import { describe, expect, it } from 'vitest'
import {
  mediaUrlForTrack,
  mimeTypeFor,
  parseRangeHeader,
  parseTrackUrl
} from '../../src/shared/media'

describe('mimeTypeFor', () => {
  it('maps the supported extensions', () => {
    expect(mimeTypeFor('C:/beats/beat.mp3')).toBe('audio/mpeg')
    expect(mimeTypeFor('C:/beats/beat.WAV')).toBe('audio/wav')
    expect(mimeTypeFor('C:/beats/beat.flac')).toBe('audio/flac')
    expect(mimeTypeFor('C:/beats/beat.m4a')).toBe('audio/mp4')
  })

  it('falls back to octet-stream for unknown extensions', () => {
    expect(mimeTypeFor('C:/beats/project.als')).toBe('application/octet-stream')
    expect(mimeTypeFor('no-extension')).toBe('application/octet-stream')
  })
})

describe('parseTrackUrl', () => {
  it('accepts the valid form', () => {
    expect(parseTrackUrl(mediaUrlForTrack(42))).toBe(42)
  })

  it('rejects anything that is not a track id', () => {
    // The renderer can only name already-indexed tracks: there is no way to
    // request an arbitrary path through this URL.
    expect(parseTrackUrl('waverr://track/../../../etc/passwd')).toBeNull()
    expect(parseTrackUrl('waverr://track/C:/Windows/System32/config/SAM')).toBeNull()
    expect(parseTrackUrl('waverr://file/42')).toBeNull()
    expect(parseTrackUrl('file:///C:/Windows/win.ini')).toBeNull()
    expect(parseTrackUrl('waverr://track/0')).toBeNull()
    expect(parseTrackUrl('waverr://track/-1')).toBeNull()
    expect(parseTrackUrl('waverr://track/abc')).toBeNull()
    expect(parseTrackUrl('not a url')).toBeNull()
  })
})

describe('parseRangeHeader', () => {
  const SIZE = 1000

  it('with no header returns null (the whole file is served)', () => {
    expect(parseRangeHeader(null, SIZE)).toBeNull()
    expect(parseRangeHeader('', SIZE)).toBeNull()
  })

  it('parses a closed range', () => {
    expect(parseRangeHeader('bytes=0-499', SIZE)).toEqual({ start: 0, end: 499 })
  })

  it('parses a range open at the end', () => {
    expect(parseRangeHeader('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 })
  })

  it('parses a suffix', () => {
    expect(parseRangeHeader('bytes=-200', SIZE)).toEqual({ start: 800, end: 999 })
  })

  it('clamps the end to the file\'s real size', () => {
    expect(parseRangeHeader('bytes=900-99999', SIZE)).toEqual({ start: 900, end: 999 })
  })

  it('ignores formats it does not understand', () => {
    expect(parseRangeHeader('items=0-10', SIZE)).toBeNull()
    expect(parseRangeHeader('bytes=0-10, 20-30', SIZE)).toBeNull()
    expect(parseRangeHeader('bytes=-', SIZE)).toBeNull()
  })

  it('throws when the range is impossible (deserves a 416)', () => {
    expect(() => parseRangeHeader('bytes=1000-1100', SIZE)).toThrow(RangeError)
    expect(() => parseRangeHeader('bytes=600-500', SIZE)).toThrow(RangeError)
    expect(() => parseRangeHeader('bytes=-0', SIZE)).toThrow(RangeError)
  })
})
