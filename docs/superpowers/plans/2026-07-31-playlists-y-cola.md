# Playlists y cola — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar contexto, cola manual y playlists para que el usuario controle qué suena después, pueda guardar órdenes que duran y reordenarlos con la rueda.

**Architecture:** La lógica de orden sale de `AudioEngine` a un módulo puro (`playbackQueue.ts`), igual que `viewStack.ts` hizo con la navegación. Las playlists viven en SQLite con una migración v2. La UI suma tres vistas nuevas (cola, playlists, prompt de texto), un menú contextual y un modo mover, todos como estados del reducer de vistas que ya existe.

**Tech Stack:** Electron 43, React 19, TypeScript 7 (strict), better-sqlite3 + FTS5, zustand, vitest, Playwright.

## Global Constraints

- TypeScript `strict: true` y `noUncheckedIndexedAccess: true` en los tres proyectos. Indexar un array devuelve `T | undefined`: hay que estrecharlo, no castear.
- **Sin dependencias nuevas.** Todo se hace con lo que ya está instalado.
- Comentarios y nombres de test en español **sin acentos ni ñ** (ASCII), igual que el código existente.
- El renderer nunca importa `node:fs`, `node:path` ni `electron`. Todo pasa por `window.waverr` (definido en `src/preload/index.ts`).
- Los canales de IPC se declaran en `src/shared/types.ts` en el objeto `IPC`, nunca como strings sueltos.
- `npm run typecheck` corre tres proyectos (`tsconfig.node.json`, `tsconfig.web.json`, `tsconfig.test.json`). Los tests importan módulos del renderer **y** del main, y por eso viven en el tercero.
- Cada commit termina con:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- Antes de cada commit: `npm test` en verde. Antes de los commits de las tareas de UI: también `npm run test:e2e`.

## File Structure

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `src/renderer/audio/playbackQueue.ts` | modelo puro del orden de reproducción |
| `src/renderer/components/views/QueueView.tsx` + `.module.css` | vista COLA con secciones |
| `src/renderer/components/views/ContextMenuView.tsx` | menú contextual sobre una fila |
| `src/renderer/components/views/PromptView.tsx` + `.module.css` | escribir texto en la LCD |
| `src/renderer/screen/useLongPress.ts` | detectar OK mantenido (mouse y teclado) |
| `tests/unit/playbackQueue.test.ts` | tests del modelo puro |
| `tests/unit/playlists.test.ts` | tests de playlists en `Library` |

**Se modifican:**

| Archivo | Cambio |
|---|---|
| `src/main/library/db.ts` | migración v2: `playlists`, `playlist_items` |
| `src/main/library/index.ts` | CRUD de playlists, reorder, settings |
| `src/main/ipc.ts` | handlers nuevos |
| `src/preload/index.ts` | métodos nuevos |
| `src/shared/types.ts` | tipos `Playlist`, `PlaylistEntry`, canales |
| `src/renderer/audio/AudioEngine.ts` | pasa a usar `playbackQueue` |
| `src/renderer/screen/viewStack.ts` | vistas `queue`, `playlist`, `prompt`, `context`; modo mover |
| `src/renderer/screen/useScreen.ts` | items de las vistas nuevas |
| `src/renderer/screen/useKeyboard.ts` | OK mantenido, teclas del modo mover |
| `src/renderer/components/Screen.tsx` | ruteo de las vistas nuevas |
| `src/renderer/components/views/ListView.tsx` | fila en movimiento, click derecho |

---

### Task 1: Modelo puro del orden de reproducción

Es el corazón del cambio y no depende de nada: se escribe y se prueba solo.

**Files:**
- Create: `src/renderer/audio/playbackQueue.ts`
- Test: `tests/unit/playbackQueue.test.ts`

**Interfaces:**
- Consumes: `Track` de `@shared/types`.
- Produces: `QueueState`, `EMPTY_QUEUE`, `playNow`, `enqueue`, `enqueueNext`, `removeAt`, `move`, `advance`, `previous`, `setShuffle`, `queueView`. `advance` y `previous` devuelven `QueueState | null`, donde `null` significa "no hay nada más".

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/unit/playbackQueue.test.ts`:

```ts
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
  setShuffle
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

describe('queueView', () => {
  it('separa lo que suena, lo encolado y lo que sigue del contexto', () => {
    let state = playNow(EMPTY_QUEUE, [a, b, c], 0)
    state = enqueue(state, d)

    expect(queueView(state)).toEqual({ now: a, manual: [d], upcoming: [b, c] })
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/unit/playbackQueue.test.ts`
Expected: FAIL — no existe `src/renderer/audio/playbackQueue.ts`.

- [ ] **Step 3: Escribir la implementación**

Crear `src/renderer/audio/playbackQueue.ts`:

```ts
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
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/unit/playbackQueue.test.ts`
Expected: PASS, 20 tests.

Si el test `mezcla el contexto pero deja quieta la cola manual` falla de forma intermitente: el contexto de 30 elementos hace que la probabilidad de que el shuffle devuelva el orden original sea 1/29!, o sea despreciable. Si falla, es un bug real en `buildOrder`, no mala suerte.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/audio/playbackQueue.ts tests/unit/playbackQueue.test.ts
git commit -m "feat: modelo puro del orden de reproduccion

Separa contexto, cola manual y lo que suena. Shuffle mezcla solo el contexto:
el orden de la cola manual fue una decision del usuario.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: AudioEngine sobre el modelo nuevo

**Files:**
- Modify: `src/renderer/audio/AudioEngine.ts`
- Modify: `src/renderer/screen/useScreen.ts` (única llamada a `setQueue`)
- Modify: `src/renderer/components/views/NowPlayingView.tsx` (usa `queueIndex`/`queueLength`)

**Interfaces:**
- Consumes: todo lo de Task 1.
- Produces: `audioEngine.playNow(tracks, index)`, `.enqueue(track)`, `.enqueueNext(track)`, `.removeFromQueue(index)`, `.moveInQueue(from, to)`, `.getQueueView(): QueueView`. `PlaybackState` pierde `queueLength` y `queueIndex`, y gana `manualCount: number` y `upcomingCount: number`.

- [ ] **Step 1: Reemplazar el estado interno de la cola**

En `src/renderer/audio/AudioEngine.ts`, borrar los campos `queue`, `order` y `orderPosition` y el tipo local `RepeatMode`, e importar el modelo:

```ts
import {
  advance,
  EMPTY_QUEUE,
  enqueue as enqueueTrack,
  enqueueNext as enqueueNextTrack,
  move as moveInQueueState,
  playNow as playNowState,
  previous as previousState,
  queueView,
  removeAt,
  setShuffle as setShuffleState,
  type QueueState,
  type QueueView,
  type RepeatMode
} from './playbackQueue'
```

Reemplazar los tres campos por uno:

```ts
private queue: QueueState = EMPTY_QUEUE
```

`RepeatMode` deja de definirse acá pero se sigue re-exportando, porque es parte
de la API pública del motor:

```ts
export type { RepeatMode } from './playbackQueue'
```

En `PlaybackState`, cambiar:

```ts
  queueLength: number
  queueIndex: number
```

por:

```ts
  /** Cuantas pistas encolo el usuario a mano. */
  manualCount: number
  /** Cuantas quedan del contexto despues de la actual. */
  upcomingCount: number
```

y en `INITIAL_STATE` reemplazar `queueLength: 0, queueIndex: -1` por `manualCount: 0, upcomingCount: 0`.

- [ ] **Step 2: Reescribir los metodos de cola y transporte**

Reemplazar `setQueue`, `clearQueue`, `next`, `previous`, `setShuffle`, `rebuildOrder` y `playAtOrderPosition` por:

```ts
  // --- Cola ---------------------------------------------------------------

  /**
   * Reemplaza el contexto y arranca en `startIndex`.
   *
   * La cola manual no se toca: lo que el usuario encolo a proposito sigue
   * sonando despues de esto.
   */
  async playNow(tracks: Track[], startIndex = 0): Promise<void> {
    this.queue = playNowState(this.queue, tracks, startIndex)
    await this.loadCurrent()
  }

  enqueue(track: Track): void {
    this.queue = enqueueTrack(this.queue, track)
    this.publishQueue()
  }

  enqueueNext(track: Track): void {
    this.queue = enqueueNextTrack(this.queue, track)
    this.publishQueue()
  }

  removeFromQueue(index: number): void {
    this.queue = removeAt(this.queue, index)
    this.publishQueue()
  }

  moveInQueue(from: number, to: number): void {
    this.queue = moveInQueueState(this.queue, from, to)
    this.publishQueue()
  }

  getQueueView(): QueueView {
    return queueView(this.queue)
  }

  clearQueue(): void {
    this.queue = EMPTY_QUEUE
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.patch({ ...INITIAL_STATE, volume: this.state.volume })
  }

  // --- Transporte ---------------------------------------------------------

  async next(): Promise<void> {
    // `advance` con repeat 'one' devuelve el mismo estado: reiniciar es
    // responsabilidad de handleEnded, no de un NEXT explicito del usuario.
    const nextState = advance(this.queue, this.state.repeat === 'one' ? 'off' : this.state.repeat)
    if (!nextState) {
      this.pause()
      return
    }
    this.queue = nextState
    await this.loadCurrent()
  }

  async previous(): Promise<void> {
    if (this.state.positionMs > RESTART_THRESHOLD_MS) {
      this.seek(0)
      return
    }
    const previousQueue = previousState(this.queue)
    if (!previousQueue) {
      this.seek(0)
      return
    }
    this.queue = previousQueue
    await this.loadCurrent()
  }

  setShuffle(shuffle: boolean): void {
    this.queue = setShuffleState(this.queue, shuffle)
    this.patch({ shuffle })
    this.publishQueue()
  }

  // --- Interno ------------------------------------------------------------

  /** Carga en el elemento <audio> lo que el modelo dice que suena ahora. */
  private async loadCurrent(): Promise<void> {
    const track = this.queue.current
    if (!track) {
      this.patch({ track: null, status: 'idle' })
      return
    }

    this.patch({
      track,
      status: 'loading',
      positionMs: 0,
      durationMs: track.durationMs ?? 0,
      error: null
    })
    this.publishQueue()

    this.audio.src = mediaUrlForTrack(track.id)
    this.audio.load()
    await this.play()
  }

  /** Refleja en el estado observable los conteos de la cola. */
  private publishQueue(): void {
    const view = queueView(this.queue)
    this.patch({ manualCount: view.manual.length, upcomingCount: view.upcoming.length })
  }
```

En `handleEnded`, dejar el manejo de `repeat === 'one'` como está (reinicia y vuelve a reproducir) y que el resto llame a `void this.next()`.

- [ ] **Step 3: Actualizar los dos lugares que llamaban a la API vieja**

En `src/renderer/screen/useScreen.ts`, dentro de `trackItem`:

```ts
      void audioEngine.playNow(tracks, index)
```

En `src/renderer/components/views/NowPlayingView.tsx`, reemplazar el bloque que usa `queueIndex`/`queueLength`:

```tsx
        <span>
          {playback.manualCount + playback.upcomingCount > 0
            ? `+${playback.manualCount + playback.upcomingCount}`
            : ''}
        </span>
```

- [ ] **Step 4: Verificar que no se rompio nada**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: typecheck limpio, 86 tests unitarios, 7 e2e en verde. Los e2e cubren reproducir, pausar y auto-avanzar, que es exactamente lo que se acaba de refactorizar.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/audio/AudioEngine.ts src/renderer/screen/useScreen.ts src/renderer/components/views/NowPlayingView.tsx
git commit -m "refactor: AudioEngine delega el orden a playbackQueue

El motor queda como cascara sobre el elemento <audio> y el AnalyserNode; que
suena despues lo decide el modelo puro.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Playlists en el indice

**Files:**
- Modify: `src/main/library/db.ts` (migración v2)
- Modify: `src/main/library/index.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/unit/playlists.test.ts`

**Interfaces:**
- Produces: en `Library` — `listPlaylists(): Playlist[]`, `createPlaylist(name): Playlist | null`, `renamePlaylist(id, name): boolean`, `deletePlaylist(id): void`, `addToPlaylist(playlistId, trackId): void`, `removeFromPlaylist(itemId): void`, `listPlaylistTracks(playlistId): PlaylistEntry[]`, `movePlaylistItem(playlistId, from, to): void`, `createPlaylistFromTracks(name, trackIds): Playlist | null`, `getSetting(key): string | null`, `setSetting(key, value): void`. En `window.waverr.library`, los mismos con `Promise`.

- [ ] **Step 1: Agregar los tipos compartidos**

En `src/shared/types.ts`, agregar después de `FolderEntry`:

```ts
export interface Playlist {
  id: number
  name: string
  trackCount: number
  createdAt: number
  updatedAt: number
}

/** Una pista dentro de una playlist. `itemId` la identifica como fila de la
 *  playlist, porque la misma pista puede estar dos veces. */
export interface PlaylistEntry extends Track {
  itemId: number
  position: number
}
```

En el objeto `IPC`, agregar:

```ts
  libraryListPlaylists: 'library:listPlaylists',
  libraryCreatePlaylist: 'library:createPlaylist',
  libraryRenamePlaylist: 'library:renamePlaylist',
  libraryDeletePlaylist: 'library:deletePlaylist',
  libraryAddToPlaylist: 'library:addToPlaylist',
  libraryRemoveFromPlaylist: 'library:removeFromPlaylist',
  libraryListPlaylistTracks: 'library:listPlaylistTracks',
  libraryMovePlaylistItem: 'library:movePlaylistItem',
  libraryCreatePlaylistFromTracks: 'library:createPlaylistFromTracks',
  libraryGetSetting: 'library:getSetting',
  librarySetSetting: 'library:setSetting',
```

En `WaverrApi['library']`, agregar:

```ts
    listPlaylists(): Promise<Playlist[]>
    createPlaylist(name: string): Promise<Playlist | null>
    renamePlaylist(playlistId: number, name: string): Promise<boolean>
    deletePlaylist(playlistId: number): Promise<void>
    addToPlaylist(playlistId: number, trackId: number): Promise<void>
    removeFromPlaylist(itemId: number): Promise<void>
    listPlaylistTracks(playlistId: number): Promise<PlaylistEntry[]>
    movePlaylistItem(playlistId: number, from: number, to: number): Promise<void>
    createPlaylistFromTracks(name: string, trackIds: number[]): Promise<Playlist | null>
    getSetting(key: string): Promise<string | null>
    setSetting(key: string, value: string): Promise<void>
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `tests/unit/playlists.test.ts`:

```ts
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { Library } from '../../src/main/library/index'
import { createTempLibrary } from './helpers/audio-fixtures'

const openLibraries: Library[] = []
const temporaryRoots: string[] = []

afterEach(async () => {
  for (const library of openLibraries.splice(0)) library.close()
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

const FILES = ['a.wav', 'b.wav', 'c.wav']

async function setup(): Promise<Library> {
  const root = await createTempLibrary(FILES)
  temporaryRoots.push(root)
  const library = Library.open(':memory:')
  openLibraries.push(library)
  await library.addRoot(root)
  await library.scanAll()
  return library
}

describe('crear y borrar playlists', () => {
  it('crea una playlist vacia', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP verano')

    expect(playlist).not.toBeNull()
    expect(playlist!.name).toBe('EP verano')
    expect(playlist!.trackCount).toBe(0)
    expect(library.listPlaylists()).toHaveLength(1)
  })

  it('rechaza un nombre repetido sin importar mayusculas', async () => {
    const library = await setup()
    library.createPlaylist('EP verano')

    expect(library.createPlaylist('ep VERANO')).toBeNull()
    expect(library.listPlaylists()).toHaveLength(1)
  })

  it('renombra', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('borrador')!

    expect(library.renamePlaylist(playlist.id, 'EP final')).toBe(true)
    expect(library.listPlaylists()[0]!.name).toBe('EP final')
  })

  it('renombrar a un nombre ocupado falla', async () => {
    const library = await setup()
    library.createPlaylist('uno')
    const otra = library.createPlaylist('dos')!

    expect(library.renamePlaylist(otra.id, 'uno')).toBe(false)
    expect(library.listPlaylists().map((item) => item.name).sort()).toEqual(['dos', 'uno'])
  })

  it('borrar la playlist borra sus items', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('temporal')!
    const tracks = library.search({ sort: 'name' })
    library.addToPlaylist(playlist.id, tracks[0]!.id)

    library.deletePlaylist(playlist.id)

    expect(library.listPlaylists()).toEqual([])
    expect(library.listPlaylistTracks(playlist.id)).toEqual([])
  })
})

describe('contenido de una playlist', () => {
  it('agrega en orden y cuenta', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    const tracks = library.search({ sort: 'name' })

    for (const track of tracks) library.addToPlaylist(playlist.id, track.id)

    const entries = library.listPlaylistTracks(playlist.id)
    expect(entries.map((entry) => entry.filename)).toEqual(['a.wav', 'b.wav', 'c.wav'])
    expect(entries.map((entry) => entry.position)).toEqual([0, 1, 2])
    expect(library.listPlaylists()[0]!.trackCount).toBe(3)
  })

  it('permite la misma pista dos veces', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    const track = library.search({ sort: 'name' })[0]!

    library.addToPlaylist(playlist.id, track.id)
    library.addToPlaylist(playlist.id, track.id)

    const entries = library.listPlaylistTracks(playlist.id)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.itemId).not.toBe(entries[1]!.itemId)
  })

  it('quitar deja las posiciones consecutivas', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    for (const track of library.search({ sort: 'name' })) {
      library.addToPlaylist(playlist.id, track.id)
    }

    const entries = library.listPlaylistTracks(playlist.id)
    library.removeFromPlaylist(entries[1]!.itemId)

    const rest = library.listPlaylistTracks(playlist.id)
    expect(rest.map((entry) => entry.filename)).toEqual(['a.wav', 'c.wav'])
    expect(rest.map((entry) => entry.position)).toEqual([0, 1])
  })

  it('reordena y deja las posiciones consecutivas', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    for (const track of library.search({ sort: 'name' })) {
      library.addToPlaylist(playlist.id, track.id)
    }

    library.movePlaylistItem(playlist.id, 2, 0)

    const entries = library.listPlaylistTracks(playlist.id)
    expect(entries.map((entry) => entry.filename)).toEqual(['c.wav', 'a.wav', 'b.wav'])
    expect(entries.map((entry) => entry.position)).toEqual([0, 1, 2])
  })

  it('mover fuera de rango satura en vez de romper', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    for (const track of library.search({ sort: 'name' })) {
      library.addToPlaylist(playlist.id, track.id)
    }

    library.movePlaylistItem(playlist.id, 0, 99)

    expect(library.listPlaylistTracks(playlist.id).map((entry) => entry.filename)).toEqual([
      'b.wav',
      'c.wav',
      'a.wav'
    ])
  })

  it('una pista perdida sigue figurando en la playlist', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    const track = library.search({ sort: 'name' })[0]!
    library.addToPlaylist(playlist.id, track.id)

    await rm(track.path)
    await library.scanAll()

    const entries = library.listPlaylistTracks(playlist.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.missing).toBe(true)
  })

  it('crea una playlist a partir de una lista de pistas', async () => {
    const library = await setup()
    const tracks = library.search({ sort: 'name' })

    const playlist = library.createPlaylistFromTracks('sesion', [
      tracks[2]!.id,
      tracks[0]!.id
    ])!

    expect(library.listPlaylistTracks(playlist.id).map((entry) => entry.filename)).toEqual([
      'c.wav',
      'a.wav'
    ])
  })
})

describe('settings', () => {
  it('guarda y lee un valor', async () => {
    const library = await setup()
    expect(library.getSetting('queue')).toBeNull()

    library.setSetting('queue', '{"manualTrackIds":[1]}')
    expect(library.getSetting('queue')).toBe('{"manualTrackIds":[1]}')

    library.setSetting('queue', '{"manualTrackIds":[]}')
    expect(library.getSetting('queue')).toBe('{"manualTrackIds":[]}')
  })
})
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/unit/playlists.test.ts`
Expected: FAIL — `library.createPlaylist is not a function`.

- [ ] **Step 4: Agregar la migracion v2**

En `src/main/library/db.ts`, agregar un segundo elemento al array `MIGRATIONS` (después del string que ya está, sin tocarlo):

```ts
  ,
  // v2 - playlists
  `
  CREATE TABLE playlists (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE playlist_items (
    id          INTEGER PRIMARY KEY,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
    -- La posicion NO es parte de la primary key: si lo fuera, mover un item
    -- exigiria posiciones temporales para no violar la restriccion a mitad de
    -- camino. Reordenar es reescribir las posiciones en una transaccion.
    position    INTEGER NOT NULL
  );

  CREATE INDEX playlist_items_order ON playlist_items(playlist_id, position);
  `
```

- [ ] **Step 5: Implementar los metodos en Library**

En `src/main/library/index.ts`, agregar los imports de tipo `Playlist` y `PlaylistEntry`, y estos métodos antes de `isPathInsideRoots`:

```ts
  // --- Playlists ---------------------------------------------------------

  listPlaylists(): Playlist[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS track_count
           FROM playlists p
          ORDER BY p.name COLLATE NOCASE ASC`
      )
      .all() as Array<{
      id: number
      name: string
      created_at: number
      updated_at: number
      track_count: number
    }>

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      trackCount: row.track_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  /** Devuelve null si el nombre ya esta ocupado (la comparacion ignora mayusculas). */
  createPlaylist(name: string): Playlist | null {
    const clean = name.trim()
    if (clean.length === 0) return null

    const now = Date.now()
    try {
      const result = this.db
        .prepare('INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)')
        .run(clean, now, now)
      return this.listPlaylists().find((item) => item.id === Number(result.lastInsertRowid)) ?? null
    } catch {
      return null
    }
  }

  renamePlaylist(playlistId: number, name: string): boolean {
    const clean = name.trim()
    if (clean.length === 0) return false

    try {
      const result = this.db
        .prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?')
        .run(clean, Date.now(), playlistId)
      return result.changes > 0
    } catch {
      return false
    }
  }

  deletePlaylist(playlistId: number): void {
    this.db.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId)
  }

  addToPlaylist(playlistId: number, trackId: number): void {
    const next = this.db
      .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM playlist_items WHERE playlist_id = ?')
      .get(playlistId) as { next: number }

    this.db
      .prepare('INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (?, ?, ?)')
      .run(playlistId, trackId, next.next)
    this.touchPlaylist(playlistId)
  }

  removeFromPlaylist(itemId: number): void {
    const row = this.db
      .prepare('SELECT playlist_id FROM playlist_items WHERE id = ?')
      .get(itemId) as { playlist_id: number } | undefined
    if (!row) return

    this.db.prepare('DELETE FROM playlist_items WHERE id = ?').run(itemId)
    this.renumber(row.playlist_id)
    this.touchPlaylist(row.playlist_id)
  }

  /** Incluye las pistas perdidas: el disco externo puede volver a aparecer. */
  listPlaylistTracks(playlistId: number): PlaylistEntry[] {
    const rows = this.db
      .prepare(
        `SELECT ${TRACK_COLUMNS}, i.id AS item_id, i.position AS item_position
           FROM playlist_items i
           JOIN tracks t ON t.id = i.track_id
           LEFT JOIN marks m ON m.track_id = t.id
          WHERE i.playlist_id = ?
          ORDER BY i.position ASC`
      )
      .all(playlistId) as Array<TrackRow & { item_id: number; item_position: number }>

    return rows.map((row) => ({
      ...rowToTrack(row),
      itemId: row.item_id,
      position: row.item_position
    }))
  }

  /** Satura en los extremos, igual que el modelo de la cola. */
  movePlaylistItem(playlistId: number, from: number, to: number): void {
    const ids = this.db
      .prepare('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC')
      .all(playlistId) as Array<{ id: number }>

    if (from < 0 || from >= ids.length) return
    const target = Math.max(0, Math.min(to, ids.length - 1))
    if (target === from) return

    const [moved] = ids.splice(from, 1)
    if (!moved) return
    ids.splice(target, 0, moved)

    const update = this.db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?')
    this.db.transaction((ordered: Array<{ id: number }>) => {
      ordered.forEach((item, index) => update.run(index, item.id))
    })(ids)

    this.touchPlaylist(playlistId)
  }

  createPlaylistFromTracks(name: string, trackIds: number[]): Playlist | null {
    const playlist = this.createPlaylist(name)
    if (!playlist) return null

    for (const trackId of trackIds) this.addToPlaylist(playlist.id, trackId)
    return this.listPlaylists().find((item) => item.id === playlist.id) ?? null
  }

  // --- Ajustes -----------------------------------------------------------

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }

  private renumber(playlistId: number): void {
    const ids = this.db
      .prepare('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC')
      .all(playlistId) as Array<{ id: number }>

    const update = this.db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?')
    this.db.transaction(() => {
      ids.forEach((item, index) => update.run(index, item.id))
    })()
  }

  private touchPlaylist(playlistId: number): void {
    this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId)
  }
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/unit/playlists.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 7: Exponer todo por IPC**

En `src/main/ipc.ts`, dentro de `registerLibraryIpc`, después del handler de `libraryToggleFavorite`:

```ts
  ipcMain.handle(IPC.libraryListPlaylists, () => library.listPlaylists())
  ipcMain.handle(IPC.libraryCreatePlaylist, (_event, name: string) => library.createPlaylist(name))
  ipcMain.handle(IPC.libraryRenamePlaylist, (_event, id: number, name: string) =>
    library.renamePlaylist(id, name)
  )
  ipcMain.handle(IPC.libraryDeletePlaylist, (_event, id: number) => library.deletePlaylist(id))
  ipcMain.handle(IPC.libraryAddToPlaylist, (_event, playlistId: number, trackId: number) =>
    library.addToPlaylist(playlistId, trackId)
  )
  ipcMain.handle(IPC.libraryRemoveFromPlaylist, (_event, itemId: number) =>
    library.removeFromPlaylist(itemId)
  )
  ipcMain.handle(IPC.libraryListPlaylistTracks, (_event, playlistId: number) =>
    library.listPlaylistTracks(playlistId)
  )
  ipcMain.handle(IPC.libraryMovePlaylistItem, (_event, playlistId: number, from: number, to: number) =>
    library.movePlaylistItem(playlistId, from, to)
  )
  ipcMain.handle(IPC.libraryCreatePlaylistFromTracks, (_event, name: string, trackIds: number[]) =>
    library.createPlaylistFromTracks(name, trackIds)
  )
  ipcMain.handle(IPC.libraryGetSetting, (_event, key: string) => library.getSetting(key))
  ipcMain.handle(IPC.librarySetSetting, (_event, key: string, value: string) =>
    library.setSetting(key, value)
  )
```

En `src/preload/index.ts`, dentro de `library`:

```ts
    listPlaylists: () => ipcRenderer.invoke(IPC.libraryListPlaylists),
    createPlaylist: (name: string) => ipcRenderer.invoke(IPC.libraryCreatePlaylist, name),
    renamePlaylist: (playlistId: number, name: string) =>
      ipcRenderer.invoke(IPC.libraryRenamePlaylist, playlistId, name),
    deletePlaylist: (playlistId: number) =>
      ipcRenderer.invoke(IPC.libraryDeletePlaylist, playlistId),
    addToPlaylist: (playlistId: number, trackId: number) =>
      ipcRenderer.invoke(IPC.libraryAddToPlaylist, playlistId, trackId),
    removeFromPlaylist: (itemId: number) =>
      ipcRenderer.invoke(IPC.libraryRemoveFromPlaylist, itemId),
    listPlaylistTracks: (playlistId: number) =>
      ipcRenderer.invoke(IPC.libraryListPlaylistTracks, playlistId),
    movePlaylistItem: (playlistId: number, from: number, to: number) =>
      ipcRenderer.invoke(IPC.libraryMovePlaylistItem, playlistId, from, to),
    createPlaylistFromTracks: (name: string, trackIds: number[]) =>
      ipcRenderer.invoke(IPC.libraryCreatePlaylistFromTracks, name, trackIds),
    getSetting: (key: string) => ipcRenderer.invoke(IPC.libraryGetSetting, key),
    setSetting: (key: string, value: string) =>
      ipcRenderer.invoke(IPC.librarySetSetting, key, value),
```

- [ ] **Step 8: Verificar y commitear**

Run: `npm run typecheck && npm test`
Expected: typecheck limpio, 99 tests en verde.

```bash
git add src/main src/preload src/shared tests/unit/playlists.test.ts
git commit -m "feat: playlists en el indice

Migracion v2 con playlists y playlist_items. La posicion no va en la primary
key para que reordenar sea reescribir posiciones en una transaccion.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Vistas nuevas en el reducer de navegacion

Solo el reducer y sus tests. Sin UI todavía: así el comportamiento queda fijado antes de dibujar nada.

**Files:**
- Modify: `src/renderer/screen/viewStack.ts`
- Modify: `tests/unit/viewStack.test.ts`

**Interfaces:**
- Produces: vistas `queue`, `playlist`, `prompt`, `context`; tipo `ContextTarget`; tipo `PromptIntent`; acciones `startMove`, `moveHeld`, `dropMove`, `cancelMove`, `confirmPrompt`. `MenuId` pierde `'queue'` (pasa a ser vista propia).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `tests/unit/viewStack.test.ts`:

```ts
describe('vista de texto', () => {
  const promptView = {
    kind: 'prompt' as const,
    label: 'NOMBRE',
    value: '',
    intent: { kind: 'newPlaylist' as const }
  }

  it('tipear escribe en el prompt en vez de abrir la busqueda', () => {
    const state = run([
      { type: 'push', view: promptView },
      { type: 'typeChar', char: 'E' },
      { type: 'typeChar', char: 'P' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'prompt', value: 'EP' })
    expect(state.stack).toHaveLength(2)
  })

  it('backspace borra una letra del prompt', () => {
    const state = run([
      { type: 'push', view: promptView },
      { type: 'typeChar', char: 'E' },
      { type: 'typeChar', char: 'P' },
      { type: 'backspace' }
    ])
    expect(currentView(state)).toMatchObject({ value: 'E' })
  })

  it('backspace con el prompt vacio lo cierra', () => {
    const state = run([{ type: 'push', view: promptView }, { type: 'backspace' }])
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'root' })
  })

  it('confirmar cierra el prompt', () => {
    const state = run([
      { type: 'push', view: promptView },
      { type: 'typeChar', char: 'X' },
      { type: 'confirmPrompt' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'root' })
  })
})

describe('modo mover', () => {
  const queueView = { kind: 'queue' as const, selected: 1, moving: null }

  it('empezar a mover agarra la fila seleccionada', () => {
    const state = run([{ type: 'push', view: queueView }, { type: 'startMove' }])
    expect(currentView(state)).toMatchObject({ moving: { from: 1, to: 1 } })
  })

  it('mover arrastra la fila y la seleccion juntas', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove' },
      { type: 'moveHeld', delta: 1, itemCount: 4 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { from: 1, to: 2 }, selected: 2 })
  })

  it('mover satura en los extremos en vez de envolver', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove' },
      { type: 'moveHeld', delta: -5, itemCount: 4 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { from: 1, to: 0 }, selected: 0 })
  })

  it('soltar termina el modo mover', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove' },
      { type: 'moveHeld', delta: 1, itemCount: 4 },
      { type: 'dropMove' }
    ])
    expect(currentView(state)).toMatchObject({ moving: null, selected: 2 })
  })

  it('cancelar devuelve la seleccion a donde estaba', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove' },
      { type: 'moveHeld', delta: 2, itemCount: 4 },
      { type: 'cancelMove' }
    ])
    expect(currentView(state)).toMatchObject({ moving: null, selected: 1 })
  })

  it('MENU no sale de la vista mientras se esta moviendo', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove' },
      { type: 'back' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'queue', moving: null })
    expect(state.stack).toHaveLength(2)
  })

  it('startMove no hace nada en una vista que no se reordena', () => {
    const state = run([{ type: 'startMove' }])
    expect(state).toEqual(INITIAL_SCREEN_STATE)
  })
})

describe('menu contextual', () => {
  const target = {
    label: 'beat_v3.wav',
    index: 0,
    origin: 'library' as const,
    trackId: 7
  }

  it('se apila sobre la vista actual', () => {
    const state = run([{ type: 'push', view: { kind: 'context', target, selected: 0 } }])
    expect(currentView(state)).toMatchObject({ kind: 'context' })
    expect(state.stack).toHaveLength(2)
  })

  it('MENU lo cierra y vuelve a la lista', () => {
    const state = run([
      { type: 'push', view: { kind: 'context', target, selected: 0 } },
      { type: 'back' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'root' })
  })

  it('tipear adentro del menu contextual no abre la busqueda', () => {
    const state = run([
      { type: 'push', view: { kind: 'context', target, selected: 0 } },
      { type: 'typeChar', char: 'b' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'context' })
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/unit/viewStack.test.ts`
Expected: FAIL — errores de tipo sobre `kind: 'prompt'`, `'queue'`, `'context'` y sobre las acciones nuevas.

- [ ] **Step 3: Extender el reducer**

En `src/renderer/screen/viewStack.ts`:

```ts
export type MenuId =
  | 'root'
  | 'folders'
  | 'recent'
  | 'favorites'
  | 'playlists'
  /** Submenu de "AGREGAR A PLAYLIST". */
  | 'playlistPicker'
  | 'settings'

/** De donde salio la fila sobre la que se abrio el menu contextual. Define
 *  que acciones tienen sentido: solo en la cola y en una playlist se puede
 *  mover o quitar. */
export type ContextOrigin = 'library' | 'queue' | 'playlist'

export interface ContextTarget {
  label: string
  /** Posicion dentro de la lista de origen. */
  index: number
  origin: ContextOrigin
  trackId?: number
  playlistId?: number
  /** Fila de playlist_items, cuando el origen es una playlist. */
  itemId?: number
}

export type PromptIntent =
  | { kind: 'newPlaylist'; trackIdToAdd?: number }
  | { kind: 'renamePlaylist'; playlistId: number }
  | { kind: 'saveQueue' }

/** Fila agarrada en modo mover: de donde salio y donde esta ahora. */
export interface MovingState {
  from: number
  to: number
}

export type View =
  | { kind: 'menu'; menu: MenuId; selected: number }
  | { kind: 'folder'; path: string; name: string; selected: number }
  | { kind: 'search'; query: string; selected: number }
  | { kind: 'queue'; selected: number; moving: MovingState | null }
  | { kind: 'playlist'; playlistId: number; name: string; selected: number; moving: MovingState | null }
  | { kind: 'prompt'; label: string; value: string; intent: PromptIntent }
  | { kind: 'context'; target: ContextTarget; selected: number }
  | { kind: 'nowPlaying' }
```

Agregar a `ScreenAction`:

```ts
  | { type: 'startMove' }
  | { type: 'moveHeld'; delta: number; itemCount: number }
  | { type: 'dropMove' }
  | { type: 'cancelMove' }
  | { type: 'confirmPrompt' }
```

En `currentSelection`, tratar `prompt` como no-lista:

```ts
export function currentSelection(state: ScreenState): number {
  const view = currentView(state)
  return view.kind === 'nowPlaying' || view.kind === 'prompt' ? -1 : view.selected
}
```

En `screenReducer`, cambiar los casos afectados:

```ts
    case 'move': {
      if (view.kind === 'nowPlaying' || view.kind === 'prompt') return state
      if (action.itemCount <= 0) return state
      // Con una fila agarrada, mover la seleccion es arrastrarla.
      if ((view.kind === 'queue' || view.kind === 'playlist') && view.moving) {
        return screenReducer(state, {
          type: 'moveHeld',
          delta: action.delta,
          itemCount: action.itemCount
        })
      }
      const next = (view.selected + action.delta + action.itemCount) % action.itemCount
      return replaceTop(state, { ...view, selected: next })
    }

    case 'setSelection': {
      if (view.kind === 'nowPlaying' || view.kind === 'prompt') return state
      if (action.index < 0) return state
      return replaceTop(state, { ...view, selected: action.index })
    }

    case 'back': {
      // Mientras se mueve una fila, MENU cancela el movimiento en vez de
      // salir de la vista: salir a mitad de un reordenamiento sorprende.
      if ((view.kind === 'queue' || view.kind === 'playlist') && view.moving) {
        return screenReducer(state, { type: 'cancelMove' })
      }
      if (state.stack.length <= 1) return state
      return { stack: state.stack.slice(0, -1) }
    }

    case 'typeChar': {
      if (view.kind === 'prompt') {
        return replaceTop(state, { ...view, value: view.value + action.char })
      }
      // En el menu contextual las letras no hacen nada: es una lista corta de
      // acciones, no un lugar donde buscar.
      if (view.kind === 'context') return state
      if (view.kind === 'search') {
        return replaceTop(state, { ...view, query: view.query + action.char, selected: 0 })
      }
      return { stack: [...state.stack, { kind: 'search', query: action.char, selected: 0 }] }
    }

    case 'backspace': {
      if (view.kind === 'prompt') {
        if (view.value.length === 0) return screenReducer(state, { type: 'back' })
        return replaceTop(state, { ...view, value: view.value.slice(0, -1) })
      }
      if (view.kind !== 'search') return state
      if (view.query.length === 0) return screenReducer(state, { type: 'back' })
      return replaceTop(state, { ...view, query: view.query.slice(0, -1), selected: 0 })
    }

    case 'confirmPrompt': {
      if (view.kind !== 'prompt') return state
      return { stack: state.stack.slice(0, -1) }
    }

    case 'startMove': {
      if (view.kind !== 'queue' && view.kind !== 'playlist') return state
      if (view.moving) return state
      return replaceTop(state, { ...view, moving: { from: view.selected, to: view.selected } })
    }

    case 'moveHeld': {
      if (view.kind !== 'queue' && view.kind !== 'playlist') return state
      if (!view.moving || action.itemCount <= 0) return state
      const to = Math.max(0, Math.min(view.moving.to + action.delta, action.itemCount - 1))
      return replaceTop(state, { ...view, moving: { ...view.moving, to }, selected: to })
    }

    case 'dropMove': {
      if (view.kind !== 'queue' && view.kind !== 'playlist') return state
      if (!view.moving) return state
      return replaceTop(state, { ...view, moving: null, selected: view.moving.to })
    }

    case 'cancelMove': {
      if (view.kind !== 'queue' && view.kind !== 'playlist') return state
      if (!view.moving) return state
      return replaceTop(state, { ...view, moving: null, selected: view.moving.from })
    }
```

- [ ] **Step 4: Mantener la app compilando**

Sacar `'queue'` de `MenuId` rompe `useScreen.ts`, que lo referencia en tres
lugares. Estos cambios son el mínimo para que el typecheck quede limpio; las
vistas se llenan en las tareas siguientes.

En `src/renderer/screen/useScreen.ts`:

1. `MENU_TITLES` (es `Record<MenuId, string>`, así que tiene que tener todas las
   claves): sacar `queue`, agregar `playlists: 'PLAYLISTS'` y
   `playlistPicker: 'A PLAYLIST'`.
2. En `ROOT_MENU`, la entrada `COLA` pasa a apuntar a la vista propia y se suma
   `PLAYLISTS`:

```ts
  { id: 'playlists', label: 'PLAYLISTS', view: { kind: 'menu', menu: 'playlists', selected: 0 } },
  { id: 'queue', label: 'COLA', view: { kind: 'queue', selected: 0, moving: null } },
```

3. En `buildMenuItems`, borrar el `case 'queue'` y agregar dos stubs:

```ts
    case 'playlists':
    case 'playlistPicker':
      return [emptyItem('VACIO')]
```

4. En `buildItems`, agregar los casos nuevos para que el `switch` siga siendo
   exhaustivo:

```ts
    case 'queue':
    case 'playlist':
    case 'prompt':
    case 'context':
      return []
```

5. En `titleFor`, agregar:

```ts
    case 'queue':
      return 'COLA'
    case 'playlist':
      return view.name.toUpperCase()
    case 'prompt':
      return view.label
    case 'context':
      return 'ACCIONES'
```

No hace falta tocar `Screen.tsx`: las vistas nuevas no son `nowPlaying`, así que
caen en `ListView` y se ven como una lista vacía hasta que se implementen.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm run typecheck && npm test`
Expected: typecheck limpio y 32 tests de `viewStack` en verde (los 16 que ya
existían siguen pasando).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/screen tests/unit/viewStack.test.ts
git commit -m "feat: vistas de cola, playlist, prompt y menu contextual en el reducer

Incluye el modo mover, donde MENU cancela el movimiento en vez de salir de la
vista.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Menu contextual

**Files:**
- Create: `src/renderer/screen/useLongPress.ts`
- Create: `src/renderer/components/views/ContextMenuView.tsx`
- Modify: `src/renderer/screen/useScreen.ts`
- Modify: `src/renderer/screen/useKeyboard.ts`
- Modify: `src/renderer/components/views/ListView.tsx`
- Modify: `src/renderer/components/Screen.tsx`

**Interfaces:**
- Consumes: `ContextTarget` y la vista `context` (Task 4); `audioEngine.enqueue/enqueueNext` (Task 2); `window.waverr.library.listPlaylists/addToPlaylist` (Task 3).
- Produces: `ScreenItem` gana `contextTarget?: ContextTarget`. `ScreenController` gana `openContextMenu(index: number): void`.

- [ ] **Step 1: Detector de OK mantenido**

Crear `src/renderer/screen/useLongPress.ts`:

```ts
import { useCallback, useRef } from 'react'

/** Cuanto hay que mantener OK para que aparezca el menu contextual. */
export const LONG_PRESS_MS = 450

interface LongPressHandlers {
  onPointerDown: () => void
  onPointerUp: () => void
  onPointerLeave: () => void
}

/**
 * Distingue un click de un OK mantenido sobre la misma fila.
 *
 * Si se suelta antes del umbral corre `onPress`; si se pasa, corre
 * `onLongPress` y el `onPress` posterior queda anulado.
 */
export function useLongPress(onPress: () => void, onLongPress: () => void): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  return {
    onPointerDown: useCallback(() => {
      fired.current = false
      clear()
      timer.current = setTimeout(() => {
        fired.current = true
        onLongPress()
      }, LONG_PRESS_MS)
    }, [clear, onLongPress]),

    onPointerUp: useCallback(() => {
      clear()
      if (!fired.current) onPress()
    }, [clear, onPress]),

    onPointerLeave: useCallback(() => {
      clear()
      fired.current = false
    }, [clear])
  }
}
```

- [ ] **Step 2: Construir los items del menu contextual**

En `src/renderer/screen/useScreen.ts`:

1. Agregar `contextTarget?: ContextTarget` a `ScreenItem`.
2. En `trackItem`, completar el target:

```ts
    contextTarget: {
      label: displayName(track),
      index,
      origin: 'library',
      trackId: track.id
    },
```

3. Agregar `openContextMenu` al controlador:

```ts
  const openContextMenu = useCallback(
    (index: number) => {
      const target = items[index]?.contextTarget
      if (!target) return
      dispatch({ type: 'setSelection', index })
      dispatch({ type: 'push', view: { kind: 'context', target, selected: 0 } })
    },
    [items]
  )
```

Devolverlo en el objeto del controlador y agregarlo a `ScreenController`.

4. En `buildItems`, agregar el caso de la vista `context`:

```ts
    case 'context':
      return buildContextItems(view.target, dispatch)
```

5. Agregar la función, al lado de `buildMenuItems`:

```ts
/**
 * Acciones sobre una fila. MOVER y QUITAR solo aparecen donde tienen sentido:
 * en la cola y adentro de una playlist.
 */
async function buildContextItems(
  target: ContextTarget,
  dispatch: (action: ScreenAction) => void
): Promise<ScreenItem[]> {
  const items: ScreenItem[] = []

  if (target.trackId !== undefined) {
    const trackId = target.trackId

    items.push({
      key: 'play',
      label: 'REPRODUCIR AHORA',
      activate: async () => {
        const track = await window.waverr.library.getTrack(trackId)
        if (!track) return
        dispatch({ type: 'back' })
        dispatch({ type: 'openNowPlaying' })
        void audioEngine.playNow([track], 0)
      }
    })

    items.push({
      key: 'next',
      label: 'ENCOLAR SIGUIENTE',
      activate: async () => {
        const track = await window.waverr.library.getTrack(trackId)
        if (track) audioEngine.enqueueNext(track)
        dispatch({ type: 'back' })
      }
    })

    items.push({
      key: 'last',
      label: 'ENCOLAR AL FINAL',
      activate: async () => {
        const track = await window.waverr.library.getTrack(trackId)
        if (track) audioEngine.enqueue(track)
        dispatch({ type: 'back' })
      }
    })

    items.push({
      key: 'playlist',
      label: 'AGREGAR A PLAYLIST',
      drillsDown: true,
      activate: () =>
        dispatch({
          type: 'push',
          view: { kind: 'menu', menu: 'playlistPicker', selected: 0 }
        })
    })

    items.push({
      key: 'favorite',
      label: 'FAVORITO',
      activate: async () => {
        await window.waverr.library.toggleFavorite(trackId)
        dispatch({ type: 'back' })
      }
    })
  }

  if (target.origin === 'queue' || target.origin === 'playlist') {
    items.push({
      key: 'move',
      label: 'MOVER',
      activate: () => {
        dispatch({ type: 'back' })
        dispatch({ type: 'setSelection', index: target.index })
        dispatch({ type: 'startMove' })
      }
    })

    items.push({
      key: 'remove',
      label: 'QUITAR',
      activate: async () => {
        if (target.origin === 'queue') {
          audioEngine.removeFromQueue(target.index)
        } else if (target.itemId !== undefined) {
          await window.waverr.library.removeFromPlaylist(target.itemId)
        }
        dispatch({ type: 'back' })
      }
    })
  }

  return items
}
```

El submenú `playlistPicker` ya existe como stub desde Task 4 y se llena en Task 6.

- [ ] **Step 3: Cablearlo al mouse y al teclado**

En `src/renderer/components/views/ListView.tsx`, reemplazar el `onClick` de cada fila por los handlers de `useLongPress` más el click derecho. Extraer la fila a su propio componente para poder usar el hook por fila:

```tsx
function Row({
  item,
  index,
  selected,
  controller,
  rowRef
}: {
  item: ScreenItem
  index: number
  selected: boolean
  controller: ScreenController
  rowRef?: RefObject<HTMLButtonElement | null>
}): JSX.Element {
  const press = useLongPress(
    () => {
      controller.dispatch({ type: 'setSelection', index })
      void item.activate()
    },
    () => controller.openContextMenu(index)
  )

  return (
    <button
      type="button"
      ref={rowRef}
      data-testid="screen-row"
      data-selected={selected ? 'true' : 'false'}
      className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
      onContextMenu={(event) => {
        event.preventDefault()
        controller.openContextMenu(index)
      }}
      {...press}
    >
      {item.favorite && <span className={styles.star}>★</span>}
      <span className={styles.label}>{item.label}</span>
      {item.meta && <span className={styles.meta}>{item.meta}</span>}
      {item.drillsDown && <span className={styles.chevron}>&gt;</span>}
    </button>
  )
}
```

En `src/renderer/screen/useKeyboard.ts`, dentro del `case 'Enter'`, usar la repeticion del teclado como "mantener":

```ts
        case 'Enter':
          event.preventDefault()
          // Mantener Enter dispara autorepeat: la primera repeticion es el
          // equivalente de teclado a mantener OK apretado.
          if (event.repeat) {
            if (!longPressFired.current) {
              longPressFired.current = true
              controller.openContextMenu(controller.selected)
            }
            return
          }
          controller.activate()
          return
```

Declarar `const longPressFired = useRef(false)` fuera del efecto y limpiarlo en un listener de `keyup`:

```ts
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') longPressFired.current = false
    }
    window.addEventListener('keyup', onKeyUp)
```

y removerlo en el cleanup.

- [ ] **Step 4: Dibujar el menu contextual**

Crear `src/renderer/components/views/ContextMenuView.tsx`:

```tsx
import type { JSX } from 'react'
import type { ScreenController } from '../../screen/useScreen'
import type { ContextTarget } from '../../screen/viewStack'
import { ListView } from './ListView'
import styles from './ContextMenuView.module.css'

interface ContextMenuViewProps {
  controller: ScreenController
  target: ContextTarget
}

/** Acciones sobre una fila. Arriba se repite sobre que pista se esta actuando,
 *  porque el menu tapa la lista de donde salio. */
export function ContextMenuView({ controller, target }: ContextMenuViewProps): JSX.Element {
  return (
    <div className={styles.view}>
      <div className={styles.target}>{target.label}</div>
      <ListView controller={controller} />
    </div>
  )
}
```

Crear `src/renderer/components/views/ContextMenuView.module.css`:

```css
.view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.target {
  flex: 0 0 auto;
  padding: 4px 8px;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--lcd-bg);
  background: var(--lcd-ink-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

En `src/renderer/components/Screen.tsx`, rutear la vista:

```tsx
          {view.kind === 'nowPlaying' ? (
            <NowPlayingView />
          ) : view.kind === 'context' ? (
            <ContextMenuView controller={controller} target={view.target} />
          ) : (
            <ListView controller={controller} />
          )}
```

Y en `titleFor` (en `useScreen.ts`) agregar `case 'context': return 'ACCIONES'`.

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: todo verde. Los e2e existentes usan click simple sobre las filas, que sigue funcionando porque `useLongPress` corre `onPress` al soltar antes del umbral.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: menu contextual con OK mantenido y click derecho

Mantener Enter usa el autorepeat del teclado como equivalente de mantener OK.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Vistas de playlists y prompt de texto

**Files:**
- Create: `src/renderer/components/views/PromptView.tsx` + `.module.css`
- Modify: `src/renderer/screen/useScreen.ts`
- Modify: `src/renderer/screen/useKeyboard.ts`
- Modify: `src/renderer/components/Screen.tsx`

**Interfaces:**
- Consumes: vista `prompt` y `PromptIntent` (Task 4); API de playlists (Task 3).
- Produces: `ScreenController.confirmPrompt(): void`, que aplica el `PromptIntent` de la vista actual.

- [ ] **Step 1: Reemplazar la entrada COLA por PLAYLISTS en el menu raiz**

En `src/renderer/screen/useScreen.ts`, `ROOT_MENU` queda:

```ts
const ROOT_MENU: Array<{ id: string; label: string; view: View }> = [
  { id: 'folders', label: 'CARPETAS', view: { kind: 'menu', menu: 'folders', selected: 0 } },
  { id: 'recent', label: 'RECIENTES', view: { kind: 'menu', menu: 'recent', selected: 0 } },
  { id: 'favorites', label: 'FAVORITOS', view: { kind: 'menu', menu: 'favorites', selected: 0 } },
  { id: 'playlists', label: 'PLAYLISTS', view: { kind: 'menu', menu: 'playlists', selected: 0 } },
  { id: 'queue', label: 'COLA', view: { kind: 'queue', selected: 0, moving: null } },
  { id: 'settings', label: 'AJUSTES', view: { kind: 'menu', menu: 'settings', selected: 0 } }
]
```

`MENU_TITLES` y `titleFor` ya quedaron completos en Task 4.

`buildMenuItems` pasa a recibir un tercer parámetro:
`buildMenuItems(menu, dispatch, pendingTrackId: number | null)`, y `buildItems`
se lo reenvía. Es lo que hace posible que el submenú
`playlistPicker` sepa qué pista está agregando.

- [ ] **Step 2: Items de las vistas de playlists**

En `buildMenuItems`, reemplazar el `case 'queue'` por:

```ts
    case 'playlists': {
      const playlists = await window.waverr.library.listPlaylists()
      const items: ScreenItem[] = [
        {
          key: 'new',
          label: '+ NUEVA PLAYLIST',
          activate: () =>
            dispatch({
              type: 'push',
              view: { kind: 'prompt', label: 'NOMBRE', value: '', intent: { kind: 'newPlaylist' } }
            })
        }
      ]

      for (const playlist of playlists) {
        items.push({
          key: `playlist-${playlist.id}`,
          label: playlist.name.toUpperCase(),
          meta: String(playlist.trackCount),
          drillsDown: true,
          contextTarget: {
            label: playlist.name,
            index: 0,
            origin: 'library',
            playlistId: playlist.id
          },
          activate: () =>
            dispatch({
              type: 'push',
              view: {
                kind: 'playlist',
                playlistId: playlist.id,
                name: playlist.name,
                selected: 0,
                moving: null
              }
            })
        })
      }

      return items
    }

    case 'playlistPicker': {
      // Submenu de AGREGAR A PLAYLIST. La pista objetivo viene de la vista
      // `context` que quedo abajo en la pila.
      const playlists = await window.waverr.library.listPlaylists()
      const items: ScreenItem[] = [
        {
          key: 'new',
          label: '+ NUEVA PLAYLIST',
          activate: () =>
            dispatch({
              type: 'push',
              view: {
                kind: 'prompt',
                label: 'NOMBRE',
                value: '',
                intent: { kind: 'newPlaylist', trackIdToAdd: pendingTrackId ?? undefined }
              }
            })
        }
      ]

      for (const playlist of playlists) {
        items.push({
          key: `pick-${playlist.id}`,
          label: playlist.name.toUpperCase(),
          meta: String(playlist.trackCount),
          activate: async () => {
            if (pendingTrackId !== null) {
              await window.waverr.library.addToPlaylist(playlist.id, pendingTrackId)
            }
            // Vuelve a la lista de donde se venia, sin quedar navegando
            // adentro de la playlist.
            dispatch({ type: 'back' })
            dispatch({ type: 'back' })
          }
        })
      }

      return items
    }
```

`buildItems` recibe un parámetro nuevo `pendingTrackId: number | null`, que `useScreen` calcula buscando la vista `context` más cercana en la pila:

```ts
  const pendingTrackId = useMemo(() => {
    for (let index = state.stack.length - 1; index >= 0; index--) {
      const entry = state.stack[index]
      if (entry?.kind === 'context') return entry.target.trackId ?? null
    }
    return null
  }, [state.stack])
```

Pasarlo a `buildItems(view, dispatch, pendingTrackId)` y agregarlo a las dependencias del efecto de carga.

- [ ] **Step 3: Items de una playlist abierta**

En `buildItems`, agregar:

```ts
    case 'playlist': {
      const entries = await window.waverr.library.listPlaylistTracks(view.playlistId)
      if (entries.length === 0) return [emptyItem('PLAYLIST VACIA')]

      return entries.map((entry, index) => ({
        key: `item-${entry.itemId}`,
        label: `${entry.missing ? '! ' : ''}${displayName(entry)}`,
        meta: entry.durationMs ? formatTime(entry.durationMs) : entry.ext.slice(1).toUpperCase(),
        trackId: entry.id,
        favorite: entry.favorite,
        contextTarget: {
          label: displayName(entry),
          index,
          origin: 'playlist',
          trackId: entry.id,
          playlistId: view.playlistId,
          itemId: entry.itemId
        },
        activate: () => {
          dispatch({ type: 'openNowPlaying' })
          // Las perdidas se saltean: no tiene sentido intentar reproducirlas.
          const playable = entries.filter((candidate) => !candidate.missing)
          const startIndex = playable.findIndex((candidate) => candidate.itemId === entry.itemId)
          void audioEngine.playNow(playable, Math.max(0, startIndex))
        }
      }))
    }
```

- [ ] **Step 4: Prompt de texto**

Crear `src/renderer/components/views/PromptView.tsx`:

```tsx
import type { JSX } from 'react'
import type { View } from '../../screen/viewStack'
import styles from './PromptView.module.css'

interface PromptViewProps {
  view: Extract<View, { kind: 'prompt' }>
  error: string | null
}

/** Escribir texto en la LCD. Reusa el teclado real, que ya es como se busca:
 *  no hace falta un teclado en pantalla. */
export function PromptView({ view, error }: PromptViewProps): JSX.Element {
  return (
    <div className={styles.view} data-testid="prompt">
      <span className={styles.label}>{view.label}</span>
      <span className={styles.value} data-testid="prompt-value">
        {view.value}
        <span className={styles.caret}>_</span>
      </span>
      {error && <span className={styles.error}>{error}</span>}
      <span className={styles.hint}>ENTER = CONFIRMAR · MENU = CANCELAR</span>
    </div>
  )
}
```

Crear `src/renderer/components/views/PromptView.module.css`:

```css
.view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 12px;
}

.label {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--lcd-ink-dim);
}

.value {
  font-size: 16px;
  color: var(--lcd-ink);
  word-break: break-all;
}

.caret {
  animation: promptBlink 1s steps(2, start) infinite;
}

@keyframes promptBlink {
  to {
    visibility: hidden;
  }
}

.error {
  font-size: 10px;
  color: var(--lcd-ink);
  background: var(--lcd-ink-dim);
  padding: 2px 4px;
  align-self: flex-start;
}

.hint {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--lcd-ink-dim);
}
```

- [ ] **Step 5: Aplicar el intent al confirmar**

En `useScreen.ts`, agregar estado de error y la acción:

```ts
  const [promptError, setPromptError] = useState<string | null>(null)

  const confirmPrompt = useCallback(async () => {
    if (view.kind !== 'prompt') return
    const value = view.value.trim()
    if (value.length === 0) return

    const intent = view.intent
    if (intent.kind === 'newPlaylist') {
      const playlist = await window.waverr.library.createPlaylist(value)
      if (!playlist) {
        setPromptError('YA EXISTE')
        return
      }
      if (intent.trackIdToAdd !== undefined) {
        await window.waverr.library.addToPlaylist(playlist.id, intent.trackIdToAdd)
      }
    } else if (intent.kind === 'renamePlaylist') {
      if (!(await window.waverr.library.renamePlaylist(intent.playlistId, value))) {
        setPromptError('YA EXISTE')
        return
      }
    } else {
      const queue = audioEngine.getQueueView()
      const trackIds = [queue.now, ...queue.manual, ...queue.upcoming]
        .filter((track): track is Track => track !== null)
        .map((track) => track.id)
      if (!(await window.waverr.library.createPlaylistFromTracks(value, trackIds))) {
        setPromptError('YA EXISTE')
        return
      }
    }

    setPromptError(null)
    dispatch({ type: 'confirmPrompt' })
    setRevision((current) => current + 1)
  }, [view])
```

Limpiar `promptError` cuando cambia `viewKey`, dentro del efecto de carga. Exponer `confirmPrompt` y `promptError` en `ScreenController`.

En `useKeyboard.ts`, el `case 'Enter'` llama a `controller.confirmPrompt()` cuando `controller.view.kind === 'prompt'`, y `case 'Escape'`/`'Backspace'` ya funcionan por el reducer.

En `Screen.tsx`, agregar la rama de `prompt`:

```tsx
          ) : view.kind === 'prompt' ? (
            <PromptView view={view} error={controller.promptError} />
```

En el menú contextual de una playlist (`target.playlistId !== undefined` y sin `trackId`), agregar en `buildContextItems`:

```ts
  if (target.playlistId !== undefined && target.trackId === undefined) {
    const playlistId = target.playlistId
    items.push({
      key: 'rename',
      label: 'RENOMBRAR',
      activate: () => {
        dispatch({ type: 'back' })
        dispatch({
          type: 'push',
          view: {
            kind: 'prompt',
            label: 'NUEVO NOMBRE',
            value: '',
            intent: { kind: 'renamePlaylist', playlistId }
          }
        })
      }
    })
    items.push({
      key: 'delete',
      label: 'BORRAR PLAYLIST',
      activate: async () => {
        await window.waverr.library.deletePlaylist(playlistId)
        dispatch({ type: 'back' })
      }
    })
  }
```

- [ ] **Step 6: Verificar y commitear**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: todo verde. Ojo con el e2e `el menu raiz arranca en CARPETAS`: sigue valiendo, CARPETAS sigue primero.

```bash
git add src/renderer
git commit -m "feat: vista de playlists, submenu para agregar y prompt de texto

Nombrar reusa el teclado real, igual que la busqueda: sin teclado en pantalla.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Vista COLA y modo mover

**Files:**
- Create: `src/renderer/components/views/QueueView.tsx` + `.module.css`
- Modify: `src/renderer/screen/useScreen.ts`
- Modify: `src/renderer/screen/useKeyboard.ts`
- Modify: `src/renderer/components/views/ListView.tsx`
- Modify: `src/renderer/components/Screen.tsx`

**Interfaces:**
- Consumes: `audioEngine.getQueueView/moveInQueue/removeFromQueue` (Task 2); acciones de movimiento (Task 4).
- Produces: nada nuevo hacia afuera.

- [ ] **Step 1: Items de la cola**

En `buildItems`, agregar el caso `queue`. La cola se lee del motor, no de la base:

```ts
    case 'queue': {
      const view_ = audioEngine.getQueueView()
      const items: ScreenItem[] = []

      if (view_.now) {
        items.push({
          key: 'now',
          label: displayName(view_.now),
          meta: 'AHORA',
          activate: () => dispatch({ type: 'openNowPlaying' })
        })
      }

      view_.manual.forEach((track, index) => {
        items.push({
          key: `manual-${index}-${track.id}`,
          label: displayName(track),
          meta: formatTime(track.durationMs ?? 0),
          trackId: track.id,
          favorite: track.favorite,
          contextTarget: {
            label: displayName(track),
            // El indice es dentro de la cola manual: es lo que entienden
            // moveInQueue y removeFromQueue.
            index,
            origin: 'queue',
            trackId: track.id
          },
          activate: () => {
            // Saltar directo a un encolado: se descarta lo anterior de la cola.
            for (let skipped = 0; skipped < index; skipped++) audioEngine.removeFromQueue(0)
            void audioEngine.next()
            dispatch({ type: 'openNowPlaying' })
          }
        })
      })

      view_.upcoming.forEach((track, index) => {
        items.push({
          key: `upcoming-${index}-${track.id}`,
          label: displayName(track),
          meta: formatTime(track.durationMs ?? 0),
          trackId: track.id,
          favorite: track.favorite,
          activate: () => {
            dispatch({ type: 'openNowPlaying' })
            void audioEngine.playNow([...view_.upcoming], index)
          }
        })
      })

      if (items.length === 0) return [emptyItem('COLA VACIA')]
      return items
    }
```

La vista se recarga cuando cambia la reproducción: agregar `playback.track?.id` y `playback.manualCount` a las dependencias del efecto de carga (leyendo `usePlayback()` dentro de `useScreen`).

- [ ] **Step 2: Dibujar las secciones**

Crear `src/renderer/components/views/QueueView.tsx`. Reusa `ListView` pero intercala encabezados según el `meta` de la primera fila de cada bloque; para mantenerlo simple, los encabezados salen del propio `ScreenItem`:

```tsx
import type { JSX } from 'react'
import type { ScreenController } from '../../screen/useScreen'
import { ListView } from './ListView'
import styles from './QueueView.module.css'

interface QueueViewProps {
  controller: ScreenController
}

/** COLA: lo que suena, lo encolado a mano y lo que sigue del contexto. */
export function QueueView({ controller }: QueueViewProps): JSX.Element {
  const view = controller.view
  const moving = view.kind === 'queue' ? view.moving : null

  return (
    <div className={styles.view}>
      {moving && (
        <div className={styles.movingBanner} data-testid="moving-banner">
          MOVIENDO · OK SUELTA · MENU CANCELA
        </div>
      )}
      <ListView controller={controller} />
    </div>
  )
}
```

Crear `src/renderer/components/views/QueueView.module.css`:

```css
.view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.movingBanner {
  flex: 0 0 auto;
  padding: 3px 8px;
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--lcd-bg);
  background: var(--lcd-ink);
}
```

En `Screen.tsx`, rutear `queue` a `QueueView` y `playlist` a `QueueView` también (misma cáscara, el banner sirve igual).

- [ ] **Step 3: Marcar la fila agarrada**

En `ListView.module.css`:

```css
.rowMoving {
  outline: 1px dashed var(--lcd-ink);
  outline-offset: -2px;
}
```

En `ListView.tsx`, calcular si la fila está agarrada y pasarlo a `Row`:

```tsx
  const view = controller.view
  const movingTo =
    (view.kind === 'queue' || view.kind === 'playlist') && view.moving ? view.moving.to : null
```

y en la clase de la fila agregar `${index === movingTo ? styles.rowMoving : ''}`, más `data-moving={index === movingTo ? 'true' : 'false'}`.

- [ ] **Step 4: Aplicar el movimiento al soltar**

En `useScreen.ts`, `activate` se comporta distinto con una fila agarrada:

```ts
  const activate = useCallback(() => {
    const view_ = view
    if ((view_.kind === 'queue' || view_.kind === 'playlist') && view_.moving) {
      const { from, to } = view_.moving
      if (view_.kind === 'queue') {
        audioEngine.moveInQueue(from, to)
      } else {
        void window.waverr.library.movePlaylistItem(view_.playlistId, from, to)
      }
      dispatch({ type: 'dropMove' })
      setRevision((current) => current + 1)
      return
    }

    const item = items[selected]
    if (item) void item.activate()
  }, [items, selected, view])
```

Ojo: en la cola, los índices de `moving` son índices de fila de la lista completa (AHORA + manual + upcoming), pero `moveInQueue` espera índices de la cola manual. Para evitar la traducción, **el modo mover solo se ofrece sobre filas cuyo `contextTarget.origin` es `queue`**, y `startMove` guarda el índice de fila. La conversión se hace restando el offset de la sección manual:

```ts
  /** Cuantas filas hay antes del primer encolado manual (0 o 1: la fila AHORA). */
  const manualOffset = audioEngine.getQueueView().now ? 1 : 0
```

y al soltar en la cola: `audioEngine.moveInQueue(from - manualOffset, to - manualOffset)`.

En `useKeyboard.ts`, `Escape` con una fila agarrada ya cancela por el reducer. No hace falta nada nuevo.

- [ ] **Step 5: Verificar y commitear**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: todo verde.

```bash
git add src/renderer
git commit -m "feat: vista COLA con secciones y modo mover

La fila agarrada se dibuja punteada y el banner recuerda que OK suelta y MENU
cancela.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Persistencia de la cola manual

**Files:**
- Modify: `src/renderer/audio/AudioEngine.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `window.waverr.library.getSetting/setSetting` (Task 3).
- Produces: `audioEngine.restore(): Promise<void>` y guardado automático.

- [ ] **Step 1: Guardar al cambiar la cola**

En `AudioEngine`, agregar:

```ts
/** Clave de `settings` donde se guarda la cola manual. */
const QUEUE_SETTING_KEY = 'queue'

/** Espera antes de escribir: encolar cinco temas seguidos hace una sola
 *  escritura, no cinco. */
const SAVE_DEBOUNCE_MS = 500
```

y dentro de la clase:

```ts
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      const payload = JSON.stringify({
        manualTrackIds: this.queue.manual.map((track) => track.id),
        currentTrackId: this.queue.current?.id ?? null
      })
      void window.waverr.library.setSetting(QUEUE_SETTING_KEY, payload)
    }, SAVE_DEBOUNCE_MS)
  }
```

Llamar a `this.scheduleSave()` al final de `publishQueue()`.

- [ ] **Step 2: Restaurar al arrancar**

```ts
  /**
   * Recupera la cola manual de la sesion anterior.
   *
   * El contexto no se guarda: era la vista que estabas mirando y al reabrir la
   * app esa vista ya no existe. Los ids que ya no estan en el indice se
   * descartan en silencio.
   */
  async restore(): Promise<void> {
    const raw = await window.waverr.library.getSetting(QUEUE_SETTING_KEY)
    if (!raw) return

    let parsed: { manualTrackIds?: unknown; currentTrackId?: unknown }
    try {
      parsed = JSON.parse(raw) as typeof parsed
    } catch {
      return
    }

    const ids = Array.isArray(parsed.manualTrackIds)
      ? parsed.manualTrackIds.filter((id): id is number => typeof id === 'number')
      : []

    const tracks: Track[] = []
    for (const id of ids) {
      const track = await window.waverr.library.getTrack(id)
      if (track && !track.missing) tracks.push(track)
    }

    this.queue = { ...this.queue, manual: tracks }
    // Se publica sin reprogramar el guardado: restaurar no es un cambio.
    const view = queueView(this.queue)
    this.patch({ manualCount: view.manual.length, upcomingCount: view.upcoming.length })
  }
```

- [ ] **Step 3: Llamarlo una vez al montar**

En `src/renderer/App.tsx`:

```tsx
  useEffect(() => {
    void audioEngine.restore()
  }, [])
```

- [ ] **Step 4: Verificar y commitear**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: todo verde.

```bash
git add src/renderer/audio/AudioEngine.ts src/renderer/App.tsx
git commit -m "feat: la cola manual sobrevive al reinicio

Se guarda con debounce y al cargar se descartan los ids que ya no existen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Guardar la cola como playlist y e2e completo

**Files:**
- Modify: `src/renderer/screen/useScreen.ts`
- Modify: `tests/e2e/playback.spec.ts`

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Accion GUARDAR COMO PLAYLIST**

En `buildItems`, en el caso `queue`, agregar como última fila cuando la cola no esté vacía:

```ts
      items.push({
        key: 'save',
        label: 'GUARDAR COMO PLAYLIST',
        activate: () =>
          dispatch({
            type: 'push',
            view: { kind: 'prompt', label: 'NOMBRE', value: '', intent: { kind: 'saveQueue' } }
          })
      })
```

El intent `saveQueue` ya está implementado en `confirmPrompt` (Task 6).

- [ ] **Step 2: Escribir los e2e**

Agregar a `tests/e2e/playback.spec.ts`:

```ts
test('encolar dos temas y verlos en la COLA en orden', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await page.keyboard.type('bpm')
  await expect(rows).toHaveCount(2, { timeout: 10000 })

  // Click derecho abre el menu contextual sobre la primera fila.
  await rows.first().click({ button: 'right' })
  await expect(page.getByTestId('screen-title')).toHaveText('ACCIONES')
  await page.getByTestId('screen-row').filter({ hasText: 'ENCOLAR AL FINAL' }).click()

  await expect(page.getByTestId('screen-title')).toHaveText(/BUSCAR/)
  await rows.nth(1).click({ button: 'right' })
  await page.getByTestId('screen-row').filter({ hasText: 'ENCOLAR AL FINAL' }).click()

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'COLA' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('COLA')

  const labels = await rows.allTextContents()
  const manual = labels.filter((text) => text.includes('bpm'))
  expect(manual.length).toBeGreaterThanOrEqual(2)
})

test('crear una playlist, agregarle un tema y reproducirla', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'PLAYLISTS' }).click()
  await rows.filter({ hasText: 'NUEVA PLAYLIST' }).click()

  await expect(page.getByTestId('prompt')).toBeVisible()
  await page.keyboard.type('EP')
  await page.keyboard.press('Enter')

  await expect(rows.filter({ hasText: 'EP' })).toHaveCount(1)

  // Agregar un tema desde la busqueda.
  await page.keyboard.press('Home')
  await page.keyboard.type('idea')
  await expect(rows.first()).toHaveText(/idea/)
  await rows.first().click({ button: 'right' })
  await page.getByTestId('screen-row').filter({ hasText: 'AGREGAR A PLAYLIST' }).click()
  await expect(page.getByTestId('screen-title')).toHaveText('A PLAYLIST')
  await rows.filter({ hasText: 'EP' }).click()

  // Reproducirla.
  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'PLAYLISTS' }).click()
  await rows.filter({ hasText: 'EP' }).click()
  await expect(rows.first()).toHaveText(/idea/)
  await rows.first().click()
  await expect(page.getByTestId('now-playing')).toBeVisible()
})

test('nombre de playlist repetido avisa y no crea nada', async () => {
  const rows = page.getByTestId('screen-row')

  await page.keyboard.press('Home')
  await rows.filter({ hasText: 'PLAYLISTS' }).click()
  const before = await rows.count()

  await rows.filter({ hasText: 'NUEVA PLAYLIST' }).click()
  await page.keyboard.type('EP')
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('prompt')).toBeVisible()
  await expect(page.getByTestId('prompt')).toContainText('YA EXISTE')

  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(before)
})
```

- [ ] **Step 3: Correr todo**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: 99+ unitarios y 10 e2e en verde.

- [ ] **Step 4: Actualizar el README**

En `README.md`, agregar a la tabla de teclas:

| `Enter` mantenido | menú contextual sobre la fila |

y una línea en la sección de uso explicando que `COLA` conserva lo encolado a mano cuando elegís otro tema, y que `GUARDAR COMO PLAYLIST` convierte la sesión en algo que dura.

- [ ] **Step 5: Commit**

```bash
git add src/renderer tests/e2e/playback.spec.ts README.md
git commit -m "feat: guardar la cola como playlist y cobertura e2e

Cierra el ciclo: una sesion de escucha que resulto buena se convierte en el set
que se manda.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notas de revision

Revisado contra el spec `docs/superpowers/specs/2026-07-31-playlists-y-cola-design.md`:

- Contexto / cola manual / playlists separados → Task 1.
- OK no borra la cola manual → Task 1 (test `no borra la cola manual`).
- Shuffle solo mezcla el contexto → Task 1.
- Migración v2 con `position` fuera de la PK → Task 3.
- Cola persistida en `settings`, ids inexistentes descartados → Task 8.
- Menú contextual con OK mantenido y click derecho → Task 5.
- `AGREGAR A PLAYLIST` como submenú que vuelve al origen → Task 6.
- Vista COLA con secciones y `GUARDAR COMO PLAYLIST` → Tasks 7 y 9.
- Vista PLAYLISTS con crear, renombrar, borrar → Tasks 6.
- Prompt de texto reusando el teclado real → Task 6.
- Modo mover con OK suelta / MENU cancela → Tasks 4 y 7.
- Nombre repetido rechazado con aviso → Tasks 3 y 6, e2e en Task 9.
- Pista perdida en playlist se muestra marcada y se saltea → Tasks 3 y 6.
- `move` satura en los extremos → Tasks 1, 3 y 4.

Fuera de alcance, igual que en el spec: exportar `.m3u`, arrastrar con mouse, playlists inteligentes.
