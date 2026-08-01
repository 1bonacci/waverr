import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { MEDIA_SCHEME, mimeTypeFor, parseRangeHeader, parseTrackUrl } from '../shared/media'
import type { ByteRange } from '../shared/media'
import type { Library } from './library/index'

/**
 * Must be called BEFORE `app.whenReady()`.
 *
 * `standard` + `secure` is what stops Chromium treating the audio as an opaque
 * origin: if it did, the MediaElementSource would be tainted and the
 * AnalyserNode would return nothing but zeros -- a dead visualizer with the
 * audio still playing. `stream` enables partial responses, so seeking inside
 * large files does not require downloading them whole.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

/**
 * Serves local audio to the renderer.
 *
 * Tracks are requested by id, not by path: the renderer never chooses which
 * file is opened, only which of the already-indexed ones. It is still
 * revalidated that the file sits inside a registered root folder, in case a row
 * ends up pointing outside.
 */
export function registerMediaProtocol(library: Library): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const trackId = parseTrackUrl(request.url)
    if (trackId === null) return new Response('Invalid URL', { status: 400 })

    const track = library.getTrack(trackId)
    if (!track) return new Response('Unknown track', { status: 404 })

    if (!library.isPathInsideRoots(track.path)) {
      return new Response('Outside the registered folders', { status: 403 })
    }

    const info = await stat(track.path).catch(() => null)
    if (!info?.isFile()) return new Response('File not found', { status: 404 })

    const headers = new Headers({
      'Content-Type': mimeTypeFor(track.path),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    })

    let range: ByteRange | null
    try {
      range = parseRangeHeader(request.headers.get('Range'), info.size)
    } catch {
      headers.set('Content-Range', `bytes */${info.size}`)
      return new Response(null, { status: 416, headers })
    }

    if (!range) {
      headers.set('Content-Length', String(info.size))
      return new Response(toWebStream(createReadStream(track.path)), { status: 200, headers })
    }

    headers.set('Content-Length', String(range.end - range.start + 1))
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`)

    return new Response(
      toWebStream(createReadStream(track.path, { start: range.start, end: range.end })),
      { status: 206, headers }
    )
  })
}

function toWebStream(stream: NodeJS.ReadableStream): ReadableStream {
  return Readable.toWeb(stream as Readable) as ReadableStream
}
