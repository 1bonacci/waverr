/**
 * Navegacion de la pantalla, modelada como pila de vistas igual que un iPod.
 *
 * Es una maquina de estados pura: no sabe de React, ni de Electron, ni de la
 * base de datos. Cada vista describe QUE mostrar; los datos los busca el
 * componente. Esto la hace testeable entera y evita que la navegacion se
 * enrede con la carga de datos.
 */

export type MenuId =
  | 'root'
  /** The whole library as one flat list. There is no folder browsing. */
  | 'tracks'
  | 'recent'
  | 'favorites'
  | 'playlists'
  /** Submenu of "ADD TO PLAYLIST". */
  | 'playlistPicker'
  | 'settings'

/** De donde salio la fila sobre la que se abrio el menu contextual. Define
 *  que acciones tienen sentido: solo en la cola y en una playlist se puede
 *  mover o quitar. */
export type ContextOrigin = 'library' | 'queue' | 'playlist'

export interface ContextTarget {
  label: string
  /** Posicion dentro de la lista de origen. Solo sirve como referencia
   *  inicial: si la pista actual cambia con el menu ACCIONES abierto, esta
   *  posicion queda vieja. MOVER y QUITAR no confian en ella para resolver la
   *  fila; usan `trackId`/`occurrence` (cola) o `itemId` (playlist), que
   *  identifican la fila en vez de su posicion. */
  index: number
  origin: ContextOrigin
  trackId?: number
  playlistId?: number
  /** Fila de playlist_items, cuando el origen es una playlist. */
  itemId?: number
  /** Solo cuando `origin` es 'queue': ordinal entre las copias de `trackId`
   *  en la cola manual (0 = primera), calculado cuando se armo esta fila.
   *  Encolar la misma pista dos veces esta permitido a proposito, asi que
   *  `trackId` solo no alcanza para volver a encontrar esta fila despues. */
  occurrence?: number
}

export type PromptIntent =
  | { kind: 'newPlaylist'; trackIdToAdd?: number }
  | { kind: 'renamePlaylist'; playlistId: number }
  | { kind: 'saveQueue' }

/** Fila agarrada en modo mover: de donde salio y donde esta ahora.
 *  `originId` es la identidad de la pista agarrada (su trackId en la cola,
 *  su itemId en una playlist), no su posicion: si la lista se reconstruye
 *  mientras se esta arrastrando (una pista que termina consume la cola
 *  manual y corre los indices de fila), `from`/`to` quedan desactualizados
 *  pero `originId` sigue apuntando a la fila correcta. */
export interface MovingState {
  from: number
  to: number
  originId: number
  /** Ordinal entre las copias que comparten `originId` (0 = primera),
   *  calculado al agarrar la fila. Encolar la misma pista dos veces esta
   *  permitido a proposito: sin esto, resolver por identidad siempre caeria
   *  en la primera copia por trackId, sin importar cual se agarro. */
  originOccurrence: number
}

export type View =
  | { kind: 'menu'; menu: MenuId; selected: number }
  | { kind: 'search'; query: string; selected: number }
  | { kind: 'queue'; selected: number; moving: MovingState | null }
  | { kind: 'playlist'; playlistId: number; name: string; selected: number; moving: MovingState | null }
  | { kind: 'prompt'; label: string; value: string; intent: PromptIntent }
  | { kind: 'context'; target: ContextTarget; selected: number }
  | { kind: 'nowPlaying' }

export interface ScreenState {
  stack: View[]
}

export type ScreenAction =
  /** Mover la seleccion. `itemCount` viene del componente, que es quien sabe cuantas filas hay. */
  | { type: 'move'; delta: number; itemCount: number }
  | { type: 'setSelection'; index: number }
  | { type: 'push'; view: View }
  | { type: 'back' }
  | { type: 'home' }
  | { type: 'openNowPlaying' }
  | { type: 'typeChar'; char: string }
  | { type: 'backspace' }
  | { type: 'startMove'; originId: number; originOccurrence: number }
  | { type: 'moveHeld'; delta: number; itemCount: number }
  /** `to`, si viene, fija donde termino el arrastre (clickear una fila con el
   *  mouse suelta ahi directo, sin pasar por `moveHeld`). Sin `to` usa la
   *  posicion ya guardada en `moving` (soltar con teclado/rueda). */
  | { type: 'dropMove'; to?: number }
  | { type: 'cancelMove' }
  | { type: 'confirmPrompt' }

export const INITIAL_SCREEN_STATE: ScreenState = {
  stack: [{ kind: 'menu', menu: 'root', selected: 0 }]
}

export function currentView(state: ScreenState): View {
  return state.stack[state.stack.length - 1] ?? INITIAL_SCREEN_STATE.stack[0]!
}

/** Indice seleccionado de la vista actual, o -1 si la vista no es una lista. */
export function currentSelection(state: ScreenState): number {
  const view = currentView(state)
  return view.kind === 'nowPlaying' || view.kind === 'prompt' ? -1 : view.selected
}

export function screenReducer(state: ScreenState, action: ScreenAction): ScreenState {
  const view = currentView(state)

  switch (action.type) {
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
      // Se envuelve en los extremos, como la rueda de un iPod.
      const next = (view.selected + action.delta + action.itemCount) % action.itemCount
      return replaceTop(state, { ...view, selected: next })
    }

    case 'setSelection': {
      if (view.kind === 'nowPlaying' || view.kind === 'prompt') return state
      if (action.index < 0) return state
      return replaceTop(state, { ...view, selected: action.index })
    }

    case 'push':
      return { stack: [...state.stack, action.view] }

    case 'back': {
      // Mientras se mueve una fila, MENU cancela el movimiento en vez de
      // salir de la vista: salir a mitad de un reordenamiento sorprende.
      if ((view.kind === 'queue' || view.kind === 'playlist') && view.moving) {
        return screenReducer(state, { type: 'cancelMove' })
      }
      // Nunca se vacia la pila: el menu raiz es el piso.
      if (state.stack.length <= 1) return state
      return { stack: state.stack.slice(0, -1) }
    }

    case 'home':
      return INITIAL_SCREEN_STATE

    case 'openNowPlaying': {
      if (view.kind === 'nowPlaying') return state
      return { stack: [...state.stack, { kind: 'nowPlaying' }] }
    }

    case 'typeChar': {
      if (view.kind === 'prompt') {
        return replaceTop(state, { ...view, value: view.value + action.char })
      }
      // En el menu contextual las letras no hacen nada: es una lista corta de
      // acciones, no un lugar donde buscar.
      if (view.kind === 'context') return state
      // Tipear en cualquier lado abre la busqueda: es la forma mas rapida de
      // llegar a un archivo sin recorrer menus.
      if (view.kind === 'search') {
        return replaceTop(state, { ...view, query: view.query + action.char, selected: 0 })
      }
      return {
        stack: [...state.stack, { kind: 'search', query: action.char, selected: 0 }]
      }
    }

    case 'backspace': {
      if (view.kind === 'prompt') {
        if (view.value.length === 0) return screenReducer(state, { type: 'back' })
        return replaceTop(state, { ...view, value: view.value.slice(0, -1) })
      }
      if (view.kind !== 'search') return state
      // Borrar la ultima letra de una busqueda vacia sale de la busqueda.
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
      return replaceTop(state, {
        ...view,
        moving: {
          from: view.selected,
          to: view.selected,
          originId: action.originId,
          originOccurrence: action.originOccurrence
        }
      })
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
      const to = action.to ?? view.moving.to
      return replaceTop(state, { ...view, moving: null, selected: to })
    }

    case 'cancelMove': {
      if (view.kind !== 'queue' && view.kind !== 'playlist') return state
      if (!view.moving) return state
      return replaceTop(state, { ...view, moving: null, selected: view.moving.from })
    }

    default:
      return state
  }
}

function replaceTop(state: ScreenState, view: View): ScreenState {
  return { stack: [...state.stack.slice(0, -1), view] }
}
