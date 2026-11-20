import 'dotenv/config';
import { fetchConTiempo } from '../utils.js';

// Voces disponibles: idioma (es/en) + género (m/f). La clave es la que manda el navegador.
export const VOCES = {
  'es-m': { id: 'wfTWLJ20rcMqvU8gIiAB', idioma: 'es', genero: 'male' },
  'es-f': { id: 'yFykvY9iSJewrANOC0cU', idioma: 'es', genero: 'female' },
  'en-m': { id: 'mKoqwDP2laxTdq1gEgU6', idioma: 'en', genero: 'male' },
  'en-f': { id: 'JaagUurP1dmW3WscoJ79', idioma: 'en', genero: 'female' },
};
export const VOZ_POR_DEFECTO = 'en-f';

/** Devuelve la voz pedida si existe; si no (o si viene algo raro), la voz por defecto. */
export const elegirVoz = (clave) => VOCES[Object.hasOwn(VOCES, clave) ? clave : VOZ_POR_DEFECTO];

/**
 * Convierte un texto en un buffer de audio MP3 usando ElevenLabs.
 * @param {string} textoGuion
 * @param {string} [voiceId] - id de la voz en ElevenLabs (por defecto, la voz por defecto)
 * @returns {Promise<ArrayBuffer>} El buffer con el audio generado
 */
export async function generarAudioLocucion(textoGuion, voiceId = VOCES[VOZ_POR_DEFECTO].id) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

  const audioResponse = await fetchConTiempo(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text: textoGuion,
      model_id: 'eleven_flash_v2_5',
    }),
  }, 25_000);

  if (!audioResponse.ok) {
    const errorText = await audioResponse.text();
    throw new Error(`Error en ElevenLabs (${audioResponse.status}): ${errorText}`);
  }

  return await audioResponse.arrayBuffer();
}
