import { describe, expect, it } from 'vitest'
import {
  mediaUrlForTrack,
  mimeTypeFor,
  parseRangeHeader,
  parseTrackUrl
} from '../../src/shared/media'

describe('mimeTypeFor', () => {
  it('mapea las extensiones soportadas', () => {
    expect(mimeTypeFor('C:/beats/beat.mp3')).toBe('audio/mpeg')
    expect(mimeTypeFor('C:/beats/beat.WAV')).toBe('audio/wav')
    expect(mimeTypeFor('C:/beats/beat.flac')).toBe('audio/flac')
    expect(mimeTypeFor('C:/beats/beat.m4a')).toBe('audio/mp4')
  })

  it('cae a octet-stream con extensiones desconocidas', () => {
    expect(mimeTypeFor('C:/beats/proyecto.als')).toBe('application/octet-stream')
    expect(mimeTypeFor('sin-extension')).toBe('application/octet-stream')
  })
})

describe('parseTrackUrl', () => {
  it('acepta la forma valida', () => {
    expect(parseTrackUrl(mediaUrlForTrack(42))).toBe(42)
  })

  it('rechaza cualquier cosa que no sea un id de pista', () => {
    // El renderer solo puede nombrar pistas ya indexadas: no hay forma de
    // pedir una ruta arbitraria a traves de esta URL.
    expect(parseTrackUrl('waverr://track/../../../etc/passwd')).toBeNull()
    expect(parseTrackUrl('waverr://track/C:/Windows/System32/config/SAM')).toBeNull()
    expect(parseTrackUrl('waverr://file/42')).toBeNull()
    expect(parseTrackUrl('file:///C:/Windows/win.ini')).toBeNull()
    expect(parseTrackUrl('waverr://track/0')).toBeNull()
    expect(parseTrackUrl('waverr://track/-1')).toBeNull()
    expect(parseTrackUrl('waverr://track/abc')).toBeNull()
    expect(parseTrackUrl('no es una url')).toBeNull()
  })
})

describe('parseRangeHeader', () => {
  const SIZE = 1000

  it('sin header devuelve null (se sirve el archivo entero)', () => {
    expect(parseRangeHeader(null, SIZE)).toBeNull()
    expect(parseRangeHeader('', SIZE)).toBeNull()
  })

  it('interpreta un rango cerrado', () => {
    expect(parseRangeHeader('bytes=0-499', SIZE)).toEqual({ start: 0, end: 499 })
  })

  it('interpreta un rango abierto al final', () => {
    expect(parseRangeHeader('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 })
  })

  it('interpreta un sufijo', () => {
    expect(parseRangeHeader('bytes=-200', SIZE)).toEqual({ start: 800, end: 999 })
  })

  it('recorta el final al tamanio real del archivo', () => {
    expect(parseRangeHeader('bytes=900-99999', SIZE)).toEqual({ start: 900, end: 999 })
  })

  it('ignora formatos que no entiende', () => {
    expect(parseRangeHeader('items=0-10', SIZE)).toBeNull()
    expect(parseRangeHeader('bytes=0-10, 20-30', SIZE)).toBeNull()
    expect(parseRangeHeader('bytes=-', SIZE)).toBeNull()
  })

  it('lanza cuando el rango es imposible (merece 416)', () => {
    expect(() => parseRangeHeader('bytes=1000-1100', SIZE)).toThrow(RangeError)
    expect(() => parseRangeHeader('bytes=600-500', SIZE)).toThrow(RangeError)
    expect(() => parseRangeHeader('bytes=-0', SIZE)).toThrow(RangeError)
  })
})
