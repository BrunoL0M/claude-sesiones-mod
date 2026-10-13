import { describe, expect, test } from 'claude-code/testing'

import { alignRow, fitPath, formatShort, parseTranscript, rowTitles } from '../hooks/sessions'
import type { SessionMeta } from '../types'

const NOW = new Date(2026, 9, 11, 18, 0).getTime()
const line = (row: Record<string, unknown>) => JSON.stringify(row)
const user = (content: string) => line({ type: 'user', message: { role: 'user', content } })
const meta = (over: Partial<SessionMeta>): SessionMeta => ({
  id: 'x',
  cwd: '/a',
  title: 't',
  startedAt: NOW,
  updatedAt: NOW,
  messages: 1,
  ...over,
})

describe('títulos basura', () => {
  test('salta "[Request interrupted…]" y usa el siguiente prompt', async () => {
    const text = [user('[Request interrupted by user for tool use]'), user('arregla el login')].join('\n')
    const s = parseTranscript('a', text, NOW, '/x')
    expect(s?.title).toBe('arregla el login')
    expect(s?.messages).toBe(1)
  })

  test('una sesión con solo interrupciones se omite', async () => {
    expect(parseTranscript('a', user('[Request interrupted by user]'), NOW, '/x')).toBeUndefined()
  })
})

describe('alignRow', () => {
  test('pega la derecha al borde', async () => {
    expect(alignRow('hola', '21:10', 20)).toBe('hola' + ' '.repeat(11) + '21:10')
    expect(alignRow('hola', '21:10', 20).length).toBe(20)
  })

  test('recorta la izquierda y deja un espacio', async () => {
    expect(alignRow('un título muy largo de verdad', '28/09', 20)).toBe('un título muy… 28/09')
  })
})

describe('fitPath', () => {
  test('deja la ruta si cabe', async () => {
    expect(fitPath('~/Projects/CV', 30)).toBe('~/Projects/CV')
  })

  test('recorta por el medio y conserva la última carpeta', async () => {
    expect(fitPath('~/Obsidian/Universidad/TELECOMUNICACIONES Y REDES', 40)).toBe(
      '~/Obsidian/…/TELECOMUNICACIONES Y REDES',
    )
    expect(fitPath('~/Obsidian/Universidad/TELECOMUNICACIONES Y REDES', 32)).toBe(
      '~/…/TELECOMUNICACIONES Y REDES',
    )
  })

  test('si ni la última carpeta cabe, la recorta', async () => {
    expect(fitPath('/a/una-carpeta-larguísima', 10).length).toBeLessThanOrEqual(10)
  })
})

describe('formatShort', () => {
  test('hora hoy, "ayer", día/mes y mes/año', async () => {
    expect(formatShort(new Date(2026, 9, 11, 9, 5).getTime(), NOW)).toBe('09:05')
    expect(formatShort(new Date(2026, 9, 10, 23, 0).getTime(), NOW)).toBe('ayer')
    expect(formatShort(new Date(2026, 8, 28, 22, 0).getTime(), NOW)).toBe('28/09')
    expect(formatShort(new Date(2025, 2, 1).getTime(), NOW)).toBe('03/2025')
  })
})

describe('rowTitles', () => {
  test('añade el id solo a los títulos repetidos', async () => {
    const titles = rowTitles([
      meta({ id: 'aaaaaaaa-1', title: 'install' }),
      meta({ id: 'bbbbbbbb-2', title: 'install' }),
      meta({ id: 'c', title: 'otro' }),
    ])
    expect(titles.get('aaaaaaaa-1')).toBe('install · aaaaaaaa')
    expect(titles.get('bbbbbbbb-2')).toBe('install · bbbbbbbb')
    expect(titles.get('c')).toBe('otro')
  })
})
