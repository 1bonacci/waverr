import Database from 'better-sqlite3'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import type { Track } from '../../shared/types'

/**
 * A raw `tracks` row exactly as SQLite returns it (snake_case, booleans as
 * 0/1). Converted to `Track` by `rowToTrack`.
 */
export interface TrackRow {
  id: number
  root_id: number
  path: string
  filename: string
  dir: string
  folder: string
  ext: string
  size: number
  mtime: number
  duration_ms: number | null
  title: string | null
  artist: string | null
  album: string | null
  has_tags: number
  added_at: number
  last_played_at: number | null
  play_count: number
  missing: number
  hidden: number
  favorite: number | null
}

export function rowToTrack(row: TrackRow): Track {
  return {
    id: row.id,
    rootId: row.root_id,
    path: row.path,
    filename: row.filename,
    dir: row.dir,
    folder: row.folder,
    ext: row.ext,
    size: row.size,
    mtime: row.mtime,
    durationMs: row.duration_ms,
    title: row.title,
    artist: row.artist,
    album: row.album,
    hasTags: row.has_tags === 1,
    addedAt: row.added_at,
    lastPlayedAt: row.last_played_at,
    playCount: row.play_count,
    missing: row.missing === 1,
    hidden: row.hidden === 1,
    favorite: row.favorite === 1
  }
}

/**
 * Ordered migrations. SQLite's `user_version` records which one was applied
 * last, so adding a new migration is a matter of pushing onto the end of the
 * array.
 */
const MIGRATIONS: readonly string[] = [
  // v1 - initial schema
  `
  CREATE TABLE roots (
    id       INTEGER PRIMARY KEY,
    path     TEXT    NOT NULL UNIQUE,
    added_at INTEGER NOT NULL
  );

  CREATE TABLE tracks (
    id             INTEGER PRIMARY KEY,
    root_id        INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    path           TEXT    NOT NULL UNIQUE,
    filename       TEXT    NOT NULL,
    -- full path of the containing folder
    dir            TEXT    NOT NULL,
    -- just the name of that folder: stands in for the album when a file has no tags
    folder         TEXT    NOT NULL,
    ext            TEXT    NOT NULL,
    size           INTEGER NOT NULL,
    mtime          INTEGER NOT NULL,
    duration_ms    INTEGER,
    title          TEXT,
    artist         TEXT,
    album          TEXT,
    has_tags       INTEGER NOT NULL DEFAULT 0,
    -- 0 while the second pass has not read this file's tags yet
    metadata_read  INTEGER NOT NULL DEFAULT 0,
    added_at       INTEGER NOT NULL,
    last_played_at INTEGER,
    play_count     INTEGER NOT NULL DEFAULT 0,
    missing        INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX tracks_root_idx     ON tracks(root_id);
  CREATE INDEX tracks_dir_idx      ON tracks(dir);
  CREATE INDEX tracks_added_idx    ON tracks(added_at DESC);
  CREATE INDEX tracks_pending_idx  ON tracks(metadata_read) WHERE metadata_read = 0;

  CREATE TABLE marks (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    favorite INTEGER NOT NULL DEFAULT 0,
    color    TEXT,
    note     TEXT
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Search index. Trigram tokenizer: finds substrings at any position ("bpm"
  -- inside "loop_140bpm.wav"), which is how someone searches for a file of
  -- their own. A word tokenizer would only match from the start of a token.
  CREATE VIRTUAL TABLE tracks_fts USING fts5(
    filename, path, title, artist, album,
    content='tracks',
    content_rowid='id',
    tokenize='trigram'
  );

  CREATE TRIGGER tracks_fts_ai AFTER INSERT ON tracks BEGIN
    INSERT INTO tracks_fts(rowid, filename, path, title, artist, album)
    VALUES (new.id, new.filename, new.path, new.title, new.artist, new.album);
  END;

  CREATE TRIGGER tracks_fts_ad AFTER DELETE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, filename, path, title, artist, album)
    VALUES ('delete', old.id, old.filename, old.path, old.title, old.artist, old.album);
  END;

  CREATE TRIGGER tracks_fts_au AFTER UPDATE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, filename, path, title, artist, album)
    VALUES ('delete', old.id, old.filename, old.path, old.title, old.artist, old.album);
    INSERT INTO tracks_fts(rowid, filename, path, title, artist, album)
    VALUES (new.id, new.filename, new.path, new.title, new.artist, new.album);
  END;
  `
  ,
  // v2 - playlists
  `
  CREATE TABLE playlists (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE playlist_items (
    id          INTEGER PRIMARY KEY,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
    -- The position is NOT part of the primary key: if it were, moving an item
    -- would need temporary positions to avoid violating the constraint midway.
    -- Reordering is rewriting the positions inside a transaction.
    position    INTEGER NOT NULL
  );

  CREATE INDEX playlist_items_order ON playlist_items(playlist_id, position);
  `
  ,
  // v3 - hidden tracks
  //
  // Scanning a folder of sessions pulls in stems, loops and one-shots along
  // with the actual tracks. Deleting those rows does not work: the file is
  // still on disk under a watched root, so the next scan finds it unknown and
  // inserts it again with a new id, losing its marks on the way. Hiding is a
  // flag on the row instead, which the scanner leaves alone -- the same shape
  // as `missing`, and filtered out by the same queries.
  `
  ALTER TABLE tracks ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX tracks_hidden_idx ON tracks(hidden) WHERE hidden = 1;
  `
]

/**
 * Opens (and creates when needed) the index database.
 *
 * @param filePath path of the .db file, or ':memory:' in tests.
 */
export function openDatabase(filePath: string): SqliteDatabase {
  const db = new Database(filePath)

  // WAL: writes from the scan do not block reads from the search.
  if (filePath !== ':memory:') db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  migrate(db)
  return db
}

function migrate(db: SqliteDatabase): void {
  const current = db.pragma('user_version', { simple: true }) as number

  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version]
    if (!sql) continue
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.pragma(`user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
