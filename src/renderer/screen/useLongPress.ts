import { useCallback, useEffect, useRef, type PointerEvent } from 'react'

/** How long OK has to be held for the context menu to appear. */
export const LONG_PRESS_MS = 450

interface LongPressHandlers {
  onPointerDown: (event: PointerEvent) => void
  onPointerUp: (event: PointerEvent) => void
  onPointerLeave: () => void
}

/**
 * Tells a click apart from a held OK on the same row.
 *
 * Released before the threshold runs `onPress`; held past it runs `onLongPress`
 * and cancels the `onPress` that would otherwise follow.
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

  // useScreen replaces `items` with [] on every view change, so the whole row
  // unmounts when navigating. If that happens with the pointer still held, the
  // timeout above stays alive and 450ms later fires `onLongPress` with the
  // `index`/`controller` of a render that no longer exists, opening the context
  // menu over the wrong row or the wrong screen. This effect cancels that timer
  // on unmount so it cannot happen.
  useEffect(() => clear, [clear])

  return {
    // Only the primary button (left, or a touch) counts as a press: the right
    // button already has its own meaning (it opens the context menu through the
    // native `contextmenu` event) and must not also activate the row.
    onPointerDown: useCallback(
      (event: PointerEvent) => {
        if (event.button !== 0) return
        fired.current = false
        clear()
        timer.current = setTimeout(() => {
          fired.current = true
          onLongPress()
        }, LONG_PRESS_MS)
      },
      [clear, onLongPress]
    ),

    onPointerUp: useCallback(
      (event: PointerEvent) => {
        if (event.button !== 0) return
        clear()
        if (!fired.current) onPress()
      },
      [clear, onPress]
    ),

    onPointerLeave: useCallback(() => {
      clear()
      fired.current = false
    }, [clear])
  }
}
