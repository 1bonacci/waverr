import type { JSX, MouseEvent } from 'react'
import { audioEngine } from '../../audio/AudioEngine'
import { formatTime, usePlayback } from '../../audio/usePlayback'
import { displayName } from '../../screen/useScreen'
import { Visualizer } from '../Visualizer'
import styles from './NowPlayingView.module.css'

/** Pantalla de reproduccion: visualizador arriba, datos y transporte abajo. */
export function NowPlayingView(): JSX.Element {
  const playback = usePlayback()

  if (!playback.track) {
    return <div className={styles.empty}>SIN PISTA</div>
  }

  const { track, positionMs, durationMs } = playback
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0

  const seekFromClick = (event: MouseEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - bounds.left) / bounds.width
    audioEngine.seek(ratio * durationMs)
  }

  // Sin tags, la carpeta contenedora es la mejor pista de contexto que hay.
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
          {playback.queueLength > 0 ? `${playback.queueIndex + 1}/${playback.queueLength}` : ''}
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
      return '|| PAUSA'
    case 'loading':
      return 'CARGANDO'
    case 'error':
      return 'ERROR'
    default:
      return 'DETENIDO'
  }
}
