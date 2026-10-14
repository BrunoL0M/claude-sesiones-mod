import { describe, expect, test } from 'claude-code/testing'

import {
  bucketOf,
  decodeProjectDir,
  formatWhen,
  groupSessions,
  parseTranscript,
  renameArgv,
  resumeCommand,
  terminalArgv,
} from '../hooks/sessions'
import type { SessionMeta } from '../types'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 9, 11, 18, 0).getTime()
const line = (row: Record<string, unknown>) => JSON.stringify(row)
const user = (content: unknown, extra: Record<string, unknown> = {}) =>
  line({ type: 'user', message: { role: 'user', content }, ...extra })
const meta = (over: Partial<SessionMeta>): SessionMeta => ({
  id: 'x',
  cwd: '/a',
  title: 'x',
  startedAt: NOW,
  updatedAt: NOW,
  messages: 1,
  ...over,
})

describe('parseTranscript · bordes', () => {
  test('custom-title gana a ai-title y a summary', async () => {
    const t = [
      user('hola', { cwd: '/a' }),
      line({ type: 'summary', summary: 'resumen' }),
      line({ type: 'ai-title', aiTitle: 'automático' }),
      line({ type: 'custom-title', customTitle: 'mío' }),
    ].join('\n')
    expect(parseTranscript('a', t, NOW, '/x')?.title).toBe('mío')
  })

  test('sin títulos, summary gana al primer prompt', async () => {
    const t = [user('hola'), line({ type: 'summary', summary: 'resumen' })].join('\n')
    expect(parseTranscript('a', t, NOW, '/x')?.title).toBe('resumen')
  })

  test('títulos largos se cortan a 120 con …', async () => {
    const title = parseTranscript('a', user('x'.repeat(200)), NOW, '/x')?.title ?? ''
    expect(title.length).toBe(118)
    expect(title.endsWith('…')).toBe(true)
  })

  test('sin cwd usa el de la carpeta; sin timestamp usa el mtime', async () => {
    const m = parseTranscript('a', user('hola'), 1234, '/desde/carpeta')
    expect(m?.cwd).toBe('/desde/carpeta')
    expect(m?.startedAt).toBe(1234)
    expect(m?.updatedAt).toBe(1234)
  })

  test('el cwd puede venir en una línea posterior', async () => {
    const t = [line({ type: 'queue-operation' }), user('hola', { cwd: '/real' })].join('\n')
    expect(parseTranscript('a', t, NOW, '/x')?.cwd).toBe('/real')
  })

  test('subagentes (isSidechain) e isMeta no cuentan ni dan título', async () => {
    const t = [
      user('del subagente', { isSidechain: true }),
      line({ type: 'assistant', isSidechain: true }),
      user('caveat interno', { isMeta: true }),
      user('el prompt real'),
      line({ type: 'assistant' }),
    ].join('\n')
    const m = parseTranscript('a', t, NOW, '/x')
    expect(m?.title).toBe('el prompt real')
    expect(m?.messages).toBe(2)
  })

  test('un prompt que solo trae etiquetas se salta', async () => {
    const t = [user('<system-reminder>ruido</system-reminder>'), user('segundo')].join('\n')
    expect(parseTranscript('a', t, NOW, '/x')?.title).toBe('segundo')
  })

  test('contenido en bloques: junta solo el texto', async () => {
    const t = user([
      { type: 'image', source: {} },
      { type: 'text', text: 'mira' },
      { type: 'text', text: 'esto' },
    ])
    expect(parseTranscript('a', t, NOW, '/x')?.title).toBe('mira esto')
  })

  test('saltos \\r\\n, líneas vacías y basura no rompen', async () => {
    const t = ['', 'no es json', user('hola', { cwd: '/a' }), '', '{"roto":'].join('\r\n')
    expect(parseTranscript('a', t, NOW, '/x')?.title).toBe('hola')
  })

  test('archivo vacío o solo basura → se descarta', async () => {
    expect(parseTranscript('a', '', NOW, '/x')).toBe(undefined)
    expect(parseTranscript('a', 'basura\n{{', NOW, '/x')).toBe(undefined)
  })
})

describe('fechas · bordes', () => {
  test('medianoche exacta de hoy es Hoy, un ms antes es Ayer', async () => {
    const midnight = new Date(2026, 9, 11, 0, 0, 0, 0).getTime()
    expect(bucketOf(midnight, NOW)).toBe('hoy')
    expect(bucketOf(midnight - 1, NOW)).toBe('ayer')
  })

  test('30 días exactos siguen en el mes; 1 ms más ya es antiguo', async () => {
    expect(bucketOf(NOW - 30 * DAY, NOW)).toBe('mes')
    expect(bucketOf(NOW - 30 * DAY - 1, NOW)).toBe('antiguos')
  })

  test('una fecha futura (reloj desfasado) cuenta como Hoy', async () => {
    expect(bucketOf(NOW + DAY, NOW)).toBe('hoy')
  })

  // Los cortes son por día de calendario, no por bloques de 24 h: así no se
  // corren una hora el día que cambia el horario de verano. Ojo: `claude plugin test`
  // corre siempre en UTC (no hay cambio de hora), así que aquí no puede fallar;
  // el arreglo se comprobó aparte con bun y TZ=America/Santiago, Europe/Madrid, etc.
  test('el día después de un cambio de hora, anteayer no es Ayer', async () => {
    for (const [y, m, d] of [
      [2026, 8, 7], // Chile adelanta el reloj el 6-sep-2026
      [2026, 3, 6], // y lo atrasa el 5-abr-2026
      [2026, 2, 30], // Europa adelanta el 29-mar-2026
      [2026, 9, 26], // y atrasa el 25-oct-2026
    ] as const) {
      const now = new Date(y, m, d, 10, 0).getTime()
      expect(bucketOf(new Date(y, m, d - 1, 0, 30).getTime(), now)).toBe('ayer')
      expect(bucketOf(new Date(y, m, d - 1, 23, 59).getTime(), now)).toBe('ayer')
      expect(bucketOf(new Date(y, m, d - 2, 23, 30).getTime(), now)).toBe('semana')
      expect(bucketOf(new Date(y, m, d - 6, 0, 30).getTime(), now)).toBe('semana')
      expect(bucketOf(new Date(y, m, d - 7, 23, 30).getTime(), now)).toBe('mes')
    }
  })

  test('formatWhen: hoy solo hora, este año día/mes, otro año con año', async () => {
    const jan2 = new Date(2026, 0, 2, 9, 5).getTime()
    expect(formatWhen(new Date(2026, 0, 2, 8, 7).getTime(), jan2)).toBe('08:07')
    expect(formatWhen(new Date(2026, 0, 1, 23, 0).getTime(), jan2)).toBe('01/01 23:00')
    expect(formatWhen(new Date(2025, 11, 31, 23, 0).getTime(), jan2)).toBe('31/12/2025')
  })

  test('decodeProjectDir pierde los guiones (por eso se prefiere cwd)', async () => {
    expect(decodeProjectDir('-home-arch-mi-proyecto')).toBe('/home/arch/mi/proyecto')
    expect(decodeProjectDir('raro')).toBe('raro')
  })
})

describe('filtro y agrupación · bordes', () => {
  const list = [
    meta({ id: '1', cwd: '/home/arch/web', title: 'Arreglar LOGIN', updatedAt: NOW - 1000 }),
    meta({ id: '2', cwd: '/home/arch/api', title: 'tests', updatedAt: NOW - 5000 }),
  ]

  test('el filtro ignora mayúsculas y espacios alrededor', async () => {
    expect(groupSessions(list, NOW, '  login ').map(g => g.cwd)).toEqual(['/home/arch/web'])
  })

  test('el filtro también busca por ruta', async () => {
    expect(groupSessions(list, NOW, 'api').map(g => g.cwd)).toEqual(['/home/arch/api'])
  })

  test('el filtro acepta la ruta como la muestra el panel (~/…)', async () => {
    expect(groupSessions(list, NOW, '~/web', '/home/arch').map(g => g.cwd)).toEqual([
      '/home/arch/web',
    ])
  })

  test('dentro de un grupo, total y orden por actividad', async () => {
    const g = groupSessions(
      [meta({ id: 'a', updatedAt: NOW - 3000 }), meta({ id: 'b', updatedAt: NOW - 1000 })],
      NOW,
    )
    expect(g[0]?.total).toBe(2)
    expect(g[0]?.lastActivity).toBe(NOW - 1000)
    expect(g[0]?.buckets[0]?.sessions.map(s => s.id)).toEqual(['b', 'a'])
  })
})

describe('resumeCommand · seguridad', () => {
  test('rutas con $(), backticks, ; y saltos de línea quedan entre comillas', async () => {
    const cmd = resumeCommand(meta({ id: 'abc', cwd: '/tmp/$(rm -rf ~)`x`;y\nz' }))
    expect(cmd).toBe(`cd '/tmp/$(rm -rf ~)\`x\`;y\nz' && claude --resume abc`)
  })

  test('un id raro (sale del nombre del archivo) también se cita', async () => {
    expect(resumeCommand(meta({ id: 'x; rm -rf ~', cwd: '/a' }))).toBe(
      `cd '/a' && claude --resume 'x; rm -rf ~'`,
    )
  })

  test('un UUID normal se deja tal cual', async () => {
    const id = '0f8e2c1a-1b2c-4d5e-8f90-123456789abc'
    expect(resumeCommand(meta({ id, cwd: '/a' }))).toBe(`cd '/a' && claude --resume ${id}`)
  })
})

describe('terminalArgv · abrir en otra terminal (issue #4)', () => {
  test('la ruta y el id viajan como argumentos, fuera del script', async () => {
    const argv = terminalArgv(meta({ id: 'x; rm -rf ~', cwd: "/tmp/$(rm -rf ~)'y" }))
    expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
    expect(argv.slice(3)).toEqual(['sh', "/tmp/$(rm -rf ~)'y", 'claude', '--resume', 'x; rm -rf ~'])
    expect(argv[2]).not.toContain('rm -rf')
  })

  test('se desacopla y no hereda las tuberías', async () => {
    expect(terminalArgv(meta({}))[2]).toContain('setsid -f "$@" </dev/null >/dev/null 2>&1')
  })
})

describe('renameArgv · cambiar el título', () => {
  test('añade la línea custom-title de /rename, con ruta y título como argumentos', async () => {
    const argv = renameArgv("/p/a'b.jsonl", 'abc', '  Nuevo\n  título $(x) "q"  ')!
    expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
    expect(argv.slice(3, 5)).toEqual(['sh', "/p/a'b.jsonl"])
    expect(JSON.parse(argv[5]!)).toEqual({
      type: 'custom-title',
      customTitle: 'Nuevo título $(x) "q"',
      sessionId: 'abc',
    })
    expect(argv[2]).not.toContain('Nuevo')
  })

  test('un título vacío no cambia nada', async () => {
    expect(renameArgv('/p/a.jsonl', 'abc', '   ')).toBeUndefined()
  })

  test('el título nuevo gana al automático al volver a leer', async () => {
    const row = renameArgv('/p/a.jsonl', 'abc', 'Mi título')![5]!
    const text = [user('hola', { cwd: '/a' }), line({ type: 'ai-title', aiTitle: 'Auto' }), row].join('\n')
    expect(parseTranscript('abc', text, NOW, '/a')?.title).toBe('Mi título')
  })
})
