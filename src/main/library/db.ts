import Database from 'better-sqlite3'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import type { Track } from '../../shared/types'

/**
 * Fila cruda de `tracks` tal como la devuelve SQLite (snake_case, booleanos
 * como 0/1). Se convierte a `Track` con `rowToTrack`.
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
    favorite: row.favorite === 1
  }
}

/**
 * Migraciones ordenadas. `user_version` de SQLite guarda cual fue la ultima
 * aplicada, asi que agregar una migracion nueva es empujar al final del array.
 */
const MIGRATIONS: readonly string[] = [
  // v1 - esquema inicial
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
    -- ruta completa de la carpeta contenedora (para el navegador de carpetas)
    dir            TEXT    NOT NULL,
    -- solo el nombre de esa carpeta: hace de "album" cuando el archivo no tiene tags
    folder         TEXT    NOT NULL,
    ext            TEXT    NOT NULL,
    size           INTEGER NOT NULL,
    mtime          INTEGER NOT NULL,
    duration_ms    INTEGER,
    title          TEXT,
    artist         TEXT,
    album          TEXT,
    has_tags       INTEGER NOT NULL DEFAULT 0,
    -- 0 mientras la segunda pasada todavia no leyo los tags de este archivo
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

  -- Indice de busqueda. Tokenizer trigram: encuentra subcadenas en cualquier
  -- posicion ("bpm" adentro de "loop_140bpm.wav"), que es como se busca un
  -- archivo propio. Un tokenizer de palabras solo matchearia desde el inicio.
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
    -- La posicion NO es parte de la primary key: si lo fuera, mover un item
    -- exigiria posiciones temporales para no violar la restriccion a mitad de
    -- camino. Reordenar es reescribir las posiciones en una transaccion.
    position    INTEGER NOT NULL
  );

  CREATE INDEX playlist_items_order ON playlist_items(playlist_id, position);
  `
]

/**
 * Abre (y si hace falta crea) la base del indice.
 *
 * @param filePath ruta del archivo .db, o ':memory:' en los tests.
 */
export function openDatabase(filePath: string): SqliteDatabase {
  const db = new Database(filePath)

  // WAL: los escritos del escaneo no bloquean las lecturas de la busqueda.
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
