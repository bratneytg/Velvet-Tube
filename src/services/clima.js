import 'dotenv/config';
import { fetchConTiempo } from '../utils.js';

const CIUDAD = process.env.CIUDAD || 'Munich'; // ciudad por defecto si el dispositivo no comparte su ubicación
const TTL_MS = 10 * 60 * 1000;                 // el clima apenas cambia: se reutiliza 10 min
const cacheClima = new Map();                  // "lat,lon" (1 decimal ≈ 11 km) -> { ts, datos }
const cacheCiudad = new Map();                 // "lat,lon" (2 decimales) -> nombre de la ciudad
let porDefecto = null;                         // { nombre, lat, lon } de CIUDAD (se geocodifica una vez)

// Código meteorológico WMO -> descripción corta en inglés (el DJ habla en inglés)
function describirCodigo(c) {
  if (c === 0) return 'clear sky';
  if (c <= 2) return 'partly cloudy';
  if (c === 3) return 'overcast';
  if (c <= 48) return 'foggy';
  if (c <= 57) return 'drizzle';
  if (c <= 67) return 'rain';
  if (c <= 77) return 'snow';
  if (c <= 82) return 'rain showers';
  if (c <= 86) return 'snow showers';
  return 'thunderstorm';
}

function parteDelDia(hora) {
  if (hora < 6) return 'late night';
  if (hora < 12) return 'morning';
  if (hora < 18) return 'afternoon';
  if (hora < 22) return 'evening';
  return 'night';
}

// Valida las coordenadas que llegan del navegador (nunca se confía en el cliente)
function coordsValidas(c) {
  const lat = Number(c?.lat), lon = Number(c?.lon);
  return c && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

// Nombre de la ciudad a partir de coordenadas (OpenStreetMap Nominatim, sin clave; se cachea para no abusar)
async function ciudadPorCoordenadas({ lat, lon }) {
  const clave = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (cacheCiudad.has(clave)) return cacheCiudad.get(clave);
  try {
    const r = await fetchConTiempo(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${lat}&lon=${lon}`,
      { headers: { 'User-Agent': 'VelvetTube/0.1 (radio app)' } }, // Nominatim exige identificarse
      6000
    );
    if (r.ok) {
      const a = (await r.json()).address || {};
      const nombre = a.city || a.town || a.village || a.municipality || a.county || a.state;
      if (nombre) { cacheCiudad.set(clave, nombre); return nombre; }
    }
  } catch (e) {
    console.warn('⚠️ No se pudo averiguar la ciudad:', e.message);
  }
  return 'your area'; // el DJ dirá algo genérico; no se cachea para reintentarlo luego
}

/**
 * Clima actual y momento del día (hora LOCAL del lugar) para que el DJ lo use en la charla.
 * @param {{lat:number, lon:number}} [coordenadas] - ubicación del dispositivo; si falta o es inválida se usa CIUDAD
 * @returns {Promise<object|null>} null si no se pudo obtener (el servidor entonces evita hablar del clima)
 */
export async function obtenerClima(coordenadas = null) {
  let clave = null;
  try {
    let punto = coordsValidas(coordenadas);
    if (!punto) {
      if (!porDefecto) {
        const geo = await (await fetchConTiempo(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(CIUDAD)}&count=1&language=en`, {}, 6000
        )).json();
        const r = geo.results?.[0];
        if (!r) throw new Error(`No se encontró la ciudad "${CIUDAD}"`);
        porDefecto = { nombre: r.name, lat: r.latitude, lon: r.longitude };
      }
      punto = porDefecto;
    }

    clave = `${punto.lat.toFixed(1)},${punto.lon.toFixed(1)}`;
    const guardado = cacheClima.get(clave);
    if (guardado && Date.now() - guardado.ts < TTL_MS) return guardado.datos;

    const ciudad = punto.nombre ?? await ciudadPorCoordenadas(punto);
    const res = await fetchConTiempo(
      `https://api.open-meteo.com/v1/forecast?latitude=${punto.lat}&longitude=${punto.lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&timezone=auto`, {}, 6000
    );
    if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
    const { current } = await res.json();

    // current.time llega como "2026-11-14T21:30" ya en hora local del lugar
    const [dia, hora] = current.time.split('T');
    const datos = {
      ciudad,
      temperaturaC: Math.round(current.temperature_2m),
      sensacionC: Math.round(current.apparent_temperature),
      descripcion: describirCodigo(current.weather_code),
      vientoKmh: Math.round(current.wind_speed_10m),
      esDeDia: !!current.is_day,
      diaSemana: new Date(`${dia}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      parteDelDia: parteDelDia(parseInt(hora.slice(0, 2), 10)),
    };

    cacheClima.set(clave, { ts: Date.now(), datos });
    return datos;
  } catch (error) {
    console.warn('⚠️ No se pudo obtener el clima:', error.message);
    return (clave && cacheClima.get(clave)?.datos) ?? null; // un dato antiguo es mejor que nada
  }
}