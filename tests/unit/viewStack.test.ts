import { describe, expect, it } from 'vitest'
import {
  currentView,
  INITIAL_SCREEN_STATE,
  screenReducer,
  type ScreenAction,
  type ScreenState
} from '../../src/renderer/screen/viewStack'

function run(actions: ScreenAction[], from: ScreenState = INITIAL_SCREEN_STATE): ScreenState {
  return actions.reduce(screenReducer, from)
}

describe('estado inicial', () => {
  it('arranca en el menu raiz', () => {
    expect(currentView(INITIAL_SCREEN_STATE)).toEqual({ kind: 'menu', menu: 'root', selected: 0 })
  })
})

describe('mover la seleccion', () => {
  it('baja y sube', () => {
    const state = run([{ type: 'move', delta: 1, itemCount: 5 }])
    expect(currentView(state)).toMatchObject({ selected: 1 })

    const back = screenReducer(state, { type: 'move', delta: -1, itemCount: 5 })
    expect(currentView(back)).toMatchObject({ selected: 0 })
  })

  it('se envuelve en los extremos', () => {
    const up = run([{ type: 'move', delta: -1, itemCount: 4 }])
    expect(currentView(up)).toMatchObject({ selected: 3 })

    const down = run([
      { type: 'setSelection', index: 3 },
      { type: 'move', delta: 1, itemCount: 4 }
    ])
    expect(currentView(down)).toMatchObject({ selected: 0 })
  })

  it('con lista vacia no se mueve', () => {
    const state = run([{ type: 'move', delta: 1, itemCount: 0 }])
    expect(currentView(state)).toMatchObject({ selected: 0 })
  })

  it('no aplica a la vista de reproduccion', () => {
    const state = run([{ type: 'openNowPlaying' }, { type: 'move', delta: 1, itemCount: 5 }])
    expect(currentView(state)).toEqual({ kind: 'nowPlaying' })
  })
})

describe('navegacion', () => {
  it('apila y desapila vistas', () => {
    const state = run([
      { type: 'push', view: { kind: 'folder', path: 'C:/beats', name: 'beats', selected: 0 } }
    ])
    expect(currentView(state).kind).toBe('folder')

    const back = screenReducer(state, { type: 'back' })
    expect(currentView(back)).toMatchObject({ kind: 'menu', menu: 'root' })
  })

  it('conserva la seleccion del nivel anterior al volver', () => {
    const state = run([
      { type: 'move', delta: 2, itemCount: 6 },
      { type: 'push', view: { kind: 'folder', path: 'C:/beats', name: 'beats', selected: 0 } },
      { type: 'move', delta: 3, itemCount: 10 },
      { type: 'back' }
    ])
    expect(currentView(state)).toMatchObject({ kind: 'menu', selected: 2 })
  })

  it('volver desde el piso no vacia la pila', () => {
    const state = run([{ type: 'back' }, { type: 'back' }])
    expect(state.stack).toHaveLength(1)
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'root' })
  })

  it('home vuelve a la raiz desde cualquier profundidad', () => {
    const state = run([
      { type: 'push', view: { kind: 'folder', path: 'C:/a', name: 'a', selected: 0 } },
      { type: 'push', view: { kind: 'folder', path: 'C:/a/b', name: 'b', selected: 0 } },
      { type: 'home' }
    ])
    expect(state).toEqual(INITIAL_SCREEN_STATE)
  })

  it('no apila dos veces la vista de reproduccion', () => {
    const state = run([{ type: 'openNowPlaying' }, { type: 'openNowPlaying' }])
    expect(state.stack.filter((view) => view.kind === 'nowPlaying')).toHaveLength(1)
  })
})

describe('busqueda al tipear', () => {
  it('tipear en un menu abre la busqueda con esa letra', () => {
    const state = run([{ type: 'typeChar', char: 'b' }])
    expect(currentView(state)).toEqual({ kind: 'search', query: 'b', selected: 0 })
  })

  it('sigue acumulando letras sin apilar vistas nuevas', () => {
    const state = run([
      { type: 'typeChar', char: 'b' },
      { type: 'typeChar', char: 'e' },
      { type: 'typeChar', char: 'a' }
    ])
    expect(currentView(state)).toMatchObject({ query: 'bea' })
    expect(state.stack).toHaveLength(2)
  })

  it('escribir reinicia la seleccion (los resultados cambiaron)', () => {
    const state = run([
      { type: 'typeChar', char: 'b' },
      { type: 'move', delta: 4, itemCount: 10 },
      { type: 'typeChar', char: 'e' }
    ])
    expect(currentView(state)).toMatchObject({ query: 'be', selected: 0 })
  })

  it('backspace borra una letra', () => {
    const state = run([
      { type: 'typeChar', char: 'b' },
      { type: 'typeChar', char: 'e' },
      { type: 'backspace' }
    ])
    expect(currentView(state)).toMatchObject({ query: 'b' })
  })

  it('backspace con la busqueda vacia sale de la busqueda', () => {
    const state = run([{ type: 'typeChar', char: 'b' }, { type: 'backspace' }, { type: 'backspace' }])
    expect(currentView(state)).toMatchObject({ kind: 'menu', menu: 'root' })
  })

  it('backspace fuera de la busqueda no hace nada', () => {
    const state = run([{ type: 'backspace' }])
    expect(state).toEqual(INITIAL_SCREEN_STATE)
  })
})
