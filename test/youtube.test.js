import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizar, parsearDuracion, puntuar, elegirCandidatos, crearContadorCuota, crearCache, crearBuscador, ErrorYoutube,
  COSTE_BUSQUEDA, COSTE_VIDEOS,
} from '../src/services/youtube.js';

const v = (id, titulo, canal, duracionS = 210, extra = {}) => ({ id, titulo, canal, duracionS, ...extra });

test('normalizar quita tildes, paréntesis, feat y signos', () => {
  assert.equal(normalizar('Despacito (Remix) [HD]'), 'despacito');
  assert.equal(normalizar('Canción Número 1 feat. Alguien'), 'cancion numero 1');
  assert.equal(normalizar("Guns N' Roses"), 'guns n roses');
});

test('parsearDuracion entiende ISO 8601', () => {
  assert.equal(parsearDuracion('PT3M45S'), 225);
  assert.equal(parsearDuracion('PT1H2M3S'), 3723);
  assert.equal(parsearDuracion('PT45S'), 45);
  assert.equal(parsearDuracion('P0D'), 0);
  assert.equal(parsearDuracion('basura'), 0);
  assert.equal(parsearDuracion(undefined), 0);
});

test('puntuar descarta otra canción u otro artista', () => {
  assert.equal(puntuar(v('a', 'Otra canción distinta', 'Queen'), 'Bohemian Rhapsody', 'Queen'), null);
  assert.equal(puntuar(v('b', 'Bohemian Rhapsody', 'Un Cantante Cualquiera'), 'Bohemian Rhapsody', 'Queen'), null);
});

test('puntuar descarta recopilaciones de horas', () => {
  assert.equal(puntuar(v('c', 'Queen - Bohemian Rhapsody', 'Queen Official', 3 * 3600), 'Bohemian Rhapsody', 'Queen'), null);
});

test('elegirCandidatos prefiere el canal Topic / audio oficial sobre versiones en directo, karaoke o remix', () => {
  const videos = [
    v('live', 'Queen - Bohemian Rhapsody (Live at Wembley)', 'Queen Official'),
    v('karaoke', 'Bohemian Rhapsody - Queen (Karaoke Version)', 'Sing King'),
    v('topic', 'Bohemian Rhapsody', 'Queen - Topic', 355),
    v('video', 'Queen - Bohemian Rhapsody (Official Video Remastered)', 'Queen Official', 359),
  ];
  const r = elegirCandidatos(videos, 'Bohemian Rhapsody', 'Queen');
  assert.equal(r[0].id, 'topic');
  assert.ok(r.map(x => x.id).includes('video'));
  assert.ok(!r.map(x => x.id).includes('karaoke'), 'el karaoke no debe ser candidato');
  assert.ok(r.findIndex(x => x.id === 'live') === -1 || r.findIndex(x => x.id === 'live') > r.findIndex(x => x.id === 'video'));
});

test('elegirCandidatos respeta el título cuando lo pedido ya es una versión (live)', () => {
  const r = elegirCandidatos([v('l', 'Nirvana - Come As You Are (Live)', 'Nirvana'), v('s', 'Nirvana - Come As You Are', 'Nirvana')], 'Come As You Are (Live)', 'Nirvana');
  assert.ok(r.length >= 1);
});

test('elegirCandidatos excluye lo no embebible y respeta el máximo', () => {
  const videos = [
    v('x1', 'Song - Artist', 'Artist - Topic', 200, { embebible: false }),
    v('x2', 'Song - Artist', 'Artist - Topic'), v('x3', 'Song Artist', 'Artist'), v('x4', 'Song by Artist', 'Artist'), v('x5', 'Artist - Song', 'Artist'),
  ];
  const r = elegirCandidatos(videos, 'Song', 'Artist', 3);
  assert.equal(r.length, 3);
  assert.ok(!r.some(x => x.id === 'x1'));
});

test('elegirCandidatos devuelve [] si nada sirve', () => {
  assert.deepEqual(elegirCandidatos([v('z', 'Nada que ver', 'Otro')], 'Song', 'Artist'), []);
  assert.deepEqual(elegirCandidatos(undefined, 'Song', 'Artist'), []);
});

test('contador de cuota: gasta, se agota y se reinicia al cambiar de día (hora del Pacífico)', () => {
  let ahora = Date.UTC(2026, 10, 20, 12, 0, 0);
  const c = crearContadorCuota({ limite: 250, reloj: () => ahora });
  assert.ok(c.permite(101)); c.gastar(101);
  assert.ok(c.permite(101)); c.gastar(101);
  assert.ok(!c.permite(101), 'ya no cabe otra búsqueda');
  assert.equal(c.estado().usado, 202);
  ahora += 24 * 3600_000;
  assert.ok(c.permite(101), 'nuevo día: cuota repuesta');
  assert.equal(c.estado().usado, 0);
  c.marcarAgotada(); assert.ok(!c.permite(1));
});

test('caché: caduca antes lo vacío que lo encontrado', () => {
  let ahora = 1_000_000;
  const cache = crearCache({ archivo: null, reloj: () => ahora });
  const k1 = cache.clave('Song', 'Artist'), k2 = cache.clave('Nada', 'Nadie');
  cache.escribir(k1, [{ id: 'a' }]); cache.escribir(k2, []);
  assert.deepEqual(cache.leer(k1), [{ id: 'a' }]);
  assert.deepEqual(cache.leer(k2), []);
  ahora += 7 * 3600_000; // 7 h
  assert.equal(cache.leer(k2), undefined, 'lo vacío caduca a las 6 h');
  assert.deepEqual(cache.leer(k1), [{ id: 'a' }]);
  ahora += 31 * 24 * 3600_000;
  assert.equal(cache.leer(k1), undefined);
  assert.equal(cache.clave('Canción', 'ÁRTISTA'), cache.clave('cancion', 'artista'), 'la clave ignora tildes y mayúsculas');
});

// --- Buscador con fetch simulado ---
function fetchFalso(respuestas) {
  const llamadas = [];
  const fn = async (url) => {
    const u = new URL(url);
    llamadas.push({ ruta: u.pathname.split('/').pop(), params: Object.fromEntries(u.searchParams) });
    const r = respuestas[u.pathname.split('/').pop()];
    const { status = 200, cuerpo } = typeof r === 'function' ? r(u) : r;
    return { ok: status < 400, status, json: async () => cuerpo };
  };
  fn.llamadas = llamadas;
  return fn;
}
const respuestasOk = () => ({
  search: { cuerpo: { items: [
    { id: { videoId: 'AAA' }, snippet: { title: 'Bohemian Rhapsody', channelTitle: 'Queen - Topic' } },
    { id: { videoId: 'BBB' }, snippet: { title: 'Queen - Bohemian Rhapsody (Live Aid)', channelTitle: 'Queen Official' } },
    { id: { videoId: 'CCC' }, snippet: { title: 'Bohemian Rhapsody', channelTitle: 'Queen Official' } },
  ] } },
  videos: { cuerpo: { items: [
    { id: 'AAA', contentDetails: { duration: 'PT5M55S' }, status: { embeddable: true, privacyStatus: 'public' } },
    { id: 'BBB', contentDetails: { duration: 'PT21M' }, status: { embeddable: true } },
    { id: 'CCC', contentDetails: { duration: 'PT5M59S' }, status: { embeddable: false } },
  ] } },
});

test('buscador: una búsqueda cuesta 101 unidades, filtra no embebibles y usa la caché la segunda vez', async () => {
  const fetchFn = fetchFalso(respuestasOk());
  const cuota = crearContadorCuota({ limite: 10_000 });
  const b = crearBuscador({ clave: () => 'K', fetchFn, cache: crearCache({ archivo: null }), cuota });
  const r1 = await b.buscarUna({ titulo: 'Bohemian Rhapsody', artista: 'Queen' });
  assert.deepEqual(r1.candidatos.map(c => c.id), ['AAA']); // CCC no es embebible, BBB es un directo de 21 min
  assert.equal(cuota.estado().usado, COSTE_BUSQUEDA + COSTE_VIDEOS);
  assert.equal(fetchFn.llamadas[0].params.videoEmbeddable, 'true');
  assert.equal(fetchFn.llamadas[0].params.key, 'K');
  const r2 = await b.buscarUna({ titulo: 'bohemian rhapsody', artista: 'QUEEN' });
  assert.equal(r2.cache, true);
  assert.equal(fetchFn.llamadas.length, 2, 'la segunda vez no llama a YouTube');
  assert.equal(cuota.estado().usado, COSTE_BUSQUEDA + COSTE_VIDEOS);
});

test('buscador: dos peticiones iguales a la vez gastan una sola búsqueda', async () => {
  const fetchFn = fetchFalso(respuestasOk());
  const b = crearBuscador({ clave: () => 'K', fetchFn, cache: crearCache({ archivo: null }), cuota: crearContadorCuota() });
  const [a, c] = await Promise.all([b.buscarUna({ titulo: 'Bohemian Rhapsody', artista: 'Queen' }), b.buscarUna({ titulo: 'Bohemian Rhapsody', artista: 'Queen' })]);
  assert.deepEqual(a.candidatos, c.candidatos);
  assert.equal(fetchFn.llamadas.filter(l => l.ruta === 'search').length, 1);
});

test('buscador: sin resultados se guarda como vacío (no se repite la búsqueda)', async () => {
  const fetchFn = fetchFalso({ search: { cuerpo: { items: [] } } });
  const b = crearBuscador({ clave: () => 'K', fetchFn, cache: crearCache({ archivo: null }), cuota: crearContadorCuota() });
  assert.deepEqual((await b.buscarUna({ titulo: 'Nada', artista: 'Nadie' })).candidatos, []);
  assert.deepEqual((await b.buscarUna({ titulo: 'Nada', artista: 'Nadie' })).candidatos, []);
  assert.equal(fetchFn.llamadas.length, 1);
});

test('buscador: cuota agotada por YouTube -> error CUOTA y no se vuelve a llamar', async () => {
  const fetchFn = fetchFalso({ search: { status: 403, cuerpo: { error: { message: 'quota', errors: [{ reason: 'quotaExceeded' }] } } } });
  const b = crearBuscador({ clave: () => 'K', fetchFn, cache: crearCache({ archivo: null }), cuota: crearContadorCuota() });
  await assert.rejects(b.buscarUna({ titulo: 'A', artista: 'B' }), (e) => e instanceof ErrorYoutube && e.codigo === 'CUOTA' && e.status === 429);
  await assert.rejects(b.buscarUna({ titulo: 'C', artista: 'D' }), (e) => e.codigo === 'CUOTA');
  assert.equal(fetchFn.llamadas.length, 1, 'tras agotarse, ni lo intenta');
});

test('buscador: cuota local agotada no llama a YouTube', async () => {
  const fetchFn = fetchFalso(respuestasOk());
  const cuota = crearContadorCuota({ limite: 50 });
  const b = crearBuscador({ clave: () => 'K', fetchFn, cache: crearCache({ archivo: null }), cuota });
  await assert.rejects(b.buscarUna({ titulo: 'A', artista: 'B' }), (e) => e.codigo === 'CUOTA');
  assert.equal(fetchFn.llamadas.length, 0);
});

test('buscador: sin clave -> SIN_CLAVE; clave inválida -> CLAVE', async () => {
  const sin = crearBuscador({ clave: () => '', fetchFn: fetchFalso({}), cache: crearCache({ archivo: null }), cuota: crearContadorCuota() });
  await assert.rejects(sin.buscarUna({ titulo: 'A', artista: 'B' }), (e) => e.codigo === 'SIN_CLAVE');
  const mala = crearBuscador({ clave: () => 'x', fetchFn: fetchFalso({ search: { status: 400, cuerpo: { error: { message: 'API key not valid', errors: [{ reason: 'keyInvalid' }] } } } }), cache: crearCache({ archivo: null }), cuota: crearContadorCuota() });
  await assert.rejects(mala.buscarUna({ titulo: 'A', artista: 'B' }), (e) => e.codigo === 'CLAVE');
});

test('resolver: conserva el orden y un fallo suelto solo afecta a esa canción (null)', async () => {
  let n = 0;
  const fetchFn = fetchFalso({
    search: (u) => (u.searchParams.get('q').startsWith('Mala')
      ? { status: 500, cuerpo: { error: { message: 'boom' } } }
      : { cuerpo: { items: [{ id: { videoId: `V${++n}` }, snippet: { title: u.searchParams.get('q'), channelTitle: 'X - Topic' } }] } }),
    videos: (u) => ({ cuerpo: { items: u.searchParams.get('id').split(',').map(id => ({ id, contentDetails: { duration: 'PT3M' }, status: { embeddable: true } })) } }),
  });
  const b = crearBuscador({ clave: () => 'K', fetchFn, cache: crearCache({ archivo: null }), cuota: crearContadorCuota() });
  const r = await b.resolver([{ titulo: 'Uno', artista: 'X' }, { titulo: 'Mala', artista: 'X' }, { titulo: 'Tres', artista: 'X' }]);
  assert.equal(r.length, 3);
  assert.equal(r[0].length, 1);
  assert.equal(r[1], null);
  assert.equal(r[2].length, 1);
});

test('resolver: un error de cuota corta todo el lote', async () => {
  const fetchFn = fetchFalso({ search: { status: 403, cuerpo: { error: { errors: [{ reason: 'quotaExceeded' }] } } } });
  const b = crearBuscador({ clave: () => 'K', fetchFn, cache: crearCache({ archivo: null }), cuota: crearContadorCuota() });
  await assert.rejects(b.resolver([{ titulo: 'A', artista: 'B' }, { titulo: 'C', artista: 'D' }, { titulo: 'E', artista: 'F' }]), (e) => e.codigo === 'CUOTA');
});
