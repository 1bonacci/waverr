import { useRef, type JSX, type WheelEvent } from 'react'
import { audioEngine } from '../audio/AudioEngine'
import type { ScreenController } from '../screen/useScreen'
import styles from './Wheel.module.css'

interface WheelProps {
  controller: ScreenController
}

/** How much accumulated scroll equals moving one row. */
const SCROLL_STEP = 40

/**
 * The click wheel. The four zones of the ring are the physical buttons, and the
 * whole ring responds to mouse scroll, which is the natural stand-in for
 * turning a finger around the original wheel.
 */
export function Wheel({ controller }: WheelProps): JSX.Element {
  const scrollAccumulator = useRef(0)

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    scrollAccumulator.current += event.deltaY
    while (Math.abs(scrollAccumulator.current) >= SCROLL_STEP) {
      const direction = scrollAccumulator.current > 0 ? 1 : -1
      controller.moveBy(direction)
      scrollAccumulator.current -= direction * SCROLL_STEP
    }
  }

  return (
    <div className={styles.deck}>
      <div className={styles.wheel} onWheel={onWheel}>
        <button
          type="button"
          className={`${styles.zone} ${styles.zoneTop}`}
          onClick={() => controller.dispatch({ type: 'back' })}
          title="Back (Esc)"
        >
          MENU
        </button>

        <button
          type="button"
          className={`${styles.zone} ${styles.zoneLeft}`}
          onClick={() => void audioEngine.previous()}
          title="Previous (left arrow)"
        >
          <span className={styles.symbol}>|&#9664;&#9664;</span>
        </button>

        <button
          type="button"
          className={`${styles.zone} ${styles.zoneRight}`}
          onClick={() => void audioEngine.next()}
          title="Next (right arrow)"
        >
          <span className={styles.symbol}>&#9654;&#9654;|</span>
        </button>

        <button
          type="button"
          className={`${styles.zone} ${styles.zoneBottom}`}
          onClick={() => void audioEngine.toggle()}
          title="Play / pause (space)"
        >
          <span className={styles.symbol}>&#9654; ||</span>
        </button>

        <button
          type="button"
          className={styles.center}
          onClick={() => controller.activate()}
          title="Select (Enter)"
        >
          OK
        </button>
      </div>
    </div>
  )
}
