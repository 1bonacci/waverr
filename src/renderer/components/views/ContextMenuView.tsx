import type { JSX } from 'react'
import type { ScreenController } from '../../screen/useScreen'
import type { ContextTarget } from '../../screen/viewStack'
import { ListView } from './ListView'
import styles from './ContextMenuView.module.css'

interface ContextMenuViewProps {
  controller: ScreenController
  target: ContextTarget
}

/** Actions on a row. The track being acted on is repeated at the top, because
 *  the menu covers the list it came from. */
export function ContextMenuView({ controller, target }: ContextMenuViewProps): JSX.Element {
  return (
    <div className={styles.view}>
      <div className={styles.target}>{target.label}</div>
      <ListView controller={controller} />
    </div>
  )
}
