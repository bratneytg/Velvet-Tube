import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { conTiempo } from '../utils.js';

// El cliente se crea al primer uso (no al importar): así el servidor arranca y los tests corren aunque falte la clave.
let _ai = null;
const ai = () => (_ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
const MODELO = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';

// ---------------------------------------------------------------------------
// TIPOS DE LOCUCIÓN (igual que en Velvet Dial). Todos terminan presentando la siguiente canción;
// lo que cambia es de qué se habla antes. `peso` = probabilidad relativa; `usaClima` = necesita clima/hora.
// ---------------------------------------------------------------------------
const TIPOS = [
  { tipo: 'cancion', peso: 35, usaClima: false },
  { tipo: 'clima',   peso: 20, usaClima: true  },
  { tipo: 'dato',    peso: 20, usaClima: false },
  { tipo: 'momento', peso: 15, usaClima: true  },
  { tipo: 'mixto',   peso: 10, usaClima: true  },
];

const INSTRUCCIONES = {
  cancion: 'Talk about both songs: name them, with a brief natural comment on the lyrics, the artist or the mood.',
  clima:   'Open with the current weather in the city (temperature and conditions, said naturally, never like a robotic report) and use it to lead into the next song. Name the next song; mentioning the one that is ending is optional.',
  dato:    'Share ONE short curiosity about the artist or the song (the one ending or the next one) ONLY if you are highly confident it is true; if not, make a brief remark about the vibe or style instead. Then name the next song.',
  momento: 'Greet the listeners according to the day and time of day and set the mood for it. Do not quote weather numbers. Name the next song.',
  mixto:   'Mix a quick remark about the weather with a quick comment about the songs. Name both songs.',
};

// Memoria POR OYENTE: último tipo (para no repetirlo dos veces seguidas) y últimas locuciones (para que Gemini no repita
// muletillas ni aperturas). Se olvida lo que lleva 6 h sin usarse.
const memorias = new Map();   // sesión -> { ultimoTipo, ultimosGuiones, uso }
function memoriaDe(sesion = '_') {
  const ahora = Date.now();
  if (memorias.size > 100) for (const [k, v] of memorias) if (ahora - v.uso > 6 * 3600_000) memorias.delete(k);
  let m = memorias.get(sesion);
  if (!m) memorias.set(sesion, m = { ultimoTipo: null, ultimosGuiones: [], uso: ahora });
  m.uso = ahora;
  return m;
}

/**
 * Elige el tipo de la próxima locución (aleatorio ponderado, sin repetir el anterior).
 * @param {boolean} hayClima - si es false, se descartan los tipos que necesitan clima/hora
 * @param {string} [sesion] - identifica al oyente (cada uno lleva su propia memoria)
 */
export function elegirTipoSegmento(hayClima = true, sesion) {
  const memoria = memoriaDe(sesion);
  const candidatos = TIPOS.filter(t => t.tipo !== memoria.ultimoTipo && (hayClima || !t.usaClima));
  let r = Math.random() * candidatos.reduce((suma, t) => suma + t.peso, 0);
  const elegido = candidatos.find(t => (r -= t.peso) < 0) ?? candidatos[0];
  memoria.ultimoTipo = elegido.tipo;
  return elegido.tipo;
}

/** "Título de Artista" tal como lo diría el locutor. */
export const nombreCancion = (c) => (c?.artista ? `${c.titulo} de ${c.artista}` : String(c?.titulo ?? 'una gran canción'));

/**
 * Genera un guion de locución para la radio.
 * @param {string} cancionAnterior - Canción que está terminando (texto: "Título de Artista")
 * @param {string} cancionSiguiente - Canción que está por sonar
 * @param {object} [opciones]
 * @param {string} [opciones.tipo='cancion'] - 'cancion' | 'clima' | 'dato' | 'momento' | 'mixto'
 * @param {object|null} [opciones.clima] - datos de services/clima.js
 * @param {string} [opciones.ambiente] - petición libre del oyente (p. ej. "estoy en una cita romántica")
 * @param {string} [opciones.idioma='en'] - 'en' | 'es': idioma en el que habla el locutor
 * @param {string} [opciones.genero='female'] - 'male' | 'female'
 * @param {string} [opciones.sesion] - identifica al oyente
 * @returns {Promise<string>} El guion redactado para locutar
 */
export async function generarGuionLocutor(cancionAnterior, cancionSiguiente, { tipo = 'cancion', clima = null, ambiente = '', idioma = 'en', genero = 'female', sesion } = {}) {
  const memoria = memoriaDe(sesion);
  const ultimosGuiones = memoria.ultimosGuiones;
  const lengua = idioma === 'es' ? 'Spanish' : 'English';
  const locutor = genero === 'male' ? 'male' : 'female';
  const necesitaClima = TIPOS.find(t => t.tipo === tipo)?.usaClima;
  const usaClima = necesitaClima && clima;
  const tipoEfectivo = necesitaClima && !clima ? 'cancion' : tipo; // sin datos de clima, se cae al tipo 'cancion'
  const contexto = usaClima
    ? `- Weather in ${clima.ciudad} right now: ${clima.temperaturaC}°C (feels like ${clima.sensacionC}°C), ${clima.descripcion}, wind ${clima.vientoKmh} km/h
    - Local time: ${clima.diaSemana} ${clima.parteDelDia}`
    : '';
  const peticion = ambiente
    ? `Listener's request (very important, apply it on top of the focus above): "${ambiente}". Adapt the tone and content of the link to it, while still leading into the next song.`
    : '';
  // El idioma por defecto es el de la voz, pero la petición del oyente manda: si pide otro idioma, TODO el texto va en ese idioma.
  // Se dice de forma explícita y destacada porque, si no, las locuciones anteriores (en el idioma de la voz) arrastran al modelo.
  const reglaIdioma = ambiente
    ? `LANGUAGE (highest priority): write the link in ${lengua} by default. BUT if the listener's request above asks for a different language (for example "speak to me in French", "háblame en italiano", "in Portuguese please"), you MUST write the ENTIRE link in that language instead, even if your previous links were in ${lengua}. Only song titles and artist names stay untouched.`
    : '';
  const evitar = ultimosGuiones.length
    ? `- Do NOT reuse the openings, phrases or structure of your previous links (they may be in another language: that must NOT influence the language of this one):\n${ultimosGuiones.map(g => `      "${g}"`).join('\n')}`
    : '';

  const prompt = `
    Act as a charismatic, sensual, deep and modern ${locutor} radio host.
    You are a ${locutor} host. Your default language is ${lengua}${idioma === 'es' ? ', so use the grammatical forms that match a ' + locutor + ' speaker' : ''}.
    Your job is a quick, entertaining link between the song that is ending and the one coming up next.

    - Song that is ending: "${cancionAnterior}"
    - Song coming up next: "${cancionSiguiente}"
    ${contexto}

    Focus of this link: ${INSTRUCCIONES[tipoEfectivo]}
    ${peticion}
    ${reglaIdioma}

    Rules:
    - Short text (default language ${lengua}; see the LANGUAGE rule if the listener asked for another one), ${ambiente ? 65 : 55} words maximum.
    - Keep song titles and artist names exactly as they are (do not translate them). Any weather or time data above is given in English: say it naturally in ${lengua}.
    - It must flow naturally and always lead into the next song, so the listener hears its title and artist.
    - Sound like a real radio host: fresh, varied, never formulaic. Do not start every link the same way (avoid always opening with "Hey").
    - Plain spoken text only: no stage directions, sound effects, emojis, hashtags or markdown. Write numbers the way you would say them.
    ${evitar}
  `;

  try {
    const response = await conTiempo(ai().models.generateContent({ model: MODELO(), contents: prompt }), 25_000, 'Gemini (locución)');
    const guion = response.text.trim();
    ultimosGuiones.push(guion);
    if (ultimosGuiones.length > 3) ultimosGuiones.shift();
    return guion;
  } catch (error) {
    console.error('❌ Error al generar el guion con Gemini:', error.message);
    throw error;
  }
}

/** Limpia y valida la respuesta JSON de Gemini para una lista (separado para poder probarlo sin red). */
export function limpiarPropuestaLista(bruto) {
  const texto = String(bruto ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const data = JSON.parse(texto);
  const vistas = new Set();
  const canciones = (Array.isArray(data?.canciones) ? data.canciones : [])
    .map(c => ({ titulo: String(c?.titulo ?? '').trim().slice(0, 120), artista: String(c?.artista ?? '').trim().slice(0, 120) }))
    .filter(c => c.titulo && c.artista)
    .filter(c => { const k = `${c.titulo}|${c.artista}`.toLowerCase(); if (vistas.has(k)) return false; vistas.add(k); return true; });
  return { nombre: String(data?.nombre ?? '').trim(), descripcion: String(data?.descripcion ?? '').trim(), canciones };
}

/**
 * Propone una lista de canciones reales para una petición del oyente (p. ej. "es por la mañana y quiero música energizante").
 * @param {string} peticion
 * @param {number} cantidad - cuántas canciones quiere el oyente
 * @param {object} [opciones]
 * @param {string} [opciones.idioma='es'] - idioma del nombre y la descripción de la lista ('es' | 'en')
 * @returns {Promise<{nombre: string, descripcion: string, canciones: {titulo: string, artista: string}[]}>}
 *          Se piden algunas canciones de más: no todas se encuentran luego en YouTube.
 */
export async function generarListaCanciones(peticion, cantidad, { idioma = 'es' } = {}) {
  const pedir = Math.min(cantidad + Math.max(3, Math.ceil(cantidad * 0.15)), 50);
  const lengua = idioma === 'en' ? 'English' : 'Spanish';
  const prompt = `
    You are an expert music curator building a playlist for a listener.

    Listener's request: "${peticion}"

    Return ONLY a JSON object, with this exact shape and no other text:
    {"nombre": "...", "descripcion": "...", "canciones": [{"titulo": "...", "artista": "..."}]}

    Rules:
    - "canciones": exactly ${pedir} songs that REALLY exist and can be found on YouTube as an official audio or music video. Never invent songs or attribute a song to the wrong artist.
      If you are not sure a song exists, leave it out and pick another one.
    - "titulo" is the original song title (no "remastered", no "feat." inside the title); "artista" is the main artist only.
    - No duplicates. Mix well-known songs with a few less obvious ones, unless the request asks for something specific.
    - Order the songs so the playlist flows well for the request (for example energy that builds, or a calm arc).
    - Follow the request closely: mood, moment of the day, activity, genres, decades, languages and artists it mentions.
    - "nombre": a short, catchy playlist name in ${lengua} (max 40 characters, no quotes or emojis).
    - "descripcion": one sentence in ${lengua} (max 120 characters).
  `;

  try {
    const response = await conTiempo(ai().models.generateContent({
      model: MODELO(),
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    }), 40_000, 'Gemini (lista)');
    return limpiarPropuestaLista(response.text);
  } catch (error) {
    console.error('❌ Error al generar la lista con Gemini:', error.message);
    throw error;
  }
}
