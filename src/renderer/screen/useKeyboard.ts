import { useEffect, useRef } from 'react'
import { audioEngine } from '../audio/AudioEngine'
import { useUiStore } from '../store/ui'
import type { ScreenController } from './useScreen'

/** How far holding PREV or NEXT seeks on each repeat. */
const SEEK_STEP_MS = 5000

/**
 * Keyboard for the device. Every key does exactly what the equivalent physical
 * button would, so waverr can be used end to end without touching the mouse.
 */
export function useKeyboardControls(controller: ScreenController): void {
  // Tracks whether the Enter autorepeat already opened the context menu, so it
  // is not reopened on every autorepeat tick while the key stays held.
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
          // In a prompt, Enter confirms the text instead of activating a row:
          // there is no list, and a context menu on autorepeat makes no sense.
          if (controller.view.kind === 'prompt') {
            if (!event.repeat) controller.confirmPrompt()
            return
          }
          // Holding Enter triggers autorepeat: the first repeat is the keyboard
          // equivalent of holding OK down.
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
          // Inside search or a prompt it deletes a letter (and the reducer
          // itself closes the view when there is nothing left to delete);
          // everywhere else it means "back".
          controller.dispatch(
            controller.view.kind === 'search' || controller.view.kind === 'prompt'
              ? { type: 'backspace' }
              : { type: 'back' }
          )
          return
        case ' ':
          event.preventDefault()
          // In a prompt, space is just another character of the name (a
          // playlist called "Car music" needs it); elsewhere it pauses/resumes.
          if (controller.view.kind === 'prompt') {
            controller.dispatch({ type: 'typeChar', char: ' ' })
            return
          }
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

      // V and F are shortcuts only outside search and prompts: while filtering
      // or typing a name, those letters belong to the text.
      if (controller.view.kind !== 'search' && controller.view.kind !== 'prompt') {
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

      // Any printable character opens search and filters live.
      if (key.length === 1 && key !== ' ') {
        event.preventDefault()
        controller.dispatch({ type: 'typeChar', char: key })
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') longPressFired.current = false
    }

    // If the window loses focus with Enter held (alt-tab, a click on another
    // window, DevTools), the Enter keyup may never arrive and the flag stays
    // stuck at true: from then on, holding Enter would no longer open the
    // context menu. A blur is the signal that the keyup is no longer
    // guaranteed, so reset the flag just in case.
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
