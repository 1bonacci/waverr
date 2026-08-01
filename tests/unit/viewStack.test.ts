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
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { from: 1, to: 1 } })
  })

  it('mover arrastra la fila y la seleccion juntas', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: 1, itemCount: 4 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { from: 1, to: 2 }, selected: 2 })
  })

  it('mover satura en los extremos en vez de envolver', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: -5, itemCount: 4 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { from: 1, to: 0 }, selected: 0 })
  })

  it('soltar termina el modo mover', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: 1, itemCount: 4 },
      { type: 'dropMove' }
    ])
    expect(currentView(state)).toMatchObject({ moving: null, selected: 2 })
  })

  it('cancelar devuelve la seleccion a donde estaba', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: 2, itemCount: 4 },
      { type: 'cancelMove' }
    ])
    expect(currentView(state)).toMatchObject({ moving: null, selected: 1 })
  })

  it('MENU no sale de la vista mientras se esta moviendo', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: 2, itemCount: 4 },
      { type: 'back' }
    ])
    // Si `back` confirmara la posicion (delegara en dropMove) en vez de
    // cancelarla, `selected` quedaria en 3 en lugar de volver a 1.
    expect(currentView(state)).toMatchObject({ kind: 'queue', moving: null, selected: 1 })
    expect(state.stack).toHaveLength(2)
  })

  it('startMove no hace nada en una vista que no se reordena', () => {
    const state = run([{ type: 'startMove', originId: 99, originOccurrence: 0 }])
    expect(state).toEqual(INITIAL_SCREEN_STATE)
  })

  it('startMove guarda la identidad de la fila agarrada, no solo su posicion', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 42, originOccurrence: 0 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { originId: 42 } })
  })

  it('startMove guarda tambien la ocurrencia, para desempatar pistas repetidas', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 42, originOccurrence: 1 }
    ])
    expect(currentView(state)).toMatchObject({ moving: { originId: 42, originOccurrence: 1 } })
  })

  it('dropMove con `to` explicito suelta ahi, como hace un click', () => {
    const state = run([
      { type: 'push', view: queueView },
      { type: 'startMove', originId: 99, originOccurrence: 0 },
      { type: 'moveHeld', delta: 1, itemCount: 4 },
      { type: 'dropMove', to: 3 }
    ])
    expect(currentView(state)).toMatchObject({ moving: null, selected: 3 })
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
