"""Construye PanControl.xlsm: la versión en Excel (con macros) de PanControl.

Uso:  python3 excel/construir_excel.py [salida.xlsm] [--datos-prueba] [--modulo-pruebas]

- Todo el cálculo (stock, resúmenes, calculadora) está en FÓRMULAS: funciona
  también en Excel de tablet/celular y en Excel en la web, donde las macros no
  corren. Las macros (excel/vba/*.bas) solo agregan comodidad en Excel de PC:
  formularios con botón "Guardar", importar/exportar el respaldo de la app web.
- --datos-prueba agrega movimientos de ejemplo (lo usan las pruebas).
- --modulo-pruebas incluye excel/vba/pruebas/*.bas (lo usan las pruebas).
"""
import datetime
import glob
import os
import sys

import xlsxwriter

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import vba_project  # noqa: E402

# ── Colores de la app (public/style.css) ─────────────────────────────────────
CAFE, CAFE2, NARANJA, CREMA, CREMA2, CREMA3 = '#3D1A06', '#7A3B12', '#C8511A', '#FFF8F0', '#F0E4D4', '#E8D8C8'
VERDE, ROJO, DORADO, GRIS = '#2D6A4F', '#9B2335', '#C8920A', '#7A6E68'

UNIDADES = ['unidad', 'porcion', 'kilogramo', 'kilo', 'gramo', 'libra', 'litro', 'mililitro', 'docena', 'jaba', 'caja',
            'bolsa', 'paquete', 'bandeja', 'plancha', 'lata', 'tarro', 'porongo', 'balde', 'casillero', 'pastel entero',
            'saco', 'quintal']
TIPOS_DOC = 'Boleta,Factura,Otro'
MOTIVOS = 'Usado en Producción,Merma / Pérdida,Devolución,Otro'
TURNOS = 'Mañana,Tarde,Noche'
FILAS_VALIDACION = 3000  # filas de las tablas que reciben listas desplegables
N_LISTA = 15             # filas de cada lista del resumen en Inicio

# Fórmulas reutilizadas
def F_FACTOR(t, art, pres):
    """Factor de la presentación: el registrado al guardar, o el del catálogo de equivalencias, o 1."""
    return (f'IF({t}[[#This Row],[Factor registrado]]>0,{t}[[#This Row],[Factor registrado]],'
            f'IF(SUMIFS(tblEquivalencias[Factor],tblEquivalencias[Artículo],{t}[[#This Row],[{art}]],tblEquivalencias[Presentación],{t}[[#This Row],[{pres}]])>0,'
            f'SUMIFS(tblEquivalencias[Factor],tblEquivalencias[Artículo],{t}[[#This Row],[{art}]],tblEquivalencias[Presentación],{t}[[#This Row],[{pres}]]),1))')


def F_UNIDAD_INSUMO(ref):
    return f'IFERROR(INDEX(tblInsumos[Unidad base],MATCH({ref},tblInsumos[Insumo],0)),"")'


def F_UNIDAD_PRODUCTO(ref):
    return f'IFERROR(INDEX(tblProductos[Unidad base],MATCH({ref},tblProductos[Producto],0)),"")'


def FNUM(e):
    """Número como texto, con separadores de la configuración regional (FIXED) y sin decimales si es entero."""
    return f'IF(({e})=INT({e}),FIXED({e},0),FIXED({e},3))'


def F_FACTOR_FORM(art, pres):
    x = f'SUMIFS(tblEquivalencias[Factor],tblEquivalencias[Artículo],{art},tblEquivalencias[Presentación],{pres})'
    return f'IF({x}>0,{x},1)'


EN_PERIODO = lambda t: f'{t}[Fecha],">="&rngDesde,{t}[Fecha],"<="&rngHasta'  # noqa: E731


def construir(salida, datos_prueba=False, modulo_pruebas=False):
    wb = xlsxwriter.Workbook(salida)
    wb.set_vba_name('ThisWorkbook')
    wb.set_properties({'title': 'PanControl', 'subject': 'Sistema de Producción — versión Excel',
                       'author': 'PanControl', 'comments': 'Generado por excel/construir_excel.py'})
    wb.set_calc_mode('auto')

    # ── Formatos ──
    f = {}
    def fmt(nombre, **kw):
        base = {'font_name': 'Calibri', 'font_size': 11, 'valign': 'vcenter'}
        base.update(kw)
        f[nombre] = wb.add_format(base)
    fmt('titulo', bold=True, font_size=20, font_color=CAFE)
    fmt('subtitulo', italic=True, font_color=GRIS)
    fmt('seccion', bold=True, font_size=13, font_color=CAFE, bottom=2, bottom_color=NARANJA)
    fmt('label', bold=True, font_color=CAFE2, align='right', bg_color=CREMA)
    fmt('input', bg_color='#FFFFFF', border=1, border_color=NARANJA, num_format='@')  # texto: "1-2" no se vuelve fecha
    fmt('texto', num_format='@')
    fmt('input_fecha', bg_color='#FFFFFF', border=1, border_color=NARANJA, num_format='dd/mm/yyyy', align='left')
    fmt('input_num', bg_color='#FFFFFF', border=1, border_color=NARANJA, num_format='General', align='left')
    fmt('input_dinero', bg_color='#FFFFFF', border=1, border_color=NARANJA, num_format='"S/ "#,##0.00', align='left')
    fmt('info', italic=True, font_color=VERDE, bg_color=CREMA2)
    fmt('mensaje', bold=True, font_color=VERDE, bg_color=CREMA)
    fmt('nota', italic=True, font_color=GRIS, font_size=10, text_wrap=True, valign='top')
    fmt('fondo_form', bg_color=CREMA)
    fmt('fecha', num_format='dd/mm/yyyy', align='left')
    fmt('num', num_format='General')
    fmt('dinero', num_format='"S/ "#,##0.00')
    fmt('card_lbl', bold=True, font_color='#FFFFFF', bg_color=CAFE, align='center', font_size=10)
    fmt('card_val', bold=True, font_size=22, font_color=CAFE, bg_color=CREMA2, align='center', num_format='General')
    fmt('card_sub', font_color=GRIS, bg_color=CREMA2, align='center', font_size=10)
    fmt('lista_hdr', bold=True, font_color='#FFFFFF', bg_color=NARANJA, border=1, border_color=CREMA3)
    fmt('lista', border=1, border_color=CREMA3)
    fmt('lista_num', border=1, border_color=CREMA3, num_format='General')
    fmt('lista_rojo', border=1, border_color=CREMA3, num_format='General', font_color=ROJO, bold=True)
    fmt('lista_nota', italic=True, font_color=GRIS, font_size=9)
    fmt('periodo_out', bg_color=CREMA2, num_format='dd/mm/yyyy', align='left', font_color=CAFE2)
    fmt('salida_num', bg_color=CREMA2, num_format='General', align='left', font_color=CAFE2)

    prueba = DATOS_PRUEBA if datos_prueba else {}
    hojas = {}
    def hoja(nombre, codigo, color=None):
        ws = wb.add_worksheet(nombre)
        ws.set_vba_name(codigo)
        ws.hide_gridlines(2)
        ws.set_column('A:A', 2)
        if color:
            ws.set_tab_color(color)
        ws.set_landscape()
        ws.set_paper(9)          # A4
        ws.fit_to_pages(1, 0)    # al imprimir: una página de ancho
        ws.set_margins(0.4, 0.4, 0.5, 0.5)
        hojas[codigo] = ws
        return ws

    inicio = hoja('Inicio', 'shInicio', CAFE)
    ent = hoja('Entradas', 'shEntradas', VERDE)
    sal = hoja('Salidas insumos', 'shSalidasIns', ROJO)
    prod = hoja('Producción', 'shProduccion', NARANJA)
    salp = hoja('Salidas productos', 'shSalidasProd', ROJO)
    insu = hoja('Insumos', 'shInsumos', DORADO)
    prods = hoja('Productos', 'shProductos', DORADO)
    cat = hoja('Catálogos', 'shCatalogos', GRIS)
    rec = hoja('Recetas', 'shRecetas', CAFE2)
    calc = hoja('Calculadora', 'shCalculadora', CAFE2)

    def boton(ws, celda, texto, macro, ancho=150, alto=28):
        ws.insert_button(celda, {'macro': macro, 'caption': texto, 'width': ancho, 'height': alto})

    def encabezado(ws, titulo, subtitulo, ancho_titulo='B1:H1'):
        ws.set_row(0, 34)
        ws.merge_range(ancho_titulo, titulo, f['titulo'])
        ws.write('B2', subtitulo, f['subtitulo'])
        boton(ws, 'J1', 'Ir a Inicio', 'IrInicio', 110, 26)

    def nombre(n, ws_nombre, celda):
        hoja_ref = f"'{ws_nombre}'" if any(c in ws_nombre for c in " áéíóúñ.") else ws_nombre
        col = ''.join(ch for ch in celda if ch.isalpha())
        fila = ''.join(ch for ch in celda if ch.isdigit())
        wb.define_name(n, f'={hoja_ref}!${col}${fila}')

    def tabla(ws, fila0, col0, nombre_t, columnas, datos=None, estilo='Table Style Medium 3', anchos=None, ocultas=()):
        """columnas: lista de (encabezado, formula|None, formato|None)."""
        datos = datos or [[None] * len(columnas)]
        cols = []
        for enc, formula, fm in columnas:
            c = {'header': enc}
            if formula:
                c['formula'] = formula
            if fm:
                c['format'] = f[fm]
            elif not formula:
                c['format'] = f['texto']  # columnas de texto: guardan lo escrito tal cual
            cols.append(c)
        filas = []
        for fila in datos:
            filas.append([v for v in fila] + [None] * (len(columnas) - len(fila)))
        ultima_fila = fila0 + len(filas)
        ws.add_table(fila0, col0, ultima_fila, col0 + len(columnas) - 1,
                     {'name': nombre_t, 'columns': cols, 'data': filas, 'style': estilo})
        # Las fórmulas de la tabla pisan los datos en sus columnas; reescribir datos en columnas sin fórmula.
        if anchos:
            for i, a in enumerate(anchos):
                ws.set_column(col0 + i, col0 + i, a, None, {'hidden': columnas[i][0] in ocultas})
        return fila0, ultima_fila

    # ════════════════════════ CATÁLOGOS ════════════════════════
    encabezado(cat, 'Catálogos', 'Equivalencias de presentaciones y listas de opciones')
    cat.merge_range('B3:H4', 'Equivalencias: 1 [Presentación] de un artículo = [Factor] en su unidad base. '
                    'Ej.: 1 saco de Harina de trigo = 50000 gramo. Las entradas y salidas usan esto para '
                    'convertir todo a la unidad base del inventario.', f['nota'])
    cat.set_row(2, 30)
    equivalencias = [
        ['Harina de trigo', 'saco', 50000, None, 'saco de 50 kg'],
        ['Harina de trigo', 'kilogramo', 1000, None, ''],
        ['Azúcar', 'saco', 50000, None, 'saco de 50 kg'],
        ['Azúcar', 'kilogramo', 1000, None, ''],
        ['Levadura', 'paquete', 500, None, 'paquete de 500 g'],
        ['Mantequilla', 'kilogramo', 1000, None, ''],
        ['Huevos', 'jaba', 30, None, 'jaba de 30'],
        ['Leche', 'litro', 1000, None, ''],
        ['Pan francés', 'bolsa', 10, None, 'bolsa de 10'],
    ]
    tabla(cat, 5, 1, 'tblEquivalencias', [
        ('Artículo', None, None), ('Presentación', None, None), ('Factor', None, 'num'),
        ('Unidad base', 'IFERROR(INDEX(tblInsumos[Unidad base],MATCH(tblEquivalencias[[#This Row],[Artículo]],tblInsumos[Insumo],0)),'
                        'IFERROR(INDEX(tblProductos[Unidad base],MATCH(tblEquivalencias[[#This Row],[Artículo]],tblProductos[Producto],0)),""))', None),
        ('Detalle', None, None)], equivalencias, anchos=[24, 16, 12, 14, 26])
    cat.write('H6', '', None)
    tabla(cat, 5, 8, 'tblUnidades', [('Unidad', None, None)], [[u] for u in UNIDADES], estilo='Table Style Medium 7', anchos=[18])
    tabla(cat, 5, 10, 'tblDestinos', [('Destino', None, None)], [['Tienda principal'], ['Delivery'], ['Pedido especial']],
          estilo='Table Style Medium 7', anchos=[22])
    tabla(cat, 5, 12, 'tblEncargados', [('Encargado', None, None)], [['Encargado 1']], estilo='Table Style Medium 7', anchos=[22])
    cat.set_column('H:H', 3)
    cat.set_column('J:J', 3)
    cat.set_column('L:L', 3)

    # ════════════════════════ INSUMOS (inventario + catálogo) ════════════════════════
    encabezado(insu, 'Inventario de insumos', 'Esta lista es también el catálogo de insumos: agrega aquí los nuevos.')
    insu.merge_range('B3:L3', 'Cantidades en la UNIDAD BASE de cada insumo. Escribe el stock inicial, los ajustes (±) y el '
                     'mínimo; las entradas, salidas y el stock se calculan solos.', f['nota'])
    insu.set_row(2, 30)
    boton(insu, 'L1', 'Ver bajo mínimo', 'FiltrarBajoMinimo', 120, 26)
    boton(insu, 'N1', 'Ver todo', 'QuitarFiltros', 90, 26)
    T = 'tblInsumos'
    insumos = [['Harina de trigo', 'gramo', 100000, 0, 0], ['Azúcar', 'gramo', 20000, 0, 0], ['Levadura', 'gramo', 1000, 0, 0],
               ['Sal', 'gramo', 2000, 0, 0], ['Mantequilla', 'gramo', 5000, 0, 0], ['Huevos', 'unidad', 60, 0, 0],
               ['Leche', 'mililitro', 5000, 0, 0]]
    tabla(insu, 4, 1, T, [
        ('Insumo', None, None), ('Unidad base', None, None), ('Mínimo', None, 'num'), ('Stock inicial', None, 'num'), ('Ajuste', None, 'num'),
        ('Entradas', f'SUMIFS(tblEntradas[Cant. base],tblEntradas[Insumo],{T}[[#This Row],[Insumo]])', 'num'),
        ('Salidas', f'SUMIFS(tblSalidasIns[Cant. base],tblSalidasIns[Insumo],{T}[[#This Row],[Insumo]])', 'num'),
        ('Stock', f'{T}[[#This Row],[Stock inicial]]+{T}[[#This Row],[Entradas]]-{T}[[#This Row],[Salidas]]+{T}[[#This Row],[Ajuste]]', 'num'),
        ('Estado', f'IF({T}[[#This Row],[Insumo]]="","",IF(AND({T}[[#This Row],[Mínimo]]>0,{T}[[#This Row],[Stock]]<={T}[[#This Row],[Mínimo]]),'
                   f'"🔴 Bajo mínimo",IF(AND({T}[[#This Row],[Mínimo]]>0,{T}[[#This Row],[Stock]]<={T}[[#This Row],[Mínimo]]*1.5),"🟡 Por reponer","🟢 OK")))', None),
        ('Ent. periodo', f'SUMIFS(tblEntradas[Cant. base],tblEntradas[Insumo],{T}[[#This Row],[Insumo]],{EN_PERIODO("tblEntradas")})', 'num'),
        ('Sal. periodo', f'SUMIFS(tblSalidasIns[Cant. base],tblSalidasIns[Insumo],{T}[[#This Row],[Insumo]],{EN_PERIODO("tblSalidasIns")})', 'num'),
        # Ayudantes para las listas de Inicio (ocultos)
        ('Mov', f'IF(AND({T}[[#This Row],[Insumo]]<>"",{T}[[#This Row],[Ent. periodo]]+{T}[[#This Row],[Sal. periodo]]>0),1,0)', None),
        ('NumMov', f'IF({T}[[#This Row],[Mov]]=1,SUM(INDEX({T}[Mov],1):{T}[[#This Row],[Mov]]),"")', None),
        ('Crit', f'IF(AND({T}[[#This Row],[Insumo]]<>"",{T}[[#This Row],[Mínimo]]>0,{T}[[#This Row],[Stock]]<={T}[[#This Row],[Mínimo]]),1,0)', None),
        ('NumCrit', f'IF({T}[[#This Row],[Crit]]=1,SUM(INDEX({T}[Crit],1):{T}[[#This Row],[Crit]]),"")', None),
    ], insumos, anchos=[26, 13, 12, 13, 10, 13, 13, 13, 16, 13, 13, 6, 6, 6, 6], ocultas=('Mov', 'NumMov', 'Crit', 'NumCrit'))
    insu.freeze_panes(5, 2)

    # ════════════════════════ PRODUCTOS (inventario + catálogo) ════════════════════════
    encabezado(prods, 'Inventario de productos', 'Esta lista es también el catálogo de panes y pasteles: agrega aquí los nuevos.')
    prods.merge_range('B3:L3', 'Tipo: Pan o Pastel. "Rinde por lote" lo usa la Calculadora. El stock se calcula con la producción neta '
                      'menos las salidas.', f['nota'])
    prods.set_row(2, 30)
    T = 'tblProductos'
    productos = [['Pan francés', 'Pan', 'unidad', 1400, 0, 0], ['Pan de molde', 'Pan', 'unidad', 60, 0, 0],
                 ['Torta de chocolate', 'Pastel', 'unidad', 1, 0, 0], ['Cupcake', 'Pastel', 'unidad', 24, 0, 0]]
    tabla(prods, 4, 1, T, [
        ('Producto', None, None), ('Tipo', None, None), ('Unidad base', None, None), ('Rinde por lote', None, 'num'),
        ('Stock inicial', None, 'num'), ('Ajuste', None, 'num'),
        ('Producido', f'SUMIFS(tblProduccion[Neto],tblProduccion[Producto],{T}[[#This Row],[Producto]])', 'num'),
        ('Salidas', f'SUMIFS(tblSalidasProd[Cant. base],tblSalidasProd[Producto],{T}[[#This Row],[Producto]])', 'num'),
        ('Stock', f'{T}[[#This Row],[Stock inicial]]+{T}[[#This Row],[Producido]]-{T}[[#This Row],[Salidas]]+{T}[[#This Row],[Ajuste]]', 'num'),
        ('Prod. periodo', f'SUMIFS(tblProduccion[Neto],tblProduccion[Producto],{T}[[#This Row],[Producto]],{EN_PERIODO("tblProduccion")})', 'num'),
        ('Sal. periodo', f'SUMIFS(tblSalidasProd[Cant. base],tblSalidasProd[Producto],{T}[[#This Row],[Producto]],{EN_PERIODO("tblSalidasProd")})', 'num'),
        ('ProdF', f'IF(AND({T}[[#This Row],[Producto]]<>"",{T}[[#This Row],[Prod. periodo]]<>0),1,0)', None),
        ('NumProd', f'IF({T}[[#This Row],[ProdF]]=1,SUM(INDEX({T}[ProdF],1):{T}[[#This Row],[ProdF]]),"")', None),
        ('SalF', f'IF(AND({T}[[#This Row],[Producto]]<>"",{T}[[#This Row],[Sal. periodo]]<>0),1,0)', None),
        ('NumSal', f'IF({T}[[#This Row],[SalF]]=1,SUM(INDEX({T}[SalF],1):{T}[[#This Row],[SalF]]),"")', None),
    ], productos, anchos=[26, 10, 13, 13, 13, 10, 13, 13, 13, 14, 13, 6, 6, 6, 6], ocultas=('ProdF', 'NumProd', 'SalF', 'NumSal'))
    prods.freeze_panes(5, 2)
    prods.data_validation(5, 2, 5 + FILAS_VALIDACION, 2, {'validate': 'list', 'source': 'Pan,Pastel'})

    # ════════════════════════ Formularios (hojas de movimientos) ════════════════════════
    def formulario(ws, prefijo, campos, fila_info, info_formula, botones, etiqueta_info='Equivale a'):
        """campos: (fila, lado 0/1, etiqueta, nombre, tipo, opciones). tipo: texto|fecha|num|dinero|lista|lista_libre|obs
        Rejilla sobre las columnas de la tabla de abajo: etiqueta B:C, campo D:E | etiqueta F, campo G:H."""
        LBL = {0: (1, 2), 1: (5, 5)}
        INP = {0: (3, 4), 1: (6, 7)}
        for r in range(3, fila_info + 2):
            for c in range(1, 8):
                ws.write_blank(r, c, None, f['fondo_form'])
        for fila, lado, etiqueta, nom, tipo, opciones in campos:
            l0, l1 = LBL[lado]
            i0, i1 = INP[lado] if tipo != 'obs' else (3, 7)
            if l0 == l1:
                ws.write(fila, l0, etiqueta, f['label'])
            else:
                ws.merge_range(fila, l0, fila, l1, etiqueta, f['label'])
            formato = {'fecha': 'input_fecha', 'num': 'input_num', 'dinero': 'input_dinero'}.get(tipo, 'input')
            ws.merge_range(fila, i0, fila, i1, '', f[formato])
            if tipo == 'fecha':
                ws.write_formula(fila, i0, '=TODAY()', f[formato])
            if tipo in ('lista', 'lista_libre'):
                dv = {'validate': 'list', 'source': opciones}
                if tipo == 'lista_libre':
                    dv.update({'error_type': 'information', 'error_title': 'PanControl',
                               'error_message': 'Ese valor no está en la lista. Si es correcto, pulsa Aceptar.'})
                ws.data_validation(fila, i0, fila, i0, dv)
            elif tipo in ('num', 'dinero'):
                ws.data_validation(fila, i0, fila, i0, {'validate': 'decimal', 'criteria': '>=', 'value': 0,
                                                        'error_message': 'Escribe un número (0 o más).'})
            elif tipo == 'fecha':
                ws.data_validation(fila, i0, fila, i0, {'validate': 'date', 'criteria': 'between',
                                                        'minimum': datetime.date(2000, 1, 1), 'maximum': datetime.date(2100, 12, 31),
                                                        'error_message': 'Escribe una fecha válida (dd/mm/aaaa).'})
            nombre(prefijo + nom, ws.name, xlsxwriter.utility.xl_rowcol_to_cell(fila, i0))
        ws.merge_range(fila_info, 1, fila_info, 2, etiqueta_info, f['label'])
        ws.merge_range(fila_info, 3, fila_info, 7, '', f['info'])
        ws.write_formula(fila_info, 3, info_formula, f['info'])
        ws.merge_range(fila_info + 1, 3, fila_info + 1, 7, '', f['mensaje'])
        nombre(prefijo + 'Mensaje', ws.name, xlsxwriter.utility.xl_rowcol_to_cell(fila_info + 1, 3))
        for i, (texto, macro) in enumerate(botones):
            boton(ws, xlsxwriter.utility.xl_rowcol_to_cell(3 + i * 2, 9), texto, macro, 170, 30)

    def nota_tablet(ws, fila):
        ws.merge_range(fila, 1, fila, 9, 'En tablet o celular los botones no funcionan: escribe directo en la tabla de abajo '
                       '(las columnas grises se calculan solas). En la PC usa el formulario y el botón Guardar.', f['nota'])
        ws.set_row(fila, 28)

    def validar_columna(ws, fila_hdr, col, dv):
        ws.data_validation(fila_hdr + 1, col, fila_hdr + FILAS_VALIDACION, col, dv)

    LISTA_INSUMOS = {'validate': 'list', 'source': '=lstInsumos'}
    LISTA_PRODUCTOS = {'validate': 'list', 'source': '=lstProductos'}
    LISTA_UNIDADES = {'validate': 'list', 'source': '=lstUnidades', 'error_type': 'information',
                      'error_message': 'Esa presentación no está en la lista de Catálogos. Si es correcta, pulsa Aceptar.'}

    # ── Entradas ──
    encabezado(ent, 'Entradas de insumos', 'Compras y entradas de materia prima')
    formulario(ent, 'ent', [
        (3, 0, 'Fecha', 'Fecha', 'fecha', None), (3, 1, 'Tipo doc.', 'TipoDoc', 'lista', TIPOS_DOC),
        (4, 0, 'N° documento', 'NumDoc', 'texto', None), (4, 1, 'Proveedor', 'Proveedor', 'texto', None),
        (5, 0, 'Insumo', 'Insumo', 'lista', '=lstInsumos'), (5, 1, 'Presentación', 'Presentacion', 'lista_libre', '=lstUnidades'),
        (6, 0, 'Cantidad', 'Cantidad', 'num', None), (6, 1, 'Precio total', 'PrecioTotal', 'dinero', None),
        (7, 0, 'Observación', 'Obs', 'obs', None),
    ], 8, '=IF(OR(entInsumo="",entCantidad=""),"Elige insumo, presentación y cantidad",'
          '' + FNUM('entCantidad*' + F_FACTOR_FORM('entInsumo', 'entPresentacion')) + ''
          '&" "&' + F_UNIDAD_INSUMO('entInsumo') + ')',
        [('Guardar línea', 'GuardarEntrada'), ('Limpiar formulario', 'LimpiarEntrada'), ('Eliminar fila seleccionada', 'EliminarFila')])
    ent.merge_range('B11:F11', 'Tip: para una factura con varios insumos, pulsa "Guardar línea" por cada insumo; la fecha, '
                    'el documento y el proveedor se mantienen.', f['nota'])
    nota_tablet(ent, 12)
    T = 'tblEntradas'
    fila_hdr = 14
    tabla(ent, fila_hdr, 1, T, datos=prueba.get(T), columnas=[
        ('ID', None, 'num'), ('Fecha', None, 'fecha'), ('Tipo doc.', None, None), ('N° doc.', None, None), ('Proveedor', None, None),
        ('Insumo', None, None), ('Presentación', None, None), ('Cantidad', None, 'num'),
        ('Factor', F_FACTOR(T, 'Insumo', 'Presentación'), 'num'),
        ('Cant. base', f'{T}[[#This Row],[Cantidad]]*{T}[[#This Row],[Factor]]', 'num'),
        ('Unidad base', F_UNIDAD_INSUMO(f'{T}[[#This Row],[Insumo]]'), None),
        ('Precio unit.', f'IFERROR({T}[[#This Row],[Precio total]]/{T}[[#This Row],[Cantidad]],0)', 'dinero'),
        ('Precio total', None, 'dinero'), ('Total doc.', None, 'dinero'), ('Obs.', None, None), ('Factor registrado', None, 'num'),
    ], anchos=[8, 12, 10, 12, 18, 22, 13, 10, 9, 12, 11, 12, 12, 12, 24, 8], ocultas=('Factor registrado',))
    validar_columna(ent, fila_hdr, 2, {'validate': 'date', 'criteria': '>', 'value': datetime.date(2000, 1, 1)})
    validar_columna(ent, fila_hdr, 3, {'validate': 'list', 'source': TIPOS_DOC})
    validar_columna(ent, fila_hdr, 6, LISTA_INSUMOS)
    validar_columna(ent, fila_hdr, 7, LISTA_UNIDADES)

    # ── Salidas de insumos ──
    encabezado(sal, 'Salidas de insumos', 'Insumos usados en producción, mermas y devoluciones')
    formulario(sal, 'sal', [
        (3, 0, 'Fecha', 'Fecha', 'fecha', None), (3, 1, 'Motivo', 'Motivo', 'lista', MOTIVOS),
        (4, 0, 'Ticket', 'Ticket', 'texto', None),
        (5, 0, 'Insumo', 'Insumo', 'lista', '=lstInsumos'), (5, 1, 'Presentación', 'Presentacion', 'lista_libre', '=lstUnidades'),
        (6, 0, 'Cantidad', 'Cantidad', 'num', None),
        (7, 0, 'Observación', 'Obs', 'obs', None),
    ], 8, '=IF(OR(salInsumo="",salCantidad=""),"Elige insumo, presentación y cantidad",'
          '' + FNUM('salCantidad*' + F_FACTOR_FORM('salInsumo', 'salPresentacion')) + ''
          '&" "&' + F_UNIDAD_INSUMO('salInsumo') + '&"  ·  stock actual: "&' + FNUM('IFERROR(INDEX(tblInsumos[Stock],MATCH(salInsumo,tblInsumos[Insumo],0)),0)') + ')',
        [('Guardar línea', 'GuardarSalidaInsumo'), ('Limpiar formulario', 'LimpiarSalidaInsumo'), ('Eliminar fila seleccionada', 'EliminarFila')])
    nota_tablet(sal, 12)
    T = 'tblSalidasIns'
    tabla(sal, fila_hdr, 1, T, datos=prueba.get(T), columnas=[
        ('ID', None, 'num'), ('Fecha', None, 'fecha'), ('Motivo', None, None), ('Ticket', None, None),
        ('Insumo', None, None), ('Presentación', None, None), ('Cantidad', None, 'num'),
        ('Factor', F_FACTOR(T, 'Insumo', 'Presentación'), 'num'),
        ('Cant. base', f'{T}[[#This Row],[Cantidad]]*{T}[[#This Row],[Factor]]', 'num'),
        ('Unidad base', F_UNIDAD_INSUMO(f'{T}[[#This Row],[Insumo]]'), None),
        ('Obs.', None, None), ('Factor registrado', None, 'num'),
    ], anchos=[8, 12, 20, 10, 22, 13, 10, 9, 12, 11, 30, 8], ocultas=('Factor registrado',))
    validar_columna(sal, fila_hdr, 2, {'validate': 'date', 'criteria': '>', 'value': datetime.date(2000, 1, 1)})
    validar_columna(sal, fila_hdr, 3, {'validate': 'list', 'source': MOTIVOS})
    validar_columna(sal, fila_hdr, 5, LISTA_INSUMOS)
    validar_columna(sal, fila_hdr, 6, LISTA_UNIDADES)

    # ── Producción ──
    encabezado(prod, 'Producción', 'Panes y pasteles producidos por turno')
    formulario(prod, 'pro', [
        (3, 0, 'Fecha', 'Fecha', 'fecha', None), (3, 1, 'Turno', 'Turno', 'lista', TURNOS),
        (4, 0, 'Producto', 'Producto', 'lista', '=lstProductos'),
        (5, 0, 'Presentación', 'Presentacion', 'lista_libre', '=lstUnidades'), (5, 1, 'Cant. presentación', 'CantPresentacion', 'num', None),
        (6, 0, 'Unidad teórica', 'UnidadTeorica', 'lista_libre', '=lstUnidades'), (6, 1, 'Cant. teórica', 'CantTeorica', 'num', None),
        (7, 0, 'Producido (unid.)', 'Producido', 'num', None), (7, 1, 'Defectuoso', 'Defectuoso', 'num', None),
        (8, 0, 'Observación', 'Obs', 'obs', None),
    ], 9, '=IF(proProducto="","Elige el producto",'
          '"Tipo: "&IFERROR(INDEX(tblProductos[Tipo],MATCH(proProducto,tblProductos[Producto],0)),"?")&"  ·  Neto: "&' + FNUM('N(proProducido)-N(proDefectuoso)') + ')',
        [('Guardar producción', 'GuardarProduccion'), ('Limpiar formulario', 'LimpiarProduccion'), ('Eliminar fila seleccionada', 'EliminarFila')],
        etiqueta_info='Resumen')
    prod.merge_range('B12:F12', 'Ej. pan: Presentación "lata", Cant. presentación 20, Unidad teórica "quintal", Cant. teórica 1, '
                     'Producido 1400.', f['nota'])
    nota_tablet(prod, 13)
    T = 'tblProduccion'
    fila_hdr_p = 15
    tabla(prod, fila_hdr_p, 1, T, datos=prueba.get(T), columnas=[
        ('ID', None, 'num'), ('Fecha', None, 'fecha'), ('Turno', None, None), ('Tipo', None, None), ('Producto', None, None),
        ('Presentación', None, None), ('Cant. presentación', None, 'num'), ('Unidad teórica', None, None), ('Cant. teórica', None, 'num'),
        ('Producido', None, 'num'), ('Defectuoso', None, 'num'),
        ('Neto', f'N({T}[[#This Row],[Producido]])-N({T}[[#This Row],[Defectuoso]])', 'num'),
        ('Obs.', None, None),
    ], anchos=[8, 12, 10, 9, 22, 13, 16, 14, 12, 11, 11, 10, 30])
    validar_columna(prod, fila_hdr_p, 2, {'validate': 'date', 'criteria': '>', 'value': datetime.date(2000, 1, 1)})
    validar_columna(prod, fila_hdr_p, 3, {'validate': 'list', 'source': TURNOS})
    validar_columna(prod, fila_hdr_p, 4, {'validate': 'list', 'source': 'Pan,Pastel'})
    validar_columna(prod, fila_hdr_p, 5, LISTA_PRODUCTOS)
    validar_columna(prod, fila_hdr_p, 6, LISTA_UNIDADES)
    validar_columna(prod, fila_hdr_p, 8, LISTA_UNIDADES)

    # ── Salidas de productos ──
    encabezado(salp, 'Salidas de productos', 'Panes y pasteles que salen a tienda, delivery o pedidos')
    formulario(salp, 'spr', [
        (3, 0, 'Fecha', 'Fecha', 'fecha', None), (3, 1, 'Destino', 'Destino', 'lista_libre', '=lstDestinos'),
        (4, 0, 'Producto', 'Producto', 'lista', '=lstProductos'), (4, 1, 'Encargado', 'Encargado', 'lista_libre', '=lstEncargados'),
        (5, 0, 'Presentación', 'Presentacion', 'lista_libre', '=lstUnidades'), (5, 1, 'Documento', 'Documento', 'texto', None),
        (6, 0, 'Cantidad', 'Cantidad', 'num', None),
        (7, 0, 'Observación', 'Obs', 'obs', None),
    ], 8, '=IF(OR(sprProducto="",sprCantidad=""),"Elige producto, presentación y cantidad",'
          '' + FNUM('sprCantidad*' + F_FACTOR_FORM('sprProducto', 'sprPresentacion')) + ''
          '&" "&' + F_UNIDAD_PRODUCTO('sprProducto') + '&"  ·  stock actual: "&' + FNUM('IFERROR(INDEX(tblProductos[Stock],MATCH(sprProducto,tblProductos[Producto],0)),0)') + ')',
        [('Guardar salida', 'GuardarSalidaProducto'), ('Limpiar formulario', 'LimpiarSalidaProducto'), ('Eliminar fila seleccionada', 'EliminarFila')])
    nota_tablet(salp, 12)
    T = 'tblSalidasProd'
    tabla(salp, fila_hdr, 1, T, datos=prueba.get(T), columnas=[
        ('ID', None, 'num'), ('Fecha', None, 'fecha'), ('Categoría', None, None), ('Producto', None, None),
        ('Presentación', None, None), ('Cantidad', None, 'num'),
        ('Factor', F_FACTOR(T, 'Producto', 'Presentación'), 'num'),
        ('Cant. base', f'{T}[[#This Row],[Cantidad]]*{T}[[#This Row],[Factor]]', 'num'),
        ('Unidad base', F_UNIDAD_PRODUCTO(f'{T}[[#This Row],[Producto]]'), None),
        ('Destino', None, None), ('Encargado', None, None), ('Documento', None, None), ('Obs.', None, None),
        ('Factor registrado', None, 'num'),
    ], anchos=[8, 12, 11, 22, 13, 10, 9, 12, 11, 18, 16, 12, 26, 8], ocultas=('Factor registrado',))
    validar_columna(salp, fila_hdr, 2, {'validate': 'date', 'criteria': '>', 'value': datetime.date(2000, 1, 1)})
    validar_columna(salp, fila_hdr, 3, {'validate': 'list', 'source': 'Panes,Pasteles'})
    validar_columna(salp, fila_hdr, 4, LISTA_PRODUCTOS)
    validar_columna(salp, fila_hdr, 5, LISTA_UNIDADES)
    validar_columna(salp, fila_hdr, 10, {'validate': 'list', 'source': '=lstDestinos', 'error_type': 'information'})
    validar_columna(salp, fila_hdr, 11, {'validate': 'list', 'source': '=lstEncargados', 'error_type': 'information'})

    # ════════════════════════ RECETAS + CALCULADORA ════════════════════════
    encabezado(rec, 'Recetas', 'Insumos por lote de cada producto (en la unidad base del insumo)')
    rec.merge_range('B3:H3', 'Una fila por insumo. "Rinde por lote" se define en la hoja Productos. La Calculadora usa esta tabla.', f['nota'])
    T = 'tblRecetas'
    recetas = [['Pan francés', 'Harina de trigo', 46000], ['Pan francés', 'Sal', 920], ['Pan francés', 'Levadura', 460],
               ['Pan francés', 'Azúcar', 920], ['Pan francés', 'Mantequilla', 920],
               ['Torta de chocolate', 'Harina de trigo', 500], ['Torta de chocolate', 'Azúcar', 400],
               ['Torta de chocolate', 'Huevos', 6], ['Torta de chocolate', 'Mantequilla', 250], ['Torta de chocolate', 'Leche', 250]]
    tabla(rec, 4, 1, T, [
        ('Producto', None, None), ('Insumo', None, None), ('Cantidad por lote', None, 'num'),
        ('Unidad base', F_UNIDAD_INSUMO(f'{T}[[#This Row],[Insumo]]'), None),
        ('Sel', f'IF({T}[[#This Row],[Producto]]=calcProducto,1,0)', None),
        ('Orden', f'IF({T}[[#This Row],[Sel]]=1,SUM(INDEX({T}[Sel],1):{T}[[#This Row],[Sel]]),"")', None),
    ], recetas, anchos=[24, 24, 16, 13, 5, 5], ocultas=('Sel', 'Orden'))
    validar_columna(rec, 4, 1, LISTA_PRODUCTOS)
    validar_columna(rec, 4, 2, LISTA_INSUMOS)

    encabezado(calc, 'Calculadora de producción', '¿Cuánto insumo necesito y me alcanza el stock?')
    calc.set_column('B:B', 24)
    calc.set_column('C:H', 15)
    calc.write('B4', 'Producto', f['label'])
    calc.write('C4', 'Pan francés', f['input'])
    calc.data_validation('C4', LISTA_PRODUCTOS)
    nombre('calcProducto', calc.name, 'C4')
    calc.write('B5', 'Lotes a producir', f['label'])
    calc.write('C5', 1, f['input_num'])
    nombre('calcLotes', calc.name, 'C5')
    calc.write('B6', 'Rinde por lote', f['label'])
    calc.write_formula('C6', '=IFERROR(INDEX(tblProductos[Rinde por lote],MATCH(calcProducto,tblProductos[Producto],0)),0)', f['salida_num'])
    calc.write('B7', 'Unidades que salen', f['label'])
    calc.write_formula('C7', '=N(calcLotes)*C6', f['card_val'])
    hdr = ['Insumo', 'Por lote', 'Necesario', 'Unidad', 'Stock actual', '¿Alcanza?']
    for i, h in enumerate(hdr):
        calc.write(9, 1 + i, h, f['lista_hdr'])
    for k in range(1, 41):
        r = 9 + k
        celda_ins = f'B{r + 1}'
        calc.write_formula(r, 1, f'=IFERROR(INDEX(tblRecetas[Insumo],MATCH({k},tblRecetas[Orden],0)),"")', f['lista'])
        calc.write_formula(r, 2, f'=IF({celda_ins}="","",INDEX(tblRecetas[Cantidad por lote],MATCH({k},tblRecetas[Orden],0)))', f['lista_num'])
        calc.write_formula(r, 3, f'=IF({celda_ins}="","",C{r + 1}*N(calcLotes))', f['lista_num'])
        calc.write_formula(r, 4, f'=IF({celda_ins}="","",{F_UNIDAD_INSUMO(celda_ins)})', f['lista'])
        calc.write_formula(r, 5, f'=IF({celda_ins}="","",IFERROR(INDEX(tblInsumos[Stock],MATCH({celda_ins},tblInsumos[Insumo],0)),0))', f['lista_num'])
        calc.write_formula(r, 6, f'=IF({celda_ins}="","",IF(F{r + 1}>=D{r + 1},"✔ Sí","✖ Faltan "&' + FNUM(f'D{r + 1}-F{r + 1}') + '))', f['lista'])
    calc.conditional_format('G11:G50', {'type': 'text', 'criteria': 'begins with', 'value': '✖', 'format': wb.add_format({'font_color': ROJO, 'bold': True})})
    calc.conditional_format('G11:G50', {'type': 'text', 'criteria': 'begins with', 'value': '✔', 'format': wb.add_format({'font_color': VERDE, 'bold': True})})

    # ════════════════════════ INICIO ════════════════════════
    inicio.set_column('B:B', 22)
    inicio.set_column('C:F', 13)
    inicio.set_column('G:G', 3)
    inicio.set_column('H:H', 22)
    inicio.set_column('I:M', 13)
    inicio.set_row(0, 40)
    inicio.set_row(1, 20)
    inicio.set_row(2, 30)
    inicio.set_row(3, 30)
    logo = os.path.join(AQUI, '..', 'public', 'logo.png')
    if os.path.exists(logo):
        inicio.insert_image('B1', logo, {'x_scale': 0.06, 'y_scale': 0.06, 'x_offset': 4, 'y_offset': 3, 'object_position': 3})
    inicio.merge_range('C1:H1', 'PanControl', f['titulo'])
    inicio.merge_range('C2:H2', 'Sistema de Producción — versión Excel (prueba)', f['subtitulo'])

    # Barra de botones (dos filas)
    x = 0
    for texto, macro, ancho in [('Entradas', 'IrEntradas', 100), ('Salidas insumos', 'IrSalidasInsumos', 120),
                                ('Producción', 'IrProduccion', 100), ('Salidas productos', 'IrSalidasProductos', 130),
                                ('Insumos', 'IrInsumos', 90), ('Productos', 'IrProductos', 90), ('Catálogos', 'IrCatalogos', 90),
                                ('Recetas', 'IrRecetas', 85), ('Calculadora', 'IrCalculadora', 95)]:
        inicio.insert_button('B3', {'macro': macro, 'caption': texto, 'width': ancho, 'height': 30, 'x_offset': x, 'y_offset': 4})
        x += ancho + 6
    x = 0
    for texto, macro, ancho in [('Importar respaldo de la app', 'ImportarRespaldo', 200),
                                ('Exportar respaldo para la app', 'ExportarRespaldo', 210),
                                ('Guardar copia de seguridad', 'GuardarCopia', 190)]:
        inicio.insert_button('B4', {'macro': macro, 'caption': texto, 'width': ancho, 'height': 30, 'x_offset': x, 'y_offset': 4})
        x += ancho + 6

    inicio.write('B6', 'Fecha', f['label'])
    inicio.write_formula('C6', '=TODAY()', f['input_fecha'])
    nombre('rngFecha', 'Inicio', 'C6')
    inicio.data_validation('C6', {'validate': 'date', 'criteria': '>', 'value': datetime.date(2000, 1, 1)})
    inicio.write('B7', 'Periodo', f['label'])
    inicio.write('C7', 'Día', f['input'])
    inicio.data_validation('C7', {'validate': 'list', 'source': 'Día,Semana,Mes'})
    nombre('rngPeriodo', 'Inicio', 'C7')
    inicio.write('D6', 'Desde', f['label'])
    inicio.write_formula('E6', '=IF(rngPeriodo="Mes",DATE(YEAR(rngFecha),MONTH(rngFecha),1),IF(rngPeriodo="Semana",rngFecha-WEEKDAY(rngFecha,2)+1,rngFecha))', f['periodo_out'])
    nombre('rngDesde', 'Inicio', 'E6')
    inicio.write('D7', 'Hasta', f['label'])
    inicio.write_formula('E7', '=IF(rngPeriodo="Mes",EOMONTH(rngFecha,0),IF(rngPeriodo="Semana",rngDesde+6,rngFecha))', f['periodo_out'])
    nombre('rngHasta', 'Inicio', 'E7')
    boton(inicio, 'F6', 'Hoy', 'IrHoy', 70, 24)
    inicio.merge_range('H6:M7', 'En la PC usa los botones y los formularios. En tablet/celular escribe directo en las tablas '
                       '(allí las macros no corren). Para probar con tus datos: en la app web pulsa "Descargar backup" y '
                       'aquí "Importar respaldo de la app". Guarda seguido (Ctrl+G).', f['nota'])

    # Tarjetas (fila 9-11)
    F_CARD = 8
    def tarjeta(c0, titulo, valor, sub):
        c1 = c0 + 1
        inicio.merge_range(F_CARD, c0, F_CARD, c1, titulo, f['card_lbl'])
        inicio.merge_range(F_CARD + 1, c0, F_CARD + 1, c1, '', f['card_val'])
        inicio.write_formula(F_CARD + 1, c0, valor, f['card_val'])
        inicio.merge_range(F_CARD + 2, c0, F_CARD + 2, c1, '', f['card_sub'])
        inicio.write_formula(F_CARD + 2, c0, sub, f['card_sub'])
    inicio.set_row(F_CARD + 1, 34)
    tarjeta(1, 'Entradas de insumos', f'=COUNTIFS({EN_PERIODO("tblEntradas")},tblEntradas[Insumo],"<>")',
            f'="línea(s)  ·  S/ "&FIXED(SUMIFS(tblEntradas[Precio total],{EN_PERIODO("tblEntradas")}),2)')
    tarjeta(3, 'Salidas de insumos', f'=COUNTIFS({EN_PERIODO("tblSalidasIns")},tblSalidasIns[Insumo],"<>")', '="línea(s)"')
    tarjeta(7, 'Panes netos', f'=SUMIFS(tblProduccion[Neto],tblProduccion[Tipo],"Pan",{EN_PERIODO("tblProduccion")})',
            f'=COUNTIFS(tblProduccion[Tipo],"Pan",{EN_PERIODO("tblProduccion")})&" lote(s)"')
    tarjeta(9, 'Pasteles netos', f'=SUMIFS(tblProduccion[Neto],tblProduccion[Tipo],"Pastel",{EN_PERIODO("tblProduccion")})',
            f'=COUNTIFS(tblProduccion[Tipo],"Pastel",{EN_PERIODO("tblProduccion")})&" lote(s)"')
    tarjeta(11, 'Bajo mínimo', '=SUM(tblInsumos[Crit])', '="insumo(s) por reponer"')

    def lista(fila0, col0, titulo, columnas, tabla_n, num_col, total_formula):
        inicio.merge_range(fila0, col0, fila0, col0 + len(columnas) - 1, titulo, f['seccion'])
        for i, (enc, _, _) in enumerate(columnas):
            inicio.write(fila0 + 1, col0 + i, enc, f['lista_hdr'])
        for k in range(1, N_LISTA + 1):
            r = fila0 + 1 + k
            match = f'MATCH({k},{tabla_n}[{num_col}],0)'
            primera = xlsxwriter.utility.xl_rowcol_to_cell(r, col0)
            for i, (_, col_t, fm) in enumerate(columnas):
                if i == 0:
                    formula = f'=IFERROR(INDEX({tabla_n}[{col_t}],{match}),"")'
                else:
                    formula = f'=IF({primera}="","",INDEX({tabla_n}[{col_t}],{match}))'
                inicio.write_formula(r, col0 + i, formula, f[fm])
        inicio.write_formula(fila0 + 2 + N_LISTA, col0,
                             f'=IF({total_formula}>{N_LISTA},"… y "&({total_formula}-{N_LISTA})&" más (ver hoja completa)","")', f['lista_nota'])

    L1, L2 = 12, 32
    lista(L1, 1, 'Insumos del periodo', [('Insumo', 'Insumo', 'lista'), ('Entradas', 'Ent. periodo', 'lista_num'),
                                         ('Salidas', 'Sal. periodo', 'lista_num'), ('Unidad', 'Unidad base', 'lista')],
          'tblInsumos', 'NumMov', 'SUM(tblInsumos[Mov])')
    lista(L1, 7, 'Producción del periodo', [('Producto', 'Producto', 'lista'), ('Tipo', 'Tipo', 'lista'), ('Neto', 'Prod. periodo', 'lista_num')],
          'tblProductos', 'NumProd', 'SUM(tblProductos[ProdF])')
    lista(L2, 1, 'Salidas de productos del periodo', [('Producto', 'Producto', 'lista'), ('Cantidad', 'Sal. periodo', 'lista_num'),
                                                       ('Unidad', 'Unidad base', 'lista')],
          'tblProductos', 'NumSal', 'SUM(tblProductos[SalF])')
    lista(L2, 7, '🔴 Insumos bajo mínimo', [('Insumo', 'Insumo', 'lista'), ('Stock', 'Stock', 'lista_rojo'), ('Mínimo', 'Mínimo', 'lista_num')],
          'tblInsumos', 'NumCrit', 'SUM(tblInsumos[Crit])')
    inicio.activate()

    # ── Nombres de listas (para las validaciones) ──
    wb.define_name('lstInsumos', '=tblInsumos[Insumo]')
    wb.define_name('lstProductos', '=tblProductos[Producto]')
    wb.define_name('lstUnidades', '=tblUnidades[Unidad]')
    wb.define_name('lstDestinos', '=tblDestinos[Destino]')
    wb.define_name('lstEncargados', '=tblEncargados[Encargado]')

    # ── Macros ──
    modulos = [{'nombre': 'ThisWorkbook', 'tipo': 'documento', 'base': vba_project.DOC_ATTRS_WORKBOOK,
                'codigo': _leer(os.path.join(AQUI, 'vba', 'ThisWorkbook.cls'))}]
    for ws in wb.worksheets():
        modulos.append({'nombre': ws.vba_codename, 'tipo': 'documento', 'base': vba_project.DOC_ATTRS_SHEET, 'codigo': ''})
    patrones = [os.path.join(AQUI, 'vba', '*.bas')]
    if modulo_pruebas:
        patrones.append(os.path.join(AQUI, 'vba', 'pruebas', '*.bas'))
    for patron in patrones:
        for ruta in sorted(glob.glob(patron)):
            modulos.append({'nombre': os.path.splitext(os.path.basename(ruta))[0], 'tipo': 'modulo', 'codigo': _leer(ruta)})
    bin_path = salida + '.vbaProject.bin'
    with open(bin_path, 'wb') as fh:
        fh.write(vba_project.construir(modulos))
    wb.add_vba_project(bin_path)
    wb.close()
    os.remove(bin_path)
    return salida


def _leer(ruta):
    if not os.path.exists(ruta):
        return ''
    with open(ruta, encoding='utf-8') as fh:
        texto = fh.read()
    # Quitar encabezados "Attribute VB_Name" si el archivo los trae (se generan solos).
    return '\n'.join(l for l in texto.splitlines() if not l.startswith('Attribute VB_')) + '\n'


# Movimientos de ejemplo para las pruebas de fórmulas (tests/excel). Fechas fijas.
_d = datetime.date
DATOS_PRUEBA = {
    # ID, Fecha, Tipo doc., N° doc., Proveedor, Insumo, Presentación, Cantidad, Factor*, Cant. base*, Unidad base*,
    # Precio unit.*, Precio total, Total doc., Obs., Factor registrado   (* = fórmula)
    'tblEntradas': [
        [1, _d(2026, 9, 28), 'Factura', 'F001-1', 'Molino', 'Harina de trigo', 'saco', 2, None, None, None, None, 300, 300, '', None],
        [2, _d(2026, 9, 30), 'Boleta', 'B01-9', 'Bodega', 'Azúcar', 'kilogramo', 5, None, None, None, None, 20, 20, '', None],
        [3, _d(2026, 9, 30), 'Boleta', 'B01-9', 'Bodega', 'Huevos', 'jaba', 1, None, None, None, None, 15, 35, '', 25],
        [4, _d(2026, 9, 30), 'Otro', '', '', 'Sal', '', 1500, None, None, None, None, 0, 0, '', None],
    ],
    # ID, Fecha, Motivo, Ticket, Insumo, Presentación, Cantidad, Factor*, Cant. base*, Unidad base*, Obs., Factor registrado
    'tblSalidasIns': [
        [1, _d(2026, 9, 30), 'Usado en Producción', 'T1', 'Harina de trigo', 'kilogramo', 46, None, None, None, '', None],
        [2, _d(2026, 9, 29), 'Merma / Pérdida', '', 'Huevos', 'unidad', 3, None, None, None, 'rotos', None],
    ],
    # ID, Fecha, Turno, Tipo, Producto, Presentación, Cant. presentación, Unidad teórica, Cant. teórica, Producido, Defectuoso, Neto*, Obs.
    'tblProduccion': [
        [1, _d(2026, 9, 30), 'Mañana', 'Pan', 'Pan francés', 'lata', 20, 'quintal', 1, 1400, 20, None, ''],
        [2, _d(2026, 9, 30), 'Tarde', 'Pastel', 'Torta de chocolate', 'bandeja', 1, 'bandeja', 1, 3, 0, None, ''],
        [3, _d(2026, 9, 29), 'Mañana', 'Pan', 'Pan de molde', 'lata', 2, 'quintal', 0.5, 50, 2, None, ''],
    ],
    # ID, Fecha, Categoría, Producto, Presentación, Cantidad, Factor*, Cant. base*, Unidad base*, Destino, Encargado, Documento, Obs., Factor registrado
    'tblSalidasProd': [
        [1, _d(2026, 9, 30), 'Panes', 'Pan francés', 'bolsa', 30, None, None, None, 'Tienda principal', 'Encargado 1', '', '', None],
        [2, _d(2026, 9, 30), 'Panes', 'Pan francés', 'unidad', 100, None, None, None, 'Delivery', '', '', '', None],
    ],
}


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    salida = args[0] if args else os.path.join(AQUI, 'PanControl.xlsm')
    construir(salida, '--datos-prueba' in sys.argv, '--modulo-pruebas' in sys.argv)
    print('Listo:', salida)
