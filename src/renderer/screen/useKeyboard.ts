import { useEffect, useRef } from 'react'
import { audioEngine } from '../audio/AudioEngine'
import { useUiStore } from '../store/ui'
import { LONG_PRESS_MS } from './useLongPress'
import type { ScreenController } from './useScreen'

/** How far holding PREV or NEXT seeks on each repeat. */
const SEEK_STEP_MS = 5000

/** How much one press of the volume keys moves the level. */
const VOLUME_STEP = 0.05

/** Safety net for the held-key guards below. `keyup` is what normally re-arms
 *  them, but a keyup can be missed (the window loses focus mid-hold), so a
 *  repeat this long after the previous one is treated as a fresh press rather
 *  than leaving the key stuck. Comfortably longer than an autorepeat interval
 *  and shorter than any deliberate double press. */
const REPEAT_GAP_MS = 250

/**
 * Keyboard for the device. Every key does exactly what the equivalent physical
 * button would, so waverr can be used end to end without touching the mouse.
 */
export function useKeyboardControls(controller: ScreenController): void {
  // Enter is held to open the context menu, exactly like OK on a real device.
  // That cannot be decided on keydown -- a press only turns out to be a tap
  // once the key comes back up -- so activation waits for keyup and the menu is
  // opened by a timer, mirroring `useLongPress` for the pointer.
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enterFired = useRef(false)

  // Whether the key that means "back" (Escape, or Backspace) is still down
  // from a previous keydown, and when that keydown was. Together they tell a
  // held key from a fresh press, which is what both the BACK step and the
  // search exit turn on.
  const backHeld = useRef(false)
  const lastBackAt = useRef(0)

  // `useScreen` returns a fresh object on every render -- including on every
  // playback position tick -- so binding the listeners to `controller` directly
  // would tear them down and rebuild them several times a second. Worse, the
  // teardown clears the pending Enter timer, so a hold would be cancelled by an
  // unrelated re-render. The listeners are registered once and read the current
  // controller through this ref instead.
  const controllerRef = useRef(controller)
  controllerRef.current = controller

  useEffect(() => {
    const clearEnter = (): void => {
      if (enterTimer.current !== null) {
        clearTimeout(enterTimer.current)
        enterTimer.current = null
      }
    }

    // True when this keydown starts a new hold rather than continuing one.
    // `event.repeat` alone is not enough: once a search query is empty there is
    // nothing left to delete and some autorepeat sequences stop setting it, so
    // the hold is tracked here as well and only released on keyup.
    const startsFreshHold = (event: KeyboardEvent): boolean => {
      const now = performance.now()
      const continuing = backHeld.current && now - lastBackAt.current < REPEAT_GAP_MS
      lastBackAt.current = now
      backHeld.current = true
      return !event.repeat && !continuing
    }

    // One press, one step back. Holding the key repeats many times a second and
    // used to walk the whole stack to the root before it could be let go.
    const goBack = (event: KeyboardEvent): void => {
      if (!startsFreshHold(event)) return
      controllerRef.current.dispatch({ type: 'back' })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const { key, ctrlKey, altKey, metaKey } = event
      if (ctrlKey || altKey || metaKey) return
      const controller = controllerRef.current

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
        case 'Enter': {
          event.preventDefault()
          // In a prompt, Enter confirms the text instead of activating a row:
          // there is no list, and a context menu makes no sense.
          if (controller.view.kind === 'prompt') {
            if (!event.repeat) controller.confirmPrompt()
            return
          }
          // Autorepeat carries no information now that a real timer decides
          // what a hold means.
          if (event.repeat) return
          enterFired.current = false
          clearEnter()
          enterTimer.current = setTimeout(() => {
            enterTimer.current = null
            enterFired.current = true
            // Read the controller as it is when the hold completes, not as it
            // was when the key went down.
            const current = controllerRef.current
            current.openContextMenu(current.selected)
          }, LONG_PRESS_MS)
          return
        }
        case 'Escape':
          event.preventDefault()
          goBack(event)
          return
        case 'Backspace': {
          event.preventDefault()
          const view = controller.view
          if (view.kind !== 'search' && view.kind !== 'prompt') {
            goBack(event)
            return
          }
          // Inside search or a prompt Backspace deletes a letter, and the
          // reducer leaves the view once there is nothing left to delete. That
          // last step is the dangerous one: someone holding the key to clear
          // what they typed would sail straight through empty and land back in
          // the menu, having meant only to clear the box.
          //
          // So the exit belongs to a press, never to a hold: deleting letters
          // happens either way, but only a fresh press may leave the view.
          controller.dispatch({ type: 'backspace', fromRepeat: !startsFreshHold(event) })
          return
        }
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

      // Volume. Up/Down move the selection and letters are swallowed by search,
      // so the +/- pair is what is left. They sit in front of the printable
      // character fallthrough below so they are never typed into a query. In a
      // prompt they stay literal: a playlist name may well contain a dash.
      if ((key === '+' || key === '-' || key === '=') && controller.view.kind !== 'prompt') {
        event.preventDefault()
        const delta = key === '-' ? -VOLUME_STEP : VOLUME_STEP
        audioEngine.setVolume(audioEngine.getState().volume + delta)
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
      // The hold is over, so the next press of these is a fresh one: allowed to
      // step back, and allowed to leave an empty search.
      if (event.key === 'Backspace' || event.key === 'Escape') backHeld.current = false
      if (event.key !== 'Enter') return
      clearEnter()
      // Released before the threshold: it was a tap after all.
      if (!enterFired.current) controllerRef.current.activate()
      enterFired.current = false
    }

    // If the window loses focus with Enter held (alt-tab, a click on another
    // window, DevTools), the Enter keyup may never arrive. Without this the
    // pending timer would open a context menu over a window nobody is looking
    // at, and the fired flag would stay stuck.
    const onBlur = (): void => {
      clearEnter()
      enterFired.current = false
      backHeld.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      // A timer left running past unmount would fire `openContextMenu` on a
      // screen that no longer exists.
      clearEnter()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
    // Bound once: the live controller is read from `controllerRef` instead.
  }, [])
}
