import { describe, expect, mock, test } from 'claude-code/testing'

import { bucketOf, groupSessions, parseTranscript, resumeCommand } from '../hooks/sessions'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 9, 11, 18, 0).getTime()

const line = (row: Record<string, unknown>) => JSON.stringify(row)

const TRANSCRIPT = [
  line({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-11T10:00:00.000Z' }),
  line({
    type: 'user',
    cwd: '/home/arch/proyectos/web',
    gitBranch: 'main',
    timestamp: '2026-10-11T10:00:01.000Z',
    message: { role: 'user', content: '<command-name>/clear</command-name> arregla el login' },
  }),
  line({ type: 'assistant', timestamp: '2026-10-11T10:00:05.000Z', message: { content: [] } }),
  line({
    type: 'user',
    timestamp: '2026-10-11T10:00:06.000Z',
    message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
  }),
  line({ type: 'ai-title', aiTitle: 'Arreglar el login', sessionId: 'abc' }),
  '{"type":"user","cut',
].join('\n')

describe('parseTranscript', () => {
  test('saca cwd, título, rama y cuenta de mensajes', async () => {
    const meta = parseTranscript('abc', TRANSCRIPT, NOW, '/fallback')
    expect(meta?.cwd).toBe('/home/arch/proyectos/web')
    expect(meta?.title).toBe('Arreglar el login')
    expect(meta?.gitBranch).toBe('main')
    expect(meta?.messages).toBe(2)
  })

  test('sin título de IA usa el primer prompt limpio', async () => {
    const noTitle = TRANSCRIPT.split('\n').filter(l => !l.includes('ai-title')).join('\n')
    expect(parseTranscript('abc', noTitle, NOW, '/x')?.title).toBe('arregla el login')
  })

  test('una sesión sin prompts se descarta', async () => {
    expect(parseTranscript('vacia', line({ type: 'summary', summary: 'x' }), NOW, '/x')).toBe(
      undefined,
    )
  })
})

describe('fechas', () => {
  test('hoy, ayer, semana, mes y antiguos', async () => {
    expect(bucketOf(NOW - 60_000, NOW)).toBe('hoy')
    expect(bucketOf(NOW - DAY, NOW)).toBe('ayer')
    expect(bucketOf(NOW - 4 * DAY, NOW)).toBe('semana')
    expect(bucketOf(NOW - 20 * DAY, NOW)).toBe('mes')
    expect(bucketOf(NOW - 31 * DAY, NOW)).toBe('antiguos')
  })

  test('agrupa por directorio, el más reciente primero', async () => {
    const s = (id: string, cwd: string, ago: number) => ({
      id,
      cwd,
      title: id,
      startedAt: NOW - ago,
      updatedAt: NOW - ago,
      messages: 1,
    })
    const groups = groupSessions(
      [s('a', '/a', 40 * DAY), s('b', '/b', 0), s('c', '/a', DAY), s('d', '/a', 50 * DAY)],
      NOW,
    )
    expect(groups.map(g => g.cwd)).toEqual(['/b', '/a'])
    expect(groups[1]?.buckets.map(b => b.bucket)).toEqual(['ayer', 'antiguos'])
    expect(groups[1]?.buckets[1]?.sessions.map(x => x.id)).toEqual(['a', 'd'])
    expect(groupSessions([s('a', '/a', 0)], NOW, 'zzz')).toEqual([])
  })

  test('comando de reanudar con comillas seguras', async () => {
    expect(
      resumeCommand({ id: 'x1', cwd: "/home/a/it's", title: '', startedAt: 0, updatedAt: 0, messages: 0 }),
    ).toBe(`cd '/home/a/it'\\''s' && claude --resume x1`)
  })
})

test('el panel lista las sesiones del disco por directorio', async ($, on) => {
  mock.env(on, { HOME: '/home/arch' })
  mock.store(on)
  const root = '/home/arch/.claude/projects'
  const recent = Date.now() - 60_000
  const old = Date.now() - 45 * DAY
  const file = (name: string, mtimeMs: number) =>
    ({ name, kind: 'file', size: TRANSCRIPT.length, mtimeMs, isLink: false }) as const
  on('ui.open', async () => ({ value: { isPlaced: true } as const }))
  on('fs.exists', async () => ({ value: true }))
  on('fs.list', async ($, e) => ({
    value:
      e.path === root
        ? [{ name: '-home-arch-proyectos-web', kind: 'dir', size: 0, mtimeMs: 0, isLink: false } as const]
        : [file('abc.jsonl', recent), file('viejo.jsonl', old), file('notas.txt', recent)],
  }))
  on('fs.read', async ($, e) => ({
    value: e.path.endsWith('viejo.jsonl')
      ? TRANSCRIPT.replace('Arreglar el login', 'Chat viejo')
      : TRANSCRIPT,
  }))

  const ran = await $.command.run({
    command: 'sesiones',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toContain('2 sesiones')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'sesiones',
      surface,
      component: 'Pane',
      requestId: 'sesiones',
      props: { title: 'Sesiones', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
    })
    expect(await ui.find({ type: 'Text', text: /Sesiones · 2 en 1 carpeta$/ })).toBeDefined()
    const dir = 'dir:/home/arch/proyectos/web'
    expect(await ui.find({ key: 's:abc' })).toBeUndefined()
    await ui.press({ key: dir })
    expect(await ui.find({ key: 's:abc' })).toBeDefined()
    // los chats de hace más de un mes van plegados en "Chats antiguos"
    const oldKey = 'old:/home/arch/proyectos/web'
    expect(await ui.find({ key: oldKey })).toBeDefined()
    expect(await ui.find({ key: 's:viejo' })).toBeUndefined()
    await ui.press({ key: oldKey })
    expect(await ui.find({ key: 's:viejo' })).toBeDefined()
    await ui.press({ key: oldKey })
    // pulsar una sesión muestra sus acciones
    await ui.press({ key: 's:abc' })
    expect(await ui.find({ key: 'copy:abc' })).toBeDefined()
    await ui.press({ key: 's:abc' })
    await ui.press({ key: dir })
    await ui.unmount()
  }
})
