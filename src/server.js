import 'dotenv/config';
import { crearApp } from './app.js';
import * as gemini from './services/gemini.js';
import * as voz from './services/elevenlabs.js';
import { obtenerClima } from './services/clima.js';
import { crearBuscador } from './services/youtube.js';

const PORT = process.env.PORT || 3000;

const buscador = crearBuscador();
const app = crearApp({ gemini, voz, obtenerClima, buscador });

const faltan = ['YOUTUBE_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY'].filter(k => !process.env[k]);
if (faltan.length) console.warn(`⚠️ Faltan variables de entorno: ${faltan.join(', ')} (la web avisará de lo que no funcione)`);
if (!process.env.ACCESS_CODE && (process.env.RENDER || process.env.NODE_ENV === 'production')) {
  console.warn('⚠️ Sin ACCESS_CODE: cualquiera con la URL puede gastar tu cuota de YouTube, Gemini y ElevenLabs.');
}

// ARRANQUE Y CIERRE ORDENADO: al desplegar, Render manda SIGTERM; se termina lo que está en curso (máx. 10 s) en vez de cortarlo
const servidor = app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Velvet Tube en el puerto ${PORT}`));

function cerrar(senal) {
  console.log(`🛑 ${senal}: cerrando el servidor`);
  servidor.close(() => process.exit(0));
  servidor.closeIdleConnections?.();
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => cerrar('SIGTERM'));
process.on('SIGINT', () => cerrar('SIGINT'));
process.on('unhandledRejection', (e) => console.error('❌ Promesa sin capturar:', e?.message || e));
