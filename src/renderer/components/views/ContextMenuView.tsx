import type { JSX } from 'react'
import type { ScreenController } from '../../screen/useScreen'
import type { ContextTarget } from '../../screen/viewStack'
import { ListView } from './ListView'
import styles from './ContextMenuView.module.css'

interface ContextMenuViewProps {
  controller: ScreenController
  target: ContextTarget
}

/** Acciones sobre una fila. Arriba se repite sobre que pista se esta actuando,
 *  porque el menu tapa la lista de donde salio. */
export function ContextMenuView({ controller, target }: ContextMenuViewProps): JSX.Element {
  return (
    <div className={styles.view}>
      <div className={styles.target}>{target.label}</div>
      <ListView controller={controller} />
    </div>
  )
}
