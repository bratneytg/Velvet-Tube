import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { esTimeout } from './utils.js';
import { crearLimitador, exigirCodigo } from './limites.js';
import { ErrorYoutube } from './services/youtube.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Política de contenido en modo "solo avisar" (Report-Only), como en Velvet Dial: no bloquea nada, pero registra en los logs lo que
// bloquearía. Permite el reproductor y las miniaturas de YouTube. Cuando los logs lleven unos días limpios se puede activar.
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https://i.ytimg.com https://*.ytimg.com; media-src 'self' data: blob:; connect-src 'self'; " +
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; " +
  "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; report-uri /api/csp-report";

const limpiarCancion = (c) => ({
  titulo: String(c?.titulo ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
  artista: String(c?.artista ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
});

/**
 * Crea la aplicación de Express. Todas las dependencias externas se inyectan para poder probar las rutas sin red ni claves.
 * @param {object} d
 * @param {object} d.gemini        - { generarListaCanciones, generarGuionLocutor, elegirTipoSegmento, nombreCancion }
 * @param {object} d.voz           - { generarAudioLocucion, elegirVoz }
 * @param {Function} d.obtenerClima
 * @param {object} d.buscador      - resultado de crearBuscador()
 * @param {object} [d.env]         - variables de entorno (por defecto process.env)
 */
export function crearApp({ gemini, voz, obtenerClima, buscador, env = process.env }) {
  const app = express();
  const codigoAcceso = env.ACCESS_CODE || '';
  const enProduccion = !!env.RENDER || env.NODE_ENV === 'production';

  app.set('trust proxy', 1); // Render va detrás de un proxy HTTPS
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      // IMPORTANTE: el reproductor de YouTube exige que la página envíe Referer. No cambiar a "no-referrer".
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=()',
      'Content-Security-Policy-Report-Only': CSP,
      ...(enProduccion ? { 'Strict-Transport-Security': 'max-age=15552000' } : {}),
    });
    next();
  });

  let informesCsp = 0; // como mucho 30 por hora para no llenar los logs
  setInterval(() => { informesCsp = 0; }, 3600_000).unref();
  app.post('/api/csp-report', express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '10kb' }), (req, res) => {
    if (informesCsp++ < 30) {
      const r = req.body?.['csp-report'] ?? req.body ?? {};
      console.warn('🛡️ CSP (solo aviso):', r['violated-directive'], '→', r['blocked-uri']);
    }
    res.sendStatus(204);
  });

  app.use(express.json({ limit: '20kb' }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.static(path.join(__dirname, '../public'), {
    setHeaders: (res, ruta) => {
      if (ruta.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      else if (ruta.endsWith('.png')) res.setHeader('Cache-Control', 'public, max-age=604800');
    },
  }));
  app.get('/healthz', (req, res) => res.send('ok'));

  // Qué piezas están configuradas (para que la web avise en vez de fallar). No requiere código y no revela ninguna clave.
  app.get('/api/config', (req, res) => {
    res.json({
      requiereCodigo: !!codigoAcceso,
      youtube: !!env.YOUTUBE_API_KEY,
      gemini: !!env.GEMINI_API_KEY,
      voz: !!env.ELEVENLABS_API_KEY,
      cuota: buscador.cuota.estado(),
    });
  });

  app.use('/api', exigirCodigo(codigoAcceso));

  // La web lo usa para comprobar el código de acceso al entrar
  app.get('/api/auth', (req, res) => res.json({ success: true }));

  const limiteListas = crearLimitador(5, 10 * 60_000);   // Gemini cuesta dinero
  const limiteLocuciones = crearLimitador(8, 60_000);    // Gemini + ElevenLabs: la web pide 1 por canción
  const limiteBusquedas = crearLimitador(20, 60_000);    // cada petición resuelve hasta 5 canciones

  // -------------------------------------------------------------------------
  // POST /api/lista  -> la petición del oyente se convierte en una lista de canciones (Gemini)
  // -------------------------------------------------------------------------
  app.post('/api/lista', async (req, res) => {
    if (!env.GEMINI_API_KEY) return res.status(503).json({ success: false, codigo: 'SIN_GEMINI', error: 'Falta GEMINI_API_KEY en el servidor' });
    if (!limiteListas.consumir(req.ip)) return res.status(429).json({ success: false, codigo: 'LIMITE', error: 'Demasiadas listas seguidas, espera unos minutos' });

    const peticion = String(req.body?.prompt ?? '').trim().slice(0, 300);
    if (peticion.length < 3) return res.status(400).json({ success: false, error: 'Escribe qué tipo de música quieres' });
    const cantidad = [10, 20, 30, 40].includes(Number(req.body?.cantidad)) ? Number(req.body.cantidad) : 20;
    const idioma = req.body?.idioma === 'en' ? 'en' : 'es';

    try {
      const propuesta = await gemini.generarListaCanciones(peticion, cantidad, { idioma });
      const canciones = (propuesta?.canciones ?? []).slice(0, cantidad); // Gemini propone algunas de más por si hay repetidas
      if (!canciones.length) return res.status(422).json({ success: false, codigo: 'SIN_RESULTADOS', error: 'La IA no propuso ninguna canción. Prueba a describirlo de otra forma.' });
      res.json({ success: true, nombre: propuesta.nombre || 'Velvet Tube', descripcion: propuesta.descripcion || peticion, canciones, cantidad });
    } catch (e) {
      console.error('❌ Error en /api/lista:', e.message);
      res.status(esTimeout(e) ? 504 : 500).json({ success: false, error: esTimeout(e) ? 'Un servicio tardó demasiado, reintenta' : 'No se pudo crear la lista' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/resolver  -> canciones (título + artista) a vídeos de YouTube. Máx. 5 por petición.
  // La web lo llama solo para las próximas canciones, no para la lista entera (ahorra cuota).
  // -------------------------------------------------------------------------
  app.post('/api/resolver', async (req, res) => {
    if (!limiteBusquedas.consumir(req.ip)) return res.status(429).json({ success: false, codigo: 'LIMITE', error: 'Demasiadas búsquedas seguidas, espera un momento' });
    const canciones = (Array.isArray(req.body?.canciones) ? req.body.canciones : []).slice(0, 5).map(limpiarCancion).filter(c => c.titulo);
    if (!canciones.length) return res.status(400).json({ success: false, error: 'No hay canciones que buscar' });
    try {
      const resultados = await buscador.resolver(canciones);
      res.json({ success: true, resultados, cuota: buscador.cuota.estado() });
    } catch (e) {
      if (e instanceof ErrorYoutube) {
        console.warn('⚠️ YouTube:', e.codigo, e.message);
        return res.status(e.status).json({ success: false, codigo: e.codigo, error: e.message });
      }
      console.error('❌ Error en /api/resolver:', e.message);
      res.status(esTimeout(e) ? 504 : 500).json({ success: false, error: esTimeout(e) ? 'YouTube tardó demasiado, reintenta' : 'No se pudo buscar en YouTube' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/locucion  -> guion (Gemini) + voz (ElevenLabs) para el hueco entre dos canciones.
  // El audio viaja en base64 dentro de la respuesta: sin archivos en disco y una petición menos.
  // -------------------------------------------------------------------------
  app.post('/api/locucion', async (req, res) => {
    if (!env.GEMINI_API_KEY || !env.ELEVENLABS_API_KEY) return res.status(503).json({ success: false, codigo: 'SIN_VOZ', error: 'Faltan GEMINI_API_KEY o ELEVENLABS_API_KEY en el servidor' });
    if (!limiteLocuciones.consumir(req.ip)) return res.status(429).json({ success: false, codigo: 'LIMITE', error: 'Demasiadas peticiones, espera un momento' });

    const anterior = limpiarCancion(req.body?.anterior);
    const siguiente = limpiarCancion(req.body?.siguiente);
    if (!anterior.titulo || !siguiente.titulo) return res.status(400).json({ success: false, error: 'Faltan las canciones' });
    try {
      const ambiente = String(req.body?.ambiente ?? '').trim().slice(0, 300);
      const clima = await obtenerClima(req.body?.ubicacion ?? null); // nunca lanza error: devuelve null; sin ubicación usa la ciudad por defecto
      // Cada oyente tiene su propia memoria de locuciones: el id lo genera la web; si no viene, se usa la IP
      const sesionCruda = /^[a-z0-9]{8,32}$/i.test(String(req.body?.sesion ?? '')) ? req.body.sesion : req.ip;
      const sesion = crypto.createHash('sha256').update(String(sesionCruda)).digest('hex').slice(0, 16);

      const tipo = gemini.elegirTipoSegmento(!!clima, sesion);
      const v = voz.elegirVoz(req.body?.voz); // idioma + género + id de la voz de ElevenLabs
      const guion = await gemini.generarGuionLocutor(gemini.nombreCancion(anterior), gemini.nombreCancion(siguiente), { tipo, clima, ambiente, idioma: v.idioma, genero: v.genero, sesion });
      console.log(`🎙️ Locución [${tipo}]${ambiente ? ` + ambiente "${ambiente}"` : ''}: ${guion}`);
      const audio = await voz.generarAudioLocucion(guion, v.id);
      res.json({ success: true, guion, tipo, audioBase64: Buffer.from(audio).toString('base64') });
    } catch (e) {
      console.error('❌ Error en /api/locucion:', e.message); // el detalle técnico queda en los logs, no se envía al navegador
      res.status(esTimeout(e) ? 504 : 500).json({ success: false, error: esTimeout(e) ? 'Un servicio tardó demasiado, reintenta' : 'No se pudo generar la locución' });
    }
  });

  // Rutas de API desconocidas: JSON, no HTML
  app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'No existe' }));

  return app;
}
