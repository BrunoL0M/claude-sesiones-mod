import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { SessionMeta } from '../types'
import {
  alignRow,
  BUCKET_LABEL,
  cols,
  decodeProjectDir,
  fit,
  fitPath,
  formatShort,
  formatWhen,
  groupSessions,
  parseTranscript,
  resumeCommand,
  rowTitles,
  shortPath,
  terminalArgv,
} from './sessions'

const PANE = 'sesiones'
/** Sesiones que se ven por bloque de fecha antes de "…y N más". */
const PER_BUCKET = 5
const TITLE = 'Sesiones'
const MAX_READ = 4 * 1024 * 1024 - 1
const HEAD_BYTES = String(1024 * 1024)
const CACHE_KEY = 'cache-v1'

const sessions = atom({ plugin: 'sesiones', key: 'sessions' } as const, [])
const scan = atom({ plugin: 'sesiones', key: 'scan' } as const, { isScanning: false, scannedAt: 0 })
const openDirs = atom({ plugin: 'sesiones', key: 'openDirs' } as const, [])
const openOld = atom({ plugin: 'sesiones', key: 'openOld' } as const, [])
const openMore = atom({ plugin: 'sesiones', key: 'openMore' } as const, [])
const selected = atom({ plugin: 'sesiones', key: 'selected' } as const, '')
const filter = atom({ plugin: 'sesiones', key: 'filter' } as const, '')
const home = atom({ plugin: 'sesiones', key: 'home' } as const, '')
const cwdRef = { plugin: 'sesiones', key: 'cwd' } as const
const cwd = atom(cwdRef, '')

type CacheEntry = { m: number; s: number; meta: SessionMeta | null }
type Cache = Record<string, CacheEntry>

async function projectsDir($: EngineInterface): Promise<string | undefined> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configDir) return `${configDir.replace(/\/+$/, '')}/projects`
  const homeDir = await $.env.get('HOME')
  return homeDir ? `${homeDir}/.claude/projects` : undefined
}

async function readTranscript($: EngineInterface, path: string, size: number): Promise<string> {
  if (size <= MAX_READ) return $.fs.read(path)
  // Transcripts enormes: basta con el principio para sacar cwd, título y primer prompt.
  const { stdout } = await $.process.run(['head', '-c', HEAD_BYTES, path])
  return stdout
}

let scanning: Promise<void> | undefined

/**
 * Recorre ~/.claude/projects y actualiza la lista; reusa la caché por mtime y tamaño.
 * Si ya hay un escaneo en curso devuelve ese mismo, así dos pulsaciones seguidas no
 * escanean dos veces (leer `isScanning` y luego escribirlo no es atómico).
 */
function rescan($: EngineInterface): Promise<void> {
  scanning ??= doRescan($).finally(() => {
    scanning = undefined
  })
  return scanning
}

async function doRescan($: EngineInterface): Promise<void> {
  await update($, scan, s => ({ ...s, isScanning: true, error: undefined }))
  try {
    const root = await projectsDir($)
    if (!root || !(await $.fs.exists(root))) {
      throw new Error(`No encuentro la carpeta de sesiones (${root ?? '~/.claude/projects'})`)
    }
    const old = ((await $.store.get(CACHE_KEY)) ?? {}) as Cache
    const next: Cache = {}
    const found: SessionMeta[] = []
    const jobs: (() => Promise<void>)[] = []

    for (const dir of await $.fs.list(root)) {
      if (dir.kind !== 'dir') continue
      const dirPath = `${root}/${dir.name}`
      const files = await $.fs.list(dirPath).catch(() => [])
      for (const file of files) {
        if (file.kind !== 'file' || !file.name.endsWith('.jsonl')) continue
        const path = `${dirPath}/${file.name}`
        const cached = old[path]
        if (cached && cached.m === file.mtimeMs && cached.s === file.size) {
          next[path] = cached
          if (cached.meta) found.push(cached.meta)
          continue
        }
        jobs.push(async () => {
          const id = file.name.slice(0, -'.jsonl'.length)
          const text = await readTranscript($, path, file.size).catch(() => '')
          const meta = parseTranscript(id, text, file.mtimeMs, decodeProjectDir(dir.name)) ?? null
          next[path] = { m: file.mtimeMs, s: file.size, meta }
          if (meta) found.push(meta)
        })
      }
    }

    for (let i = 0; i < jobs.length; i += 8) {
      await Promise.all(jobs.slice(i, i + 8).map(job => job()))
    }

    await $.store.set(CACHE_KEY, next).catch(() => undefined)
    await update($, sessions, () => found)
    await update($, scan, () => ({ isScanning: false, scannedAt: Date.now() }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, scan, () => ({ isScanning: false, scannedAt: Date.now(), error: message }))
  }
}

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
}

/**
 * Reanuda en una terminal nueva una sesión de otra carpeta; si no se puede,
 * copia el comando para pegarlo a mano.
 */
async function openInTerminal($: EngineInterface, s: SessionMeta, surface: RenderSurface | undefined): Promise<void> {
  try {
    const { exitCode, stderr } = await $.process.run(terminalArgv(s), { timeoutMs: 10_000 })
    if (exitCode === 0) {
      await $.ui.toast('Abriendo el chat en una terminal nueva')
      return
    }
    throw new Error(stderr.trim())
  } catch (error) {
    const reason = error instanceof Error && error.message ? `${error.message}. ` : ''
    const copied = await $.ui
      .copy({ text: resumeCommand(s), surface })
      .catch(() => ({ isCopied: false }))
    await $.ui.toast(
      copied.isCopied
        ? `${reason}No pude abrir otra terminal; comando copiado`
        : `${reason}No pude abrir otra terminal; usa: ${resumeCommand(s)}`,
    )
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sesiones',
      description: 'Abre el panel de sesiones locales (por directorio y fecha)',
      argumentHint: '[actualizar]',
    })
    const homeDir = (await $.env.get('HOME')) ?? ''
    await $.state.set({ plugin: 'sesiones', key: 'home' }, homeDir)
    await $.state.set(cwdRef, e.cwd)
    const dirs = await $.state.get({ plugin: 'sesiones', key: 'openDirs' })
    if (dirs.version === 0) await $.state.set({ plugin: 'sesiones', key: 'openDirs' }, [e.cwd])

    return next(e)
  })

  on('command.run', { command: 'sesiones' }, async ($, e) => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    const isRefresh = /^\s*(actualizar|refresh|r)\s*$/i.test(e.args)
    const { scannedAt } = await read($, scan)
    if (isRefresh || scannedAt === 0) await rescan($)
    const count = (await read($, sessions)).length

    return {
      text: opened.isPlaced
        ? `Panel de sesiones abierto (${count} sesiones).`
        : `${count} sesiones encontradas; ensancha la terminal para ver el panel.`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Input = 'Input' in ui ? ui.Input : undefined
    // Una columna de margen a la derecha: sin ella el último carácter queda bajo el borde.
    const width = Math.max(30, (e.props as { bodyColumns?: number }).bodyColumns ?? 40) - 1

    const list = await read($, sessions)
    const status = await read($, scan)
    const dirsOpen = await read($, openDirs)
    const oldOpen = await read($, openOld)
    const moreOpen = await read($, openMore)
    const picked = await read($, selected)
    const query = await read($, filter)
    const homeDir = await read($, home)
    const here = await read($, cwd)
    const now = Date.now()
    const isFiltering = query.trim() !== ''
    // La carpeta donde está abierta esta sesión va siempre primero.
    const groups = groupSessions(list, now, query, homeDir).sort(
      (a, b) => Number(b.cwd === here) - Number(a.cwd === here),
    )

    const dirCount = new Set(list.map(s => s.cwd)).size
    const header = status.isScanning
      ? 'Buscando sesiones…'
      : `Sesiones · ${list.length} en ${dirCount} ${dirCount === 1 ? 'carpeta' : 'carpetas'}`

    const sessionRow = (s: SessionMeta, label: string) => {
      const isPicked = picked === s.id
      // Claude Code solo reanuda aquí chats de esta misma carpeta (issue #4).
      const isElsewhere = here !== '' && s.cwd !== here
      const when = formatShort(s.updatedAt, now)
      const title = fit(label, width - 4 - cols(when) - 1)
      return (
        <Box key={`row:${s.id}`} flexDirection="column">
          <Button
            key={`s:${s.id}`}
            plain
            onPress={() => update($, selected, cur => (cur === s.id ? '' : s.id))}
          >
            {isPicked ? <Text color="claude">  ❯ </Text> : '    '}
            {title}
            {' '.repeat(Math.max(1, width - 4 - cols(title) - cols(when)))}
            <Text dimColor>{when}</Text>
          </Button>
          {isPicked && (
            <Box key={`detail:${s.id}`} flexDirection="column" paddingLeft={6}>
              <Text dimColor wrap="truncate">
                {s.messages} mensajes{s.gitBranch ? ` · rama ${s.gitBranch}` : ''} · empezó{' '}
                {formatWhen(s.startedAt, now)}
              </Text>
              <Box key={`actions:${s.id}`} flexDirection="row" gap={1}>
                {isElsewhere ? (
                  <Button
                    key={`open:${s.id}`}
                    variant="primary"
                    onPress={press => {
                      void openInTerminal($, s, press.surface)
                    }}
                  >
                    Abrir en terminal
                  </Button>
                ) : (
                  <Button
                    key={`resume:${s.id}`}
                    variant="primary"
                    onPress={() => {
                      $.command
                        .run({ command: 'resume', args: s.id })
                        .catch(() => $.ui.toast(`No pude reanudar; usa: ${resumeCommand(s)}`))
                    }}
                  >
                    Reanudar
                  </Button>
                )}
                <Button
                  key={`copy:${s.id}`}
                  onPress={press => {
                    void $.ui.copy({ text: resumeCommand(s), surface: press.surface }).then(r =>
                      $.ui.toast(r.isCopied ? 'Comando copiado' : resumeCommand(s)),
                    )
                  }}
                >
                  Copiar comando
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      )
    }

    /** Las sesiones de un bloque, cortadas en PER_BUCKET salvo que se pidan todas. */
    const sessionRows = (key: string, items: SessionMeta[]) => {
      const titles = rowTitles(items)
      const showAll = isFiltering || moreOpen.includes(key) || items.length <= PER_BUCKET + 1
      const shown = showAll ? items : items.slice(0, PER_BUCKET)
      return [
        ...shown.map(s => sessionRow(s, titles.get(s.id) ?? s.title)),
        ...(showAll
          ? []
          : [
              <Button
                key={`more:${key}`}
                plain
                dimColor
                onPress={() => update($, openMore, cur => toggle(cur, key))}
              >
                {`    …y ${items.length - PER_BUCKET} más`}
              </Button>,
            ]),
      ]
    }

    return (
      <Box flexDirection="column">
        <Box key="top" flexDirection="row" justifyContent="space-between" marginRight={1}>
          <Text bold wrap="truncate">
            {header}
          </Text>
          <Button key="refresh" plain hotkey="r" onPress={() => void rescan($)}>
            ⟳
          </Button>
        </Box>
        {status.error && <Text color="error">{status.error}</Text>}
        {Input && (
          <Input
            key="filter"
            label="Filtrar"
            placeholder="título o carpeta"
            value={query}
            onInput={value => void update($, filter, () => value)}
            onSubmit={value => void update($, filter, () => value)}
          />
        )}
        <Text dimColor>{'─'.repeat(width)}</Text>
        {!status.isScanning && groups.length === 0 && (
          <Text dimColor>{isFiltering ? 'Nada coincide con el filtro.' : 'No hay sesiones guardadas.'}</Text>
        )}
        {groups.map(group => {
          const isOpen = isFiltering || dirsOpen.includes(group.cwd)
          const isHere = group.cwd === here
          // Plegada, la línea resume la carpeta: cuántas sesiones y la última actividad.
          const right = isOpen
            ? String(group.total)
            : `${group.total}  ${formatShort(group.lastActivity, now).padStart(5)}`
          const mark = isHere ? ' ●' : ''
          const label = fitPath(shortPath(group.cwd, homeDir), width - 2 - cols(mark) - cols(right) - 2)
          const gap = Math.max(1, width - 2 - cols(label) - cols(mark) - cols(right))
          return (
            <Box key={`g:${group.cwd}`} flexDirection="column">
              <Button
                key={`dir:${group.cwd}`}
                plain
                onPress={() => update($, openDirs, cur => toggle(cur, group.cwd))}
              >
                {isOpen ? '▾ ' : '▸ '}
                <Text bold color="suggestion">
                  {label}
                </Text>
                {isHere && <Text color="claude">{mark}</Text>}
                {' '.repeat(gap)}
                <Text dimColor>{right}</Text>
              </Button>
              {isOpen &&
                group.buckets.map(({ bucket, sessions: items }) => {
                  const key = `${group.cwd}\n${bucket}`
                  if (bucket !== 'antiguos') {
                    return (
                      <Box key={`b:${key}`} flexDirection="column">
                        <Text dimColor bold>
                          {'  ' + alignRow(BUCKET_LABEL[bucket].toUpperCase(), String(items.length), width - 2)}
                        </Text>
                        {sessionRows(key, items)}
                      </Box>
                    )
                  }
                  const isOldOpen = isFiltering || oldOpen.includes(group.cwd)
                  return (
                    <Box key={`b:${key}`} flexDirection="column">
                      <Button
                        key={`old:${group.cwd}`}
                        plain
                        onPress={() => update($, openOld, cur => toggle(cur, group.cwd))}
                      >
                        {isOldOpen ? '  ▾ ' : '  ▸ '}
                        <Text color="warning">
                          {alignRow(BUCKET_LABEL.antiguos, String(items.length), width - 4)}
                        </Text>
                      </Button>
                      {isOldOpen && sessionRows(key, items)}
                    </Box>
                  )
                })}
            </Box>
          )
        })}
      </Box>
    )
  })
}
