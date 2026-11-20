/**
 * Búsqueda de canciones en YouTube (YouTube Data API v3).
 *
 * La reproducción NO pasa por aquí: la hace el navegador con el reproductor oficial incrustado (IFrame Player API).
 * Este módulo solo traduce "título + artista" en vídeos concretos que se puedan incrustar.
 *
 * CUOTA: cada `search.list` cuesta 100 unidades y la cuota gratuita es de 10.000 al día (≈ 100 búsquedas). Por eso:
 *  - se busca una canción solo cuando va a sonar pronto (el navegador pide de 3 en 3, no la lista entera),
 *  - los resultados se guardan en caché (memoria + archivo opcional),
 *  - se lleva la cuenta de lo gastado y, si se agota, se avisa con un error claro en vez de seguir insistiendo.
 */

import fs from 'fs';
import { fetchConTiempo } from '../utils.js';

const API = 'https://www.googleapis.com/youtube/v3';
export const COSTE_BUSQUEDA = 100;
export const COSTE_VIDEOS = 1;

/** Error con código para que el servidor decida qué responder al navegador. */
export class ErrorYoutube extends Error {
  constructor(codigo, mensaje, status = 500) { super(mensaje); this.codigo = codigo; this.status = status; }
}

// ---------------------------------------------------------------------------
// Normalización y puntuación (funciones puras: se prueban sin red)
// ---------------------------------------------------------------------------
/** Minúsculas, sin tildes, sin "(Official Video)", "feat." ni signos: para comparar títulos y artistas. */
export function normalizar(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft|featuring|with)\b.*$/g, ' ')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "PT1H2M3S" -> segundos. Devuelve 0 si no se entiende. */
export function parsearDuracion(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso ?? ''));
  if (!m) return 0;
  const [, d = 0, h = 0, min = 0, s = 0] = m;
  return Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(s);
}

const VERSIONES_RARAS = /\b(karaoke|tribute|cover|instrumental|live|en vivo|concierto|remix|acoustic|acustico|8d|sped up|slowed|nightcore|reaction|reaccion|tutorial|lesson|mashup|loop|hours?|horas?|piano version|megamix)\b/;
const contiene = (texto, frag) => !!frag && ` ${texto} `.includes(` ${frag} `);

/**
 * Puntúa un vídeo para un título y artista pedidos. Devuelve null si no sirve (otro artista, otra canción, demasiado largo).
 * @param {{id:string, titulo:string, canal:string, duracionS:number}} v
 */
export function puntuar(v, titulo, artista) {
  const t = normalizar(titulo), a = normalizar(artista);
  const nt = normalizar(v.titulo), canal = normalizar(v.canal);
  if (!t || !nt) return null;
  if (!contiene(nt, t)) return null;                                   // el título del vídeo debe incluir el de la canción
  const artistaEnTitulo = contiene(nt, a);
  const artistaEnCanal = !!a && (canal === a || canal === `${a} topic` || canal.startsWith(`${a} `) || contiene(canal, a));
  if (a && !artistaEnTitulo && !artistaEnCanal) return null;           // mismo título de otro artista: no vale
  if (v.duracionS && v.duracionS > 20 * 60) return null;               // recopilaciones y bucles de horas

  let p = 40;
  if (nt === t || nt === `${a} ${t}` || nt === `${t} ${a}`) p += 10;   // título limpio
  if (artistaEnCanal) p += 10;
  if (canal.endsWith(' topic')) p += 14;                               // audio oficial generado por YouTube Music
  if (/vevo$/.test(canal) || canal.endsWith(' oficial') || canal.endsWith(' official')) p += 6;
  const crudo = String(v.titulo ?? '').toLowerCase();
  if (/official audio|audio oficial/.test(crudo)) p += 8;
  else if (/official (music )?video|video oficial|videoclip/.test(crudo)) p += 5;
  else if (/lyrics?|letra/.test(crudo)) p += 2;
  if (VERSIONES_RARAS.test(nt) && !VERSIONES_RARAS.test(t)) p -= 30;   // en directo, karaoke, remix...
  if (v.duracionS) {
    if (v.duracionS < 60) p -= 30;
    else if (v.duracionS > 10 * 60) p -= 15;
  }
  return p;
}

/** Ordena los vídeos de mejor a peor y devuelve hasta `max` válidos y embebibles. */
export function elegirCandidatos(videos, titulo, artista, max = 3) {
  return (videos ?? [])
    .filter(v => v?.id && v.embebible !== false)
    .map(v => ({ v, p: puntuar(v, titulo, artista) }))
    .filter(x => x.p !== null && x.p > 0)
    .sort((x, y) => y.p - x.p)
    .slice(0, max)
    .map(({ v }) => ({ id: v.id, titulo: v.titulo, canal: v.canal, duracion: v.duracionS || null }));
}

// ---------------------------------------------------------------------------
// Cuota
// ---------------------------------------------------------------------------
/** Día actual en hora del Pacífico: la cuota de Google se reinicia a medianoche allí. */
const diaPacifico = (ahora = Date.now()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(ahora);

export function crearContadorCuota({ limite = Number(process.env.YT_CUOTA_DIARIA) || 10_000, reloj = () => Date.now() } = {}) {
  let dia = diaPacifico(reloj());
  let usado = 0;
  let agotada = false;
  const revisarDia = () => {
    const hoy = diaPacifico(reloj());
    if (hoy !== dia) { dia = hoy; usado = 0; agotada = false; }
  };
  return {
    /** ¿Cabe una operación que cuesta `coste`? */
    permite(coste) { revisarDia(); return !agotada && usado + coste <= limite; },
    gastar(coste) { revisarDia(); usado += coste; },
    marcarAgotada() { revisarDia(); agotada = true; },
    estado() { revisarDia(); return { usado, limite, agotada, restantes: Math.max(0, limite - usado) }; },
  };
}

// ---------------------------------------------------------------------------
// Caché de resultados
// ---------------------------------------------------------------------------
const TTL_ENCONTRADA = 30 * 24 * 3600_000; // un vídeo bueno sigue siéndolo semanas
const TTL_VACIA = 6 * 3600_000;            // si no hubo resultado, se reintenta más tarde pero no en cada petición
const MAX_CACHE = 5000;

export function crearCache({ archivo = process.env.CACHE_FILE || null, reloj = () => Date.now() } = {}) {
  const mapa = new Map(); // clave -> { ts, candidatos }
  let temporizador = null;
  if (archivo) {
    try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(archivo, 'utf8')))) mapa.set(k, v); }
    catch { /* sin archivo todavía */ }
  }
  const guardar = () => {
    if (!archivo || temporizador) return;
    temporizador = setTimeout(() => {
      temporizador = null;
      try { fs.writeFileSync(archivo, JSON.stringify(Object.fromEntries(mapa))); }
      catch (e) { console.warn('⚠️ No se pudo guardar la caché:', e.message); }
    }, 5000);
    temporizador.unref?.();
  };
  return {
    clave: (titulo, artista) => `${normalizar(titulo)}|${normalizar(artista)}`,
    leer(clave) {
      const e = mapa.get(clave);
      if (!e) return undefined;
      const ttl = e.candidatos.length ? TTL_ENCONTRADA : TTL_VACIA;
      if (reloj() - e.ts > ttl) { mapa.delete(clave); return undefined; }
      return e.candidatos;
    },
    escribir(clave, candidatos) {
      if (mapa.size >= MAX_CACHE) mapa.delete(mapa.keys().next().value); // la más antigua
      mapa.set(clave, { ts: reloj(), candidatos });
      guardar();
    },
    get tamano() { return mapa.size; },
  };
}

// ---------------------------------------------------------------------------
// Llamadas a la API
// ---------------------------------------------------------------------------
function traducirError(status, cuerpo) {
  const motivo = cuerpo?.error?.errors?.[0]?.reason || cuerpo?.error?.status || '';
  const mensaje = cuerpo?.error?.message || `HTTP ${status}`;
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(motivo)) return new ErrorYoutube('CUOTA', 'Se agotó la cuota diaria de YouTube. Se reinicia a medianoche (hora del Pacífico).', 429);
  if (status === 400 && /keyInvalid|API_KEY_INVALID/i.test(motivo + mensaje)) return new ErrorYoutube('CLAVE', 'La clave de la API de YouTube no es válida.', 500);
  if (status === 403) return new ErrorYoutube('CLAVE', `YouTube rechazó la petición (¿está activada la "YouTube Data API v3" en tu proyecto de Google?): ${mensaje}`, 500);
  return new ErrorYoutube('YOUTUBE', `YouTube respondió ${status}: ${mensaje}`, 502);
}

async function llamar(ruta, params, clave, { fetchFn = fetchConTiempo } = {}) {
  const url = `${API}/${ruta}?${new URLSearchParams({ ...params, key: clave })}`;
  const r = await fetchFn(url, {}, 10_000);
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) throw traducirError(r.status, cuerpo);
  return cuerpo;
}

/**
 * Crea el buscador. Se inyectan `fetchFn`, `cache` y `cuota` para poder probarlo sin red.
 */
export function crearBuscador({ clave = () => process.env.YOUTUBE_API_KEY, fetchFn = fetchConTiempo, cache = crearCache(), cuota = crearContadorCuota() } = {}) {
  const enCurso = new Map(); // clave de caché -> Promise (dos peticiones iguales a la vez gastan una sola búsqueda)

  async function buscarUna({ titulo, artista }) {
    const k = cache.clave(titulo, artista);
    const guardado = cache.leer(k);
    if (guardado) return { candidatos: guardado, cache: true };
    if (enCurso.has(k)) return enCurso.get(k);

    const tarea = (async () => {
      const apiKey = clave();
      if (!apiKey) throw new ErrorYoutube('SIN_CLAVE', 'Falta YOUTUBE_API_KEY en el servidor.', 500);
      if (!cuota.permite(COSTE_BUSQUEDA + COSTE_VIDEOS)) throw new ErrorYoutube('CUOTA', 'Se agotó la cuota diaria de YouTube. Se reinicia a medianoche (hora del Pacífico).', 429);
      try {
        // 1) Buscar. Solo vídeos que se pueden incrustar y de la categoría Música.
        const busqueda = await llamar('search', {
          part: 'snippet', type: 'video', maxResults: '6', videoEmbeddable: 'true', videoSyndicated: 'true', videoCategoryId: '10',
          q: `${titulo} ${artista}`,
          fields: 'items(id/videoId,snippet(title,channelTitle))',
        }, apiKey, { fetchFn });
        cuota.gastar(COSTE_BUSQUEDA);
        const items = (busqueda?.items ?? []).filter(i => i?.id?.videoId);
        if (!items.length) { cache.escribir(k, []); return { candidatos: [], cache: false }; }

        // 2) Duración y estado de incrustación (1 unidad para todos los resultados)
        const detalles = await llamar('videos', {
          part: 'contentDetails,status', id: items.map(i => i.id.videoId).join(','),
          fields: 'items(id,contentDetails/duration,status(embeddable,privacyStatus))',
        }, apiKey, { fetchFn });
        cuota.gastar(COSTE_VIDEOS);
        const porId = new Map((detalles?.items ?? []).map(d => [d.id, d]));
        const videos = items.map(i => {
          const d = porId.get(i.id.videoId);
          return {
            id: i.id.videoId, titulo: i.snippet?.title ?? '', canal: i.snippet?.channelTitle ?? '',
            duracionS: parsearDuracion(d?.contentDetails?.duration),
            embebible: d ? d.status?.embeddable !== false && d.status?.privacyStatus !== 'private' : true,
          };
        });
        const candidatos = elegirCandidatos(videos, titulo, artista);
        cache.escribir(k, candidatos);
        return { candidatos, cache: false };
      } catch (e) {
        if (e instanceof ErrorYoutube && e.codigo === 'CUOTA') cuota.marcarAgotada();
        throw e;
      }
    })().finally(() => enCurso.delete(k));
    enCurso.set(k, tarea);
    return tarea;
  }

  /** Resuelve varias canciones con un máximo de `paralelo` búsquedas a la vez. Conserva el orden. */
  async function resolver(canciones, paralelo = 3) {
    const resultados = new Array(canciones.length);
    let siguiente = 0, error = null;
    const trabajador = async () => {
      while (siguiente < canciones.length && !error) {
        const i = siguiente++;
        try { resultados[i] = (await buscarUna(canciones[i])).candidatos; }
        catch (e) {
          if (e instanceof ErrorYoutube && ['CUOTA', 'CLAVE', 'SIN_CLAVE'].includes(e.codigo)) { error = e; return; } // no tiene sentido seguir
          resultados[i] = null; // una búsqueda fallida solo afecta a esa canción (el navegador la reintentará)
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(paralelo, canciones.length) }, trabajador));
    if (error) throw error;
    return resultados;
  }

  return { buscarUna, resolver, cuota, cache };
}
