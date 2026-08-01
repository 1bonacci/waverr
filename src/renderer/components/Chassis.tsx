import type { JSX, ReactNode } from 'react'
import styles from './Chassis.module.css'

interface ChassisProps {
  children: ReactNode
}

/**
 * Carcasa del aparato. Dibuja el cuerpo, la barra de arrastre (la ventana es
 * frameless) y deja un hueco para la pantalla y los controles.
 */
export function Chassis({ children }: ChassisProps): JSX.Element {
  return (
    <div className={styles.shell}>
      <div className={styles.body}>
        <div className={styles.dragbar}>
          <span className={styles.brand}>waverr</span>
          <div className={styles.windowControls}>
            <button
              type="button"
              className={styles.windowButton}
              onClick={() => window.waverr.window.minimize()}
              title="Minimize"
              aria-label="Minimize"
            >
              &#8211;
            </button>
            <button
              type="button"
              className={styles.windowButton}
              onClick={() => window.waverr.window.close()}
              title="Close"
              aria-label="Close"
            >
              &#10005;
            </button>
          </div>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  )
}
