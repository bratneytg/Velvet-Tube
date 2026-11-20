// Velvet Tube: radio con DJ de IA sobre YouTube.
// Todo el reproductor vive en el navegador (reproductor oficial incrustado de YouTube). El servidor solo propone listas,
// busca vídeos y fabrica las locuciones del DJ.

const $ = (id) => document.getElementById(id);
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
const UA = navigator.userAgent;
const ES_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ES_MOVIL = ES_IOS || /Android/i.test(UA);

// Ajustes de la locución (se pueden tocar sin miedo)
const DUCK = 0.22;            // la música baja al 22 % mientras habla el DJ
const BAJADA_MS = 600;        // duración del fundido hacia abajo
const SUBIDA_MS = 1200;       // y hacia arriba
const SUBIDA_ANTES_S = 1.6;   // la música vuelve a subir bajo las últimas palabras
const ANTICIPACION_S = 1.2;   // la voz termina ~1,2 s antes de que acabe la canción, para que la siguiente entre limpia
const RETRASO_VOZ_S = 0.35;   // la música empieza a bajar este tiempo antes de que entre la voz
const MIN_SOLAPE_S = 2.5;     // si a la locución le quedan menos segundos de canción que esto, se emite en el hueco
const ESPERA_DJ_MAX_MS = 12000;

// ---------------------------------------------------------------------------
// Textos (es / en)
// ---------------------------------------------------------------------------
const TXT = {
  es: {
    tabCrear: 'Crear', tabCola: 'Cola', tabGuardadas: 'Guardadas',
    promptLabel: '¿Qué quieres escuchar?', promptPlaceholder: 'Ej.: es por la mañana y quiero empezar el día con música energizante',
    cantidad: 'Canciones', djHabla: 'El DJ habla', cadaCancion: 'Cada canción', cada2: 'Cada 2 canciones', cada3: 'Cada 3 canciones',
    voz: 'Voz del DJ', vozEsF: 'Español · mujer', vozEsM: 'Español · hombre', vozEnF: 'English · woman', vozEnM: 'English · man',
    ambienteLabel: 'Pedido para el DJ (opcional)', ambientePlaceholder: 'Ej.: estoy en una cena romántica',
    usarUbicacion: 'Usar mi ubicación para el clima', crear: 'Crear y reproducir', pensando: 'Pensando la lista…',
    sinLista: 'Crea una lista para empezar', colaVacia: 'Aún no hay lista. Créala en la pestaña Crear.',
    guardar: 'Guardar lista', guardada: 'Guardada ✓', sinGuardadas: 'Todavía no has guardado listas.',
    notaGuardadas: 'Las listas se guardan en este navegador, con los vídeos ya encontrados: volver a ponerlas no gasta cuota de YouTube.',
    reproducir: 'Reproducir', borrar: 'Borrar', canciones: 'canciones',
    mostrarVideo: 'Mostrar vídeo', ocultarVideo: 'Ocultar vídeo',
    probarVoz: '🔊 Probar la voz del DJ', probando: 'Generando una locución de prueba…', pruebaFallo: 'La prueba falló:',
    pruebaBloqueada: 'El navegador bloqueó el sonido. Toca la pantalla y vuelve a probar.',
    pruebaSuena: 'Suena: «{g}». Si no la oyes, sube el volumen del dispositivo (en iPhone, quita el modo silencio).',
    errDj: 'El DJ no pudo preparar su intervención: {m}. Mira los logs de Render para ver el detalle.',
    djOn: 'DJ activado', djOff: 'DJ desactivado', djNoDisponible: 'DJ no disponible',
    anterior: 'Anterior', siguiente: 'Siguiente', reproducirPausa: 'Reproducir / pausa', volumen: 'Volumen',
    tocarContinuar: '▶ Toca para continuar',
    codigoTitulo: 'Código de acceso', codigoPlaceholder: 'Código', codigoEntrar: 'Entrar', codigoMal: 'Código incorrecto',
    notaMovil: 'En el móvil, YouTube detiene el sonido si bloqueas la pantalla o cambias de app. Mientras suena, la pantalla se mantiene encendida.',
    bReposo: 'DJ en espera', bBuscando: 'Buscando en YouTube…', bPreparando: 'El DJ prepara su intervención…', bListo: 'DJ listo ({s} s)',
    bAlAire: 'DJ al aire', bSiguiente: 'Siguiente canción', bErrGenerar: 'No se pudo preparar la locución', bPulsaDj: 'Pulsa DJ para activar el audio',
    bEsperandoDj: 'El DJ está terminando de preparar…', bFinLista: 'Fin de la lista', bProbando: 'Probando otra versión…',
    noEncontrada: 'No encontrada en YouTube: {t}', noReproducible: 'YouTube no deja reproducir: {t}',
    errCuota: 'Se agotó la cuota diaria de YouTube. Se reinicia a medianoche (hora del Pacífico). Las listas guardadas con vídeos ya encontrados siguen funcionando.',
    errGenerico: 'Algo falló: {m}', falta: 'Falta configurar en el servidor: {k}',
    avisoSinVoz: 'El DJ está desactivado: el servidor no tiene GEMINI_API_KEY o ELEVENLABS_API_KEY.',
  },
  en: {
    tabCrear: 'Create', tabCola: 'Queue', tabGuardadas: 'Saved',
    promptLabel: 'What do you want to listen to?', promptPlaceholder: 'E.g.: it is morning and I want to start the day with energetic music',
    cantidad: 'Songs', djHabla: 'DJ speaks', cadaCancion: 'Every song', cada2: 'Every 2 songs', cada3: 'Every 3 songs',
    voz: 'DJ voice', vozEsF: 'Español · mujer', vozEsM: 'Español · hombre', vozEnF: 'English · woman', vozEnM: 'English · man',
    ambienteLabel: 'Request for the DJ (optional)', ambientePlaceholder: 'E.g.: I am having a romantic dinner',
    usarUbicacion: 'Use my location for the weather', crear: 'Create and play', pensando: 'Thinking up the list…',
    sinLista: 'Create a list to start', colaVacia: 'No list yet. Create one in the Create tab.',
    guardar: 'Save list', guardada: 'Saved ✓', sinGuardadas: 'You have not saved any lists yet.',
    notaGuardadas: 'Lists are saved in this browser together with the videos already found, so replaying them costs no YouTube quota.',
    reproducir: 'Play', borrar: 'Delete', canciones: 'songs',
    mostrarVideo: 'Show video', ocultarVideo: 'Hide video',
    probarVoz: '🔊 Test the DJ voice', probando: 'Generating a test link…', pruebaFallo: 'The test failed:',
    pruebaBloqueada: 'The browser blocked the sound. Tap the screen and try again.',
    pruebaSuena: 'Playing: "{g}". If you cannot hear it, raise the device volume (on iPhone, turn off silent mode).',
    errDj: 'The DJ could not prepare the link: {m}. Check the Render logs for details.',
    djOn: 'DJ on', djOff: 'DJ off', djNoDisponible: 'DJ unavailable',
    anterior: 'Previous', siguiente: 'Next', reproducirPausa: 'Play / pause', volumen: 'Volume',
    tocarContinuar: '▶ Tap to continue',
    codigoTitulo: 'Access code', codigoPlaceholder: 'Code', codigoEntrar: 'Enter', codigoMal: 'Wrong code',
    notaMovil: 'On mobile, YouTube stops the sound if you lock the screen or switch apps. While playing, the screen stays on.',
    bReposo: 'DJ standing by', bBuscando: 'Searching YouTube…', bPreparando: 'The DJ is preparing the link…', bListo: 'DJ ready ({s} s)',
    bAlAire: 'DJ on air', bSiguiente: 'Next song', bErrGenerar: 'Could not prepare the link', bPulsaDj: 'Press DJ to enable audio',
    bEsperandoDj: 'The DJ is almost ready…', bFinLista: 'End of the list', bProbando: 'Trying another version…',
    noEncontrada: 'Not found on YouTube: {t}', noReproducible: 'YouTube will not play: {t}',
    errCuota: 'The daily YouTube quota is used up. It resets at midnight (Pacific time). Saved lists with videos already found still work.',
    errGenerico: 'Something failed: {m}', falta: 'Not configured on the server: {k}',
    avisoSinVoz: 'The DJ is off: the server has no GEMINI_API_KEY or ELEVENLABS_API_KEY.',
  },
};

let idioma = 'es';
const t = (k, v = {}) => (TXT[idioma][k] ?? TXT.es[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '');
function aplicarIdioma() {
  document.documentElement.lang = idioma;
  document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(e => { e.placeholder = t(e.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-aria]').forEach(e => { e.setAttribute('aria-label', t(e.dataset.i18nAria)); });
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('activo', b.dataset.lang === idioma));
  pintarBtnDj(); pintarCola(); pintarGuardadas(); pintarActual(); pintarVideo(); setBadge(badgeActual, badgeVars);
}

// ---------------------------------------------------------------------------
// Ajustes guardados en el navegador
// ---------------------------------------------------------------------------
const leerJson = (clave, def) => { try { return JSON.parse(localStorage.getItem(clave)) ?? def; } catch { return def; } };
const guardarJson = (clave, valor) => { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin espacio o modo privado */ } };
const AJ = Object.assign({ idioma: (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en', voz: null, freq: 1, cantidad: 20, dj: true, ambiente: '', ubicacion: false, video: false, codigo: '' }, leerJson('vt_ajustes', {}));
const guardarAjustes = () => guardarJson('vt_ajustes', AJ);
const idSesion = (() => { let s = localStorage.getItem('vt_sesion'); if (!s) { s = crypto.randomUUID().replace(/-/g, '').slice(0, 20); try { localStorage.setItem('vt_sesion', s); } catch { /* ok */ } } return s; })();

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const S = {
  cola: [],          // { titulo, artista, cand: null | [{id,titulo,canal,duracion}], ci, estado: 'pend'|'ok'|'nf'|'err', fallos, promesa }
  idx: -1,           // canción actual
  proximo: null,     // índice de la siguiente canción que SÍ se puede reproducir (el DJ la presenta)
  id: null, nombre: '', descripcion: '',
  token: 0,          // cambia con cada canción: invalida las tareas asíncronas de la anterior
  tokenIniciado: -1,
  estadoYt: -1,
  djActivo: true,
  freq: 1,
  vol: 100,
  hablando: false, esperandoVoz: false, timersVoz: [], revelado: false, avisoDj: false,
  dj: nuevoDj(),
  errYt: null,       // último error grave de YouTube (cuota, clave...)
  fade: null,
};
function nuevoDj() { return { estado: 'idle', url: null, dur: 0, guion: '', fallos: 0 }; }
function soltarDj() { if (S.dj.url) { try { URL.revokeObjectURL(S.dj.url); } catch { /* ok */ } S.dj.url = null; } }
const CONF = { requiereCodigo: false, youtube: true, gemini: true, voz: true };

// ---------------------------------------------------------------------------
// Avisos y mensajes
// ---------------------------------------------------------------------------
function aviso(texto, { error = false, fijo = false } = {}) {
  const div = document.createElement('div');
  div.className = 'aviso' + (error ? ' error' : '');
  const span = document.createElement('span'); span.textContent = texto;
  const x = document.createElement('button'); x.textContent = '✕'; x.setAttribute('aria-label', '✕');
  x.onclick = () => div.remove();
  div.append(span, x);
  $('avisos').append(div);
  if (!fijo) setTimeout(() => div.remove(), 9000);
  return div;
}
let badgeActual = 'bReposo', badgeVars = {};
function setBadge(clave, vars = {}) { badgeActual = clave; badgeVars = vars; $('djBadge').textContent = t(clave, vars); }
function badgeReposo() { if (!S.hablando && S.dj.estado !== 'preparando') setBadge('bReposo'); }

// ---------------------------------------------------------------------------
// API del servidor
// ---------------------------------------------------------------------------
async function api(ruta, cuerpo, { timeout = 60000 } = {}) {
  const r = await fetch(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-codigo': AJ.codigo || '' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(timeout),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && d.codigo === 'CODIGO') { pedirCodigo(true); throw Object.assign(new Error(d.error || 'Código incorrecto'), { codigo: 'CODIGO' }); }
  if (!r.ok || d.success === false) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { codigo: d.codigo, status: r.status, detalle: d.detalle });
  return d;
}

function pedirCodigo(mal = false) {
  $('overlayCodigo').hidden = false;
  $('codigoError').textContent = mal ? t('codigoMal') : '';
  $('inputCodigo').focus();
}
async function validarCodigo() {
  AJ.codigo = $('inputCodigo').value.trim();
  const r = await fetch('/api/auth', { headers: { 'x-codigo': AJ.codigo } });
  if (r.ok) { guardarAjustes(); $('overlayCodigo').hidden = true; return true; }
  $('codigoError').textContent = t('codigoMal');
  return false;
}

// ---------------------------------------------------------------------------
// Reproductor de YouTube (IFrame Player API, el oficial)
// ---------------------------------------------------------------------------
let player = null, playerListo = false;
const YT_ENDED = 0, YT_PLAYING = 1, YT_PAUSED = 2, YT_BUFFERING = 3;

function cargarApiYoutube() {
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('ytPlayer', {
      width: '100%', height: '100%',
      playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, enablejsapi: 1, origin: location.origin },
      events: { onReady: () => { playerListo = true; player.setVolume(S.vol); if (S.alListo) { const f = S.alListo; S.alListo = null; f(); } }, onStateChange: alCambiarEstado, onError: alErrorYoutube },
    });
  };
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
  s.onerror = () => aviso('No se pudo cargar el reproductor de YouTube. / Could not load the YouTube player.', { error: true, fijo: true });
  document.head.append(s);
}
const cuandoListo = (f) => (playerListo ? f() : (S.alListo = f));

function cargarVideo(id) {
  const tok = S.token;
  cuandoListo(() => {
    if (tok !== S.token) return;
    player.loadVideoById(id);
    player.setVolume(S.vol);
  });
  // Si el navegador bloquea el inicio automático (típico en iPhone), se ofrece un toque para continuar
  clearTimeout(S.tEspera);
  S.tEspera = setTimeout(() => {
    if (tok !== S.token || S.estadoYt === YT_PLAYING || S.estadoYt === YT_BUFFERING) return;
    $('btnTocar').hidden = false;
    S.revelado = true; pintarVideo(); // en iPhone a veces hay que tocar el propio reproductor: se deja a la vista
  }, 4500);
}

function alCambiarEstado(e) {
  S.estadoYt = e.data;
  if (e.data === YT_PLAYING) {
    $('btnTocar').hidden = true; clearTimeout(S.tEspera);
    if (S.revelado) { S.revelado = false; pintarVideo(); }
    pintarPlay(true); mantenerPantalla(true);
    if (S.tokenIniciado !== S.token) { S.tokenIniciado = S.token; alEmpezarCancion(); }
  } else if (e.data === YT_PAUSED) { pintarPlay(false); }
  else if (e.data === YT_ENDED) { pintarPlay(false); alTerminarCancion(); }
}

// Códigos de error del reproductor: 2 id no válido, 5 error de HTML5, 100 borrado/privado, 101/150/153 sin permiso para incrustar
function alErrorYoutube() {
  const c = S.cola[S.idx];
  if (!c) return;
  if (c.cand && c.ci + 1 < c.cand.length) { c.ci++; pintarMiniatura(); setBadge('bProbando'); cargarVideo(c.cand[c.ci].id); return; }
  c.estado = 'err'; pintarCola();
  aviso(t('noReproducible', { t: c.titulo }), { error: true });
  detenerVoz();
  reproducir(S.proximo ?? S.idx + 1);
}

// ---------------------------------------------------------------------------
// Resolver canciones -> vídeos (el servidor busca en YouTube; solo las próximas, para ahorrar cuota)
// ---------------------------------------------------------------------------
function resolverDesde(i, n = 3) {
  const pend = [];
  for (let j = i; j < Math.min(S.cola.length, i + n); j++) {
    const c = S.cola[j];
    if (c.cand === null && !c.promesa && c.fallos < 2) pend.push(j);
  }
  if (pend.length) {
    const lista = S.cola; // por si cambia la lista mientras se busca
    const p = api('/api/resolver', { canciones: pend.map(j => ({ titulo: lista[j].titulo, artista: lista[j].artista })) }, { timeout: 30000 })
      .then(r => {
        pend.forEach((j, k) => {
          const res = r.resultados?.[k];
          if (Array.isArray(res)) lista[j].cand = res; else lista[j].fallos++;
        });
        if (lista === S.cola) guardarListaActual();
      })
      .catch(e => { S.errYt = e; pend.forEach(j => { lista[j].fallos++; }); })
      .finally(() => pend.forEach(j => { delete lista[j].promesa; }));
    pend.forEach(j => { lista[j].promesa = p; });
  }
  return S.cola[i]?.promesa ?? Promise.resolve();
}
const errorFatalYt = () => S.errYt && ['CUOTA', 'CLAVE', 'SIN_CLAVE', 'CODIGO'].includes(S.errYt.codigo);

function avisarErrorYt(e) {
  if (e?.codigo === 'CUOTA') aviso(t('errCuota'), { error: true, fijo: true });
  else if (e?.codigo === 'CODIGO') pedirCodigo(true);
  else aviso(t('errGenerico', { m: e?.message || '' }), { error: true });
}

// ---------------------------------------------------------------------------
// Reproducir una canción de la cola
// ---------------------------------------------------------------------------
async function reproducir(i) {
  detenerVoz();
  if (i < 0) i = 0;
  if (i >= S.cola.length) { S.token++; S.proximo = null; setBadge('bFinLista'); pintarPlay(false); try { player?.stopVideo(); } catch { /* ok */ } return; }
  const tok = ++S.token;
  S.idx = i; S.proximo = null; soltarDj(); S.dj = nuevoDj(); S.estadoYt = -1; S.esperandoVoz = false;
  $('btnTocar').hidden = true;
  const c = S.cola[i];
  pintarCola(); pintarActual(); setBadge('bBuscando');

  await resolverDesde(i, 3);
  if (tok !== S.token) return;
  if (c.cand === null) {
    if (errorFatalYt()) { avisarErrorYt(S.errYt); S.errYt = null; setBadge('bReposo'); return; }
    c.estado = 'err'; pintarCola(); return reproducir(i + 1);
  }
  if (!c.cand.length) { c.estado = 'nf'; pintarCola(); aviso(t('noEncontrada', { t: `${c.titulo} — ${c.artista}` })); return reproducir(i + 1); }

  c.estado = 'ok'; c.ci = Math.min(c.ci, c.cand.length - 1);
  pintarCola(); pintarActual(); badgeReposo();
  cargarVideo(c.cand[c.ci].id);
  resolverDesde(i + 1, 3); // las siguientes se buscan mientras suena esta
}

// Cuando una canción empieza a sonar de verdad: se fija la siguiente y, si toca, se prepara al DJ
async function alEmpezarCancion() {
  const tok = S.token;
  const c = S.cola[S.idx];
  actualizarMediaSession(c);
  const j = await fijarProximo(tok);
  if (tok !== S.token || j === null) return;
  if (djDebeHablar()) prepararDj(tok);
}

async function fijarProximo(tok) {
  let j = S.idx + 1;
  while (j < S.cola.length) {
    await resolverDesde(j, 3);
    if (tok !== S.token) return null;
    const c = S.cola[j];
    if (c.cand?.length) { S.proximo = j; return j; }
    if (c.cand === null && errorFatalYt()) return null;   // al llegar su turno se avisará
    c.estado = c.cand === null ? 'err' : 'nf'; pintarCola();
    j++;
  }
  S.proximo = S.cola.length; // no queda nada reproducible: fin de la lista
  return null;
}

function irSiguiente() { reproducir(S.proximo ?? S.idx + 1); }

// ---------------------------------------------------------------------------
// DJ: preparar la locución y emitirla
// ---------------------------------------------------------------------------
const djDebeHablar = () => S.djActivo && CONF.voz && CONF.gemini && S.proximo !== null && S.proximo < S.cola.length && ((S.idx + 1) % S.freq === 0);

// La voz del DJ suena por un elemento <audio> (no por Web Audio): los navegadores móviles lo toleran mucho mejor junto al
// reproductor de YouTube. Hay que "desbloquearlo" con un toque del usuario; se intenta en cada toque hasta que lo consigue.
const djAudio = $('djAudio'), pruebaAudio = $('pruebaAudio');
let audioDesbloqueado = false;
function wavSilencio() { // 0,1 s de silencio, solo para desbloquear los elementos de audio
  const n = 800, b = new Uint8Array(44 + n), dv = new DataView(b.buffer);
  const w = (o, txt) => [...txt].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, n, true);
  b.fill(128, 44);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function asegurarAudio() {
  try { if (ES_IOS && 'audioSession' in navigator) navigator.audioSession.type = 'playback'; } catch { /* opcional */ }
  if (audioDesbloqueado) return;
  audioDesbloqueado = true;
  const silencio = wavSilencio();
  const abrir = (el) => {
    el.src = silencio; el.muted = true;
    el.play().then(() => { el.pause(); el.muted = false; }).catch(() => { el.muted = false; audioDesbloqueado = false; });
  };
  abrir(pruebaAudio);
  if (!['listo', 'hablando'].includes(S.dj.estado)) abrir(djAudio); // no pisar una locución ya preparada
}
['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, () => asegurarAudio(), { passive: true }));

/** Carga un audio en un elemento y devuelve su duración en segundos. */
function cargarEnElemento(el, url, bytes) {
  return new Promise((ok, ko) => {
    const limite = setTimeout(() => ko(new Error('el audio tardó demasiado en cargar')), 10000);
    el.onloadedmetadata = () => { clearTimeout(limite); const d = el.duration; ok(Number.isFinite(d) && d > 0 ? d : (bytes * 8) / 128000); };
    el.onerror = () => { clearTimeout(limite); ko(new Error('el navegador no pudo leer el audio del DJ')); };
    el.src = url; el.load();
  });
}
const urlDeBase64 = (b64) => {
  const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  return { url: URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })), bytes: bytes.length };
};

function ubicacion() {
  return AJ.ubicacion && S.ubic ? S.ubic : null;
}

async function prepararDj(tok) {
  const dj = S.dj;
  if (dj.estado !== 'idle') return;
  dj.estado = 'preparando'; setBadge('bPreparando');
  const anterior = S.cola[S.idx], siguiente = S.cola[S.proximo];
  try {
    const res = await api('/api/locucion', {
      anterior: { titulo: anterior.titulo, artista: anterior.artista },
      siguiente: { titulo: siguiente.titulo, artista: siguiente.artista },
      ambiente: AJ.ambiente, ubicacion: ubicacion(), voz: AJ.voz, sesion: idSesion,
    }, { timeout: 60000 });
    if (tok !== S.token) return;
    asegurarAudio();
    const { url, bytes } = urlDeBase64(res.audioBase64);
    let dur;
    try { dur = await cargarEnElemento(djAudio, url, bytes); } catch (err) { URL.revokeObjectURL(url); throw err; }
    if (tok !== S.token || !S.djActivo) { URL.revokeObjectURL(url); if (tok === S.token) dj.estado = 'idle'; return; } // cambió la canción, o apagaron el DJ mientras se preparaba
    Object.assign(dj, { estado: 'listo', url, dur, guion: res.guion });
    setBadge('bListo', { s: Math.round(dur) });
  } catch (e) {
    if (tok !== S.token) return;
    dj.estado = 'error'; dj.fallos++;
    console.warn('[DJ] preparación fallida:', e.message);
    setBadge('bErrGenerar');
    if (!S.avisoDj) { S.avisoDj = true; aviso(t('errDj', { m: `${e.detalle ? e.detalle + ' · ' : ''}${e.message}` }), { error: true, fijo: true }); }
    if (e.codigo === 'SIN_VOZ') { CONF.voz = false; pintarBtnDj(); return; }
    if (dj.fallos < 2 && e.codigo !== 'LIMITE') setTimeout(() => { if (tok === S.token && dj.estado === 'error') { dj.estado = 'idle'; prepararDj(tok); } }, 8000);
  }
}

const modoSolape = () => !ES_IOS; // en iPhone el volumen del reproductor no se puede cambiar: la voz va en el hueco entre canciones

function fundir(desde, hasta, ms) {
  clearInterval(S.fade);
  const t0 = performance.now();
  const paso = () => {
    const x = Math.min(1, (performance.now() - t0) / ms);
    const curva = x * x * (3 - 2 * x);
    try { player?.setVolume(Math.round(desde + (hasta - desde) * curva)); } catch { /* ok */ }
    if (x >= 1) clearInterval(S.fade);
  };
  paso();
  S.fade = setInterval(paso, 50);
}

async function iniciarVoz({ solape }) {
  const dj = S.dj, tok = S.token;
  if (S.hablando || !dj.url || dj.estado !== 'listo') return false;
  S.hablando = true; dj.estado = 'hablando';
  setBadge('bAlAire');
  $('djScript').textContent = `"${dj.guion}"`;
  if (solape) { fundir(S.vol, S.vol * DUCK, BAJADA_MS); await esperar(RETRASO_VOZ_S * 1000); }
  if (tok !== S.token || !S.hablando) return false;

  djAudio.onended = () => finVoz(tok);
  djAudio.currentTime = 0; djAudio.volume = 1;
  try { await djAudio.play(); }
  catch (e) { // el navegador no deja sonar sin un toque del usuario: se descarta esta locución y la música sigue
    console.warn('[DJ] reproducción bloqueada:', e.message);
    if (tok !== S.token) return false;
    S.hablando = false; dj.estado = 'descartada'; clearInterval(S.fade);
    try { player?.setVolume(S.vol); } catch { /* ok */ }
    setBadge('bPulsaDj');
    return false;
  }
  if (tok !== S.token) { djAudio.pause(); return false; }
  if (solape) S.timersVoz.push(setTimeout(() => { if (tok === S.token) fundir(S.vol * DUCK, S.vol, SUBIDA_MS); }, Math.max(0, (dj.dur - SUBIDA_ANTES_S) * 1000)));
  S.timersVoz.push(setTimeout(() => finVoz(tok), dj.dur * 1000 + 4000)); // red de seguridad por si 'ended' no llega
  return true;
}

function finVoz(tok) {
  if (tok !== S.token || !S.hablando) return;
  S.hablando = false; S.dj.estado = 'hecha';
  S.timersVoz.forEach(clearTimeout); S.timersVoz = [];
  djAudio.onended = null;
  clearInterval(S.fade);
  try { player?.setVolume(S.vol); } catch { /* ok */ }
  setBadge('bSiguiente');
  if (S.esperandoVoz) { S.esperandoVoz = false; irSiguiente(); }
}

/** Corta la locución en curso (al cambiar de canción a mano) y devuelve el volumen. */
function detenerVoz() {
  S.timersVoz.forEach(clearTimeout); S.timersVoz = [];
  clearInterval(S.fade);
  djAudio.onended = null; try { djAudio.pause(); } catch { /* ok */ }
  S.hablando = false; S.esperandoVoz = false;
  try { player?.setVolume(S.vol); } catch { /* ok */ }
}

// Fin de la canción: si la voz ya está sonando se espera a que acabe; si está lista, suena en el hueco; si se está preparando, se espera un poco
async function alTerminarCancion() {
  const tok = S.token;
  if (S.hablando) { S.esperandoVoz = true; return; }
  if (S.dj.estado === 'preparando') {
    setBadge('bEsperandoDj');
    const t0 = performance.now();
    while (S.dj.estado === 'preparando' && performance.now() - t0 < ESPERA_DJ_MAX_MS) { await esperar(250); if (tok !== S.token) return; }
  }
  if (tok !== S.token) return;
  if (S.djActivo && S.dj.estado === 'listo') { S.esperandoVoz = true; if (await iniciarVoz({ solape: false })) return; S.esperandoVoz = false; }
  irSiguiente();
}

// ---------------------------------------------------------------------------
// Reloj: progreso y momento de entrar la voz sobre el final de la canción
// ---------------------------------------------------------------------------
const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let ultimaPos = 0, ultimaDur = 0, arrastrando = false;

function tick() {
  if (!playerListo || S.idx < 0) return;
  let pos = 0, dur = 0;
  try { pos = player.getCurrentTime() || 0; dur = player.getDuration() || 0; } catch { return; }
  ultimaPos = pos; ultimaDur = dur;
  if (!arrastrando) {
    $('tActual').textContent = fmt(pos); $('tTotal').textContent = fmt(dur);
    $('relleno').style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0%';
  }
  const dj = S.dj;
  if (S.djActivo && dj.estado === 'listo' && !S.hablando && dur > 0 && S.estadoYt === YT_PLAYING && modoSolape()) {
    const resta = dur - pos;
    if (resta <= dj.dur + ANTICIPACION_S + RETRASO_VOZ_S && resta > MIN_SOLAPE_S) iniciarVoz({ solape: true });
    // Si queda menos que MIN_SOLAPE_S es tarde para solapar: la voz sonará en el hueco, al terminar la canción
  }
}
setInterval(tick, 250);

$('barra').addEventListener('pointerdown', (e) => {
  if (!ultimaDur || S.hablando) return;
  const r = $('barra').getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  try { player.seekTo(frac * ultimaDur, true); } catch { /* ok */ }
});

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------
const ICONO_PLAY = '<path d="M8 5v14l11-7z"/>', ICONO_PAUSA = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
function pintarPlay(sonando) { $('iconoPlay').innerHTML = sonando ? ICONO_PAUSA : ICONO_PLAY; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = sonando ? 'playing' : 'paused'; }

function alternarPlay() {
  asegurarAudio();
  if (!playerListo || S.idx < 0) return;
  if (S.hablando) { // en pleno DJ: se pausan la voz y la canción juntas (si la canción ya terminó, solo la voz)
    if (!djAudio.paused) { djAudio.pause(); if (S.estadoYt !== YT_ENDED) player.pauseVideo(); pintarPlay(false); }
    else { djAudio.play().catch(() => {}); if (S.estadoYt !== YT_ENDED) player.playVideo(); pintarPlay(true); }
    return;
  }
  const st = player.getPlayerState();
  if (st === YT_PLAYING || st === YT_BUFFERING) player.pauseVideo(); else player.playVideo();
}
$('btnPlay').onclick = alternarPlay;
$('btnTocar').onclick = () => {
  asegurarAudio(); $('btnTocar').hidden = true;
  try { player.playVideo(); } catch { /* ok */ }
  // si el navegador sigue sin arrancar, se quita el botón para poder tocar el propio reproductor (ya visible)
  setTimeout(() => { if (S.estadoYt !== YT_PLAYING && S.estadoYt !== YT_BUFFERING) { S.revelado = true; pintarVideo(); } }, 1500);
};
$('btnNext').onclick = () => { asegurarAudio(); if (S.cola.length) reproducir(S.idx + 1); };
$('btnPrev').onclick = () => { asegurarAudio(); if (ultimaPos > 4) { try { player.seekTo(0, true); } catch { /* ok */ } } else if (S.cola.length) reproducir(S.idx - 1); };
$('rangoVol').oninput = (e) => { S.vol = Number(e.target.value); if (!S.hablando) { try { player?.setVolume(S.vol); } catch { /* ok */ } } };

function pintarBtnDj() {
  const b = $('btnDj');
  const disponible = CONF.voz && CONF.gemini;
  b.disabled = !disponible;
  b.classList.toggle('on', S.djActivo && disponible);
  $('btnDjTxt').textContent = !disponible ? t('djNoDisponible') : t(S.djActivo ? 'djOn' : 'djOff');
}
$('btnDj').onclick = () => {
  S.djActivo = !S.djActivo; AJ.dj = S.djActivo; guardarAjustes();
  if (S.djActivo) asegurarAudio();
  pintarBtnDj();
  // Si se activa a mitad de canción, se prepara la locución para el siguiente cambio
  if (S.djActivo && S.idx >= 0 && S.dj.estado === 'idle' && djDebeHablar()) prepararDj(S.token);
  if (!S.djActivo && !S.hablando && S.dj.estado !== 'hablando') { soltarDj(); S.dj.estado = 'idle'; setBadge('bReposo'); }
};

// ---------------------------------------------------------------------------
// Pantalla encendida y controles del sistema (móvil)
// ---------------------------------------------------------------------------
let wake = null;
async function mantenerPantalla(activar) {
  if (!ES_MOVIL || !('wakeLock' in navigator)) return;
  try {
    if (activar && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    else if (!activar && wake) { await wake.release(); wake = null; }
  } catch { /* sin permiso */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.estadoYt === YT_PLAYING) mantenerPantalla(true); });

function actualizarMediaSession(c) {
  if (!('mediaSession' in navigator) || !c) return;
  const id = c.cand?.[c.ci]?.id;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: c.titulo, artist: c.artista, album: S.nombre || 'Velvet Tube',
      artwork: id ? [{ src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', alternarPlay);
    navigator.mediaSession.setActionHandler('pause', alternarPlay);
    navigator.mediaSession.setActionHandler('nexttrack', () => $('btnNext').click());
    navigator.mediaSession.setActionHandler('previoustrack', () => $('btnPrev').click());
  } catch { /* navegador sin soporte completo */ }
}

// ---------------------------------------------------------------------------
// Pintar interfaz
// ---------------------------------------------------------------------------
function pintarVideo() {
  $('portada').classList.toggle('oculta', !AJ.video && !S.revelado);
  $('btnVideo').textContent = t(AJ.video ? 'ocultarVideo' : 'mostrarVideo');
}
$('btnVideo').onclick = () => { AJ.video = !AJ.video; S.revelado = false; guardarAjustes(); pintarVideo(); };

function pintarMiniatura() {
  const c = S.cola[S.idx], id = c?.cand?.[c.ci]?.id, m = $('miniatura');
  m.style.backgroundImage = id ? `url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)` : 'url(/logo.png)';
  m.style.backgroundSize = id ? 'cover' : 'contain';
}

function pintarActual() {
  const c = S.cola[S.idx];
  pintarMiniatura();
  $('titulo').textContent = c ? c.titulo : '—';
  $('artista').textContent = c ? c.artista : t('sinLista');
}

function pintarCola() {
  const ol = $('listaCola');
  ol.replaceChildren();
  $('colaVacia').hidden = S.cola.length > 0;
  $('colaNombre').textContent = S.nombre;
  $('colaDesc').textContent = S.descripcion;
  $('btnGuardar').hidden = !S.cola.length;
  $('btnGuardar').textContent = estaGuardada() ? t('guardada') : t('guardar');
  S.cola.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = (i === S.idx ? 'actual ' : '') + (c.estado === 'nf' || c.estado === 'err' ? 'fallo' : '');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = i === S.idx ? '▶' : String(i + 1);
    const info = document.createElement('div'); info.className = 'info';
    const tt = document.createElement('div'); tt.className = 't'; tt.textContent = c.titulo;
    const aa = document.createElement('div'); aa.className = 'a'; aa.textContent = c.artista;
    info.append(tt, aa);
    const m = document.createElement('span'); m.className = 'marca-estado';
    m.textContent = c.estado === 'nf' || c.estado === 'err' ? '✕' : '';
    li.append(n, info, m);
    li.onclick = () => { asegurarAudio(); reproducir(i); };
    ol.append(li);
  });
  ol.querySelector('.actual')?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------------------
// Listas guardadas (localStorage). Se guardan los vídeos ya encontrados: volver a ponerlas no gasta cuota.
// ---------------------------------------------------------------------------
const MAX_GUARDADAS = 30;
let guardadas = leerJson('vt_listas', []);
const estaGuardada = () => !!S.id && guardadas.some(l => l.id === S.id);

function serializarCola() {
  return S.cola.map(c => ({ titulo: c.titulo, artista: c.artista, cand: c.cand ? c.cand.slice(0, 2) : null }));
}
function guardarListaActual({ nueva = false } = {}) {
  if (!S.id) return;
  const i = guardadas.findIndex(l => l.id === S.id);
  if (i < 0 && !nueva) return; // solo se actualiza lo que el usuario guardó
  const entrada = { id: S.id, nombre: S.nombre, descripcion: S.descripcion, ts: Date.now(), canciones: serializarCola() };
  if (i >= 0) guardadas[i] = entrada; else guardadas.unshift(entrada);
  guardadas = guardadas.slice(0, MAX_GUARDADAS);
  guardarJson('vt_listas', guardadas);
  pintarGuardadas(); pintarCola();
}
$('btnGuardar').onclick = () => guardarListaActual({ nueva: true });

function pintarGuardadas() {
  const ul = $('listaGuardadas');
  ul.replaceChildren();
  $('guardadasVacio').hidden = guardadas.length > 0;
  for (const l of guardadas) {
    const li = document.createElement('li');
    const info = document.createElement('div'); info.className = 'info';
    const tt = document.createElement('div'); tt.className = 't'; tt.textContent = l.nombre;
    const aa = document.createElement('div'); aa.className = 'a'; aa.textContent = `${l.canciones.length} ${t('canciones')}`;
    info.append(tt, aa);
    const bp = document.createElement('button'); bp.className = 'play'; bp.textContent = t('reproducir');
    bp.onclick = () => { asegurarAudio(); cargarLista({ id: l.id, nombre: l.nombre, descripcion: l.descripcion, canciones: l.canciones }); };
    const bb = document.createElement('button'); bb.textContent = t('borrar');
    bb.onclick = () => { guardadas = guardadas.filter(x => x.id !== l.id); guardarJson('vt_listas', guardadas); pintarGuardadas(); pintarCola(); };
    li.append(info, bp, bb);
    ul.append(li);
  }
}

function cargarLista({ id, nombre, descripcion, canciones }) {
  S.errYt = null; S.avisoDj = false;
  S.id = id; S.nombre = nombre; S.descripcion = descripcion;
  S.cola = canciones.map(c => ({ titulo: c.titulo, artista: c.artista, cand: Array.isArray(c.cand) ? c.cand : null, ci: 0, estado: 'pend', fallos: 0 }));
  S.idx = -1; $('djScript').textContent = '';
  mostrarTab('cola');
  reproducir(0);
}

// ---------------------------------------------------------------------------
// Crear una lista con IA
// ---------------------------------------------------------------------------
async function crearLista() {
  const prompt = $('inputPrompt').value.trim();
  const estado = $('estadoCrear');
  estado.classList.remove('error');
  if (prompt.length < 3) { estado.textContent = TXT[idioma].promptLabel; estado.classList.add('error'); return; }
  const btn = $('btnCrear');
  btn.disabled = true; estado.textContent = t('pensando');
  asegurarAudio(); // aprovecha el clic para desbloquear el audio del navegador
  try {
    const r = await api('/api/lista', { prompt, cantidad: Number($('selCantidad').value), idioma }, { timeout: 70000 });
    estado.textContent = '';
    cargarLista({ id: crypto.randomUUID(), nombre: r.nombre, descripcion: r.descripcion, canciones: r.canciones });
    guardarListaActual({ nueva: true });
  } catch (e) {
    estado.textContent = e.message; estado.classList.add('error');
  } finally { btn.disabled = false; }
}
$('btnCrear').onclick = crearLista;

// Prueba aislada de la voz del DJ (Gemini + ElevenLabs + audio del navegador) sin esperar a una transición
async function probarVoz() {
  const btn = $('btnProbarVoz'), est = $('estadoVoz');
  est.classList.remove('error');
  if (!CONF.voz || !CONF.gemini) { est.textContent = t('avisoSinVoz'); est.classList.add('error'); return; }
  asegurarAudio();
  btn.disabled = true; est.textContent = t('probando');
  try {
    const res = await api('/api/locucion', {
      anterior: { titulo: 'Bohemian Rhapsody', artista: 'Queen' }, siguiente: { titulo: 'Hotel California', artista: 'Eagles' },
      ambiente: AJ.ambiente, ubicacion: ubicacion(), voz: AJ.voz, sesion: idSesion,
    }, { timeout: 60000 });
    const { url, bytes } = urlDeBase64(res.audioBase64);
    await cargarEnElemento(pruebaAudio, url, bytes);
    pruebaAudio.onended = () => URL.revokeObjectURL(url);
    pruebaAudio.currentTime = 0; pruebaAudio.volume = 1;
    await pruebaAudio.play();
    est.textContent = t('pruebaSuena', { g: res.guion });
  } catch (e) {
    est.textContent = e.name === 'NotAllowedError' ? t('pruebaBloqueada') : `${t('pruebaFallo')} ${e.detalle ? e.detalle + ' · ' : ''}${e.message}`;
    est.classList.add('error');
  } finally { btn.disabled = false; }
}
$('btnProbarVoz').onclick = probarVoz;

// ---------------------------------------------------------------------------
// Pestañas, idioma y ajustes
// ---------------------------------------------------------------------------
function mostrarTab(nombre) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('activo', b.dataset.tab === nombre));
  document.querySelectorAll('.vista').forEach(v => { v.hidden = v.id !== `vista-${nombre}`; });
}
document.querySelectorAll('.tab').forEach(b => { b.onclick = () => mostrarTab(b.dataset.tab); });
document.querySelectorAll('.lang-btn').forEach(b => {
  b.onclick = () => {
    idioma = b.dataset.lang; AJ.idioma = idioma;
    if (!AJ.voz || !AJ.voz.startsWith(idioma)) { AJ.voz = `${idioma}-f`; $('selVoz').value = AJ.voz; }
    guardarAjustes(); aplicarIdioma();
  };
});
$('selVoz').onchange = (e) => { AJ.voz = e.target.value; guardarAjustes(); descartarLocucionPreparada(); };
$('selFreq').onchange = (e) => { AJ.freq = Number(e.target.value); S.freq = AJ.freq; guardarAjustes(); };
$('selCantidad').onchange = (e) => { AJ.cantidad = Number(e.target.value); guardarAjustes(); };
$('inputAmbiente').onchange = (e) => { AJ.ambiente = e.target.value.trim(); guardarAjustes(); descartarLocucionPreparada(); };
$('chkUbicacion').onchange = (e) => { AJ.ubicacion = e.target.checked; guardarAjustes(); if (AJ.ubicacion) pedirUbicacion(); };

// Si cambia la voz o el pedido, la locución ya preparada ya no vale: se vuelve a generar
function descartarLocucionPreparada() {
  if (S.hablando || S.idx < 0) return;
  if (['listo', 'error', 'descartada'].includes(S.dj.estado)) { soltarDj(); S.dj.estado = 'idle'; if (djDebeHablar()) prepararDj(S.token); }
}
function pedirUbicacion() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    p => { S.ubic = { lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) }; }, // 2 decimales ≈ 1 km: no hace falta más
    () => { AJ.ubicacion = false; $('chkUbicacion').checked = false; guardarAjustes(); },
    { timeout: 8000, maximumAge: 3600_000 });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
$('btnCodigo').onclick = validarCodigo;
$('inputCodigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') validarCodigo(); });

async function iniciar() {
  idioma = AJ.idioma;
  if (!AJ.voz) AJ.voz = `${idioma}-f`;
  S.djActivo = !!AJ.dj; S.freq = AJ.freq;
  $('selVoz').value = AJ.voz; $('selFreq').value = String(AJ.freq); $('selCantidad').value = String(AJ.cantidad);
  $('inputAmbiente').value = AJ.ambiente; $('chkUbicacion').checked = AJ.ubicacion;
  $('notaMovil').hidden = !ES_MOVIL;
  if (AJ.ubicacion) pedirUbicacion();
  aplicarIdioma();
  mostrarTab('crear');
  cargarApiYoutube();

  try {
    Object.assign(CONF, await (await fetch('/api/config')).json());
    if (CONF.requiereCodigo) {
      const ok = AJ.codigo && (await fetch('/api/auth', { headers: { 'x-codigo': AJ.codigo } })).ok;
      if (!ok) pedirCodigo(false);
    }
    const faltan = [];
    if (!CONF.youtube) faltan.push('YOUTUBE_API_KEY');
    if (!CONF.gemini) faltan.push('GEMINI_API_KEY');
    if (faltan.length) aviso(t('falta', { k: faltan.join(', ') }), { error: true, fijo: true });
    else if (!CONF.voz) aviso(t('avisoSinVoz'), { fijo: true });
    pintarBtnDj();
  } catch { aviso('No se pudo contactar con el servidor. / Could not reach the server.', { error: true, fijo: true }); }
  pintarGuardadas();
}
iniciar();

// Para las pruebas automáticas del navegador
window.__vt = { S, reproducir, cargarLista };
