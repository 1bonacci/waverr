import type { JSX, MouseEvent } from 'react'
import { audioEngine } from '../../audio/AudioEngine'
import { formatTime, usePlayback } from '../../audio/usePlayback'
import { displayName } from '../../screen/useScreen'
import { Visualizer } from '../Visualizer'
import styles from './NowPlayingView.module.css'

/** Playback screen: visualizer on top, details and transport below. */
export function NowPlayingView(): JSX.Element {
  const playback = usePlayback()

  if (!playback.track) {
    return <div className={styles.empty}>NO TRACK</div>
  }

  const { track, positionMs, durationMs } = playback
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0

  const seekFromClick = (event: MouseEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - bounds.left) / bounds.width
    audioEngine.seek(ratio * durationMs)
  }

  // With no tags, the containing folder is the best context there is.
  const subtitle = track.hasTags
    ? [track.artist, track.album].filter(Boolean).join(' - ') || track.folder
    : track.folder

  return (
    <div className={styles.view} data-testid="now-playing">
      <div className={styles.visual}>
        <Visualizer />
      </div>

      <div className={styles.info}>
        <span className={styles.title} data-testid="np-title">
          {displayName(track)}
        </span>
        <span className={styles.subtitle}>{subtitle.toUpperCase()}</span>
      </div>

      <div className={styles.progress} onClick={seekFromClick}>
        <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
      </div>

      <div className={styles.times}>
        <span>{formatTime(positionMs)}</span>
        <span>{formatTime(durationMs)}</span>
      </div>

      <div className={styles.transport}>
        <span className={styles.badge}>
          {playback.error ?? statusLabel(playback.status)}
        </span>
        <span>
          {playback.manualCount + playback.upcomingCount > 0
            ? `+${playback.manualCount + playback.upcomingCount}`
            : ''}
        </span>
      </div>
    </div>
  )
}

function statusLabel(status: string): string {
  switch (status) {
    case 'playing':
      return '▶ PLAY'
    case 'paused':
      return '|| PAUSED'
    case 'loading':
      return 'LOADING'
    case 'error':
      return 'ERROR'
    default:
      return 'STOPPED'
  }
}
