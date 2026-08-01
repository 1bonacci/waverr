import { useEffect, useRef, type JSX } from 'react'
import { audioEngine } from '../audio/AudioEngine'
import { usePlayback } from '../audio/usePlayback'
import { useUiStore } from '../store/ui'

export type VisualizerMode = 'bars' | 'scope' | 'ambient'

export const VISUALIZER_MODES: VisualizerMode[] = ['bars', 'scope', 'ambient']

/** Tope de refresco. Es un adorno: no debe pelear CPU con el DAW del usuario. */
const TARGET_FPS = 40
const FRAME_MS = 1000 / TARGET_FPS

/** Bandas del modo barras, agrupadas logaritmicamente. */
const BAND_COUNT = 24

interface VisualizerProps {
  mode?: VisualizerMode
}

/**
 * Visualizador de la pantalla.
 *
 * Lee del AnalyserNode del motor y dibuja en un canvas 2D. El bucle se detiene
 * cuando no hay reproduccion o la ventana esta oculta: en reposo no consume.
 */
export function Visualizer({ mode }: VisualizerProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(0)
  const peaksRef = useRef<Float32Array>(new Float32Array(BAND_COUNT))
  const phaseRef = useRef(0)
  const playback = usePlayback()
  const storeMode = useUiStore((state) => state.visualizerMode)
  const activeMode = mode ?? storeMode

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const analyser = playback.status === 'playing' ? audioEngine.getAnalyser() : null
    const frequency = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const waveform = analyser ? new Uint8Array(analyser.fftSize) : null

    let lastFrame = 0
    let stopped = false

    const resize = (): void => {
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = Math.max(1, Math.floor(width * ratio))
        canvas.height = Math.max(1, Math.floor(height * ratio))
      }
    }

    const draw = (timestamp: number): void => {
      if (stopped) return
      frameRef.current = requestAnimationFrame(draw)

      if (timestamp - lastFrame < FRAME_MS) return
      lastFrame = timestamp

      resize()
      const { width, height } = canvas
      const ink = readInk(canvas)

      context.clearRect(0, 0, width, height)

      if (!analyser || !frequency || !waveform) {
        drawIdle(context, width, height, ink)
        return
      }

      let peak = 0

      switch (activeMode) {
        case 'bars':
          analyser.getByteFrequencyData(frequency)
          peak = maxOf(frequency)
          drawBars(context, width, height, ink, frequency, peaksRef.current)
          break
        case 'scope':
          analyser.getByteTimeDomainData(waveform)
          peak = maxDeviation(waveform)
          drawScope(context, width, height, ink, waveform)
          break
        case 'ambient':
          analyser.getByteFrequencyData(frequency)
          peak = maxOf(frequency)
          phaseRef.current += 0.02
          drawAmbient(context, width, height, ink, frequency, phaseRef.current)
          break
      }

      // Nivel del ultimo cuadro. Lo consumen los tests y sirve para diagnosticar
      // de un vistazo si el analizador esta recibiendo audio.
      canvas.dataset['peak'] = String(peak)
    }

    frameRef.current = requestAnimationFrame(draw)

    // Con la ventana minimizada u oculta el bucle no tiene sentido.
    const onVisibility = (): void => {
      if (document.hidden) {
        cancelAnimationFrame(frameRef.current)
      } else if (!stopped) {
        frameRef.current = requestAnimationFrame(draw)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stopped = true
      cancelAnimationFrame(frameRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeMode, playback.status, playback.track?.id])

  return (
    <canvas
      ref={canvasRef}
      data-testid="visualizer"
      data-mode={activeMode}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}

function maxOf(values: Uint8Array): number {
  let peak = 0
  for (const value of values) if (value > peak) peak = value
  return peak
}

function maxDeviation(waveform: Uint8Array): number {
  let peak = 0
  for (const value of waveform) {
    const deviation = Math.abs(value - 128)
    if (deviation > peak) peak = deviation
  }
  return peak
}

/** The visualizer draws in the accent color, not the text color: black bars on
 *  a pale screen read as a glitch, blue reads as part of the device. */
function readInk(canvas: HTMLCanvasElement): string {
  return getComputedStyle(canvas).getPropertyValue('--lcd-accent').trim() || '#1f6feb'
}

/** Sin audio: una linea base viva pero quieta, para que la pantalla no parezca rota. */
function drawIdle(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  ink: string
): void {
  context.strokeStyle = ink
  context.globalAlpha = 0.25
  context.lineWidth = Math.max(1, height / 90)
  context.beginPath()
  context.moveTo(0, height / 2)
  context.lineTo(width, height / 2)
  context.stroke()
  context.globalAlpha = 1
}

function drawBars(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  ink: string,
  frequency: Uint8Array,
  peaks: Float32Array
): void {
  const gap = Math.max(1, Math.round(width / 260))
  const barWidth = (width - gap * (BAND_COUNT - 1)) / BAND_COUNT

  context.fillStyle = ink

  for (let band = 0; band < BAND_COUNT; band++) {
    // Agrupacion logaritmica: reparte el detalle como lo oye el oido, en vez
    // de dejar 20 barras de agudos casi siempre vacias.
    const start = binForBand(band, frequency.length)
    const end = Math.max(start + 1, binForBand(band + 1, frequency.length))

    let sum = 0
    for (let bin = start; bin < end; bin++) sum += frequency[bin] ?? 0
    const level = sum / (end - start) / 255

    const previous = peaks[band] ?? 0
    // Sube al instante, baja despacio: da la sensacion de inercia del hardware.
    const value = level > previous ? level : previous * 0.86
    peaks[band] = value

    const barHeight = Math.max(1, value * height)
    context.fillRect(band * (barWidth + gap), height - barHeight, barWidth, barHeight)
  }
}

function binForBand(band: number, binCount: number): number {
  const ratio = band / BAND_COUNT
  // Escala exponencial acotada a los primeros ~2/3 del espectro, donde vive
  // casi toda la energia de la musica.
  return Math.floor(Math.pow(ratio, 2.2) * binCount * 0.7)
}

function drawScope(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  ink: string,
  waveform: Uint8Array
): void {
  context.strokeStyle = ink
  context.lineWidth = Math.max(1, height / 70)
  context.beginPath()

  const step = width / waveform.length
  for (let index = 0; index < waveform.length; index++) {
    const value = ((waveform[index] ?? 128) - 128) / 128
    const y = height / 2 + value * (height / 2) * 0.9
    if (index === 0) context.moveTo(0, y)
    else context.lineTo(index * step, y)
  }

  context.stroke()
}

function drawAmbient(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  ink: string,
  frequency: Uint8Array,
  phase: number
): void {
  // Energia de graves: los primeros bins son los que hacen "latir" la imagen.
  let bass = 0
  const bassBins = Math.max(1, Math.floor(frequency.length * 0.08))
  for (let bin = 0; bin < bassBins; bin++) bass += frequency[bin] ?? 0
  const energy = bass / bassBins / 255

  const centerX = width / 2
  const centerY = height / 2
  const baseRadius = Math.min(width, height) * 0.18

  context.strokeStyle = ink

  for (let ring = 0; ring < 4; ring++) {
    const wobble = Math.sin(phase + ring * 0.9) * 0.12
    const radius = baseRadius * (1 + ring * 0.45) * (1 + energy * 0.6 + wobble)
    context.globalAlpha = 0.55 - ring * 0.11
    context.lineWidth = Math.max(1, height / 110)
    context.beginPath()
    context.arc(centerX, centerY, Math.max(1, radius), 0, Math.PI * 2)
    context.stroke()
  }

  context.globalAlpha = 1
}
