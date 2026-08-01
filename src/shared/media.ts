/**
 * Rules of the `waverr://` media protocol.
 *
 * A pure module with no Node or Electron dependencies: it is imported both by
 * the main process (which serves the files) and by the renderer (which builds
 * the URLs), and it can be tested on its own.
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
 * MIME type by extension. Chromium picks the decoder from this, so sending the
 * right type is the difference between playing and not playing.
 */
export function mimeTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_TYPES[filePath.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream'
}

/** The URL the renderer hands to the <audio> element. */
export function mediaUrlForTrack(trackId: number): string {
  return `${MEDIA_SCHEME}://track/${trackId}`
}

/** Extracts the track id from a `waverr://track/<id>` URL. */
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
 * Parses a single-part `Range` header.
 *
 * Returns null when there is no header or it cannot be understood (the caller
 * then serves the whole file), and throws `RangeError` when the range is
 * impossible, because that deserves a 416 rather than a silent 200.
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
    // "bytes=-500" asks for the last 500 bytes.
    const suffixLength = Number(rawEnd)
    if (suffixLength <= 0) throw new RangeError('empty range')
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }

  if (start > end || start >= size) throw new RangeError('range outside the file')
  return { start, end }
}
