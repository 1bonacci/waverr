import { useEffect } from 'react'
import { audioEngine } from '../audio/AudioEngine'
import { useUiStore } from '../store/ui'
import type { ScreenController } from './useScreen'

/** Cuanto rebobina/adelanta al mantener PREV o NEXT apretados. */
const SEEK_STEP_MS = 5000

/**
 * Teclado del aparato. Cada tecla hace exactamente lo que haria el boton
 * fisico equivalente, asi que se puede usar waverr entero sin tocar el mouse.
 */
export function useKeyboardControls(controller: ScreenController): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const { key, ctrlKey, altKey, metaKey } = event
      if (ctrlKey || altKey || metaKey) return

      switch (key) {
        case 'ArrowUp':
          event.preventDefault()
          controller.moveBy(-1)
          return
        case 'ArrowDown':
          event.preventDefault()
          controller.moveBy(1)
          return
        case 'PageUp':
          event.preventDefault()
          controller.moveBy(-5)
          return
        case 'PageDown':
          event.preventDefault()
          controller.moveBy(5)
          return
        case 'Enter':
          event.preventDefault()
          controller.activate()
          return
        case 'Escape':
          event.preventDefault()
          controller.dispatch({ type: 'back' })
          return
        case 'Backspace':
          event.preventDefault()
          // Dentro de la busqueda borra una letra; en el resto es "atras".
          controller.dispatch(
            controller.view.kind === 'search' ? { type: 'backspace' } : { type: 'back' }
          )
          return
        case ' ':
          event.preventDefault()
          void audioEngine.toggle()
          return
        case 'ArrowLeft':
          event.preventDefault()
          if (event.repeat) audioEngine.seek(audioEngine.getState().positionMs - SEEK_STEP_MS)
          else void audioEngine.previous()
          return
        case 'ArrowRight':
          event.preventDefault()
          if (event.repeat) audioEngine.seek(audioEngine.getState().positionMs + SEEK_STEP_MS)
          else void audioEngine.next()
          return
        case 'Home':
          event.preventDefault()
          controller.dispatch({ type: 'home' })
          return
      }

      // V y F son atajos solo fuera de la busqueda: mientras se filtra, esas
      // letras le pertenecen al texto.
      if (controller.view.kind !== 'search') {
        if (key === 'v' || key === 'V') {
          event.preventDefault()
          useUiStore.getState().cycleVisualizer()
          return
        }
        if (key === 'f' || key === 'F') {
          event.preventDefault()
          controller.toggleFavorite()
          return
        }
      }

      // Cualquier caracter imprimible abre la busqueda y filtra en vivo.
      if (key.length === 1 && key !== ' ') {
        event.preventDefault()
        controller.dispatch({ type: 'typeChar', char: key })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller])
}
