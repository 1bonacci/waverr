import { describe, expect, it } from 'vitest'
import type { Track } from '../../src/shared/types'
import {
  buildQueueRows,
  isMovableRow,
  manualIndexForDrop,
  occurrenceInManual,
  resolveManualIndexById,
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

describe('occurrenceInManual', () => {
  it('sin repetidos, cada fila es la ocurrencia 0', () => {
    const rows = buildQueueRows({ now, manual: [m0, m1, m2], upcoming: [] })
    expect(occurrenceInManual(rows, 0)).toBe(0)
    expect(occurrenceInManual(rows, 1)).toBe(0)
    expect(occurrenceInManual(rows, 2)).toBe(0)
  })

  it('con una pista repetida, cuenta cual copia es', () => {
    // Cola manual [X, Y, X]: encolar la misma pista dos veces esta permitido
    // a proposito (enqueue no deduplica).
    const rows = buildQueueRows({ now: null, manual: [m0, m1, m0], upcoming: [] })
    expect(occurrenceInManual(rows, 0)).toBe(0) // primera copia de m0
    expect(occurrenceInManual(rows, 1)).toBe(0) // m1, sin repetidos
    expect(occurrenceInManual(rows, 2)).toBe(1) // segunda copia de m0
  })

  it('con una pista repetida tres veces, cuenta las tres ocurrencias', () => {
    const rows = buildQueueRows({ now: null, manual: [m0, m0, m0], upcoming: [] })
    expect(occurrenceInManual(rows, 0)).toBe(0)
    expect(occurrenceInManual(rows, 1)).toBe(1)
    expect(occurrenceInManual(rows, 2)).toBe(2)
  })
})

describe('resolveManualIndexById', () => {
  it('sin repetidos, resuelve por trackId sin que la ocurrencia cambie nada', () => {
    // Estado al agarrar la fila: AHORA=now, MANUAL=[m0, m1, m2]. Se agarra m2.
    const before = buildQueueRows({ now, manual: [m0, m1, m2], upcoming: [] })
    expect(resolveManualIndexById(before, m2.id, occurrenceInManual(before, 2))).toBe(2)

    // Mientras se arrastra termina la pista que sonaba: se consume m0 (pasa a
    // ser AHORA) y la cola manual queda mas corta. El indice de fila de m2
    // cambio (de 3 a 2 con AHORA presente), pero su identidad sigue
    // resolviendo al indice de manual correcto.
    const after = buildQueueRows({ now: m0, manual: [m1, m2], upcoming: [] })
    expect(resolveManualIndexById(after, m2.id, 0)).toBe(1)
  })

  it('si la pista agarrada se consumio sola, no hay donde resolverla', () => {
    const rows = buildQueueRows({ now: m0, manual: [m1, m2], upcoming: [] })
    expect(resolveManualIndexById(rows, m0.id, 0)).toBeNull()
  })

  // Regresion: con la cola manual en [X, Y, X], agarrar la tercera fila (la
  // segunda copia de X) y soltarla resolvia siempre a la PRIMERA coincidencia
  // por trackId (indice 0), moviendo la copia equivocada. Encolar la misma
  // pista dos veces esta permitido a proposito, asi que hace falta desempatar
  // por ocurrencia, no solo por trackId.
  describe('con la pista repetida, desempata por ocurrencia', () => {
    it('cola sin repetidos: no cambia nada', () => {
      const rows = buildQueueRows({ now: null, manual: [m0, m1, m2], upcoming: [] })
      expect(resolveManualIndexById(rows, m1.id, 0)).toBe(1)
    })

    it('[X, Y, X]: agarrar la primera copia de X resuelve al indice 0', () => {
      const rows = buildQueueRows({ now: null, manual: [m0, m1, m0], upcoming: [] })
      expect(resolveManualIndexById(rows, m0.id, 0)).toBe(0)
    })

    it('[X, Y, X]: agarrar la segunda copia de X resuelve al indice 2, no al 0', () => {
      const rows = buildQueueRows({ now: null, manual: [m0, m1, m0], upcoming: [] })
      expect(resolveManualIndexById(rows, m0.id, 1)).toBe(2)
    })

    it('pista repetida tres veces: cada ocurrencia resuelve a su propio indice', () => {
      const rows = buildQueueRows({ now: null, manual: [m0, m0, m0], upcoming: [] })
      expect(resolveManualIndexById(rows, m0.id, 0)).toBe(0)
      expect(resolveManualIndexById(rows, m0.id, 1)).toBe(1)
      expect(resolveManualIndexById(rows, m0.id, 2)).toBe(2)
    })

    it('si una copia anterior se consumio sola, cae a la ultima copia que quede', () => {
      // Se agarro la tercera fila de [X, Y, X] (ocurrencia 1). Mientras se
      // arrastraba, la primera copia de X paso a sonar (AHORA) y salio de la
      // cola manual: ahora solo queda una copia, la que se agarro.
      const rows = buildQueueRows({ now: m0, manual: [m1, m0], upcoming: [] })
      expect(resolveManualIndexById(rows, m0.id, 1)).toBe(1)
    })
  })
})
