// Servidor de pruebas: la app real (src/app.js) con Gemini, ElevenLabs y YouTube simulados.
import { crearApp } from '../src/app.js';
import { elegirVoz } from '../src/services/elevenlabs.js';
import { nombreCancion } from '../src/services/gemini.js';

const registro = { resolver: [], locuciones: [] };
function wav(segundos, hz = 8000) {
  const n = Math.floor(segundos * hz), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(hz, 24); b.writeUInt32LE(hz * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / hz) * 3000), 44 + i * 2);
  return b;
}
const gemini = {
  generarListaCanciones: async (p, n) => ({ nombre: 'Lista de prueba', descripcion: p, canciones: Array.from({ length: n + 3 }, (_, i) => ({ titulo: `Song ${i}`, artista: `Artist ${i}` })) }),
  generarGuionLocutor: async (a, s) => `Terminó ${a}, ahora ${s}`,
  elegirTipoSegmento: () => 'cancion',
  nombreCancion,
};
const voz = { elegirVoz, generarAudioLocucion: async () => { await new Promise(r => setTimeout(r, 400)); const w = wav(Number(process.env.DUR_VOZ || 4)); return w.buffer.slice(w.byteOffset, w.byteOffset + w.length); } };
const buscador = {
  resolver: async (cs) => { registro.resolver.push(cs.map(c => c.titulo)); return cs.map(c => {
    if (c.titulo === 'Song 2') return [];                                                // no existe en YouTube
    if (c.titulo === 'Song 1') return [{ id: 'FALLA1', titulo: 'x', canal: 'c', duracion: 200 }, { id: 'ok_song_1', titulo: 'x', canal: 'c', duracion: 200 }]; // el primero no se puede incrustar
    return [{ id: 'id_' + c.titulo.replace(/\W/g, '_'), titulo: c.titulo, canal: c.artista + ' - Topic', duracion: 200 }];
  }); },
  cuota: { estado: () => ({ usado: 0, limite: 10000, agotada: false, restantes: 10000 }) },
};
const env = { YOUTUBE_API_KEY: 'y', GEMINI_API_KEY: 'g', ELEVENLABS_API_KEY: 'e', ACCESS_CODE: process.env.CODIGO || '' };
const app = crearApp({ gemini, voz, obtenerClima: async () => null, buscador, env });
app.get('/__registro', (req, res) => res.json(registro));
app.listen(Number(process.env.PORT || 3111), '127.0.0.1', () => console.log('listo'));
