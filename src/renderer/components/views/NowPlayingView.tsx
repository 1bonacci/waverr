import type { JSX, MouseEvent, PointerEvent } from 'react'
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

  const { track, positionMs, durationMs, volume } = playback
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0

  const seekFromClick = (event: MouseEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - bounds.left) / bounds.width
    audioEngine.seek(ratio * durationMs)
  }

  // Unlike the progress bar above, the volume track follows the pointer: a
  // level is something you dial in, so being able to drag to it matters more
  // than it does for a seek.
  const setVolumeFrom = (clientX: number, track: HTMLElement): void => {
    const bounds = track.getBoundingClientRect()
    if (bounds.width === 0) return
    const ratio = (clientX - bounds.left) / bounds.width
    audioEngine.setVolume(Math.max(0, Math.min(1, ratio)))
  }

  const volumeFromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const track = event.currentTarget
    track.setPointerCapture(event.pointerId)
    setVolumeFrom(event.clientX, track)
  }

  const volumeDrag = (event: PointerEvent<HTMLDivElement>): void => {
    // With the pointer captured, this fires for the whole drag even when it
    // leaves the track.
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    setVolumeFrom(event.clientX, event.currentTarget)
  }

  const endVolumeDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // With no tags, the containing folder is the best context there is.
  const subtitle = track.hasTags
    ? [track.artist, track.album].filter(Boolean).join(' - ') || track.folder
    : track.folder

  return (
    <div className={styles.view} data-testid="now-playing" data-position={Math.round(positionMs)}>
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

      <div className={styles.volume}>
        <span className={styles.volumeLabel}>VOL</span>
        <div
          className={styles.volumeTrack}
          onPointerDown={volumeFromPointer}
          onPointerMove={volumeDrag}
          onPointerUp={endVolumeDrag}
          onPointerCancel={endVolumeDrag}
          data-testid="volume"
          data-volume={volume.toFixed(2)}
        >
          <div className={styles.volumeFill} style={{ width: `${volume * 100}%` }} />
        </div>
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
