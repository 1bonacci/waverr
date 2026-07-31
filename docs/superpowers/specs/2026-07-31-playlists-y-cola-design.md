# Playlists y cola — diseño

Fecha: 2026-07-31
Proyecto: waverr
Estado: aprobado, listo para plan de implementación

## Contexto

waverr ya indexa carpetas, busca por subcadena, reproduce y marca favoritos.
Lo que falta es control sobre **qué suena después**. Hoy `AudioEngine.setQueue`
reemplaza la cola entera con la lista que estabas mirando: no existe forma de
encolar algo a propósito, ni de guardar un orden, y la entrada `COLA` del menú
raíz es un placeholder que siempre dice "COLA VACIA".

Tres usos concretos que tiene que cubrir:

1. **Sesión de escucha** — juntar los temas en los que estoy trabajando ahora y
   escucharlos seguidos. Se arma y se descarta seguido.
2. **Armar un EP** — definir el orden definitivo de un disco, escuchar
   transiciones, mover temas de lugar. El orden importa y la lista dura.
3. **Set para mandar** — seleccionar los temas que le voy a pasar a alguien.

El 1 pide algo efímero, el 2 pide algo persistente y reordenable, el 3 es el
puente entre ambos: una sesión que resultó buena y quiero conservar.

## Modelo

Tres conceptos separados. Hoy están fundidos en uno y esa es la causa raíz del
problema.

| Concepto | Qué es | Dónde vive |
|---|---|---|
| **Contexto** | la lista que se estaba mirando al apretar OK (carpeta, resultados de búsqueda, playlist) | memoria, efímero |
| **Cola manual** | lo que el usuario encoló explícitamente | memoria + tabla `settings`, sobrevive al reinicio |
| **Playlists** | orden que dura | SQLite |

El orden de reproducción es la concatenación:

```
[lo que suena ahora] + [cola manual] + [resto del contexto]
```

### Reglas de comportamiento

- **OK sobre una pista** reproduce esa pista y reemplaza el *contexto*, pero
  **no toca la cola manual**. Lo que el usuario pidió explícitamente nunca se
  pierde sin que él lo saque.
- **Shuffle mezcla solo el contexto.** La cola manual conserva su orden: ese
  orden fue una decisión del usuario, no un accidente.
- **Repeat `all`** vuelve al principio del contexto una vez agotada la cola
  manual. **Repeat `one`** repite lo que suena y no consume la cola.
- Al terminar una pista se toma primero de la cola manual; si está vacía, se
  avanza en el contexto.

## Datos (migración v2)

```sql
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
  position    INTEGER NOT NULL
);

CREATE INDEX playlist_items_order ON playlist_items(playlist_id, position);
```

`position` deliberadamente **no** forma parte de la primary key. Con una PK
compuesta `(playlist_id, position)`, mover un elemento obliga a posiciones
temporales para no violar la restricción a mitad de camino. Con `position` como
columna común, reordenar es reescribir las posiciones de esa playlist dentro de
una transacción: más simple y sin estados intermedios inválidos.

Se permite el mismo `track_id` dos veces en la misma playlist (un interludio
repetido en un EP es legítimo).

### Persistencia de la cola manual

Clave `queue` en `settings`, con JSON:

```json
{ "manualTrackIds": [12, 45, 7], "currentTrackId": 12 }
```

El contexto **no** se persiste: es lo que estabas mirando, y al reabrir la app
esa vista ya no está. Al cargar, los ids que ya no existen en `tracks` se
descartan en silencio.

## Motor

La lógica de orden sale de `AudioEngine` y pasa a un módulo puro
`src/renderer/audio/playbackQueue.ts`, siguiendo el patrón que ya funcionó con
`src/renderer/screen/viewStack.ts`: estado inmutable, funciones puras, cero DOM,
cero Electron. Es lo que hace que se pueda testear el orden sin levantar la app.

```ts
interface QueueState {
  current: Track | null
  manual: Track[]
  context: Track[]
  contextIndex: number
  shuffleOrder: number[] | null   // permutación del contexto, null si shuffle off
}

playNow(state, context, index): QueueState
enqueue(state, track): QueueState          // al final de la cola manual
enqueueNext(state, track): QueueState      // al principio de la cola manual
removeAt(state, index): QueueState
move(state, from, to): QueueState
advance(state, repeat): QueueState
previous(state): QueueState
setShuffle(state, on): QueueState
view(state): { now, manual, upcoming }
```

`AudioEngine` queda como cáscara: mantiene el `<audio>`, el `AudioContext` y el
`AnalyserNode`, y le pregunta a este módulo qué sigue. Su API pública hacia la
UI no cambia de forma (`next`, `previous`, `toggle`, `seek`) más los métodos
nuevos de encolado.

## Pantalla

### Menú contextual

Se abre manteniendo `OK` ~450 ms sobre una fila, o con click derecho. Es una
vista más de la pila (`{ kind: 'context', target }`), así que `MENU` la cierra
como cualquier otro nivel.

```
REPRODUCIR AHORA
ENCOLAR SIGUIENTE
ENCOLAR AL FINAL
AGREGAR A PLAYLIST  >
FAVORITO
MOVER                   (solo dentro de COLA o de una playlist)
QUITAR                  (solo dentro de COLA o de una playlist)
```

`AGREGAR A PLAYLIST` abre un nivel más con las playlists existentes y
`+ NUEVA PLAYLIST` arriba de todo. Elegir una agrega la pista al final y vuelve
a la lista de donde se venía, sin quedar navegando adentro de la playlist.

### Vista COLA

Reemplaza el placeholder actual. Tres secciones con encabezado: `AHORA`,
`SIGUIENTE` (cola manual) y `LUEGO` (resto del contexto). Su menú contextual
suma `GUARDAR COMO PLAYLIST`, que es lo que convierte una sesión de escucha en
el set que se va a mandar.

### Vista PLAYLISTS

Lista de playlists con su cantidad de temas, más `+ NUEVA PLAYLIST`. Entrar
muestra sus pistas en orden. Menú contextual de una playlist: `REPRODUCIR`,
`RENOMBRAR`, `BORRAR`.

### Escribir texto

Nombrar y renombrar reusan el mecanismo de tipeo que ya existe para la búsqueda:
una vista `{ kind: 'prompt', label, value }` en el reducer que acumula
caracteres y confirma con `Enter`. No hace falta teclado en pantalla.

### Modo mover

Estado nuevo en el reducer de vistas: la vista de lista guarda
`moving: number | null`. Con una fila agarrada, las flechas y la rueda la mueven
dentro de la lista, `OK` la suelta y `MENU` cancela dejando todo como estaba.
La fila agarrada se dibuja con marcas `^ ... ^` para que se note que está en
movimiento y no simplemente seleccionada.

## Errores

- **Nombre de playlist repetido:** la restricción `UNIQUE COLLATE NOCASE` lo
  rechaza; la LCD muestra `YA EXISTE` y deja el nombre en pantalla para
  corregirlo.
- **Pista perdida dentro de una playlist:** se muestra con marca de perdida y se
  saltea al reproducir, sin sacarla de la lista (el disco externo puede volver).
- **Cola guardada con ids inexistentes:** se filtran al cargar, sin aviso.
- **Mover fuera de rango:** `move` satura en los extremos en lugar de envolver;
  envolver en un reordenamiento es casi siempre un error del usuario.

## Tests

**Unitarios sobre `playbackQueue.ts`** (el grueso del valor):
orden de reproducción con cola manual y contexto; OK no borra la cola manual;
shuffle mezcla el contexto y deja la cola manual quieta; `advance` consume
primero la manual; `repeat one` no consume la cola; `move` satura en los
extremos; `removeAt` de lo que está sonando.

**Unitarios sobre `Library`:** crear, renombrar, borrar playlists; nombre
duplicado rechazado; agregar y reordenar items; posiciones consecutivas después
de reordenar; borrar una playlist borra sus items; una pista perdida sigue
figurando.

**E2E:** encolar dos temas desde el menú contextual y verificar el orden en la
vista COLA; crear una playlist, agregarle temas, reordenar con modo mover y
reproducirla; guardar la cola como playlist.

## Fuera de alcance

Exportar a `.m3u`, arrastrar filas con el mouse, playlists inteligentes por
criterio, y sincronización entre equipos.
