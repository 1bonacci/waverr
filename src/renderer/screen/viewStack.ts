/**
 * Navegacion de la pantalla, modelada como pila de vistas igual que un iPod.
 *
 * Es una maquina de estados pura: no sabe de React, ni de Electron, ni de la
 * base de datos. Cada vista describe QUE mostrar; los datos los busca el
 * componente. Esto la hace testeable entera y evita que la navegacion se
 * enrede con la carga de datos.
 */

export type MenuId = 'root' | 'folders' | 'recent' | 'favorites' | 'queue' | 'settings'

export type View =
  | { kind: 'menu'; menu: MenuId; selected: number }
  | { kind: 'folder'; path: string; name: string; selected: number }
  | { kind: 'search'; query: string; selected: number }
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

export const INITIAL_SCREEN_STATE: ScreenState = {
  stack: [{ kind: 'menu', menu: 'root', selected: 0 }]
}

export function currentView(state: ScreenState): View {
  return state.stack[state.stack.length - 1] ?? INITIAL_SCREEN_STATE.stack[0]!
}

/** Indice seleccionado de la vista actual, o -1 si la vista no es una lista. */
export function currentSelection(state: ScreenState): number {
  const view = currentView(state)
  return view.kind === 'nowPlaying' ? -1 : view.selected
}

export function screenReducer(state: ScreenState, action: ScreenAction): ScreenState {
  const view = currentView(state)

  switch (action.type) {
    case 'move': {
      if (view.kind === 'nowPlaying' || action.itemCount <= 0) return state
      // Se envuelve en los extremos, como la rueda de un iPod.
      const next = (view.selected + action.delta + action.itemCount) % action.itemCount
      return replaceTop(state, { ...view, selected: next })
    }

    case 'setSelection': {
      if (view.kind === 'nowPlaying') return state
      if (action.index < 0) return state
      return replaceTop(state, { ...view, selected: action.index })
    }

    case 'push':
      return { stack: [...state.stack, action.view] }

    case 'back': {
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
      if (view.kind !== 'search') return state
      // Borrar la ultima letra de una busqueda vacia sale de la busqueda.
      if (view.query.length === 0) return screenReducer(state, { type: 'back' })
      return replaceTop(state, { ...view, query: view.query.slice(0, -1), selected: 0 })
    }

    default:
      return state
  }
}

function replaceTop(state: ScreenState, view: View): ScreenState {
  return { stack: [...state.stack.slice(0, -1), view] }
}
