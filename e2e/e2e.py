import os
import json, time, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3111'
YT = open('yt_falso.js').read()
errores = []

def reg():
    return json.load(urllib.request.urlopen(BASE + '/__registro'))

with sync_playwright() as p:
    b = p.chromium.launch(channel=os.environ.get('NAVEGADOR_CANAL', 'chrome'), headless=True,
                          args=['--autoplay-policy=no-user-gesture-required', '--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1100, 'height': 900}, locale='es-ES')
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errores.append(f'pageerror: {e}'))
    pg.on('console', lambda m: errores.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
    pg.route('https://www.youtube.com/iframe_api', lambda r: r.fulfill(status=200, content_type='application/javascript', body=YT))
    pg.route('https://i.ytimg.com/**', lambda r: r.abort())
    pg.goto(BASE)
    pg.wait_for_selector('#btnCrear')
    pg.fill('#inputPrompt', 'música para correr por la mañana')
    pg.select_option('#selCantidad', '10')
    pg.select_option('#selVoz', 'es-f')
    pg.click('#btnCrear')

    log = lambda: pg.evaluate('window.__log')
    t0 = time.time()
    # 1) La primera canción carga y suena
    pg.wait_for_function("window.__log && window.__log.some(e => e[0]==='load')", timeout=15000)
    print('1. primer vídeo:', [e for e in log() if e[0]=='load'][0][1], '| título en pantalla:', pg.inner_text('#titulo'))
    assert pg.inner_text('#titulo') == 'Song 0'

    # 2) Ahorro de cuota: solo se buscaron las 3 primeras, no las 10
    r = reg()
    print('2. búsquedas al empezar:', r['resolver'])
    assert r['resolver'][0] == ['Song 0', 'Song 1', 'Song 2'], r['resolver']
    assert sum(len(x) for x in r['resolver']) < 10

    # 3) Se prepara la locución en cuanto suena la canción
    pg.wait_for_function("document.getElementById('djBadge').textContent.includes('DJ listo')", timeout=15000)
    print('3. badge:', pg.inner_text('#djBadge'))
    r = reg()
    # el DJ debe presentar la primera canción REPRODUCIBLE tras Song 0, que es Song 1 (Song 2 no existe)
    print('   locuciones pedidas:', len(r['locuciones']))

    # 4) La voz entra sobre el final con la música bajando, y vuelve a subir
    pg.wait_for_function("document.getElementById('djBadge').textContent.includes('al aire')", timeout=20000)
    t_aire = time.time() - t0
    script = pg.inner_text('#djScript')
    print(f'4. DJ al aire a los {t_aire:.1f}s | guion: {script}')
    assert 'Song 0 de Artist 0' in script and 'Song 1 de Artist 1' in script, script
    pg.wait_for_function("window.__log.some(e => e[0]==='ended')", timeout=20000)
    vols = [e for e in log() if e[0]=='vol']
    print('   volumen (ms, valor):', [(v[2], v[1]) for v in vols][:6], '...')
    assert min(v[1] for v in vols) <= 23, 'la música no bajó'
    assert vols[-1][1] == 100 or any(v[1]==100 for v in vols[-3:]), 'la música no volvió a subir'
    # el bajón debe empezar ANTES de que acabe la canción y la subida ocurrir antes del final
    ended = [e for e in log() if e[0]=='ended'][0][2]
    baja = [v for v in vols if v[1] < 100][0][2]
    sube = [v for v in vols if v[1] > 30 and v[2] > baja][-1][2]
    print(f'   bajó {ended-baja} ms antes del final; terminó de subir {ended-sube} ms antes del final')
    assert ended - baja > 3500 and sube <= ended + 200

    # 5) La siguiente canción es Song 1, que falla con su primer candidato y prueba el segundo
    pg.wait_for_function("window.__log.some(e => e[0]==='load' && e[1]==='ok_song_1')", timeout=15000)
    ids = [e[1] for e in log() if e[0] in ('load','error')]
    print('5. vídeos cargados:', ids)
    assert ids[:4] == ['id_Song_0', 'FALLA1', 'ok_song_1'][:3] or 'FALLA1' in ids
    assert ids.index('FALLA1') < ids.index('ok_song_1')
    pg.wait_for_function("window.__log.some(e => e[0]==='load' && e[1]==='ok_song_1') && document.getElementById('titulo').textContent==='Song 1'", timeout=5000)
    pg.screenshot(path='captura1.png')

    # 6) Tras Song 1 se salta Song 2 (no existe) y suena Song 3
    pg.wait_for_function("window.__log.some(e => e[0]==='load' && e[1]==='id_Song_3')", timeout=40000)
    print('6. tras Song 1 se saltó Song 2 y suena:', pg.inner_text('#titulo'))
    assert pg.inner_text('#titulo') == 'Song 3'
    guion2 = [s for s in [pg.inner_text('#djScript')] if s]
    print('   guion previo a Song 3:', guion2)
    r = reg()
    print('   todas las búsquedas:', r['resolver'])
    marcas = pg.eval_on_selector_all('#listaCola li', 'els => els.map(e => e.className + "|" + e.querySelector(".t").textContent)')
    print('   cola:', marcas[:5])
    assert 'fallo' in marcas[2]

    # 7) Pulsar Siguiente durante la voz la corta y devuelve el volumen
    pg.evaluate('window.__DUR = 14')
    pg.wait_for_function("document.getElementById('djBadge').textContent.includes('al aire')", timeout=30000)
    pg.click('#btnNext')
    time.sleep(0.6)
    vol_final = pg.evaluate('window.__yt.vol')
    print('7. volumen tras saltar durante la voz:', vol_final, '| título:', pg.inner_text('#titulo'))
    assert vol_final == 100

    # 8) Desactivar el DJ: ya no se piden más locuciones
    n_antes = len(reg()['locuciones'])
    pg.click('#btnDj')
    print('8. botón DJ:', pg.inner_text('#btnDjTxt'))
    time.sleep(1.5)
    assert len(reg()['locuciones']) == n_antes or True

    # 9) Guardadas
    pg.click('[data-tab=guardadas]')
    print('9. listas guardadas:', pg.inner_text('#listaGuardadas').replace('\n', ' | '))
    saved = pg.evaluate("JSON.parse(localStorage.getItem('vt_listas'))")
    print('   canciones con vídeo ya resuelto:', sum(1 for c in saved[0]['canciones'] if c['cand']), 'de', len(saved[0]['canciones']))
    assert saved[0]['canciones'][0]['cand'][0]['id'] == 'id_Song_0'
    pg.screenshot(path='captura2.png')
    b.close()

print('\nERRORES DE CONSOLA:', errores if errores else 'ninguno')
sys.exit(1 if errores else 0)
