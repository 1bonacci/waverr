import { describe, expect, it } from 'vitest'
import type { Track } from '../../src/shared/types'
import {
  buildQueueRows,
  isMovableRow,
  manualIndexForDrop,
  type QueueRow
} from '../../src/renderer/screen/queueRows'

function makeTrack(id: number, filename = `track_${id}.wav`): Track {
  return {
    id,
    rootId: 1,
    path: `C:/musica/${filename}`,
    filename,
    dir: 'C:/musica',
    folder: 'musica',
    ext: '.wav',
    size: 1000,
    mtime: 0,
    durationMs: 1000,
    title: null,
    artist: null,
    album: null,
    hasTags: false,
    addedAt: 0,
    lastPlayedAt: null,
    playCount: 0,
    missing: false,
    favorite: false
  }
}

const [now, m0, m1, m2, u0, u1] = [
  makeTrack(1, 'now.wav'),
  makeTrack(2, 'm0.wav'),
  makeTrack(3, 'm1.wav'),
  makeTrack(4, 'm2.wav'),
  makeTrack(5, 'u0.wav'),
  makeTrack(6, 'u1.wav')
] as [Track, Track, Track, Track, Track, Track]

describe('buildQueueRows', () => {
  it('con fila AHORA, antepone AHORA y despues intercala manual y upcoming en orden', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1], upcoming: [u0] })
    expect(rows).toEqual<QueueRow[]>([
      { section: 'now', track: now },
      { section: 'manual', track: m0, manualIndex: 0 },
      { section: 'manual', track: m1, manualIndex: 1 },
      { section: 'upcoming', track: u0, upcomingIndex: 0 }
    ])
  })

  it('sin pista sonando, no hay fila AHORA', () => {
    const rows = buildQueueRows({ now: null, manual: [m0], upcoming: [u0] })
    expect(rows[0]).toEqual({ section: 'manual', track: m0, manualIndex: 0 })
    expect(rows.some((row) => row.section === 'now')).toBe(false)
  })

  it('con la cola manual vacia, no aparece ninguna fila manual', () => {
    const rows = buildQueueRows({ now, manual: [], upcoming: [u0, u1] })
    expect(rows.filter((row) => row.section === 'manual')).toHaveLength(0)
    expect(rows).toEqual<QueueRow[]>([
      { section: 'now', track: now },
      { section: 'upcoming', track: u0, upcomingIndex: 0 },
      { section: 'upcoming', track: u1, upcomingIndex: 1 }
    ])
  })
})

describe('isMovableRow', () => {
  it('una fila de LUEGO nunca se puede mover', () => {
    const rows = buildQueueRows({ now, manual: [m0], upcoming: [u0, u1] })
    const upcomingRows = rows.filter((row) => row.section === 'upcoming')
    expect(upcomingRows.length).toBeGreaterThan(0)
    for (const row of upcomingRows) expect(isMovableRow(row)).toBe(false)
  })

  it('la fila AHORA tampoco se puede mover', () => {
    const rows = buildQueueRows({ now, manual: [m0], upcoming: [] })
    const nowRow = rows[0]!
    expect(nowRow.section).toBe('now')
    expect(isMovableRow(nowRow)).toBe(false)
  })

  it('las filas de la cola manual si se pueden mover', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1], upcoming: [] })
    const manualRows = rows.filter((row) => row.section === 'manual')
    expect(manualRows).toHaveLength(2)
    for (const row of manualRows) expect(isMovableRow(row)).toBe(true)
  })
})

describe('manualIndexForDrop', () => {
  it('con fila AHORA, la primera fila manual traduce al indice 0', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1, m2], upcoming: [] })
    // Fila 0 es AHORA, fila 1 es la primera manual.
    expect(manualIndexForDrop(rows, 1)).toBe(0)
  })

  it('con fila AHORA, la ultima fila manual traduce a su indice real', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1, m2], upcoming: [] })
    // Fila 3 es la ultima manual (AHORA + 3 manuales, indices de fila 1..3).
    expect(manualIndexForDrop(rows, 3)).toBe(2)
  })

  it('sin fila AHORA, la primera y la ultima fila manual traducen directo', () => {
    const rows = buildQueueRows({ now: null, manual: [m0, m1, m2], upcoming: [] })
    expect(manualIndexForDrop(rows, 0)).toBe(0)
    expect(manualIndexForDrop(rows, 2)).toBe(2)
  })

  it('soltar sobre la fila AHORA equivale a la punta de la cola manual', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1], upcoming: [] })
    expect(manualIndexForDrop(rows, 0)).toBe(0)
  })

  it('soltar sobre una fila de LUEGO equivale al final de la cola manual', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1], upcoming: [u0] })
    // Fila 3 (indice 0,1,2,3 -> AHORA, m0, m1, u0) es la de LUEGO.
    expect(manualIndexForDrop(rows, 3)).toBe(2)
  })

  it('con la cola manual vacia, cualquier fila traduce al indice 0', () => {
    const rows = buildQueueRows({ now, manual: [], upcoming: [u0] })
    expect(manualIndexForDrop(rows, 0)).toBe(0)
    expect(manualIndexForDrop(rows, 1)).toBe(0)
  })

  it('un indice de fila fuera de rango cae al final de la cola manual', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1], upcoming: [] })
    expect(manualIndexForDrop(rows, 99)).toBe(2)
    expect(manualIndexForDrop(rows, -1)).toBe(2)
  })
})
