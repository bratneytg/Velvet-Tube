import json, time, sys, subprocess, os, urllib.request
from playwright.sync_api import sync_playwright
YT = open('yt_falso.js').read()
resultados = []
def ok(nombre, cond, extra=''):
    resultados.append((nombre, bool(cond))); print(('✔' if cond else '✘'), nombre, extra)

def servidor(puerto, **env):
    e = dict(os.environ, PORT=str(puerto), **env)
    pr = subprocess.Popen(['node', 'servidor-falso.mjs'], env=e, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(30):
        try: urllib.request.urlopen(f'http://127.0.0.1:{puerto}/healthz'); break
        except Exception: time.sleep(0.2)
    return pr

def nueva(b, puerto, **kw):
    ctx = b.new_context(locale='es-ES', **kw)
    pg = ctx.new_page()
    pg.route('https://www.youtube.com/iframe_api', lambda r: r.fulfill(status=200, content_type='application/javascript', body=YT))
    pg.route('https://i.ytimg.com/**', lambda r: r.fulfill(status=200, content_type='image/png', body=b''))
    pg.goto(f'http://127.0.0.1:{puerto}'); return pg

def crear(pg, n='10'):
    pg.wait_for_selector('#btnCrear'); pg.fill('#inputPrompt', 'música para correr'); pg.select_option('#selCantidad', n); pg.click('#btnCrear')

with sync_playwright() as p:
    b = p.chromium.launch(channel=os.environ.get('NAVEGADOR_CANAL', 'chrome'), headless=True, args=['--autoplay-policy=no-user-gesture-required', '--no-sandbox'])

    # --- A. Código de acceso ---
    s1 = servidor(3121, CODIGO='abc123')
    pg = nueva(b, 3121)
    pg.wait_for_selector('#overlayCodigo:not([hidden])')
    ok('A1. con ACCESS_CODE aparece la pantalla de código', True)
    pg.fill('#inputCodigo', 'mal'); pg.click('#btnCodigo'); time.sleep(0.5)
    ok('A2. código incorrecto -> mensaje y sigue bloqueado', 'incorrecto' in pg.inner_text('#codigoError').lower() and pg.is_visible('#overlayCodigo'))
    pg.fill('#inputCodigo', 'abc123'); pg.click('#btnCodigo'); time.sleep(0.5)
    ok('A3. código correcto -> desaparece y se recuerda', not pg.is_visible('#overlayCodigo') and 'abc123' in pg.evaluate("localStorage.getItem('vt_ajustes')"))
    crear(pg, '10'); pg.wait_for_function("window.__log && window.__log.some(e => e[0]==='load')", timeout=15000)
    ok('A4. con el código, crear lista y reproducir funciona', pg.inner_text('#titulo') == 'Song 0')
    pg.reload(); pg.wait_for_selector('#btnCrear'); time.sleep(0.8)
    ok('A5. al recargar no vuelve a pedir el código', not pg.is_visible('#overlayCodigo'))
    pg.context.close(); s1.terminate()

    # --- B. Sin autoplay: aparece "Toca para continuar" ---
    s2 = servidor(3122)
    pg = nueva(b, 3122)
    pg.evaluate('window.__NOAUTOPLAY = true')
    crear(pg); pg.wait_for_selector('#btnTocar:not([hidden])', timeout=12000)
    ok('B1. si el navegador bloquea el inicio, se ofrece tocar para continuar', True)
    pg.click('#btnTocar'); pg.wait_for_function("window.__yt.state === 1", timeout=5000)
    ok('B2. al tocar, la canción suena y el botón desaparece', not pg.is_visible('#btnTocar'))
    pg.context.close()

    # --- C. Cuota de YouTube agotada ---
    pg = nueva(b, 3122)
    pg.route('**/api/resolver', lambda r: r.fulfill(status=429, content_type='application/json', body=json.dumps({'success': False, 'codigo': 'CUOTA', 'error': 'agotada'})))
    crear(pg); pg.wait_for_selector('.aviso.error', timeout=12000)
    ok('C1. cuota agotada -> aviso claro', 'cuota' in pg.inner_text('.aviso.error').lower(), pg.inner_text('.aviso.error')[:70])
    ok('C2. y no se queda reproduciendo nada ni entra en bucle', pg.evaluate('window.__log.filter(e => e[0]==="load").length') == 0)
    pg.context.close()

    # --- D. DJ desactivado a mitad de canción: no habla ---
    pg = nueva(b, 3122)
    crear(pg); pg.wait_for_function("document.getElementById('djBadge').textContent.includes('DJ listo')", timeout=15000)
    pg.click('#btnDj'); time.sleep(0.3)
    ok('D1. al apagar el DJ se descarta la locución preparada', pg.evaluate('window.__vt.S.dj.estado') == 'idle')
    pg.wait_for_function("window.__log.some(e => e[0]==='ended')", timeout=20000); time.sleep(0.5)
    vols = [e for e in pg.evaluate('window.__log') if e[0]=='vol']
    ok('D2. con el DJ apagado la música no baja de volumen y pasa a la siguiente', not vols and pg.evaluate('window.__vt.S.idx') == 1, f'vol={vols}')
    pg.click('#btnDj'); time.sleep(0.5)
    ok('D3. al volver a encenderlo se prepara de nuevo', pg.evaluate('window.__vt.S.dj.estado') in ('preparando', 'listo'))
    pg.context.close()

    # --- E. iPhone: sin control de volumen, la voz va en el hueco entre canciones ---
    ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    pg = nueva(b, 3122, user_agent=ua, viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
    crear(pg); pg.wait_for_function("document.getElementById('djBadge').textContent.includes('DJ listo')", timeout=15000)
    ok('E0. en iPhone se muestra el aviso de pantalla bloqueada', pg.is_visible('#notaMovil'))
    pg.wait_for_function("window.__log.some(e => e[0]==='ended')", timeout=25000)
    t_fin = [e for e in pg.evaluate('window.__log') if e[0]=='ended'][0][2]
    vols = [e for e in pg.evaluate('window.__log') if e[0]=='vol']
    ok('E1. durante la canción no se toca el volumen', not [v for v in vols if v[2] < t_fin], f'{vols[:3]}')
    pg.wait_for_function("document.getElementById('djBadge').textContent.includes('al aire')", timeout=5000)
    ok('E2. al terminar la canción habla el DJ en el hueco', True)
    t_load2 = lambda: [e for e in pg.evaluate('window.__log') if e[0]=='load']
    pg.wait_for_function("window.__log.filter(e => e[0]==='load').length >= 3", timeout=15000)   # Song0, FALLA1, ok_song_1
    cargas = t_load2()
    ok('E3. la siguiente canción entra después de la voz (≈4 s tras el final)', 3500 < cargas[1][2] - t_fin < 7000, f'{cargas[1][2]-t_fin} ms')
    pg.screenshot(path='captura_movil.png')
    pg.context.close()

    # --- F. Atajos: listas guardadas se reproducen sin volver a buscar ---
    pg = nueva(b, 3122)
    crear(pg, '10'); pg.wait_for_function("window.__log && window.__log.some(e => e[0]==='load')", timeout=15000)
    time.sleep(1)
    pg.click('[data-tab=guardadas]')
    n0 = len(json.load(urllib.request.urlopen('http://127.0.0.1:3122/__registro'))['resolver'])
    pg.click('#listaGuardadas .play'); pg.wait_for_function("window.__log.filter(e => e[0]==='load').length >= 2", timeout=10000)
    time.sleep(1)
    n1 = len(json.load(urllib.request.urlopen('http://127.0.0.1:3122/__registro'))['resolver'])
    ok('F1. reproducir una lista guardada no repite búsquedas de las canciones ya resueltas', n1 - n0 <= 2, f'búsquedas nuevas: {n1-n0}')
    pg.context.close()
    b.close(); s2.terminate()

fallos = [n for n, c in resultados if not c]
print(f'\n{len(resultados)-len(fallos)}/{len(resultados)} comprobaciones OK'); sys.exit(1 if fallos else 0)
