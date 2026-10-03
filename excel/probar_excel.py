"""Pruebas de PanControl.xlsm sin Excel, con LibreOffice (headless).

Uso:  /usr/bin/python3 excel/probar_excel.py      (necesita LibreOffice Calc + python3-uno,
                                                  y xlsxwriter en el "python3" del PATH)

1. Genera un libro de prueba (datos de ejemplo + módulo de pruebas VBA).
2. Lo abre en LibreOffice: verifica que cargan las macros, recalcula y
   comprueba stock, resumen de Inicio, listas y calculadora.
3. Ejecuta las macros puras (JSON, UTF-8, importar/exportar respaldo).
4. Genera el libro final y verifica que abre sin errores de fórmula.
"""
import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

import uno
from com.sun.star.beans import PropertyValue

AQUI = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix='pancontrol-excel-')
pasadas = falladas = 0


def ok(nombre, cond, extra=''):
    global pasadas, falladas
    if cond:
        pasadas += 1
        print('  ✓ ' + nombre)
    else:
        falladas += 1
        print('  ✗ ' + nombre + ('\n    ' + str(extra) if extra else ''))


def prop(n, v):
    p = PropertyValue()
    p.Name, p.Value = n, v
    return p


def construir(salida, *flags):
    py = shutil.which('python3')
    r = subprocess.run([py, os.path.join(AQUI, 'construir_excel.py'), salida, *flags], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('No se pudo generar el libro:\n' + r.stdout + r.stderr)


class LibreOffice:
    def __enter__(self):
        self.proc = subprocess.Popen(['soffice', '--headless', '--norestore', '--nologo', '--accept=pipe,name=pcxt;urp;'],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        local = uno.getComponentContext()
        res = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        for _ in range(120):
            try:
                self.ctx = res.resolve('uno:pipe,name=pcxt;urp;StarOffice.ComponentContext')
                break
            except Exception:
                time.sleep(0.5)
        self.desk = self.ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', self.ctx)
        return self

    def abrir(self, ruta):
        return self.desk.loadComponentFromURL(uno.systemPathToFileUrl(ruta), '_blank', 0,
                                              (prop('Hidden', True), prop('MacroExecutionMode', 4)))

    def __exit__(self, *a):
        try:
            self.desk.terminate()
        except Exception:
            pass
        self.proc.wait(timeout=30)


def celda(doc, ref):
    hoja, r = ref.split('!')
    return doc.Sheets.getByName(hoja).getCellRangeByName(r)


def val(doc, ref):
    c = celda(doc, ref)
    return c.getString() if c.getType().value in ('TEXT',) or (c.getType().value == 'FORMULA' and c.FormulaResultType2 == 2) else c.getValue()


def txt(doc, ref):
    return celda(doc, ref).getString()


def num(doc, ref):
    return celda(doc, ref).getValue()


def fila_de(doc, hoja, columna, texto, desde=5, hasta=200):
    sh = doc.Sheets.getByName(hoja)
    for r in range(desde, hasta):
        if sh.getCellRangeByName(f'{columna}{r}').getString() == texto:
            return r
    raise AssertionError(f'No encontré {texto} en {hoja}!{columna}')


def fecha_serial(d):
    return (d - datetime.date(1899, 12, 30)).days


def errores_de_formula(doc):
    """Celdas con error de fórmula en todas las hojas (#NAME?, Err:xxx, etc.)."""
    errores = []
    for i in range(doc.Sheets.Count):
        sh = doc.Sheets.getByIndex(i)
        cur = sh.createCursor()
        cur.gotoEndOfUsedArea(False)
        filas, cols = cur.RangeAddress.EndRow, cur.RangeAddress.EndColumn
        datos = sh.getCellRangeByPosition(0, 0, cols, filas)
        for r in range(filas + 1):
            for c in range(cols + 1):
                cell = datos.getCellByPosition(c, r)
                if cell.getType().value == 'FORMULA' and cell.getError() != 0:
                    errores.append(f'{sh.Name}!{cell.AbsoluteName.split(".")[-1]} err={cell.getError()} {cell.getFormula()[:60]}')
    return errores


def macro(doc, nombre, *args):
    sp = doc.getScriptProvider()
    s = sp.getScript(f'vnd.sun.star.script:VBAProject.{nombre}?language=Basic&location=document')
    r = s.invoke(tuple(args), (), ())
    return r[0]


# ════════════════════════════════════════════════════════════════
RESPALDO = {
    'version': 2, 'fecha_exportacion': '2026-09-30T12:00:00.000Z',
    'entradas': [
        {'id': 5, 'fecha': '2026-09-30', 'tipodoc': 'Factura', 'numdoc': 'F-9', 'proveedor': 'Molino "Sol"', 'insumo': 'Harina de trigo',
         'unidad': 'saco', 'cantidad': 2, 'cantidadBase': 100000, 'unidadBase': 'gramo', 'factorBase': 50000, 'precio': 150,
         'precioTotal': 300, 'totalDoc': 300, 'obs': 'línea\nnueva'},
        {'id': 6, 'fecha': '2026-09-29', 'insumo': 'Sal', 'unidad': 'kilogramo', 'cantidad': '1,5', 'precio': 2},
    ],
    'salidas_ins': [
        {'id': 3, 'fecha': '2026-09-30', 'motivo': 'Usado en Producción', 'ticket': 'T-1', 'obs': 'cabecera', 'obs_linea': 'detalle',
         'insumo': 'Harina de trigo', 'unidad': 'kilogramo', 'cantidad': 46, 'cantidadBase': 46000, 'factorBase': 1000},
    ],
    'produccion': [
        {'id': 8, 'tipo': 'pan', 'fecha': '2026-09-30', 'turno': 'Mañana', 'producto': 'Pan francés', 'unidad': 'lata', 'cantidad': 1400,
         'cantidadPresentacion': 20, 'unidadTeorica': 'quintal', 'cantidadTeorica': 1, 'defectuosa': 20, 'neto': 1380, 'obs': ''},
        {'id': 9, 'tipo': 'pastel', 'fecha': '2026-09-30', 'producto': 'Torta', 'unidad': 'bandeja', 'cantidad': 3,
         'cantidadPresentacion': 1, 'eqA': 2, 'defectuosa': 0},
    ],
    'salida_prod': [
        {'id': 4, 'fecha': '2026-09-30', 'categoria': 'Panes', 'producto': 'Pan francés', 'unidad': 'bolsa', 'cantidad': 30,
         'cantidadBase': 300, 'unidadBase': 'unidad', 'factorBase': 10, 'destino': 'Tienda', 'encargado': 'Ana', 'documento': '', 'obs': ''},
    ],
    'inventario': [{'id': 1, 'key': 'ins_Harina de trigo', 'si': 1000, 'aj': -50, 'min': 100000},
                   {'id': 2, 'key': 'prod_Pan francés', 'si': 10, 'aj': 0}],
    'catalogos': [
        {'id': 1, 'insumos': ['viejo']},
        {'id': 2, 'encargados': ['Ana', 'Luis'], 'destinos': ['Tienda', 'Delivery'],
         'insumos': ['Harina de trigo', 'Sal', 'Leche entera', 'Huevos'], 'panes': ['Pan francés'], 'pasteles': ['Torta'],
         'unidades': {'insumos': {'Harina de trigo': ['gramo', 'saco'], 'Huevos': ['unidad']}, 'panes': {'Pan francés': ['unidad']}, 'pasteles': {}},
         'baseUnits': {'insumos': {'Harina de trigo': 'gramo', 'Sal': 'gramo'}, 'panes': {'Pan francés': 'unidad'}, 'pasteles': {}},
         'equivalencias': {'insumos': {'Harina de trigo': [{'nombre': 'saco', 'unidad': 'saco', 'factor': 50000, 'detalle': '50 kg'},
                                                           'kilogramo | kilogramo | 1000'],
                                       'Huevos': [{'nombre': 'jaba', 'factorBase': '6x5'}]},
                           'panes': {'Pan francés': [{'nombre': 'bolsa', 'unidad': 'bolsita', 'factor': '10'}]}, 'pasteles': {}}},
    ],
}
ESPERADO_RESPALDO = {
    'insumos': [['Harina de trigo', 'gramo', 100000, 1000, -50], ['Sal', 'gramo', 0, 0, 0], ['Leche entera', 'litro', 0, 0, 0],
                ['Huevos', 'unidad', 0, 0, 0]],
    'productos': [['Pan francés', 'Pan', 'unidad', None, 10, 0], ['Torta', 'Pastel', 'unidad', None, 0, 0]],
    'equivalencias': [['Harina de trigo', 'saco', 50000, '50 kg'], ['Harina de trigo', 'kilogramo', 1000, ''], ['Huevos', 'jaba', 30, ''],
                      ['Pan francés', 'bolsa', 10, ''], ['Pan francés', 'bolsita', 10, '']],
    'unidades': [['unidad'], ['gramo'], ['saco'], ['kilogramo'], ['jaba'], ['bolsa'], ['bolsita']],
    'destinos': [['Tienda'], ['Delivery']],
    'encargados': [['Ana'], ['Luis']],
    'entradas': [[5, '2026-09-30', 'Factura', 'F-9', 'Molino "Sol"', 'Harina de trigo', 'saco', 2, 300, 300, 'línea\nnueva', 50000],
                 [6, '2026-09-29', '', '', '', 'Sal', 'kilogramo', 1.5, 3, None, '', None]],
    'salidas_ins': [[3, '2026-09-30', 'Usado en Producción', 'T-1', 'Harina de trigo', 'kilogramo', 46, 'cabecera · detalle', 1000]],
    'produccion': [[8, '2026-09-30', 'Mañana', 'Pan', 'Pan francés', 'lata', 20, 'quintal', 1, 1400, 20, ''],
                   [9, '2026-09-30', '', 'Pastel', 'Torta', 'bandeja', 1, 'lata', 2, 3, 0, '']],
    'salida_prod': [[4, '2026-09-30', 'Panes', 'Pan francés', 'bolsa', 30, 'Tienda', 'Ana', '', '', 10]],
}
JSON_RARO = {'texto': 'comillas " barra \\ / tab\t salto\n ñ € 🍞 中', 'num': [0, -0.5, 1e-7, 123456789012, 3.25, 1e21],
             'b': [True, False, None], 'vacios': [{}, [], ''], 'anidado': {'a': {'b': {'c': [1, [2, [3]]]}}},
             'Clave': 1, 'clave': 2}


def probar_formulas(lo):
    print('\n▶ Libro con datos de ejemplo (fórmulas)')
    ruta = os.path.join(TMP, 'prueba.xlsm')
    construir(ruta, '--datos-prueba', '--modulo-pruebas')
    doc = lo.abrir(ruta)
    try:
        libs = doc.BasicLibraries
        modulos = set(libs.getByName('VBAProject').getElementNames()) if libs.hasByName('VBAProject') else set()
        ok('LibreOffice carga el proyecto de macros con todos los módulos',
           {'modJson', 'modRespaldo', 'modPanControl', 'modPruebas', 'ThisWorkbook', 'shInicio'} <= modulos, modulos)

        # Ajustes: fecha fija, stock inicial para probar los tres estados.
        celda(doc, 'Inicio!C6').setValue(fecha_serial(datetime.date(2026, 9, 30)))
        celda(doc, 'Inicio!C7').setString('Día')
        celda(doc, f'Insumos!E{fila_de(doc, "Insumos", "B", "Levadura")}').setValue(1200)
        celda(doc, f'Insumos!E{fila_de(doc, "Insumos", "B", "Mantequilla")}').setValue(10000)
        doc.calculateAll()

        ok('sin errores de fórmula en ninguna hoja', not errores_de_formula(doc), errores_de_formula(doc)[:5])

        def ins(nombre, col):
            return num(doc, f'Insumos!{col}{fila_de(doc, "Insumos", "B", nombre)}')
        # Insumos: E entradas=G, salidas=H, stock=I, estado=J
        ok('Entradas con factor del catálogo (2 sacos = 100000 g)', ins('Harina de trigo', 'G') == 100000, ins('Harina de trigo', 'G'))
        ok('Salidas de insumos convertidas (46 kg = 46000 g)', ins('Harina de trigo', 'H') == 46000)
        ok('Stock = inicial + entradas − salidas + ajuste', ins('Harina de trigo', 'I') == 54000, ins('Harina de trigo', 'I'))
        ok('El factor registrado manda sobre el del catálogo (1 jaba = 25 aquí)', ins('Huevos', 'G') == 25 and ins('Huevos', 'I') == 22)
        ok('Sin presentación se usa la unidad base (factor 1)', ins('Sal', 'G') == 1500)
        estado = lambda n: txt(doc, f'Insumos!J{fila_de(doc, "Insumos", "B", n)}')  # noqa: E731
        ok('Estados: bajo mínimo / por reponer / OK',
           estado('Harina de trigo').startswith('🔴') and estado('Levadura').startswith('🟡') and estado('Mantequilla').startswith('🟢'),
           [estado('Harina de trigo'), estado('Levadura'), estado('Mantequilla')])

        def prod(nombre, col):
            return num(doc, f'Productos!{col}{fila_de(doc, "Productos", "B", nombre)}')
        ok('Producción neta por producto', prod('Pan francés', 'H') == 1380 and prod('Pan de molde', 'H') == 48)
        ok('Salidas de productos con equivalencia (30 bolsas = 300) y sin ella (100)', prod('Pan francés', 'I') == 400)
        ok('Stock de productos', prod('Pan francés', 'J') == 980 and prod('Torta de chocolate', 'J') == 3)
        ok('Neto en la tabla de producción (1400 − 20)', num(doc, 'Producción!M17') == 1380)

        # Inicio — Día 30/09/2026
        ok('Tarjeta Entradas del día: 3 líneas', num(doc, 'Inicio!B10') == 3, txt(doc, 'Inicio!B10'))
        ok('Tarjeta Entradas: total en soles', 'S/ 35.00' in txt(doc, 'Inicio!B11'), txt(doc, 'Inicio!B11'))
        ok('Tarjeta Salidas de insumos: 1', num(doc, 'Inicio!D10') == 1)
        ok('Tarjeta Panes netos: 1380 (1 lote)', num(doc, 'Inicio!H10') == 1380 and txt(doc, 'Inicio!H11').startswith('1 '), txt(doc, 'Inicio!H11'))
        ok('Tarjeta Pasteles netos: 3', num(doc, 'Inicio!J10') == 3)
        ok('Tarjeta Bajo mínimo: 5', num(doc, 'Inicio!L10') == 5, num(doc, 'Inicio!L10'))
        lista1 = [(txt(doc, f'Inicio!B{r}'), txt(doc, f'Inicio!C{r}'), txt(doc, f'Inicio!D{r}')) for r in range(15, 20)]
        ok('Lista "Insumos del periodo" en orden y con cantidades',
           lista1[:4] == [('Harina de trigo', '0', '46000'), ('Azúcar', '5000', '0'), ('Sal', '1500', '0'), ('Huevos', '25', '0')]
           and lista1[4][0] == '', lista1)
        lista2 = [(txt(doc, f'Inicio!H{r}'), txt(doc, f'Inicio!J{r}')) for r in range(15, 18)]
        ok('Lista "Producción del periodo"', lista2 == [('Pan francés', '1380'), ('Torta de chocolate', '3'), ('', '')], lista2)
        ok('Lista "Salidas de productos"', (txt(doc, 'Inicio!B35'), txt(doc, 'Inicio!C35'), txt(doc, 'Inicio!B36')) == ('Pan francés', '400', ''))
        criticos = [txt(doc, f'Inicio!H{r}') for r in range(35, 41)]
        ok('Lista "Bajo mínimo"', criticos == ['Harina de trigo', 'Azúcar', 'Sal', 'Huevos', 'Leche', ''], criticos)

        # Semana (lun 28/09 – dom 04/10)
        celda(doc, 'Inicio!C7').setString('Semana')
        doc.calculateAll()
        ok('Periodo Semana: desde lunes 28/09', num(doc, 'Inicio!E6') == fecha_serial(datetime.date(2026, 9, 28)))
        ok('Semana: 4 entradas y S/ 335.00', num(doc, 'Inicio!B10') == 4 and 'S/ 335.00' in txt(doc, 'Inicio!B11'), txt(doc, 'Inicio!B11'))
        ok('Semana: panes netos 1428 (2 lotes)', num(doc, 'Inicio!H10') == 1428 and txt(doc, 'Inicio!H11').startswith('2 '))
        celda(doc, 'Inicio!C7').setString('Mes')
        doc.calculateAll()
        ok('Periodo Mes: 01/09 – 30/09', num(doc, 'Inicio!E6') == fecha_serial(datetime.date(2026, 9, 1))
           and num(doc, 'Inicio!E7') == fecha_serial(datetime.date(2026, 9, 30)))

        # Calculadora: Pan francés (receta de 5 insumos)
        doc.calculateAll()
        filas = [(txt(doc, f'Calculadora!B{r}'), num(doc, f'Calculadora!D{r}'), txt(doc, f'Calculadora!G{r}')) for r in range(11, 17)]
        ok('Calculadora lista la receta del producto elegido', [f[0] for f in filas] ==
           ['Harina de trigo', 'Sal', 'Levadura', 'Azúcar', 'Mantequilla', ''], filas)
        ok('Calculadora: con 1 lote alcanza todo', all(f[2].startswith('✔') for f in filas[:5]), filas)
        celda(doc, 'Calculadora!C5').setValue(2)
        doc.calculateAll()
        ok('Calculadora: con 2 lotes falta harina (92000 − 54000)', txt(doc, 'Calculadora!G11') == '✖ Faltan 38,000', txt(doc, 'Calculadora!G11'))
        ok('Calculadora: unidades que salen (2 × 1400)', num(doc, 'Calculadora!C7') == 2800)
        ok('Calculadora: "Rinde por lote" se muestra como número', txt(doc, 'Calculadora!C6') == '1400', txt(doc, 'Calculadora!C6'))
        celda(doc, 'Calculadora!C4').setString('Torta de chocolate')
        doc.calculateAll()
        ok('Calculadora cambia al elegir otro producto', txt(doc, 'Calculadora!B11') == 'Harina de trigo' and num(doc, 'Calculadora!D13') == 12
           and txt(doc, 'Calculadora!B16') == '', [txt(doc, f'Calculadora!B{r}') for r in range(11, 17)])

        # Textos de los formularios
        celda(doc, 'Entradas!D6').setString('Harina de trigo')
        celda(doc, 'Entradas!G6').setString('saco')
        celda(doc, 'Entradas!D7').setValue(3)
        doc.calculateAll()
        ok('Formulario muestra la equivalencia antes de guardar', txt(doc, 'Entradas!D9') == '150,000 gramo', txt(doc, 'Entradas!D9'))

        print('\n▶ Macros (VBA puro) ejecutadas en LibreOffice')
        entrada = os.path.join(TMP, 'raro.json')
        salida = os.path.join(TMP, 'raro.out.json')
        with open(entrada, 'w', encoding='utf-8') as fh:
            json.dump(JSON_RARO, fh, ensure_ascii=False)
        macro(doc, 'modPruebas.PruebaJsonIdaVuelta', entrada, salida)
        with open(salida, encoding='utf-8') as fh:
            vuelta = json.load(fh)
        ok('JSON: leer y volver a escribir deja todo igual (escapes, unicode, números)', vuelta == JSON_RARO,
           json.dumps(vuelta, ensure_ascii=False)[:300])
        con_bom = os.path.join(TMP, 'bom.json')
        with open(con_bom, 'w', encoding='utf-8-sig') as fh:
            json.dump(RESPALDO, fh, ensure_ascii=False, indent=2)
        macro(doc, 'modPruebas.PruebaJsonIdaVuelta', con_bom, salida)
        with open(salida, encoding='utf-8') as fh:
            ok('JSON: respaldo con BOM e indentado', json.load(fh) == json.loads(json.dumps(RESPALDO)))
        ok('UTF-8: escribir y leer archivos con tildes y emojis', macro(doc, 'modPruebas.PruebaUtf8', os.path.join(TMP, 'u.txt')) == 'ok')

        resp = os.path.join(TMP, 'respaldo.json')
        with open(resp, 'w', encoding='utf-8') as fh:
            json.dump(RESPALDO, fh, ensure_ascii=False)
        filas_out = os.path.join(TMP, 'filas.json')
        r = macro(doc, 'modPruebas.PruebaRespaldo', resp, filas_out)
        ok('La macro de importación corre sin errores', r == 'ok', r)
        with open(filas_out, encoding='utf-8') as fh:
            filas = json.load(fh)
        for clave, esperado in ESPERADO_RESPALDO.items():
            ok(f'Importar respaldo → {clave}', filas[clave] == esperado, f'obtenido {filas[clave]}\n    esperado {esperado}')

        exp = os.path.join(TMP, 'export.json')
        r = macro(doc, 'modPruebas.PruebaExportar', exp)
        ok('La macro de exportación corre sin errores', r == 'ok', r)
        with open(exp, encoding='utf-8') as fh:
            e = json.load(fh)
        ok('Exportar: formato que acepta "Cargar backup" de la app', e['version'] == 2 and isinstance(e['entradas'], list))
        ok('Exportar: omite filas vacías', len(e['entradas']) == 1 and len(e['produccion']) == 1)
        en = e['entradas'][0]
        ok('Exportar: entrada con cantidades, base y factor', (en['id'], en['fecha'], en['insumo'], en['unidad'], en['cantidad'],
           en['cantidadBase'], en['unidadBase'], en['factorBase'], en['precio'], en['precioTotal'], en['totalDoc']) ==
           (7, '2026-09-30', 'Harina de trigo', 'saco', 2, 100000, 'gramo', 50000, 150, 300, 300), en)
        ok('Exportar: textos con comillas y saltos de línea', en['proveedor'] == 'Molino "El Sol"' and en['obs'] == 'línea 1\nnota')
        pr = e['produccion'][0]
        ok('Exportar: producción en minúsculas como la app (pan)', (pr['tipo'], pr['cantidad'], pr['neto'], pr['id']) == ('pan', 1400, 1380, 1000001), pr)
        c = e['catalogos'][0]
        ok('Exportar: catálogo (insumos, panes, pasteles, unidades base)',
           c['insumos'] == ['Harina de trigo', 'Huevos'] and c['panes'] == ['Pan francés'] and c['pasteles'] == ['Torta']
           and c['baseUnits']['insumos'] == {'Harina de trigo': 'gramo', 'Huevos': 'unidad'}
           and c['unidades']['insumos'] == {'Harina de trigo': ['gramo'], 'Huevos': ['unidad']}, c)
        ok('Exportar: equivalencias agrupadas por tipo de artículo',
           c['equivalencias']['insumos'] == {'Harina de trigo': [{'nombre': 'saco', 'unidad': 'saco', 'factor': 50000, 'detalle': 'saco 50 kg'}]}
           and c['equivalencias']['panes'] == {'Pan francés': [{'nombre': 'bolsa', 'unidad': 'bolsa', 'factor': 10, 'detalle': ''}]}, c['equivalencias'])
        ok('Exportar: destinos y encargados', c['destinos'] == ['Tienda', 'Delivery'] and c['encargados'] == ['Encargado 1'])
    finally:
        doc.close(True)


def probar_final(lo):
    print('\n▶ Libro final (el que se entrega)')
    ruta = os.path.join(TMP, 'PanControl.xlsm')
    construir(ruta)
    doc = lo.abrir(ruta)
    try:
        modulos = set(doc.BasicLibraries.getByName('VBAProject').getElementNames())
        ok('Trae las macros y NO el módulo de pruebas', 'modPanControl' in modulos and 'modPruebas' not in modulos, modulos)
        doc.calculateAll()
        ok('Abre sin errores de fórmula', not errores_de_formula(doc), errores_de_formula(doc)[:5])
        ok('Sin movimientos: tarjetas en 0', num(doc, 'Inicio!B10') == 0 and num(doc, 'Inicio!H10') == 0)
        ok('Catálogo de ejemplo cargado', txt(doc, 'Insumos!B6') == 'Harina de trigo' and txt(doc, 'Productos!B6') == 'Pan francés')
        nombres = set(doc.NamedRanges.getElementNames())
        ok('Nombres de los formularios definidos', {'entInsumo', 'salCantidad', 'proProducto', 'sprProducto', 'rngDesde', 'calcProducto',
                                                    'entMensaje', 'lstInsumos'} <= nombres, sorted(nombres)[:20])
    finally:
        doc.close(True)


if __name__ == '__main__':
    print('▶ Revisión estática del VBA')
    r = subprocess.run([sys.executable, os.path.join(AQUI, 'verificar_vba.py')], capture_output=True, text=True)
    ok('Todas las funciones llamadas existen y las variables están declaradas', r.returncode == 0, r.stdout[-800:])
    try:
        with LibreOffice() as lo:
            probar_formulas(lo)
            probar_final(lo)
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
    print(f'\n══════════════════════════════════\nResultado: {pasadas} pasadas, {falladas} falladas')
    sys.exit(1 if falladas else 0)
