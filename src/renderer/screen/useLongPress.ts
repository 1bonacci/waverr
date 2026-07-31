import { useCallback, useEffect, useRef, type PointerEvent } from 'react'

/** Cuanto hay que mantener OK para que aparezca el menu contextual. */
export const LONG_PRESS_MS = 450

interface LongPressHandlers {
  onPointerDown: (event: PointerEvent) => void
  onPointerUp: (event: PointerEvent) => void
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

  // useScreen reemplaza `items` por [] en cada cambio de vista, asi que la
  // fila entera se desmonta al navegar. Si eso pasa con el puntero todavia
  // apretado, el timeout de mas arriba sigue vivo y a los 450ms dispara
  // `onLongPress` con el `index`/`controller` de un render que ya no existe,
  // abriendo el menu contextual sobre la fila o pantalla equivocada. Este
  // efecto cancela ese timer al desmontar para que eso no pueda pasar.
  useEffect(() => clear, [clear])

  return {
    // Solo el boton primario (izquierdo, o el toque) cuenta como press: el
    // derecho ya tiene su propio significado (abre el menu contextual via
    // el evento nativo `contextmenu`) y no tiene que ademas activar la fila.
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
