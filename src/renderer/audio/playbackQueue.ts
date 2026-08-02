import type { Track } from '@shared/types'

export type RepeatMode = 'off' | 'one' | 'all'

/**
 * Playback order, modelled as immutable data.
 *
 * Deliberately a pure module: it touches neither the DOM nor the AudioContext.
 * `AudioEngine` uses it to know what comes next; every behaviour can be tested
 * here without launching the app.
 */
export interface QueueState {
  /** What is playing. Can come from the manual queue or from the context. */
  current: Track | null
  /** What the user queued on purpose. Never shuffled, never dropped on its own. */
  manual: Track[]
  /** The list that was on screen when a track was chosen. */
  context: Track[]
  /** Permutation of `context` indices. Without shuffle it is the identity. */
  order: number[]
  /** Position within `order` of the last context track that played. */
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
 * Replaces the context and starts playing `context[index]`.
 *
 * The manual queue survives: what the user asked for explicitly is not lost by
 * choosing something else to listen to now.
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
 * Jumps straight to a track in the manual queue without discarding the ones
 * ahead of it.
 *
 * Choosing it starts it playing; the ones that were ahead of it in the manual
 * queue stay there, ready to play afterwards: what the user queued on purpose
 * is not lost by choosing to hear something else they had also queued. An
 * out-of-range `index` does nothing.
 */
export function skipToManual(state: QueueState, index: number): QueueState {
  if (index < 0 || index >= state.manual.length) return state
  const manual = [...state.manual]
  const [chosen] = manual.splice(index, 1)
  if (!chosen) return state
  return { ...state, current: chosen, manual }
}

/** Moves within the manual queue. Saturates at the ends: wrapping around while
 *  reordering is almost always a slip, not an intention. */
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
 * What plays next. Returns null when nothing is left, so the caller pauses
 * instead of guessing.
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

/** Steps back within the context. The manual queue is not walked backwards:
 *  it is consumed. */
export function previous(state: QueueState): QueueState | null {
  if (state.contextPosition <= 0) return null
  const contextPosition = state.contextPosition - 1
  return { ...state, contextPosition, current: trackAt(state, contextPosition) }
}

/** Shuffles or unshuffles the context without moving what is playing. */
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

/** With shuffle on, the chosen track stays first and the rest is shuffled, so
 *  turning shuffle on never interrupts what was already playing. */
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
