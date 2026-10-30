"""Pruebas de extremo a extremo de Plazo en un móvil simulado (390x844).

Requisitos (una vez):  pip install playwright && python3 -m playwright install chromium
Ejecución:             npm run e2e
"""
import json
import os
import socket
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
SHOTS = Path(os.environ.get('PLAZO_SHOTS', '/tmp/plazo-shots'))
AXE_CACHE = ROOT / 'app' / 'e2e' / '.cache' / 'axe.min.js'
AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
NOW = '2026-10-30T10:00:00'
PASS = 'caballo grapa batería correcto'
VIOLATIONS = []  # errores de consola y violaciones de CSP de todas las pruebas
TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def wait_port(port, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(('127.0.0.1', port), 0.2):
                return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError('el servidor no arrancó')


class App:
    def __init__(self, browser, base, *, dark=False, fixed_clock=True, routes=None, init=None):
        self.ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True,
                                       has_touch=True, locale='es-ES', timezone_id='Atlantic/Canary',
                                       color_scheme='dark' if dark else 'light', reduced_motion='reduce')
        self.page = self.ctx.new_page()
        self.page.on('console', lambda m: m.type in ('error', 'warning') and VIOLATIONS.append(m.type + ': ' + m.text))
        self.page.on('pageerror', lambda e: VIOLATIONS.append('pageerror: ' + str(e)))
        self.page.add_init_script("document.addEventListener('securitypolicyviolation', e => console.error('CSP: ' + e.violatedDirective + ' ' + e.blockedURI));")
        if fixed_clock:
            self.page.clock.set_fixed_time(NOW)
        for pattern, handler in (routes or {}).items():
            self.ctx.route(pattern, handler)
        if init:
            self.page.add_init_script(init)
        self.base = base
        self.page.goto(base)
        self.page.wait_for_selector('h1')

    def close(self):
        self.ctx.close()

    def h1(self):
        return self.page.locator('h1').inner_text()

    def shot(self, name):
        SHOTS.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(SHOTS / (name + '.png')), full_page=True)

    def create_vault(self, passphrase=PASS):
        p = self.page
        p.get_by_label('Crea tu clave').fill(passphrase)
        p.get_by_label('Repítela').fill(passphrase)
        p.get_by_label('Entiendo que si olvido la clave').check()
        p.get_by_role('button', name='Crear mi bóveda cifrada').click()
        expect(p.locator('h1')).to_have_text('Añade tu primera compra.')

    def add_item(self, name, *, store='', price='', purchase='2026-10-20', delivery='', channel='En una tienda física',
                 second_hand=False, digital=False):
        p = self.page
        p.get_by_role('button', name='Añadir compra').click()
        expect(p.locator('h1')).to_have_text('Añadir compra')
        p.get_by_label('Qué compraste').fill(name)
        if store:
            p.get_by_label('Dónde (tienda o web)').fill(store)
        if price:
            p.get_by_label('Precio').fill(price)
        p.get_by_label('Fecha de compra').fill(purchase)
        if delivery:
            p.get_by_label('Fecha de entrega').fill(delivery)
        p.get_by_label(channel).check()
        if second_hand:
            p.get_by_label('Segunda mano o reacondicionado').check()
        if digital:
            p.get_by_label('Contenido digital').check()
        p.get_by_role('button', name='Guardar compra').click()
        expect(p.locator('h1')).to_have_text(name)

    def go_home(self):
        self.page.get_by_role('button', name='Tus compras').click()

    def storage(self):
        return self.page.evaluate('JSON.stringify(Object.assign({}, localStorage))')

    def unlock(self, passphrase=PASS):
        self.page.get_by_label('Tu clave').fill(passphrase)
        self.page.get_by_role('button', name='Desbloquear').click()


# ------------------------------------------------------------------ pruebas

@test
def onboarding_rechaza_claves_debiles(browser, base):
    app = App(browser, base)
    p = app.page
    app.shot('01-bienvenida')
    p.get_by_label('Crea tu clave').fill('corta')
    p.get_by_role('button', name='Crear mi bóveda cifrada').click()
    expect(p.locator('.error', has_text='Usa al menos 10 caracteres')).to_be_visible()
    p.get_by_label('Crea tu clave').fill('mipassword123')
    p.get_by_role('button', name='Crear mi bóveda cifrada').click()
    expect(p.locator('.error', has_text='contraseña muy común')).to_be_visible()
    p.get_by_label('Crea tu clave').fill(PASS)
    p.get_by_label('Repítela').fill(PASS + 'x')
    p.get_by_role('button', name='Crear mi bóveda cifrada').click()
    expect(p.get_by_text('Las dos claves no coinciden.')).to_be_visible()
    expect(p.get_by_text('Marca la casilla para continuar.')).to_be_visible()
    assert 'plazo.vault.v1' not in app.storage()
    app.create_vault()
    app.shot('02-vacia')
    app.close()


@test
def compra_online_calcula_plazos(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.add_item('Auriculares Sony', store='Tienda Online', price='299,99', purchase='2026-10-20', delivery='2026-10-22',
                 channel='Por internet o por teléfono')
    p = app.page
    expect(p.get_by_text('Devolverlo sin dar motivos')).to_be_visible()
    expect(p.get_by_text('Hasta el 5 nov 2026, 6 días')).to_be_visible()
    expect(p.get_by_text('Hasta el 22 oct 2029, 3 años')).to_be_visible()
    app.shot('04-detalle')
    app.go_home()
    expect(p.locator('h1')).to_have_text('Te quedan 6 días para devolverlo sin dar motivos.')
    expect(p.get_by_text('299,99 €', exact=True)).to_be_visible()
    app.add_item('Nevera', store='Electro Sur', price='1.299', purchase='2025-03-10')
    app.go_home()
    app.add_item('Kindle', price='119', purchase='2026-10-16', delivery='2026-10-18', channel='Por internet o por teléfono')
    app.go_home()
    expect(p.locator('h1')).to_have_text('Te quedan 2 días para devolverlo sin dar motivos.')
    expect(p.locator('.hero--pronto')).to_be_visible()
    app.shot('03-inicio')
    app.close()


@test
def almacenamiento_cifrado_sin_texto_en_claro(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.add_item('Portátil Secreto', store='Tienda Misteriosa', price='999', purchase='2026-01-15')
    raw = app.storage()
    for word in ('Portátil', 'Secreto', 'Misteriosa', '999', '2026-01-15'):
        assert word not in raw, 'texto en claro en el almacenamiento: ' + word
    blob = json.loads(json.loads(raw)['plazo.vault.v1'])
    assert blob['v'] == 1 and blob['kdf']['iter'] == 600000 and len(blob['iv']) == 16
    app.close()


@test
def bloquear_borra_los_datos_de_pantalla(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.add_item('Bicicleta', purchase='2026-05-01')
    p = app.page
    p.get_by_role('button', name='Bloquear Plazo').click()
    expect(p.locator('h1')).to_have_text('Plazo está bloqueado')
    assert 'Bicicleta' not in p.content()
    app.unlock('una frase equivocada')
    expect(p.get_by_text('Clave incorrecta.')).to_be_visible()
    assert p.get_by_label('Tu clave').input_value() == '', 'el campo se vacía tras un fallo'
    app.shot('05-bloqueo')
    app.unlock()
    expect(p.locator('.row-name', has_text='Bicicleta')).to_be_visible()
    app.close()


@test
def los_datos_sobreviven_a_recargar(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.add_item('Cafetera', purchase='2026-02-02')
    app.page.reload()
    expect(app.page.locator('h1')).to_have_text('Plazo está bloqueado')
    app.unlock()
    expect(app.page.locator('.row-name', has_text='Cafetera')).to_be_visible()
    app.close()


@test
def espera_creciente_tras_5_fallos(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.page.reload()
    for _ in range(5):
        app.unlock('frase incorrecta numero')
        expect(app.page.locator('button[type=submit]')).to_have_text('Desbloquear')
    expect(app.page.get_by_text('Demasiados intentos')).to_be_visible()
    expect(app.page.get_by_role('button', name='Desbloquear')).to_be_disabled()
    app.page.reload()
    expect(app.page.get_by_role('button', name='Desbloquear')).to_be_disabled()
    app.close()


@test
def xss_se_muestra_como_texto(browser, base):
    app = App(browser, base)
    app.create_vault()
    payload = '<img src=x onerror="window.__xss=1">'
    app.add_item(payload, store='<script>window.__xss=2</script>', purchase='2026-03-03')
    p = app.page
    assert p.evaluate('window.__xss') is None
    assert p.locator('img').count() == 0
    assert p.locator('h1').inner_text() == payload
    app.go_home()
    assert p.evaluate('window.__xss') is None
    expect(p.get_by_text(payload).first).to_be_visible()
    app.close()


@test
def bloqueo_automatico_por_inactividad(browser, base):
    app = App(browser, base, fixed_clock=False)
    app.page.clock.install(time=NOW)
    app.page.reload()
    app.create_vault()
    app.add_item('Tele', purchase='2026-04-04')
    app.page.clock.run_for('02:30')
    expect(app.page.locator('h1')).to_have_text('Tele')
    app.page.clock.run_for('00:40')
    expect(app.page.locator('h1')).to_have_text('Plazo está bloqueado')
    app.close()


@test
def bloqueo_al_salir_de_la_app(browser, base):
    app = App(browser, base, fixed_clock=False)
    app.page.clock.install(time=NOW)
    app.page.reload()
    app.create_vault()
    set_vis = "s => { Object.defineProperty(document, 'visibilityState', { value: s, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }"
    app.page.evaluate(set_vis, 'hidden')
    app.page.clock.run_for('00:10')
    app.page.evaluate(set_vis, 'visible')
    expect(app.page.locator('h1')).to_have_text('Añade tu primera compra.')
    app.page.evaluate(set_vis, 'hidden')
    app.page.clock.fast_forward('00:31')
    app.page.evaluate(set_vis, 'visible')
    expect(app.page.locator('h1')).to_have_text('Plazo está bloqueado')
    app.close()


@test
def formulario_valida_datos(browser, base):
    app = App(browser, base)
    app.create_vault()
    p = app.page
    p.get_by_role('button', name='Añadir compra').click()
    p.get_by_role('button', name='Guardar compra').click()
    expect(p.get_by_text('Escribe qué compraste.')).to_be_visible()
    p.get_by_label('Qué compraste').fill('Móvil')
    p.get_by_label('Fecha de compra').fill('2026-10-20')
    p.get_by_label('Fecha de entrega').fill('2026-10-10')
    p.get_by_label('Precio').fill('doce euros')
    p.get_by_role('button', name='Guardar compra').click()
    expect(p.get_by_text('La entrega no puede ser anterior a la compra.')).to_be_visible()
    expect(p.get_by_text('Precio no válido. Ejemplo: 299,99')).to_be_visible()
    assert p.get_by_label('Qué compraste').input_value() == 'Móvil', 'no se pierde lo escrito'
    assert p.get_by_text('No me informaron').is_hidden(), 'en tienda física no hay desistimiento'
    assert p.get_by_text('Garantía que pactaste').is_hidden()
    p.get_by_label('Fecha de entrega').fill('')
    p.get_by_label('Precio').fill('149,90')
    expect(p.get_by_text('Precio no válido. Ejemplo: 299,99')).to_be_hidden()
    p.get_by_label('Por internet o por teléfono').check()
    expect(p.get_by_text('No me informaron')).to_be_visible()
    p.get_by_label('Segunda mano o reacondicionado').check()
    expect(p.get_by_label('Garantía que pactaste con el vendedor')).to_be_visible()
    p.get_by_label('A otra persona, no a una empresa').check()
    expect(p.get_by_text('Segunda mano o reacondicionado')).to_be_hidden()
    p.get_by_label('En una tienda física').check()
    p.get_by_label('Nuevo', exact=True).check()
    expect(p.locator('.preview')).to_contain_text('Garantía legal: hasta el 20 oct 2029')
    app.shot('06-formulario')
    p.get_by_role('button', name='Guardar compra').click()
    expect(p.locator('h1')).to_have_text('Móvil')
    app.close()


@test
def reparacion_congela_la_garantia(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.add_item('Lavadora', purchase='2025-03-10')
    p = app.page
    expect(p.get_by_text('Hasta el 10 mar 2028')).to_be_visible()
    p.get_by_role('button', name='Registrar reparación').click()
    p.get_by_label('Fecha en que lo entregaste').fill('2026-09-01')
    p.get_by_label('Fecha en que te lo devolvieron').fill('2026-09-15')
    p.get_by_label('Qué fallo tenía').fill('No centrifuga')
    p.get_by_role('button', name='Guardar reparación').click()
    expect(p.get_by_text('Hasta el 24 mar 2028')).to_be_visible()
    expect(p.get_by_text('Garantía de la reparación')).to_be_visible()
    app.close()


@test
def carta_de_reclamacion_sin_guardar_el_nombre(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.add_item('Microondas', store='Hogar Plus', price='89', purchase='2025-03-10')
    p = app.page
    p.get_by_role('button', name='Preparar reclamación').click()
    p.get_by_label('Tu nombre y apellidos').fill('Lucía Ramírez Torres')
    p.get_by_label('Describe el fallo').fill('No calienta desde la semana pasada')
    p.get_by_role('button', name='Redactar carta').click()
    letter = p.get_by_label('Texto de la carta').input_value()
    for expected in ('«Microondas»', 'Hogar Plus', 'artículo 120', 'artículo 121', 'Lucía Ramírez Torres', 'de forma gratuita'):
        assert expected in letter, 'falta en la carta: ' + expected
    app.shot('07-carta')
    p.get_by_role('button', name='Volver').click()
    p.get_by_role('button', name='Ajustes').click()
    p.get_by_role('button', name='Ver mis datos sin cifrar').click()
    exported = p.get_by_label('Copia de tus datos').input_value()
    assert 'Microondas' in exported and 'Lucía' not in exported, 'el nombre no debe guardarse'
    app.close()


@test
def compra_a_particular(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.add_item('Patinete usado', purchase='2026-08-01', channel='A otra persona, no a una empresa')
    p = app.page
    expect(p.get_by_text('Reclamar defectos ocultos', exact=True)).to_be_visible()
    expect(p.get_by_text('Art. 1490 del Código Civil')).to_be_visible()
    assert p.get_by_role('button', name='Preparar reclamación').count() == 0
    app.close()


@test
def editar_y_eliminar(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.add_item('Altavoz', purchase='2026-06-06')
    p = app.page
    p.get_by_role('button', name='Editar').click()
    p.get_by_label('Qué compraste').fill('Altavoz portátil')
    p.get_by_role('button', name='Guardar cambios').click()
    expect(p.locator('h1')).to_have_text('Altavoz portátil')
    p.get_by_role('button', name='Eliminar', exact=True).click()
    p.get_by_role('button', name='Eliminar definitivamente').click()
    expect(p.locator('h1')).to_have_text('Añade tu primera compra.')
    app.close()


@test
def cambiar_la_clave(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.add_item('Monitor', purchase='2026-07-07')
    p = app.page
    nueva = 'tortuga violeta lunes tranquilo'
    p.get_by_role('button', name='Ajustes').click()
    p.get_by_text('Cambiar clave', exact=True).first.click()
    p.get_by_label('Clave actual').fill('no es la clave buena')
    p.get_by_label('Clave nueva', exact=True).fill(nueva)
    p.get_by_label('Repite la clave nueva').fill(nueva)
    p.get_by_role('button', name='Cambiar clave').click()
    expect(p.get_by_text('La clave actual no es correcta.')).to_be_visible()
    p.get_by_label('Clave actual').fill(PASS)
    p.get_by_role('button', name='Cambiar clave').click()
    expect(p.get_by_text('Clave cambiada')).to_be_visible()
    p.get_by_role('button', name='Bloquear ahora').click()
    app.unlock(PASS)
    expect(p.get_by_text('Clave incorrecta.')).to_be_visible()
    app.unlock(nueva)
    expect(p.locator('.row-name', has_text='Monitor')).to_be_visible()
    app.close()


@test
def borrar_todo_exige_confirmacion(browser, base):
    app = App(browser, base)
    app.create_vault()
    app.add_item('Tostadora', purchase='2026-01-01')
    p = app.page
    p.get_by_role('button', name='Ajustes').click()
    app.shot('08-ajustes')
    p.get_by_role('button', name='Borrar todos mis datos').click()
    p.get_by_role('button', name='Borrar todo', exact=True).click()
    expect(p.get_by_text('Escribe BORRAR para confirmar.')).to_be_visible()
    p.get_by_label('Escribe BORRAR para confirmar').fill('borrar')
    p.get_by_role('button', name='Borrar todo', exact=True).click()
    expect(p.locator('h1')).to_have_text('Que no se te pase ninguna devolución ni garantía.')
    assert app.storage() == '{}'
    app.close()


@test
def datos_manipulados_no_se_abren(browser, base):
    app = App(browser, base)
    app.create_vault()
    p = app.page
    p.evaluate("""() => { const b = JSON.parse(localStorage.getItem('plazo.vault.v1'));
      const c = atob(b.ct).split(''); c[5] = String.fromCharCode(c[5].charCodeAt(0) ^ 1);
      b.ct = btoa(c.join('')); localStorage.setItem('plazo.vault.v1', JSON.stringify(b)); }""")
    p.reload()
    app.unlock()
    expect(p.get_by_text('Clave incorrecta.')).to_be_visible()
    p.evaluate("""() => { const b = JSON.parse(localStorage.getItem('plazo.vault.v1')); b.kdf.iter = 1000;
      localStorage.setItem('plazo.vault.v1', JSON.stringify(b)); }""")
    p.reload()
    app.unlock()
    expect(p.get_by_text('dañados o no son compatibles')).to_be_visible()
    app.close()


@test
def trusted_types_bloquea_inyeccion_html(browser, base):
    if 'demo' in base:
        return
    app = App(browser, base)
    result = app.page.evaluate("() => { try { document.body.innerHTML = '<b>x</b>'; return 'permitido'; } catch (e) { return e.name; } }")
    assert result == 'TypeError', 'Trusted Types debería bloquear innerHTML: ' + result
    app.page.wait_for_timeout(300)  # los avisos de consola llegan de forma asíncrona
    app.close()
    # Esta violación es la esperada: es justo lo que la prueba provoca.
    VIOLATIONS[:] = [v for v in VIOLATIONS if 'trusted-types' not in v.lower() and 'TrustedHTML' not in v]


@test
def funciona_sin_conexion(browser, base):
    if 'demo' in base:
        return
    app = App(browser, base)
    app.page.evaluate('navigator.serviceWorker.ready')
    app.page.reload()
    app.page.wait_for_function('navigator.serviceWorker.controller !== null')
    app.ctx.set_offline(True)
    app.page.reload()
    expect(app.page.locator('h1')).to_have_text('Que no se te pase ninguna devolución ni garantía.')
    app.ctx.set_offline(False)
    app.close()


@test
def modo_oscuro(browser, base):
    app = App(browser, base, dark=True)
    bg = app.page.evaluate("getComputedStyle(document.body).backgroundColor")
    assert bg == 'rgb(16, 20, 23)', bg
    app.create_vault()
    app.add_item('Consola', store='Juegos', price='449', purchase='2026-10-24', channel='Por internet o por teléfono')
    app.shot('09-oscuro-detalle')
    app.go_home()
    app.shot('10-oscuro-inicio')
    app.close()


@test
def accesibilidad_axe(browser, base):
    if 'demo' not in base:
        return  # axe se inyecta como script: en la PWA la CSP (correctamente) lo bloquea
    if not AXE_CACHE.exists():
        AXE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        try:
            urllib.request.urlretrieve(AXE_URL, AXE_CACHE)
        except Exception as e:  # sin red: se informa, no se oculta
            print('    (aviso) no se pudo descargar axe-core: ' + str(e))
            return
    app = App(browser, base)
    p = app.page

    def audit(name):
        p.add_script_tag(path=str(AXE_CACHE))
        res = p.evaluate("axe.run(document, { resultTypes: ['violations'] })")
        bad = [v for v in res['violations'] if v['impact'] in ('serious', 'critical')]
        assert not bad, name + ': ' + '; '.join(v['id'] + ' -> ' + ' | '.join(n['target'][0] + ' ' + n.get('failureSummary', '').split('\n')[-1] for n in v['nodes'][:4]) for v in bad)

    audit('bienvenida')
    app.create_vault()
    app.add_item('Router', store='Telco', price='59', purchase='2026-10-21', channel='Por internet o por teléfono')
    audit('detalle')
    app.go_home()
    app.add_item('Tostadora antigua', purchase='2021-05-05')
    audit('detalle con plazos vencidos')
    app.go_home()
    audit('inicio')
    p.get_by_role('button', name='Añadir compra').click()
    audit('formulario')
    app.close()



# ------------------------------------------------------------------ catálogo de tiendas

def start_store_item(app, name='Monitor 27 pulgadas'):
    p = app.page
    p.get_by_role('button', name='Añadir compra').click()
    p.get_by_label('Qué compraste').fill(name)
    p.get_by_label('Fecha de compra').fill('2026-10-20')
    p.get_by_label('Fecha de entrega').fill('2026-10-22')
    p.get_by_label('Por internet o por teléfono').check()
    p.get_by_label('Tienda', exact=True).select_option('pccomponentes')


@test
def catalogo_aplica_la_politica_de_la_tienda(browser, base):
    app = App(browser, base)
    app.create_vault()
    p = app.page
    start_store_item(app)
    expect(p.get_by_label('Dónde (tienda o web)')).to_be_hidden()
    expect(p.locator('.policy')).to_contain_text('PcComponentes: 30 días desde la entrega.')
    link = p.locator('.policy a')
    expect(link).to_have_attribute('href', 'https://www.pccomponentes.com/landings/condiciones-de-compra')
    expect(link).to_have_attribute('rel', 'noopener noreferrer')
    expect(p.locator('.preview')).to_contain_text('Devolución según la tienda: hasta el 21 nov 2026')
    expect(p.get_by_label('Días de devolución que da la tienda')).to_be_hidden()
    p.get_by_label('En una tienda física').check()
    expect(p.locator('.policy')).to_contain_text('No tenemos la política de PcComponentes')
    p.get_by_label('Por internet o por teléfono').check()
    app.shot('11-tienda-catalogo')
    p.get_by_role('button', name='Guardar compra').click()
    expect(p.locator('h1')).to_have_text('Monitor 27 pulgadas')
    expect(p.get_by_text('Devolución según PcComponentes')).to_be_visible()
    expect(p.get_by_text('Hasta el 21 nov 2026, 22 días')).to_be_visible()
    expect(p.get_by_role('link', name='Ver la política en la web de PcComponentes')).to_be_visible()
    expect(p.get_by_text('Tu tienda te da más tiempo')).to_be_visible()
    app.shot('12-detalle-tienda')
    app.go_home()
    expect(p.locator('h1')).to_have_text('Te quedan 22 días para devolverlo según la política de la tienda.')
    # Editar no rehace la foto de la política
    p.locator('.row').first.click()
    p.get_by_role('button', name='Editar').click()
    p.get_by_label('Qué compraste').fill('Monitor 27 pulgadas IPS')
    p.get_by_role('button', name='Guardar cambios').click()
    expect(p.get_by_text('Devolución según PcComponentes')).to_be_visible()
    p.get_by_role('button', name='Ajustes').click()
    p.get_by_role('button', name='Ver mis datos sin cifrar').click()
    exported = json.loads(p.get_by_label('Copia de tus datos').input_value())
    policy = exported['compras'][0]['storePolicy']
    assert policy['returnDays'] == 30 and policy['checkedAt'] == '2026-10-30' and policy['catalogSeq'] == 1, policy
    app.close()


@test
def catalogo_marketplace_mantiene_los_14_dias(browser, base):
    app = App(browser, base)
    app.create_vault()
    p = app.page
    start_store_item(app, 'Ratón')
    p.get_by_label('Vendedor externo (Marketplace)').check()
    expect(p.locator('.policy')).to_contain_text('Plazo según el vendedor.')
    p.get_by_role('button', name='Guardar compra').click()
    expect(p.get_by_text('Devolverlo sin dar motivos')).to_be_visible()
    expect(p.get_by_text('Hasta el 5 nov 2026, 6 días')).to_be_visible()
    expect(p.get_by_text('no se aplica a vendedores externos')).to_be_visible()
    assert p.get_by_text('Devolución según PcComponentes').count() == 0
    app.close()


def tampered_catalog():
    import base64
    signed = json.loads((ROOT / 'catalog' / 'catalog.signed.json').read_text())
    payload = base64.b64decode(signed['payload']).decode().replace('"returnDays":30', '"returnDays":90')
    signed['payload'] = base64.b64encode(payload.encode()).decode()
    return json.dumps(signed)


@test
def catalogo_manipulado_se_rechaza(browser, base):
    if 'demo' in base:
        return  # la demo no descarga catálogo: solo usa el incluido
    hits = []

    def evil(route):
        hits.append(route.request.url)
        route.fulfill(status=200, content_type='application/json', body=tampered_catalog())

    app = App(browser, base, routes={'**/catalog.json': evil})
    app.page.wait_for_timeout(400)
    assert hits, 'la app debería intentar descargar el catálogo'
    stored = app.page.evaluate("localStorage.getItem('plazo.catalogo.v1')")
    assert stored == (ROOT / 'catalog' / 'catalog.signed.json').read_text(), 'solo se guarda el catálogo auténtico'
    app.create_vault()
    start_store_item(app)
    expect(app.page.locator('.policy')).to_contain_text('30 días desde la entrega.')
    app.close()


@test
def catalogo_antiguo_no_se_acepta(browser, base):
    # Si el dispositivo ya vio un catálogo más nuevo, uno anterior (aunque esté bien firmado) se rechaza.
    genuine = (ROOT / 'catalog' / 'catalog.signed.json').read_text()  # firma válida, pero seq 1 < 99
    app = App(browser, base, init="localStorage.setItem('plazo.catalogo.v1.seq', '99')",
              routes={'**/catalog.json': lambda r: r.fulfill(status=200, content_type='application/json', body=genuine)})
    app.create_vault()
    p = app.page
    p.get_by_role('button', name='Añadir compra').click()
    expect(p.get_by_label('Tienda', exact=True)).to_be_hidden()
    expect(p.get_by_label('Dónde (tienda o web)')).to_be_visible()
    app.close()

# ------------------------------------------------------------------ ejecución

def run_suite(browser, base, label):
    failures = 0
    for fn in TESTS:
        before = len(VIOLATIONS)
        try:
            fn(browser, base)
            new = VIOLATIONS[before:]
            if new:
                raise AssertionError('errores en consola o CSP: ' + ' | '.join(new))
            print('  ok   ' + label + ' ' + fn.__name__)
        except Exception:
            failures += 1
            print('  FAIL ' + label + ' ' + fn.__name__)
            traceback.print_exc(limit=3)
    return failures


def main():
    subprocess.run(['node', str(ROOT / 'app' / 'build.mjs')], check=True, stdout=subprocess.DEVNULL)
    pwa_port, demo_port = free_port(), free_port()
    servers = [
        subprocess.Popen(['node', str(ROOT / 'app' / 'serve.mjs')], env={**os.environ, 'PORT': str(pwa_port)}, stdout=subprocess.DEVNULL),
        subprocess.Popen([sys.executable, '-m', 'http.server', str(demo_port), '--bind', '127.0.0.1', '--directory', str(ROOT / 'dist' / 'demo')],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
    ]
    try:
        wait_port(pwa_port)
        wait_port(demo_port)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            failures = run_suite(browser, 'http://localhost:%d/' % pwa_port, '[pwa] ')
            failures += run_suite(browser, 'http://localhost:%d/index.html?target=demo' % demo_port, '[demo]')
            browser.close()
    finally:
        for s in servers:
            s.terminate()
    total = len(TESTS) * 2
    print('\n%d de %d pruebas superadas. Capturas en %s' % (total - failures, total, SHOTS))
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
