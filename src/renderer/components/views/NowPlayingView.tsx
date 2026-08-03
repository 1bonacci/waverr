import type { JSX, PointerEvent } from 'react'
import { audioEngine } from '../../audio/AudioEngine'
import { formatTime, usePlayback } from '../../audio/usePlayback'
import { displayName } from '../../screen/useScreen'
import { Visualizer } from '../Visualizer'
import styles from './NowPlayingView.module.css'

/** Reads where a pointer sits along a horizontal track, as a 0-1 ratio. */
function ratioAlong(clientX: number, track: HTMLElement): number | null {
  const bounds = track.getBoundingClientRect()
  if (bounds.width === 0) return null
  return Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
}

/** Playback screen: visualizer on top, details and transport below. */
export function NowPlayingView(): JSX.Element {
  const playback = usePlayback()

  if (!playback.track) {
    return <div className={styles.empty}>NO TRACK</div>
  }

  const { track, positionMs, durationMs, volume } = playback
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0

  const seekFrom = (clientX: number, track: HTMLElement): void => {
    const ratio = ratioAlong(clientX, track)
    if (ratio !== null) audioEngine.seek(ratio * durationMs)
  }

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const track = event.currentTarget
    track.setPointerCapture(event.pointerId)
    seekFrom(event.clientX, track)
  }

  const seekDrag = (event: PointerEvent<HTMLDivElement>): void => {
    // With the pointer captured, this fires for the whole drag even when it
    // leaves the track.
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    seekFrom(event.clientX, event.currentTarget)
  }

  const endSeekDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const setVolumeFrom = (clientX: number, track: HTMLElement): void => {
    const ratio = ratioAlong(clientX, track)
    if (ratio !== null) audioEngine.setVolume(ratio)
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

      <div
        className={styles.progress}
        onPointerDown={seekFromPointer}
        onPointerMove={seekDrag}
        onPointerUp={endSeekDrag}
        onPointerCancel={endSeekDrag}
        data-testid="progress"
      >
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
      return '▶ Play'
    case 'paused':
      return '|| Paused'
    case 'loading':
      return 'Loading'
    case 'error':
      return 'Error'
    default:
      return 'Stopped'
  }
}
