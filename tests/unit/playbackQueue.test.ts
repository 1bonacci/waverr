import { describe, expect, it } from 'vitest'
import type { Track } from '../../src/shared/types'
import {
  advance,
  EMPTY_QUEUE,
  enqueue,
  enqueueNext,
  move,
  playNow,
  previous,
  queueView,
  removeAt,
  setShuffle,
  skipToManual
} from '../../src/renderer/audio/playbackQueue'

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

const [a, b, c, d] = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)]

describe('playNow', () => {
  it('empieza a sonar la pista elegida del contexto', () => {
    const state = playNow(EMPTY_QUEUE, [a, b, c], 1)
    expect(state.current).toBe(b)
    expect(queueView(state).upcoming).toEqual([c])
  })

  it('no borra la cola manual', () => {
    const withManual = enqueue(EMPTY_QUEUE, d)
    const state = playNow(withManual, [a, b, c], 0)
    expect(state.manual).toEqual([d])
  })

  it('un indice fuera de rango no rompe', () => {
    const state = playNow(EMPTY_QUEUE, [a, b], 99)
    expect(state.current).toBe(b)
  })

  it('un contexto vacio deja todo quieto', () => {
    const state = playNow(EMPTY_QUEUE, [], 0)
    expect(state.current).toBeNull()
    expect(queueView(state).upcoming).toEqual([])
  })
})

describe('encolar', () => {
  it('enqueue agrega al final', () => {
    const state = enqueue(enqueue(EMPTY_QUEUE, a), b)
    expect(state.manual).toEqual([a, b])
  })

  it('enqueueNext agrega al principio', () => {
    const state = enqueueNext(enqueue(EMPTY_QUEUE, a), b)
    expect(state.manual).toEqual([b, a])
  })

  it('permite la misma pista dos veces', () => {
    const state = enqueue(enqueue(EMPTY_QUEUE, a), a)
    expect(state.manual).toHaveLength(2)
  })
})

describe('advance', () => {
  it('consume primero la cola manual', () => {
    const state = enqueue(playNow(EMPTY_QUEUE, [a, b, c], 0), d)
    const next = advance(state, 'off')!
    expect(next.current).toBe(d)
    expect(next.manual).toEqual([])
  })

  it('agotada la cola manual sigue por el contexto donde iba', () => {
    let state = enqueue(playNow(EMPTY_QUEUE, [a, b, c], 0), d)
    state = advance(state, 'off')!
    state = advance(state, 'off')!
    expect(state.current).toBe(b)
  })

  it('al final del contexto devuelve null', () => {
    const state = playNow(EMPTY_QUEUE, [a, b], 1)
    expect(advance(state, 'off')).toBeNull()
  })

  it('con repeat all vuelve al principio del contexto', () => {
    const state = playNow(EMPTY_QUEUE, [a, b], 1)
    expect(advance(state, 'all')!.current).toBe(a)
  })

  it('con repeat one no consume nada', () => {
    const state = enqueue(playNow(EMPTY_QUEUE, [a, b], 0), d)
    const next = advance(state, 'one')!
    expect(next.current).toBe(a)
    expect(next.manual).toEqual([d])
  })
})

describe('previous', () => {
  it('retrocede dentro del contexto', () => {
    const state = playNow(EMPTY_QUEUE, [a, b, c], 2)
    expect(previous(state)!.current).toBe(b)
  })

  it('en el primer tema devuelve null', () => {
    const state = playNow(EMPTY_QUEUE, [a, b], 0)
    expect(previous(state)).toBeNull()
  })
})

describe('shuffle', () => {
  it('mezcla el contexto pero deja quieta la cola manual', () => {
    const context = Array.from({ length: 30 }, (_, index) => makeTrack(index + 10))
    let state = playNow(EMPTY_QUEUE, context, 0)
    state = enqueue(enqueue(state, a), b)

    const shuffled = setShuffle(state, true)

    expect(shuffled.manual).toEqual([a, b])
    // Sigue estando el contexto entero, solo cambio el orden.
    expect(new Set(shuffled.order)).toEqual(new Set(context.map((_, index) => index)))
    expect(queueView(shuffled).upcoming).not.toEqual(queueView(state).upcoming)
  })

  it('no cambia lo que esta sonando', () => {
    const context = Array.from({ length: 20 }, (_, index) => makeTrack(index + 10))
    const state = playNow(EMPTY_QUEUE, context, 5)
    expect(setShuffle(state, true).current).toBe(state.current)
  })

  it('apagarlo devuelve el orden original', () => {
    const context = [a, b, c, d]
    const state = setShuffle(setShuffle(playNow(EMPTY_QUEUE, context, 0), true), false)
    expect(state.order).toEqual([0, 1, 2, 3])
    expect(state.current).toBe(a)
  })
})

describe('editar la cola manual', () => {
  it('removeAt saca el elemento indicado', () => {
    const state = enqueue(enqueue(enqueue(EMPTY_QUEUE, a), b), c)
    expect(removeAt(state, 1).manual).toEqual([a, c])
  })

  it('removeAt fuera de rango no hace nada', () => {
    const state = enqueue(EMPTY_QUEUE, a)
    expect(removeAt(state, 7).manual).toEqual([a])
  })

  it('move reordena', () => {
    const state = enqueue(enqueue(enqueue(EMPTY_QUEUE, a), b), c)
    expect(move(state, 2, 0).manual).toEqual([c, a, b])
  })

  it('move satura en los extremos en vez de envolver', () => {
    const state = enqueue(enqueue(EMPTY_QUEUE, a), b)
    expect(move(state, 0, -5).manual).toEqual([a, b])
    expect(move(state, 0, 99).manual).toEqual([b, a])
  })
})

describe('skipToManual', () => {
  it('la pista elegida pasa a sonar y las anteriores quedan para despues', () => {
    const state = enqueue(enqueue(enqueue(EMPTY_QUEUE, a), b), c)
    const next = skipToManual(state, 2)
    expect(next.current).toBe(c)
    // a y b (las que estaban antes de c) siguen en la cola manual, en el
    // mismo orden: no se pierden por haber saltado por encima de ellas.
    expect(next.manual).toEqual([a, b])
  })

  it('saltar a la primera pista de la cola manual la deja sin nada por delante', () => {
    const state = enqueue(enqueue(EMPTY_QUEUE, a), b)
    const next = skipToManual(state, 0)
    expect(next.current).toBe(a)
    expect(next.manual).toEqual([b])
  })

  it('descarta lo que sonaba antes del salto, como cualquier avance', () => {
    let state = playNow(EMPTY_QUEUE, [d], 0)
    state = enqueue(enqueue(state, a), b)
    const next = skipToManual(state, 1)
    expect(next.current).toBe(b)
    expect(next.manual).toEqual([a])
  })

  it('un indice fuera de rango no hace nada', () => {
    const state = enqueue(EMPTY_QUEUE, a)
    expect(skipToManual(state, 7)).toEqual(state)
    expect(skipToManual(state, -1)).toEqual(state)
  })
})

describe('queueView', () => {
  it('separa lo que suena, lo encolado y lo que sigue del contexto', () => {
    let state = playNow(EMPTY_QUEUE, [a, b, c], 0)
    state = enqueue(state, d)

    expect(queueView(state)).toEqual({ now: a, manual: [d], upcoming: [b, c] })
  })
})
