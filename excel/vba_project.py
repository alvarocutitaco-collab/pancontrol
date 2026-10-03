"""Genera un vbaProject.bin (el proyecto de macros de un .xlsm) a partir de
código VBA en texto, sin necesidad de tener Excel.

Sigue la especificación pública de Microsoft [MS-OVBA] (estructura del
proyecto, compresión de los módulos y "cifrado" de los campos de protección) y
[MS-CFB] (el contenedor OLE). No guarda código precompilado: Excel compila el
código fuente la primera vez que abre el archivo (versión 0xFFFF en
_VBA_PROJECT), que es lo que hacen otras librerías como EPPlus.
"""
import random
import struct
import uuid

CODEPAGE = 1252  # Windows Latin-1: admite tildes y ñ en el código VBA
ENC = 'cp1252'

DOC_ATTRS_WORKBOOK = '0{00020819-0000-0000-C000-000000000046}'
DOC_ATTRS_SHEET = '0{00020820-0000-0000-C000-000000000046}'


# ── [MS-OVBA] 2.4.1 Compresión ───────────────────────────────────────────────
def _copy_token_help(diferencia):
    bit_count = 4
    while (1 << bit_count) < diferencia:
        bit_count += 1
    length_mask = 0xFFFF >> bit_count
    maximum_length = length_mask + 3
    return bit_count, maximum_length


def _comprimir_trozo(trozo):
    salida = bytearray()
    n = len(trozo)
    pos = 0
    indice = {}  # prefijo de 3 bytes → posiciones anteriores (para buscar coincidencias rápido)

    def registrar(p):
        if p + 3 <= n:
            indice.setdefault(trozo[p:p + 3], []).append(p)

    while pos < n:
        pos_bandera = len(salida)
        salida.append(0)
        bandera = 0
        for bit in range(8):
            if pos >= n:
                break
            bit_count, max_len = _copy_token_help(pos)
            mejor_len, mejor_off = 0, 0
            if pos + 3 <= n:
                for cand in reversed(indice.get(trozo[pos:pos + 3], [])[-64:]):
                    largo = 0
                    limite = min(max_len, n - pos)
                    while largo < limite and trozo[cand + largo] == trozo[pos + largo]:
                        largo += 1
                    if largo > mejor_len:
                        mejor_len, mejor_off = largo, pos - cand
                        if largo == limite:
                            break
            if mejor_len >= 3:
                token = ((mejor_off - 1) << (16 - bit_count)) | (mejor_len - 3)
                salida += struct.pack('<H', token)
                bandera |= 1 << bit
                for p in range(pos, pos + mejor_len):
                    registrar(p)
                pos += mejor_len
            else:
                salida.append(trozo[pos])
                registrar(pos)
                pos += 1
        salida[pos_bandera] = bandera
    if len(salida) > 4096:
        # No se pudo comprimir: se guarda tal cual (solo válido con 4096 bytes).
        assert n == 4096, 'trozo incompresible de tamaño parcial'
        return struct.pack('<H', 0x3000 | (4096 + 2 - 3)) + bytes(trozo)
    return struct.pack('<H', 0xB000 | (len(salida) + 2 - 3)) + bytes(salida)


def comprimir(datos):
    salida = bytearray([0x01])
    for i in range(0, len(datos), 4096):
        salida += _comprimir_trozo(datos[i:i + 4096])
    return bytes(salida)


def descomprimir(contenedor):
    """Implementación propia para las pruebas de ida y vuelta."""
    assert contenedor[0] == 0x01
    salida = bytearray()
    pos = 1
    while pos < len(contenedor):
        (cabecera,) = struct.unpack_from('<H', contenedor, pos)
        tam = (cabecera & 0x0FFF) + 3
        comprimido = cabecera & 0x8000
        datos = contenedor[pos + 2:pos + tam]
        pos += tam
        inicio = len(salida)
        if not comprimido:
            salida += datos
            continue
        i = 0
        while i < len(datos):
            bandera = datos[i]
            i += 1
            for bit in range(8):
                if i >= len(datos):
                    break
                if bandera & (1 << bit):
                    (token,) = struct.unpack_from('<H', datos, i)
                    i += 2
                    bit_count, _ = _copy_token_help(len(salida) - inicio)
                    largo = (token & (0xFFFF >> bit_count)) + 3
                    desp = (token >> (16 - bit_count)) + 1
                    for _ in range(largo):
                        salida.append(salida[-desp])
                else:
                    salida.append(datos[i])
                    i += 1
    return bytes(salida)


# ── [MS-OVBA] 2.4.3 "Cifrado" de CMG / DPB / GC ─────────────────────────────
def _cifrar(datos, project_id):
    semilla = random.randrange(256)
    version_enc = semilla ^ 2
    proj_key = sum(project_id.encode(ENC)) & 0xFF
    proj_key_enc = semilla ^ proj_key
    salida = bytearray([semilla, version_enc, proj_key_enc])
    unenc1, enc1, enc2 = proj_key, proj_key_enc, version_enc
    plano = bytearray([semilla] * ((semilla & 6) // 2)) + struct.pack('<I', len(datos)) + bytes(datos)
    for b in plano:
        b_enc = b ^ ((enc2 + unenc1) & 0xFF)
        salida.append(b_enc)
        enc2, enc1, unenc1 = enc1, b_enc, b
    return salida.hex().upper()


# ── [MS-OVBA] 2.3.4.2 Stream "dir" ──────────────────────────────────────────
def _rec(ident, datos):
    return struct.pack('<HI', ident, len(datos)) + datos


def _rec_doble(ident, texto, ident_unicode):
    a = texto.encode(ENC)
    u = texto.encode('utf-16-le')
    return struct.pack('<HI', ident, len(a)) + a + struct.pack('<HI', ident_unicode, len(u)) + u


REFERENCIAS = [
    ('stdole', '*\\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\\Windows\\System32\\stdole2.tlb#OLE Automation'),
    ('Office', '*\\G{2DF8D04C-5BFA-101B-BDE5-00AA0044DE52}#2.0#0#C:\\Program Files\\Common Files\\Microsoft Shared\\OFFICE16\\MSO.DLL#Microsoft Office 16.0 Object Library'),
]


def _dir_stream(modulos, nombre_proyecto):
    b = bytearray()
    b += _rec(0x01, struct.pack('<I', 1))            # SYSKIND: Win32
    b += _rec(0x02, struct.pack('<I', 0x0409))       # LCID
    b += _rec(0x14, struct.pack('<I', 0x0409))       # LCIDINVOKE
    b += _rec(0x03, struct.pack('<H', CODEPAGE))     # CODEPAGE
    b += _rec(0x04, nombre_proyecto.encode(ENC))     # NAME
    b += _rec_doble(0x05, '', 0x40)                  # DOCSTRING
    b += _rec_doble(0x06, '', 0x3D)                  # HELPFILEPATH
    b += _rec(0x07, struct.pack('<I', 0))            # HELPCONTEXT
    b += _rec(0x08, struct.pack('<I', 0))            # LIBFLAGS
    b += struct.pack('<HIIH', 0x09, 4, 1361024421, 6)  # VERSION (Reserved=4, Major, Minor)
    b += _rec_doble(0x0C, '', 0x3C)                  # CONSTANTS
    for nombre, libid in REFERENCIAS:
        b += _rec_doble(0x16, nombre, 0x3E)          # REFERENCENAME
        lib = libid.encode(ENC)
        b += struct.pack('<HII', 0x0D, 4 + len(lib) + 4 + 2, len(lib)) + lib + struct.pack('<IH', 0, 0)
    b += _rec(0x0F, struct.pack('<H', len(modulos)))  # MODULES count
    b += _rec(0x13, struct.pack('<H', 0xFFFF))        # PROJECTCOOKIE
    for m in modulos:
        b += _rec_doble(0x19, m['nombre'], 0x47)                           # MODULENAME + UNICODE
        b += _rec_doble(0x1A, m['nombre'], 0x32)                           # MODULESTREAMNAME
        b += _rec_doble(0x1C, '', 0x48)                                    # MODULEDOCSTRING
        b += _rec(0x31, struct.pack('<I', 0))                              # MODULEOFFSET (sin caché)
        b += _rec(0x1E, struct.pack('<I', 0))                              # MODULEHELPCONTEXT
        b += _rec(0x2C, struct.pack('<H', 0xFFFF))                         # MODULECOOKIE
        b += struct.pack('<HI', 0x21 if m['tipo'] == 'modulo' else 0x22, 0)  # MODULETYPE
        b += struct.pack('<HI', 0x2B, 0)                                   # terminador del módulo
    b += struct.pack('<HI', 0x10, 0)                                       # terminador del dir
    return bytes(b)


def _project_stream(modulos, project_id, nombre_proyecto):
    lineas = [f'ID="{project_id}"']
    for m in modulos:
        lineas.append(f"Document={m['nombre']}/&H00000000" if m['tipo'] == 'documento' else f"Module={m['nombre']}")
    lineas += [
        f'Name="{nombre_proyecto}"',
        'HelpContextID="0"',
        'VersionCompatible32="393222000"',
        f'CMG="{_cifrar(struct.pack("<I", 0), project_id)}"',
        f'DPB="{_cifrar(bytes([0]), project_id)}"',
        f'GC="{_cifrar(bytes([0xFF]), project_id)}"',
        '',
        '[Host Extender Info]',
        '&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000',
        '',
        '[Workspace]',
    ]
    lineas += [f"{m['nombre']}=0, 0, 0, 0, C" for m in modulos]
    return ('\r\n'.join(lineas) + '\r\n').encode(ENC)


def _projectwm_stream(modulos):
    b = bytearray()
    for m in modulos:
        b += m['nombre'].encode(ENC) + b'\x00' + m['nombre'].encode('utf-16-le') + b'\x00\x00'
    return bytes(b + b'\x00\x00')


def _codigo_modulo(m):
    if m['tipo'] == 'documento':
        attrs = [f'Attribute VB_Name = "{m["nombre"]}"',
                 f'Attribute VB_Base = "{m["base"]}"',
                 'Attribute VB_GlobalNameSpace = False',
                 'Attribute VB_Creatable = False',
                 'Attribute VB_PredeclaredId = True',
                 'Attribute VB_Exposed = True',
                 'Attribute VB_TemplateDerived = False',
                 'Attribute VB_Customizable = True']
    else:
        attrs = [f'Attribute VB_Name = "{m["nombre"]}"']
    codigo = m.get('codigo', '').replace('\r\n', '\n').replace('\n', '\r\n')
    # Caracteres decorativos de los comentarios que no existen en Windows-1252.
    for orig, repl in (('═', '='), ('─', '-'), ('→', '->'), ('←', '<-'), ('✔', 'v'), ('✖', 'x')):
        codigo = codigo.replace(orig, repl)
    texto = '\r\n'.join(attrs) + '\r\n' + codigo
    if not texto.endswith('\r\n'):
        texto += '\r\n'
    return texto.encode(ENC)


# ── [MS-CFB] Contenedor OLE (versión 3, sectores de 512 bytes) ──────────────
FREESECT, ENDOFCHAIN, FATSECT, NOSTREAM = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD, 0xFFFFFFFF


def _clave_orden(nombre):
    return (len(nombre), nombre.upper())


def _cfb(arbol):
    """arbol: {'nombre': bytes | dict} (dict = storage). Devuelve el archivo."""
    entradas = [{'nombre': 'Root Entry', 'tipo': 5, 'hijos': [], 'datos': b''}]

    def agregar(nodo):
        indices = []
        for nombre, valor in nodo.items():
            e = {'nombre': nombre, 'hijos': []}
            entradas.append(e)
            idx = len(entradas) - 1
            if isinstance(valor, dict):
                e['tipo'], e['datos'] = 1, b''
                e['hijos'] = agregar(valor)
            else:
                e['tipo'], e['datos'] = 2, valor
            indices.append(idx)
        return indices

    entradas[0]['hijos'] = agregar(arbol)

    # Árbol binario de búsqueda balanceado (todos negros, como Apache POI).
    for e in entradas:
        e['izq'] = e['der'] = e['hijo'] = NOSTREAM

    def balancear(indices):
        if not indices:
            return NOSTREAM
        orden = sorted(indices, key=lambda i: _clave_orden(entradas[i]['nombre']))
        medio = len(orden) // 2
        raiz = orden[medio]
        entradas[raiz]['izq'] = balancear(orden[:medio])
        entradas[raiz]['der'] = balancear(orden[medio + 1:])
        return raiz

    for e in entradas:
        if e['tipo'] in (1, 5):
            e['hijo'] = balancear(e['hijos'])

    # Streams chicos (< 4096) van al mini stream; los grandes, a sectores normales.
    mini = bytearray()
    minifat = []
    for e in entradas:
        if e['tipo'] == 2 and len(e['datos']) < 4096:
            if not e['datos']:
                e['inicio'] = ENDOFCHAIN
                continue
            n = (len(e['datos']) + 63) // 64
            e['inicio'] = len(minifat)
            minifat += [len(minifat) + i + 1 for i in range(n - 1)] + [ENDOFCHAIN]
            mini += e['datos'] + b'\x00' * (n * 64 - len(e['datos']))

    sectores = []  # lista de bytes de 512
    fat = []

    def cadena(datos):
        if not datos:
            return ENDOFCHAIN
        n = (len(datos) + 511) // 512
        inicio = len(sectores)
        for i in range(n):
            sectores.append(datos[i * 512:(i + 1) * 512].ljust(512, b'\x00'))
            fat.append(inicio + i + 1 if i < n - 1 else ENDOFCHAIN)
        return inicio

    for e in entradas:
        if e['tipo'] == 2 and len(e['datos']) >= 4096:
            e['inicio'] = cadena(e['datos'])
    entradas[0]['inicio'] = cadena(bytes(mini)) if mini else ENDOFCHAIN
    entradas[0]['datos'] = bytes(mini)
    minifat_bytes = b''.join(struct.pack('<I', x) for x in minifat)
    if minifat_bytes:
        minifat_bytes += struct.pack('<I', FREESECT) * ((-len(minifat)) % 128)
    inicio_minifat = cadena(minifat_bytes) if minifat else ENDOFCHAIN
    n_minifat = (len(minifat_bytes) + 511) // 512

    dir_bytes = bytearray()
    for e in entradas:
        nombre = e['nombre'].encode('utf-16-le') + b'\x00\x00'
        assert len(nombre) <= 64, e['nombre']
        d = nombre.ljust(64, b'\x00')
        d += struct.pack('<HBB', len(nombre), e['tipo'], 1)  # color: negro
        d += struct.pack('<III', e['izq'], e['der'], e['hijo'])
        d += b'\x00' * 16 + struct.pack('<I', 0) + b'\x00' * 16
        d += struct.pack('<IQ', e.get('inicio', ENDOFCHAIN) if e['tipo'] != 1 else 0, len(e['datos']))
        dir_bytes += d
    dir_bytes += b'\x00' * ((-len(dir_bytes)) % 512)
    # Entradas vacías del directorio: nombre vacío y hermanos NOSTREAM.
    vacia = b'\x00' * 64 + struct.pack('<HBB', 0, 0, 0) + struct.pack('<III', NOSTREAM, NOSTREAM, NOSTREAM) + b'\x00' * 48
    for off in range(len(entradas) * 128, len(dir_bytes), 128):
        dir_bytes[off:off + 128] = vacia
    inicio_dir = cadena(bytes(dir_bytes))

    # Sectores de la FAT (se agregan al final y se marcan a sí mismos).
    n_fat = 1
    while True:
        total = len(sectores) + n_fat
        if (total + 127) // 128 <= n_fat:
            break
        n_fat += 1
    assert n_fat <= 109, 'archivo demasiado grande para este escritor simple'
    inicio_fat = len(sectores)
    fat += [FATSECT] * n_fat
    fat += [FREESECT] * (n_fat * 128 - len(fat))
    fat_bytes = b''.join(struct.pack('<I', x) for x in fat)
    for i in range(n_fat):
        sectores.append(fat_bytes[i * 512:(i + 1) * 512])

    cab = bytearray()
    cab += bytes.fromhex('D0CF11E0A1B11AE1') + b'\x00' * 16
    cab += struct.pack('<HHHHH', 0x003E, 0x0003, 0xFFFE, 9, 6)
    cab += b'\x00' * 6
    # dir sectors (0 en v3), FAT sectors, 1er sector dir, transacción, corte mini stream,
    # 1er sector mini FAT, sectores mini FAT, 1er sector DIFAT, sectores DIFAT
    cab += struct.pack('<IIIIIIIII', 0, n_fat, inicio_dir, 0, 4096, inicio_minifat, n_minifat, ENDOFCHAIN, 0)
    difat = [inicio_fat + i for i in range(n_fat)] + [FREESECT] * (109 - n_fat)
    cab += b''.join(struct.pack('<I', x) for x in difat)
    assert len(cab) == 512, len(cab)
    return bytes(cab) + b''.join(sectores)


def construir(modulos, nombre_proyecto='VBAProject'):
    """modulos: [{'nombre','tipo': 'documento'|'modulo','base'(documentos),'codigo'}]"""
    project_id = '{' + str(uuid.uuid4()).upper() + '}'
    vba = {'_VBA_PROJECT': bytes([0xCC, 0x61, 0xFF, 0xFF, 0x00, 0x00, 0x00]),
           'dir': comprimir(_dir_stream(modulos, nombre_proyecto))}
    for m in modulos:
        vba[m['nombre']] = comprimir(_codigo_modulo(m))
    return _cfb({
        'PROJECT': _project_stream(modulos, project_id, nombre_proyecto),
        'PROJECTwm': _projectwm_stream(modulos),
        'VBA': vba,
    })
