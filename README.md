# waverr

Reproductor de audio local con interfaz de MP3 clasico, pensado para gente que
produce su propia musica.

Los reproductores comunes asumen una biblioteca con tags ID3 limpios. Un
productor tiene `beat_v3.wav`, `demo_final_FINAL.wav` e `idea_140bpm.wav`
repartidos en decenas de carpetas de proyecto y casi siempre sin metadata.
waverr indexa esas carpetas, busca por cualquier fragmento del nombre o de la
ruta, y reproduce con un aparato dibujado en pantalla: LCD, rueda de control y
visualizador.

## Uso

Todo pasa dentro de la pantalla del aparato. Se maneja entero con el teclado o
entero con el mouse.

| Tecla | Accion |
|---|---|
| `↑` `↓` | mover la seleccion (o scroll del mouse sobre la rueda) |
| `Enter` | entrar / reproducir |
| `Esc` | atras |
| `Backspace` | borrar letra en la busqueda; atras en el resto |
| `Espacio` | reproducir / pausar |
| `←` `→` | pista anterior / siguiente (mantener: rebobinar 5 s) |
| letras y numeros | abre la busqueda y filtra en vivo |
| `F` | marcar favorito |
| `V` | cambiar modo de visualizador |
| `Home` | volver al menu raiz |

Para cargar musica: `AJUSTES` -> `+ AGREGAR CARPETA`. Se puede agregar mas de
una raiz. El escaneo corre en dos pasadas: primero rutas (la busqueda ya
funciona a los pocos segundos) y despues tags y duracion.

Un archivo que desaparece del disco no se borra del indice: queda marcado como
perdido y conserva sus favoritos por si el disco externo vuelve a montarse.

## Desarrollo

```bash
npm install
npm run dev        # app con recarga en caliente
npm test           # unitarios (vitest)
npm run test:e2e   # smoke end-to-end (playwright + electron)
npm run build:win  # instalador NSIS en dist/
```

### Si `npm run dev` abre y se cierra al instante

Algunos entornos (la terminal integrada de VS Code, entre otros) exportan
`ELECTRON_RUN_AS_NODE=1`. Con esa variable, Electron arranca como Node puro:
`require('electron')` no devuelve `app` y el proceso muere antes de abrir la
ventana. Se limpia asi:

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE
```

## Como esta armado

```
src/main/          proceso Node: dueno del disco y del indice
  library/         SQLite + FTS5, escaneo, lectura de tags
  media-protocol   sirve el audio por waverr://track/<id>
src/preload/       unico puente hacia el renderer (contextBridge)
src/shared/        tipos y reglas que usan los dos lados
src/renderer/      React: dueno del sonido y del pixel
  audio/           AudioEngine (fuera de React, sobrevive a los re-render)
  screen/          pila de vistas (reducer puro) y teclado
  components/      chasis, LCD, rueda, visualizador
```

El renderer nunca toca `fs`. `contextIsolation` y `sandbox` activos,
`nodeIntegration` apagado.

### Dos decisiones que explican casi todo

**El audio se pide por id, no por ruta.** `waverr://track/42` obliga a que el
renderer solo pueda nombrar pistas que ya estan en el indice; no existe forma de
pedir un archivo arbitrario del disco. El proceso main igual revalida que el
archivo siga dentro de una carpeta raiz registrada antes de abrirlo.

**El esquema se registra como `standard` y `secure`.** Si Chromium tratara al
audio como origen opaco, el `MediaElementSource` quedaria *tainted* y el
`AnalyserNode` devolveria ceros: el visualizador se veria muerto aunque el audio
sonara. El e2e verifica justamente eso leyendo el nivel del ultimo cuadro.

### Busqueda

El indice FTS5 usa el tokenizer `trigram`, que encuentra subcadenas en cualquier
posicion: buscar `bpm` matchea `loop_140bpm.wav`. Un tokenizer de palabras solo
podria matchear desde el principio de cada token. Para consultas de una o dos
letras, que trigram no puede indexar, se cae a `LIKE %x%`.

Medido sobre 5.000 archivos: escaneo ~1 s, busqueda mas lenta 4 ms.

## Formatos

Se indexan `.mp3 .wav .flac .m4a .aac .ogg .opus .aiff .aif .wma`.

Reproduccion verificada sobre archivos reales: MP3, WAV, M4A y OGG. FLAC lo
decodifica Chromium de forma nativa pero todavia no se probo con un archivo de
verdad.

**AIFF no lo reproduce Chromium.** Los archivos se indexan y se buscan, pero
falta el decodificador propio que los convierta en `AudioBuffer`.
