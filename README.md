# Velvet Tube

Radio con DJ de IA sobre **YouTube**. Misma idea que Velvet Dial, pero sin Spotify: pides una música con una frase
("es por la mañana y quiero empezar el día con música energizante"), Gemini propone las canciones, se buscan en YouTube,
suenan con el reproductor oficial de YouTube y, entre canción y canción, un locutor (guion de Gemini + voz de ElevenLabs)
habla de la música, el clima o la hora.

## En qué se diferencia de Velvet Dial

| | Velvet Dial (Spotify) | Velvet Tube (YouTube) |
|---|---|---|
| Inicio de sesión | Cuenta de Spotify (Premium) | **Ninguno** (solo un código de acceso opcional) |
| Quién reproduce | Spotify, controlado desde el servidor | El navegador, con el reproductor incrustado de YouTube |
| Bajar la música cuando habla el DJ | Peticiones a la API de Spotify | `setVolume` local: instantáneo y sin red |
| Listas | Playlist real en tu Spotify | Se guardan en el navegador (con los vídeos ya encontrados) |
| Servidor | Guarda la sesión en una cookie | **Sin estado**: solo Gemini, ElevenLabs y búsqueda |

## Lo que tienes que saber antes de usarla

1. **El vídeo se ve.** No hay modo "solo audio" oculto: el reproductor de YouTube hace de portada (≈ 360×220). Las condiciones
   de la API de YouTube prohíben ocultar el reproductor o separar el audio del vídeo, y las alternativas (extraer el audio con
   herramientas tipo yt-dlp) las incumplen y se rompen cada pocas semanas. Si quieres, ese cuadro se puede hacer más pequeño
   (mínimo 200×200), pero no esconderlo.
2. **Cuota de la API de YouTube.** Cada canción nueva que se busca cuesta 101 unidades de las 10.000 diarias gratuitas:
   **≈ 99 canciones nuevas al día** (unas 5 listas de 20). Para gastar lo mínimo:
   - solo se buscan las 3 próximas canciones, no la lista entera (si cierras a mitad, el resto no gasta nada);
   - cada resultado se guarda en caché en el servidor (30 días);
   - las listas guardadas llevan sus vídeos ya encontrados: volver a ponerlas **no gasta cuota**;
   - si se agota, la web avisa con un mensaje claro (se reinicia a medianoche, hora del Pacífico).
   Si necesitas más, Google permite pedir una ampliación de cuota rellenando un formulario de auditoría.
3. **Móvil: el sonido se corta con la pantalla bloqueada.** YouTube no permite reproducir en segundo plano desde un reproductor
   incrustado (sí en su propia app con Premium). La web mantiene la pantalla encendida mientras suena. Para tener sonido con
   la pantalla apagada habría que hacer una app Android con un servicio en primer plano (como la de Velvet Dial).
4. **iPhone:** Safari no deja cambiar el volumen del reproductor, así que el DJ habla en el hueco entre canciones (no encima del
   final). En el resto de dispositivos habla sobre el final con la música bajada. A veces Safari bloquea el inicio automático
   de una canción: aparece un botón "Toca para continuar".
5. **Algunos vídeos no se pueden incrustar** (los dueños lo desactivan). La búsqueda ya los descarta y guarda hasta 3 candidatos por
   canción; si el primero falla en el reproductor, prueba el siguiente y, si no, salta a la siguiente canción.

## Puesta en marcha

```bash
npm install
cp .env.example .env     # rellena las claves
npm start                # http://127.0.0.1:3000
npm test                 # 33 pruebas automáticas (sin red ni claves)
```

### Claves

| Variable | Dónde se consigue | Para qué |
|---|---|---|
| `YOUTUBE_API_KEY` | Google Cloud Console → crea un proyecto → *APIs y servicios* → activa **YouTube Data API v3** → *Credenciales* → *Clave de API* (conviene restringirla a esa API) | Buscar vídeos |
| `GEMINI_API_KEY` | Google AI Studio | Listas y guiones |
| `ELEVENLABS_API_KEY` | ElevenLabs | Voz del DJ (sin ella, la app funciona sin DJ) |
| `ACCESS_CODE` | Lo eliges tú | **Ponlo si publicas la app**: sin él cualquiera con la URL gasta tus claves |
| `CIUDAD`, `GEMINI_MODEL`, `YT_CUOTA_DIARIA`, `CACHE_FILE`, `PORT` | Opcionales | Ver `.env.example` |

No hace falta ninguna credencial de OAuth: la búsqueda usa solo la clave de API y la reproducción no requiere cuenta.
Nunca subas el `.env` al repositorio.

### Despliegue (Render)

Servicio web de Node: *Build* `npm install`, *Start* `npm start`, y las variables de arriba. Render gratis duerme el servicio tras un
rato sin uso (tarda ~50 s en despertar) y borra el disco al reiniciar, así que la caché de búsquedas en archivo (`CACHE_FILE`) se
pierde; las listas guardadas del usuario no, porque viven en su navegador.

## Cómo funciona el DJ entre canciones

1. Al empezar una canción, el navegador averigua cuál es la **siguiente que sí se puede reproducir** (se saltan las no encontradas) y
   pide al servidor su locución: Gemini escribe el guion con las dos canciones, el clima o la hora; ElevenLabs lo convierte en voz.
2. La locución llega mientras la canción aún suena (suele tardar 5–10 s).
3. Cuando a la canción le quedan `duración de la voz + 1,2 s`, la música baja al 22 % en 0,6 s, entra la voz, y la música vuelve a
   subir bajo las últimas palabras. La siguiente canción empieza justo después, limpia.
4. Si la locución llega tarde, suena en el hueco entre canciones. Si no llega en 12 s, se sigue sin ella.

Ajustes en `public/app.js` (constantes de arriba: `DUCK`, `BAJADA_MS`, `ANTICIPACION_S`...). El DJ puede hablar cada canción, cada 2 o cada 3.

## Estructura

```
src/server.js           Arranque y cierre ordenado
src/app.js              Rutas: /api/lista, /api/resolver, /api/locucion, /api/config, /api/auth
src/limites.js          Límites por IP y código de acceso
src/services/youtube.js Búsqueda en YouTube, puntuación de resultados, caché y contador de cuota
src/services/gemini.js  Guiones del DJ y listas (los prompts de Velvet Dial)
src/services/elevenlabs.js, clima.js   Voz y clima (de Velvet Dial)
public/                 Web: index.html, estilos.css, app.js (reproductor, cola, DJ, listas guardadas)
test/                   Pruebas automáticas (node:test)
e2e/                    Pruebas en Chrome con YouTube simulado (opcional)
```
