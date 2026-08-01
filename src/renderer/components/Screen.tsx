import type { JSX } from 'react'
import { usePlayback } from '../audio/usePlayback'
import type { ScreenController } from '../screen/useScreen'
import { ContextMenuView } from './views/ContextMenuView'
import { ListView } from './views/ListView'
import { NowPlayingView } from './views/NowPlayingView'
import { PromptView } from './views/PromptView'
import { QueueView } from './views/QueueView'
import styles from './Screen.module.css'

interface ScreenProps {
  controller: ScreenController
}

/**
 * The LCD screen. Everything the user sees lives in here: there are no panels
 * outside the device.
 */
export function Screen({ controller }: ScreenProps): JSX.Element {
  const playback = usePlayback()
  const { view, scan } = controller

  return (
    <div className={styles.bezel}>
      <div className={styles.glass}>
        <div className={styles.header}>
          <span className={styles.headerTitle} data-testid="screen-title">
            {controller.title}
            {view.kind === 'search' && <span className={styles.caret}>_</span>}
          </span>
          <span className={styles.headerStatus} data-testid="screen-status">
            {statusText(scan, playback.status)}
          </span>
        </div>

        <div className={styles.body}>
          {view.kind === 'nowPlaying' ? (
            <NowPlayingView />
          ) : view.kind === 'context' ? (
            <ContextMenuView controller={controller} target={view.target} />
          ) : view.kind === 'prompt' ? (
            <PromptView view={view} error={controller.promptError} />
          ) : view.kind === 'queue' || view.kind === 'playlist' ? (
            <QueueView controller={controller} />
          ) : (
            <ListView controller={controller} />
          )}
        </div>
      </div>
    </div>
  )
}

function statusText(
  scan: ScreenController['scan'],
  status: ReturnType<typeof usePlayback>['status']
): string {
  if (scan) {
    const suffix = scan.total > 0 ? `${scan.done}/${scan.total}` : String(scan.done)
    return `${scan.phase === 'metadata' ? 'TAGS' : 'SCAN'} ${suffix}`
  }

  switch (status) {
    case 'playing':
      return '▶'
    case 'paused':
      return '||'
    case 'loading':
      return '...'
    case 'error':
      return '!'
    default:
      return ''
  }
}
