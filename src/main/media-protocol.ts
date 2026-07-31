import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { MEDIA_SCHEME, mimeTypeFor, parseRangeHeader, parseTrackUrl } from '../shared/media'
import type { ByteRange } from '../shared/media'
import type { Library } from './library/index'

/**
 * Debe llamarse ANTES de `app.whenReady()`.
 *
 * `standard` + `secure` es lo que evita que Chromium trate al audio como origen
 * opaco: si lo hiciera, el MediaElementSource quedaria "tainted" y el
 * AnalyserNode devolveria puros ceros, o sea visualizador muerto con audio
 * sonando. `stream` habilita respuestas parciales para poder buscar dentro de
 * archivos grandes sin bajarlos enteros.
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
 * Sirve audio local al renderer.
 *
 * Las pistas se piden por id, no por ruta: el renderer nunca elige que archivo
 * se abre, solo cual de los que ya estan indexados. Igual se revalida que el
 * archivo siga dentro de una carpeta raiz registrada, por si la fila quedara
 * apuntando afuera.
 */
export function registerMediaProtocol(library: Library): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const trackId = parseTrackUrl(request.url)
    if (trackId === null) return new Response('URL invalida', { status: 400 })

    const track = library.getTrack(trackId)
    if (!track) return new Response('Pista desconocida', { status: 404 })

    if (!library.isPathInsideRoots(track.path)) {
      return new Response('Fuera de las carpetas registradas', { status: 403 })
    }

    const info = await stat(track.path).catch(() => null)
    if (!info?.isFile()) return new Response('Archivo no encontrado', { status: 404 })

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
