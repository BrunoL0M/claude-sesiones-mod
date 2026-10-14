import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const ROOT = '/home/arch/.claude/projects'
const DIR = '-home-arch-web'
const line = (row: Record<string, unknown>) => JSON.stringify(row)
const transcript = (title: string) =>
  [
    line({ type: 'user', cwd: '/home/arch/web', message: { content: `hola ${title}` } }),
    line({ type: 'ai-title', aiTitle: title }),
  ].join('\n')

type File = { name: string; mtimeMs: number; size: number }

/**
 * Monta un ~/.claude/projects falso con un directorio y los archivos dados.
 * Devuelve contadores de lo que el mod leyó para comprobar la caché.
 */
function disk(on: On, files: File[]) {
  const seen = { reads: [] as string[], heads: [] as string[], lists: [] as string[] }
  on('fs.exists', async () => ({ value: true }))
  on('fs.list', async ($, e) => {
    seen.lists.push(e.path)
    return {
      value: e.path.endsWith('/projects')
        ? [{ name: DIR, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } as const]
        : files.map(f => ({ ...f, kind: 'file', isLink: false }) as const),
    }
  })
  on('fs.read', async ($, e) => {
    seen.reads.push(e.path)
    if (e.path.includes('roto')) throw new Error('EACCES')
    return { value: transcript(e.path.split('/').pop()!.replace('.jsonl', '')) }
  })
  on('process.run', async ($, e) => {
    seen.heads.push(e.argv.join(' '))
    return {
      value: { exitCode: 0, stdout: transcript('gigante'), stderr: '' } as never,
    }
  })
  return seen
}

const run = ($: Engine, args = '') =>
  $.command.run({
    command: 'sesiones',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

const mountPane = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'sesiones',
    surface,
    component: 'Pane',
    requestId: 'sesiones',
    props: { title: 'Sesiones', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })

const now = Date.now()

describe('escaneo y caché', () => {
  test('el segundo escaneo sin cambios no relee nada', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    const seen = disk(on, [
      { name: 'a.jsonl', mtimeMs: now, size: 10 },
      { name: 'b.jsonl', mtimeMs: now, size: 10 },
    ])
    expect((await run($)).text).toContain('2 sesiones')
    expect(seen.reads.length).toBe(2)
    expect((await run($, 'actualizar')).text).toContain('2 sesiones')
    expect(seen.reads.length).toBe(2)
  })

  test('/sesiones sin argumento no reescanea; actualizar, refresh y r sí', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    const seen = disk(on, [{ name: 'a.jsonl', mtimeMs: now, size: 10 }])
    await run($)
    await run($)
    expect(seen.lists.filter(p => p === ROOT).length).toBe(1)
    for (const arg of ['actualizar', 'refresh', ' R ']) await run($, arg)
    expect(seen.lists.filter(p => p === ROOT).length).toBe(4)
  })

  test('solo se relee el archivo que cambió de fecha o tamaño', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    const files = [
      { name: 'a.jsonl', mtimeMs: now, size: 10 },
      { name: 'b.jsonl', mtimeMs: now, size: 10 },
      { name: 'c.jsonl', mtimeMs: now, size: 10 },
    ]
    const seen = disk(on, files)
    await run($)
    files[0] = { ...files[0]!, mtimeMs: now + 1 }
    files[1] = { ...files[1]!, size: 11 }
    seen.reads.length = 0
    await run($, 'actualizar')
    expect(seen.reads.map(p => p.split('/').pop()).sort()).toEqual(['a.jsonl', 'b.jsonl'])
  })

  test('un archivo borrado desaparece de la lista', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    const files = [
      { name: 'a.jsonl', mtimeMs: now, size: 10 },
      { name: 'b.jsonl', mtimeMs: now, size: 10 },
    ]
    disk(on, files)
    expect((await run($)).text).toContain('2 sesiones')
    files.pop()
    expect((await run($, 'actualizar')).text).toContain('1 sesiones')
  })

  test('un transcript de más de 4 MB se lee con head y tail, no entero', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    const seen = disk(on, [{ name: 'g.jsonl', mtimeMs: now, size: 50 * 1024 * 1024 }])
    expect((await run($)).text).toContain('1 sesiones')
    expect(seen.reads).toEqual([])
    expect(seen.heads).toEqual([
      `sh -c head -c "$1" "$3"; echo; tail -c "$2" "$3" sh 1048576 262144 ${ROOT}/${DIR}/g.jsonl`,
    ])
  })

  test('si un archivo no se puede leer, el resto aparece igual', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    disk(on, [
      { name: 'roto.jsonl', mtimeMs: now, size: 10 },
      { name: 'ok.jsonl', mtimeMs: now, size: 10 },
    ])
    expect((await run($)).text).toContain('1 sesiones')
  })

  test('una caché corrupta en el store no rompe el escaneo', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on, { 'cache-v1': 'esto no es un objeto' })
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    disk(on, [{ name: 'a.jsonl', mtimeMs: now, size: 10 }])
    expect((await run($)).text).toContain('1 sesiones')
  })

  test('CLAUDE_CONFIG_DIR cambia la carpeta (sin doble barra)', async ($, on) => {
    mock.env(on, { HOME: '/home/arch', CLAUDE_CONFIG_DIR: '/otra/config/' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    const seen = disk(on, [{ name: 'a.jsonl', mtimeMs: now, size: 10 }])
    await run($)
    expect(seen.lists[0]).toBe('/otra/config/projects')
  })

  test('dos escaneos a la vez: solo corre uno', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    const seen = disk(on, [{ name: 'a.jsonl', mtimeMs: now, size: 10 }])
    await Promise.all([run($, 'actualizar'), run($, 'actualizar')])
    expect(seen.lists.filter(p => p === ROOT).length).toBe(1)
  })

  test('sin carpeta de sesiones: el panel muestra el error', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    on('fs.exists', async () => ({ value: false }))
    expect((await run($)).text).toContain('0 sesiones')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Text', text: /No encuentro la carpeta de sesiones/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /No hay sesiones guardadas/ })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('panel', () => {
  test('filtrar despliega directorios y chats antiguos; sin coincidencias avisa', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    disk(on, [
      { name: 'nuevo.jsonl', mtimeMs: now, size: 10 },
      { name: 'viejo.jsonl', mtimeMs: now - 60 * 86_400_000, size: 10 },
    ])
    await run($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountPane($, surface)
      expect(await ui.find({ key: 's:viejo' })).toBeUndefined()
      await ui.input({ key: 'filter', text: 'viejo', kind: 'change' })
      expect(await ui.find({ key: 's:viejo' })).toBeDefined()
      expect(await ui.find({ key: 's:nuevo' })).toBeUndefined()
      await ui.input({ key: 'filter', text: 'zzz', kind: 'change' })
      expect(await ui.find({ type: 'Text', text: /Nada coincide con el filtro/ })).toBeDefined()
      await ui.input({ key: 'filter', text: '', kind: 'change' })
      await ui.unmount()
    }
  })

  test('si /resume falla, el toast da el comando para la terminal', async ($, on) => {
    mock.env(on, { HOME: '/home/arch' })
    mock.store(on)
    on('ui.open', async () => ({ value: { isPlaced: true } as const }))
    disk(on, [{ name: 'abc.jsonl', mtimeMs: now, size: 10 }])
    const toasts: string[] = []
    on('ui.toast', async ($, e) => {
      toasts.push(e.text)
      return { value: undefined as never }
    })
    on('command.run', { command: 'resume' }, async () => {
      throw new Error('no disponible')
    })
    on('ui.copy', async () => ({ value: { isCopied: false } as never }))
    await run($)
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'dir:/home/arch/web' })
    await ui.press({ key: 's:abc' })
    await ui.press({ key: 'resume:abc' })
    await ui.press({ key: 'copy:abc' })
    const cmd = `cd '/home/arch/web' && claude --resume abc`
    expect(toasts).toEqual([`No pude reanudar; usa: ${cmd}`, cmd])
    await ui.unmount()
  })
})
