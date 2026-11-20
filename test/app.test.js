import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { crearLimitador, codigoValido } from '../src/limites.js';
import { limpiarPropuestaLista, elegirTipoSegmento, nombreCancion } from '../src/services/gemini.js';
import { elegirVoz, VOCES } from '../src/services/elevenlabs.js';
import { ErrorYoutube } from '../src/services/youtube.js';

// Los registros del servidor (con emojis) ensucian la salida del ejecutor de pruebas: se silencian aquí
for (const m of ['log', 'warn', 'error']) console[m] = () => {};

// ---- Dependencias simuladas ----
const llamadas = { lista: [], guion: [], voz: [], resolver: [] };
const gemini = {
  generarListaCanciones: async (p, n, o) => { llamadas.lista.push({ p, n, o }); return { nombre: 'Mañanas', descripcion: 'desc', canciones: Array.from({ length: n + 3 }, (_, i) => ({ titulo: `T${i}`, artista: `A${i}` })) }; },
  generarGuionLocutor: async (a, s, o) => { llamadas.guion.push({ a, s, o }); return 'Hola oyentes'; },
  elegirTipoSegmento: () => 'cancion',
  nombreCancion,
};
const voz = { elegirVoz, generarAudioLocucion: async (txt, id) => { llamadas.voz.push({ txt, id }); return new Uint8Array([1, 2, 3]).buffer; } };
let resolverImpl = async (cs) => cs.map(() => [{ id: 'abc', titulo: 't', canal: 'c', duracion: 200 }]);
const buscador = { resolver: async (cs) => { llamadas.resolver.push(cs); return resolverImpl(cs); }, cuota: { estado: () => ({ usado: 0, limite: 10000, agotada: false, restantes: 10000 }) } };
const env = { YOUTUBE_API_KEY: 'y', GEMINI_API_KEY: 'g', ELEVENLABS_API_KEY: 'e', ACCESS_CODE: 'secreto' };

let servidor, base;
const post = (ruta, cuerpo, cabeceras = {}) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-codigo': 'secreto', ...cabeceras }, body: JSON.stringify(cuerpo) });

before(async () => {
  const app = crearApp({ gemini, voz, obtenerClima: async () => null, buscador, env });
  servidor = app.listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { servidor.closeAllConnections?.(); servidor.close(); });

test('/api/config es público y no revela claves', async () => {
  const r = await fetch(base + '/api/config');
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual({ requiereCodigo: d.requiereCodigo, youtube: d.youtube, gemini: d.gemini, voz: d.voz }, { requiereCodigo: true, youtube: true, gemini: true, voz: true });
  assert.ok(!JSON.stringify(d).includes('secreto'));
});

test('sin código de acceso correcto, la API responde 401', async () => {
  for (const ruta of ['/api/lista', '/api/resolver', '/api/locucion']) {
    const r = await post(ruta, {}, { 'x-codigo': 'mal' });
    assert.equal(r.status, 401, ruta);
    assert.equal((await r.json()).codigo, 'CODIGO');
  }
  assert.equal((await fetch(base + '/api/auth', { headers: { 'x-codigo': 'mal' } })).status, 401);
  assert.equal((await fetch(base + '/api/auth', { headers: { 'x-codigo': 'secreto' } })).status, 200);
});

test('/api/lista devuelve exactamente las canciones pedidas y valida la entrada', async () => {
  const r = await post('/api/lista', { prompt: 'música para correr', cantidad: 10, idioma: 'es' });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.canciones.length, 10, 'se recorta lo que Gemini propuso de más');
  assert.equal(llamadas.lista.at(-1).n, 10);
  const corto = await post('/api/lista', { prompt: 'a' });
  assert.equal(corto.status, 400);
  await post('/api/lista', { prompt: 'rock clásico', cantidad: 999 });
  assert.equal(llamadas.lista.at(-1).n, 20, 'una cantidad no permitida cae a 20');
});

test('/api/lista aplica el límite por IP (5 cada 10 min)', async () => {
  // las llamadas anteriores ya gastaron 3; quedan 2
  assert.equal((await post('/api/lista', { prompt: 'jazz suave' })).status, 200);
  assert.equal((await post('/api/lista', { prompt: 'jazz suave' })).status, 200);
  const r = await post('/api/lista', { prompt: 'jazz suave' });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).codigo, 'LIMITE');
});

test('/api/resolver limita a 5 canciones, limpia la entrada y devuelve candidatos', async () => {
  const canciones = Array.from({ length: 9 }, (_, i) => ({ titulo: `  Canción   ${i} `, artista: 'X'.repeat(500) }));
  const r = await post('/api/resolver', { canciones });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.resultados.length, 5);
  assert.equal(llamadas.resolver.at(-1)[0].titulo, 'Canción 0');
  assert.equal(llamadas.resolver.at(-1)[0].artista.length, 120);
  assert.equal(d.resultados[0][0].id, 'abc');
  assert.equal((await post('/api/resolver', { canciones: [] })).status, 400);
  assert.equal((await post('/api/resolver', { canciones: [{ titulo: '', artista: 'x' }] })).status, 400);
});

test('/api/resolver traduce los errores de YouTube a su código y estado', async () => {
  resolverImpl = async () => { throw new ErrorYoutube('CUOTA', 'agotada', 429); };
  const r = await post('/api/resolver', { canciones: [{ titulo: 'a', artista: 'b' }] });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).codigo, 'CUOTA');
  resolverImpl = async () => { throw new Error('secreto interno'); };
  const r2 = await post('/api/resolver', { canciones: [{ titulo: 'a', artista: 'b' }] });
  assert.equal(r2.status, 500);
  assert.ok(!(await r2.text()).includes('secreto interno'), 'el detalle técnico no llega al navegador');
});

test('/api/locucion genera guion + audio en base64 con la voz elegida', async () => {
  const r = await post('/api/locucion', { anterior: { titulo: 'Uno', artista: 'A' }, siguiente: { titulo: 'Dos', artista: 'B' }, voz: 'es-m', ambiente: 'cena romántica', sesion: 'abcdef1234567890' });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.guion, 'Hola oyentes');
  assert.equal(Buffer.from(d.audioBase64, 'base64').length, 3);
  const g = llamadas.guion.at(-1);
  assert.equal(g.a, 'Uno de A');
  assert.equal(g.s, 'Dos de B');
  assert.equal(g.o.idioma, 'es'); assert.equal(g.o.genero, 'male'); assert.equal(g.o.ambiente, 'cena romántica');
  assert.equal(llamadas.voz.at(-1).id, VOCES['es-m'].id);
});

test('/api/locucion: una voz desconocida cae a la de por defecto y faltan canciones -> 400', async () => {
  await post('/api/locucion', { anterior: { titulo: 'Uno', artista: 'A' }, siguiente: { titulo: 'Dos', artista: 'B' }, voz: '../../hack' });
  assert.equal(llamadas.voz.at(-1).id, VOCES['en-f'].id);
  assert.equal((await post('/api/locucion', { anterior: { titulo: 'Uno' } })).status, 400);
});

test('/api/locucion: si falla ElevenLabs o Gemini, dice cuál (con el código HTTP) sin filtrar el mensaje técnico', async () => {
  const montar = async (vozFalla, geminiFalla) => {
    const app = crearApp({
      gemini: { ...gemini, generarGuionLocutor: async () => { if (geminiFalla) throw Object.assign(new Error('clave api-secreta-123 inválida'), { status: 400 }); return 'hola'; } },
      voz: { elegirVoz, generarAudioLocucion: async () => { if (vozFalla) throw new Error('Error en ElevenLabs (401): {"detail":"clave xi-secreta"}'); return new ArrayBuffer(1); } },
      obtenerClima: async () => null, buscador, env: { GEMINI_API_KEY: 'g', ELEVENLABS_API_KEY: 'e' },
    });
    const sv = app.listen(0, '127.0.0.1'); await new Promise(r => sv.once('listening', r));
    const r = await fetch(`http://127.0.0.1:${sv.address().port}/api/locucion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anterior: { titulo: 'a', artista: 'b' }, siguiente: { titulo: 'c', artista: 'd' } }) });
    const texto = await r.text(); sv.closeAllConnections?.(); sv.close();
    return { status: r.status, d: JSON.parse(texto), texto };
  };
  const a = await montar(true, false);
  assert.equal(a.status, 500); assert.equal(a.d.detalle, 'ElevenLabs (401)'); assert.ok(!a.texto.includes('xi-secreta'));
  const b = await montar(false, true);
  assert.equal(b.d.detalle, 'Gemini (400)'); assert.ok(!b.texto.includes('api-secreta'));
});

test('rutas /api desconocidas responden JSON 404', async () => {
  const r = await fetch(base + '/api/nada', { headers: { 'x-codigo': 'secreto' } });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).success, false);
});

test('cabeceras: el Referer se envía (el reproductor de YouTube lo exige) y se sirve la web', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy-report-only'), /frame-src https:\/\/www\.youtube\.com/);
  assert.match(await r.text(), /Velvet/);
});

test('sin claves en el servidor, las rutas avisan con 503 en vez de fallar', async () => {
  const app = crearApp({ gemini, voz, obtenerClima: async () => null, buscador, env: {} });
  const s = app.listen(0, '127.0.0.1'); await new Promise(r => s.once('listening', r));
  const b = `http://127.0.0.1:${s.address().port}`;
  const j = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  assert.equal((await fetch(b + '/api/lista', { ...j, body: JSON.stringify({ prompt: 'rock' }) })).status, 503);
  assert.equal((await fetch(b + '/api/locucion', { ...j, body: '{}' })).status, 503);
  assert.equal((await (await fetch(b + '/api/config')).json()).youtube, false);
  s.closeAllConnections?.(); s.close();
});

// ---- Módulos sueltos ----
test('limitador de ventana deslizante', () => {
  let ahora = 0;
  const l = crearLimitador(2, 1000, () => ahora);
  assert.ok(l.consumir('a')); assert.ok(l.consumir('a'));
  assert.ok(!l.consumir('a'), 'tercera dentro de la ventana');
  assert.ok(l.consumir('b'), 'otra clave tiene su propio límite');
  ahora = 1500;
  assert.ok(l.consumir('a'), 'pasada la ventana vuelve a permitir');
  l.limpiar();
});

test('código de acceso: sin ACCESS_CODE es abierto; con él compara bien', () => {
  assert.ok(codigoValido(undefined, ''));
  assert.ok(codigoValido('x', 'x'));
  assert.ok(!codigoValido('x', 'y'));
  assert.ok(!codigoValido(undefined, 'y'));
  assert.ok(!codigoValido('', 'y'));
});

test('limpiarPropuestaLista quita vallas de código, duplicados y entradas incompletas', () => {
  const bruto = '```json\n' + JSON.stringify({ nombre: ' Lista ', descripcion: 'd', canciones: [
    { titulo: 'A', artista: 'X' }, { titulo: 'a', artista: 'x' }, { titulo: '', artista: 'Y' }, { titulo: 'B' }, { titulo: 'C', artista: 'Z' },
  ] }) + '\n```';
  const r = limpiarPropuestaLista(bruto);
  assert.equal(r.nombre, 'Lista');
  assert.deepEqual(r.canciones.map(c => c.titulo), ['A', 'C']);
  assert.throws(() => limpiarPropuestaLista('no es json'));
  assert.deepEqual(limpiarPropuestaLista('{}').canciones, []);
});

test('elegirTipoSegmento nunca repite el anterior y sin clima evita los tipos que lo necesitan', () => {
  let anterior = null;
  for (let i = 0; i < 60; i++) { const t = elegirTipoSegmento(true, 'sesion-test'); assert.notEqual(t, anterior); anterior = t; }
  for (let i = 0; i < 60; i++) assert.ok(['cancion', 'dato'].includes(elegirTipoSegmento(false, 'sesion-sin-clima')));
});
