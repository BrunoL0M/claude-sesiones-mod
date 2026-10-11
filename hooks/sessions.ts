import type { SessionMeta } from '../types'

const DAY = 24 * 60 * 60 * 1000
export const OLD_AFTER_DAYS = 30

export type DateBucket = 'hoy' | 'ayer' | 'semana' | 'mes' | 'antiguos'

export const BUCKET_LABEL: Record<DateBucket, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  semana: 'Últimos 7 días',
  mes: 'Últimos 30 días',
  antiguos: 'Chats antiguos (más de 1 mes)',
}

const BUCKET_ORDER: DateBucket[] = ['hoy', 'ayer', 'semana', 'mes', 'antiguos']

export type DirGroup = {
  cwd: string
  lastActivity: number
  total: number
  buckets: { bucket: DateBucket; sessions: SessionMeta[] }[]
}

/** Quita etiquetas tipo <command-name>…</command-name> y espacios sobrantes. */
function cleanText(text: string): string {
  return text
    .replace(/<([a-z-]+)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block =>
      block && typeof block === 'object' && (block as { type?: string }).type === 'text'
        ? String((block as { text?: unknown }).text ?? '')
        : '',
    )
    .join(' ')
}

/**
 * Lee un transcript .jsonl de Claude Code y devuelve sus datos para el panel,
 * o undefined si no tiene ningún mensaje del usuario (sesión vacía).
 */
export function parseTranscript(
  id: string,
  text: string,
  mtimeMs: number,
  fallbackCwd: string,
): SessionMeta | undefined {
  let cwd: string | undefined
  let gitBranch: string | undefined
  let startedAt: number | undefined
  let customTitle: string | undefined
  let aiTitle: string | undefined
  let summary: string | undefined
  let firstPrompt: string | undefined
  let messages = 0

  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line)
    } catch {
      continue // última línea cortada o basura
    }
    if (typeof row.cwd === 'string' && cwd === undefined) cwd = row.cwd
    if (typeof row.gitBranch === 'string' && row.gitBranch) gitBranch = row.gitBranch
    if (typeof row.timestamp === 'string' && startedAt === undefined) {
      const t = Date.parse(row.timestamp)
      if (!Number.isNaN(t)) startedAt = t
    }
    switch (row.type) {
      case 'custom-title':
        if (typeof row.customTitle === 'string') customTitle = row.customTitle
        break
      case 'ai-title':
        if (typeof row.aiTitle === 'string') aiTitle = row.aiTitle
        break
      case 'summary':
        if (typeof row.summary === 'string') summary = row.summary
        break
      case 'assistant':
        if (row.isSidechain !== true) messages++
        break
      case 'user': {
        if (row.isSidechain === true) break
        const message = row.message as { content?: unknown } | undefined
        const isToolResult =
          Array.isArray(message?.content) &&
          message.content.some(
            b => b && typeof b === 'object' && (b as { type?: string }).type === 'tool_result',
          )
        if (isToolResult || row.isMeta === true) break
        messages++
        if (firstPrompt === undefined) {
          const clean = cleanText(textOf(message?.content))
          if (clean) firstPrompt = clean
        }
        break
      }
    }
  }

  if (firstPrompt === undefined && customTitle === undefined && aiTitle === undefined) {
    return undefined
  }
  const title = customTitle ?? aiTitle ?? summary ?? firstPrompt ?? '(sin título)'
  return {
    id,
    cwd: cwd ?? fallbackCwd,
    title: title.length > 120 ? `${title.slice(0, 117)}…` : title,
    gitBranch,
    startedAt: startedAt ?? mtimeMs,
    updatedAt: mtimeMs,
    messages,
  }
}

/**
 * Nombre de carpeta de ~/.claude/projects → ruta aproximada. Es con pérdida
 * (un "-" del nombre real también se vuelve "/"), por eso solo se usa si el
 * transcript no trae su `cwd`.
 */
export function decodeProjectDir(name: string): string {
  return name.startsWith('-') ? name.replace(/-/g, '/') : name
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function bucketOf(updatedAt: number, now: number): DateBucket {
  const today = startOfDay(now)
  if (updatedAt >= today) return 'hoy'
  if (updatedAt >= today - DAY) return 'ayer'
  if (updatedAt >= today - 6 * DAY) return 'semana'
  if (updatedAt >= now - OLD_AFTER_DAYS * DAY) return 'mes'
  return 'antiguos'
}

/** Agrupa primero por directorio y dentro de cada uno por fecha. */
export function groupSessions(
  sessions: readonly SessionMeta[],
  now: number,
  filter = '',
): DirGroup[] {
  const needle = filter.trim().toLowerCase()
  const byDir = new Map<string, SessionMeta[]>()
  for (const s of sessions) {
    if (
      needle &&
      !s.title.toLowerCase().includes(needle) &&
      !s.cwd.toLowerCase().includes(needle)
    ) {
      continue
    }
    const list = byDir.get(s.cwd) ?? []
    list.push(s)
    byDir.set(s.cwd, list)
  }
  const groups: DirGroup[] = []
  for (const [cwd, list] of byDir) {
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    const buckets = BUCKET_ORDER.map(bucket => ({
      bucket,
      sessions: list.filter(s => bucketOf(s.updatedAt, now) === bucket),
    })).filter(b => b.sessions.length > 0)
    groups.push({ cwd, lastActivity: list[0]?.updatedAt ?? 0, total: list.length, buckets })
  }
  return groups.sort((a, b) => b.lastActivity - a.lastActivity)
}

export function shortPath(cwd: string, home: string | undefined): string {
  if (home && (cwd === home || cwd.startsWith(home + '/'))) return '~' + cwd.slice(home.length)
  return cwd
}

export function formatWhen(ms: number, now: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (bucketOf(ms, now) === 'hoy') return hm
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
  return new Date(now).getFullYear() === d.getFullYear()
    ? `${date} ${hm}`
    : `${date}/${d.getFullYear()}`
}

/** Comando para reanudar la sesión desde cualquier terminal. */
export function resumeCommand(s: SessionMeta): string {
  const quoted = `'${s.cwd.replace(/'/g, `'\\''`)}'`
  return `cd ${quoted} && claude --resume ${s.id}`
}
