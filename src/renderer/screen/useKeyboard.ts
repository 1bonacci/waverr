import { useEffect, useRef } from 'react'
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
  // Marca si la repeticion de Enter ya disparo el menu contextual, para no
  // abrirlo de nuevo en cada tick de autorepeat mientras se mantiene apretado.
  const longPressFired = useRef(false)

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

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') longPressFired.current = false
    }

    // Si la ventana pierde el foco con Enter mantenido (alt-tab, click en
    // otra ventana, DevTools), el keyup de Enter puede no llegar nunca y el
    // flag queda pegado en true: a partir de ahi mantener Enter no volveria
    // a abrir el menu contextual. El blur es la senal de que ya no hay
    // garantia de recibir ese keyup, asi que resetea el flag por las dudas.
    const onBlur = (): void => {
      longPressFired.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [controller])
}
