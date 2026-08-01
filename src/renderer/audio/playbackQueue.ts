import type { Track } from '@shared/types'

export type RepeatMode = 'off' | 'one' | 'all'

/**
 * Orden de reproduccion, modelado como datos inmutables.
 *
 * Modulo puro a proposito: no toca el DOM ni el AudioContext. `AudioEngine` lo
 * usa para saber que sigue; aca se puede probar todo el comportamiento sin
 * levantar la app.
 */
export interface QueueState {
  /** Lo que esta sonando. Puede venir de la cola manual o del contexto. */
  current: Track | null
  /** Lo que el usuario encolo a proposito. Nunca se mezcla ni se descarta solo. */
  manual: Track[]
  /** La lista que se estaba mirando al elegir una pista. */
  context: Track[]
  /** Permutacion de indices de `context`. Sin shuffle es la identidad. */
  order: number[]
  /** Posicion dentro de `order` de la ultima pista de contexto que sono. */
  contextPosition: number
  shuffle: boolean
}

export const EMPTY_QUEUE: QueueState = {
  current: null,
  manual: [],
  context: [],
  order: [],
  contextPosition: -1,
  shuffle: false
}

export interface QueueView {
  now: Track | null
  manual: Track[]
  upcoming: Track[]
}

/**
 * Reemplaza el contexto y empieza a sonar `context[index]`.
 *
 * La cola manual sobrevive: lo que el usuario pidio explicitamente no se
 * pierde por elegir otra cosa para escuchar ahora.
 */
export function playNow(state: QueueState, context: Track[], index: number): QueueState {
  if (context.length === 0) {
    return { ...state, current: null, context: [], order: [], contextPosition: -1 }
  }

  const startIndex = clamp(index, 0, context.length - 1)
  const order = buildOrder(context.length, startIndex, state.shuffle)
  const contextPosition = order.indexOf(startIndex)

  return {
    ...state,
    context,
    order,
    contextPosition,
    current: context[startIndex] ?? null
  }
}

export function enqueue(state: QueueState, track: Track): QueueState {
  return { ...state, manual: [...state.manual, track] }
}

export function enqueueNext(state: QueueState, track: Track): QueueState {
  return { ...state, manual: [track, ...state.manual] }
}

export function removeAt(state: QueueState, index: number): QueueState {
  if (index < 0 || index >= state.manual.length) return state
  const manual = [...state.manual]
  manual.splice(index, 1)
  return { ...state, manual }
}

/**
 * Salta directo a una pista de la cola manual sin descartar las que quedaron
 * antes de ella.
 *
 * Elegirla la pone a sonar; las que estaban delante en la cola manual (mas
 * cerca del frente) siguen ahi, listas para sonar despues: lo que el usuario
 * encolo a proposito no se pierde por elegir escuchar antes otra cosa que
 * tambien habia encolado. `index` fuera de rango no hace nada.
 */
export function skipToManual(state: QueueState, index: number): QueueState {
  if (index < 0 || index >= state.manual.length) return state
  const manual = [...state.manual]
  const [chosen] = manual.splice(index, 1)
  if (!chosen) return state
  return { ...state, current: chosen, manual }
}

/** Mueve dentro de la cola manual. Satura en los extremos: envolver al
 *  reordenar casi siempre es un error de dedo, no una intencion. */
export function move(state: QueueState, from: number, to: number): QueueState {
  if (from < 0 || from >= state.manual.length) return state

  const target = clamp(to, 0, state.manual.length - 1)
  if (target === from) return state

  const manual = [...state.manual]
  const [moved] = manual.splice(from, 1)
  if (!moved) return state
  manual.splice(target, 0, moved)
  return { ...state, manual }
}

/**
 * Que suena despues. Devuelve null cuando no queda nada, para que el llamador
 * pause en vez de adivinar.
 */
export function advance(state: QueueState, repeat: RepeatMode): QueueState | null {
  if (repeat === 'one') return state

  const [next, ...rest] = state.manual
  if (next) {
    return { ...state, current: next, manual: rest }
  }

  if (state.contextPosition < state.order.length - 1) {
    const contextPosition = state.contextPosition + 1
    return { ...state, contextPosition, current: trackAt(state, contextPosition) }
  }

  if (repeat === 'all' && state.order.length > 0) {
    return { ...state, contextPosition: 0, current: trackAt(state, 0) }
  }

  return null
}

/** Retrocede dentro del contexto. La cola manual no se recorre hacia atras:
 *  se consume. */
export function previous(state: QueueState): QueueState | null {
  if (state.contextPosition <= 0) return null
  const contextPosition = state.contextPosition - 1
  return { ...state, contextPosition, current: trackAt(state, contextPosition) }
}

/** Mezcla o desmezcla el contexto sin mover lo que esta sonando. */
export function setShuffle(state: QueueState, shuffle: boolean): QueueState {
  if (shuffle === state.shuffle) return state
  if (state.context.length === 0) return { ...state, shuffle }

  const currentContextIndex = state.order[state.contextPosition] ?? 0
  const order = buildOrder(state.context.length, currentContextIndex, shuffle)

  return { ...state, shuffle, order, contextPosition: order.indexOf(currentContextIndex) }
}

export function queueView(state: QueueState): QueueView {
  const upcoming: Track[] = []
  for (let position = state.contextPosition + 1; position < state.order.length; position++) {
    const track = trackAt(state, position)
    if (track) upcoming.push(track)
  }

  return { now: state.current, manual: state.manual, upcoming }
}

function trackAt(state: QueueState, position: number): Track | null {
  const index = state.order[position]
  if (index === undefined) return null
  return state.context[index] ?? null
}

/** Con shuffle, la pista elegida queda primera y el resto se mezcla: asi
 *  activar shuffle nunca interrumpe lo que ya estaba sonando. */
function buildOrder(length: number, startIndex: number, shuffle: boolean): number[] {
  const indices = Array.from({ length }, (_, index) => index)
  if (!shuffle) return indices

  const rest = indices.filter((index) => index !== startIndex)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const left = rest[i]!
    const right = rest[j]!
    rest[i] = right
    rest[j] = left
  }
  return [startIndex, ...rest]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
