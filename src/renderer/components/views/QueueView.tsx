import type { JSX } from 'react'
import type { ScreenController } from '../../screen/useScreen'
import { ListView } from './ListView'
import styles from './QueueView.module.css'

interface QueueViewProps {
  controller: ScreenController
}

/** COLA y PLAYLIST comparten esta cascara: ambas pueden entrar en modo mover. */
export function QueueView({ controller }: QueueViewProps): JSX.Element {
  const view = controller.view
  const moving = view.kind === 'queue' || view.kind === 'playlist' ? view.moving : null

  return (
    <div className={styles.view}>
      {moving && (
        <div className={styles.movingBanner} data-testid="moving-banner">
          MOVING · OK DROPS · MENU CANCELS
        </div>
      )}
      <ListView controller={controller} />
    </div>
  )
}
