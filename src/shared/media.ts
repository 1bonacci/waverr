/**
 * Reglas del protocolo de medios `waverr://`.
 *
 * Modulo puro y sin dependencias de Node ni de Electron: lo importan tanto el
 * main (que sirve los archivos) como el renderer (que arma las URL), y ademas
 * se puede testear solo.
 */

export const MEDIA_SCHEME = 'waverr'

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  wma: 'audio/x-ms-wma'
}

/**
 * Tipo MIME por extension. Chromium elige el decodificador con esto, asi que
 * mandar el tipo correcto es lo que hace la diferencia entre reproducir y no.
 */
export function mimeTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_TYPES[filePath.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream'
}

/** URL que el renderer le pasa al elemento <audio>. */
export function mediaUrlForTrack(trackId: number): string {
  return `${MEDIA_SCHEME}://track/${trackId}`
}

/** Extrae el id de pista de una URL `waverr://track/<id>`. */
export function parseTrackUrl(rawUrl: string): number | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== 'track') return null

  const raw = url.pathname.replace(/^\/+/, '')
  if (!/^\d+$/.test(raw)) return null

  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export interface ByteRange {
  start: number
  end: number
}

/**
 * Interpreta un header `Range` de una sola porcion.
 *
 * Devuelve null si no hay header o no se entiende (el llamador responde el
 * archivo entero) y lanza `RangeError` si el rango es imposible, porque eso
 * merece un 416 y no un 200 silencioso.
 */
export function parseRangeHeader(header: string | null, size: number): ByteRange | null {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number

  if (rawStart === '') {
    // "bytes=-500" pide los ultimos 500 bytes.
    const suffixLength = Number(rawEnd)
    if (suffixLength <= 0) throw new RangeError('rango vacio')
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }

  if (start > end || start >= size) throw new RangeError('rango fuera del archivo')
  return { start, end }
}
