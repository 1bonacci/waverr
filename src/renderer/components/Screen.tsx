import { useEffect, useRef, useState, type JSX } from 'react'
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
  const volumeFlash = useVolumeFlash(playback.volume)

  return (
    <div className={styles.bezel}>
      <div className={styles.glass}>
        <div className={styles.header}>
          <span className={styles.headerTitle} data-testid="screen-title">
            {controller.title}
            {view.kind === 'search' && <span className={styles.caret}>_</span>}
          </span>
          {/* Hiding takes effect immediately so a folder can be pruned quickly;
              this is what makes that safe. It sits beside the status rather
              than replacing it: the play state stays readable throughout. */}
          {controller.undo && (
            <button
              type="button"
              className={styles.undo}
              title={`Restore ${controller.undo.label}`}
              data-testid="undo-hide"
              onClick={controller.undoHide}
            >
              HIDDEN &middot; UNDO
            </button>
          )}
          <span className={styles.headerStatus} data-testid="screen-status">
            {statusText(scan, playback.status, volumeFlash)}
          </span>
          {/* Once something is loaded, the glyph is the way back to it. Leaving
              NOW PLAYING pops the view off the stack, and the only other route
              back was re-selecting the row -- which used to start it over. */}
          {playback.track && view.kind !== 'nowPlaying' && (
            <button
              type="button"
              className={styles.nowPlaying}
              title="Now playing"
              aria-label="Now playing"
              data-testid="now-playing-button"
              onClick={() => controller.dispatch({ type: 'openNowPlaying' })}
            >
              ♪
            </button>
          )}
          {view.kind !== 'search' && view.kind !== 'prompt' && (
            <button
              type="button"
              className={styles.search}
              title="Search"
              aria-label="Search"
              data-testid="search-button"
              onClick={() =>
                controller.dispatch({
                  type: 'push',
                  view: { kind: 'search', query: '', selected: 0 }
                })
              }
            >
              ⌕
            </button>
          )}
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

/** How long the level stays on the header after the volume is changed. */
const VOLUME_FLASH_MS = 1200

/**
 * Volume can be changed from any view with the +/- keys, where the slider on
 * the playback screen is nowhere in sight. This briefly puts the level on the
 * header so the keys are not firing into the dark.
 */
function useVolumeFlash(volume: number): number | null {
  const [flash, setFlash] = useState<number | null>(null)
  const previous = useRef(volume)

  useEffect(() => {
    // Only a change shows the readout: the initial level is not news.
    if (previous.current === volume) return
    previous.current = volume
    setFlash(volume)
    const timer = setTimeout(() => setFlash(null), VOLUME_FLASH_MS)
    return () => clearTimeout(timer)
  }, [volume])

  return flash
}

function statusText(
  scan: ScreenController['scan'],
  status: ReturnType<typeof usePlayback>['status'],
  volumeFlash: number | null
): string {
  // Scanning is the one thing that outranks the level: it is the only status
  // that tells the user the library is still incomplete.
  if (scan) {
    const suffix = scan.total > 0 ? `${scan.done}/${scan.total}` : String(scan.done)
    return `${scan.phase === 'metadata' ? 'TAGS' : 'SCAN'} ${suffix}`
  }

  if (volumeFlash !== null) return `VOL ${Math.round(volumeFlash * 100)}%`

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
