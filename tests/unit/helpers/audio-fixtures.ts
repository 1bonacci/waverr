import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Genera un WAV PCM valido y diminuto. Sirve para que el escaneo y
 * `music-metadata` tengan archivos reales que leer sin meter binarios al repo.
 */
export function makeWavBuffer(durationSeconds = 0.05, sampleRate = 8000): Buffer {
  const channels = 1
  const bitsPerSample = 16
  const frameCount = Math.max(1, Math.round(durationSeconds * sampleRate))
  const dataSize = frameCount * channels * (bitsPerSample / 8)

  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // tamanio del chunk fmt
  buffer.writeUInt16LE(1, 20) // formato PCM
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28)
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)

  // Una onda senoidal simple: audio real, no silencio.
  for (let frame = 0; frame < frameCount; frame++) {
    const sample = Math.round(Math.sin((frame / sampleRate) * 2 * Math.PI * 440) * 12000)
    buffer.writeInt16LE(sample, 44 + frame * 2)
  }

  return buffer
}

/**
 * @param durationSeconds duracion de cada archivo. Los tests unitarios usan el
 *   default minimo; los de reproduccion necesitan algo que suene lo suficiente
 *   como para poder observarlo.
 */
export async function createTempLibrary(
  files: string[],
  durationSeconds = 0.05
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'waverr-test-'))
  const wav = makeWavBuffer(durationSeconds)

  for (const relativePath of files) {
    const fullPath = join(root, relativePath)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, wav)
  }

  return root
}
