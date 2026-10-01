"""Revisión estática del VBA (lo que LibreOffice no detecta porque resuelve los nombres al ejecutar):
- toda función/sub llamada existe (en nuestros módulos o es de VBA/Excel),
- toda variable usada está declarada (Option Explicit),
- no hay variables locales que tapen funciones del mismo módulo.
Uso: python3 excel/verificar_vba.py"""
import glob, os, re, sys

AQUI = os.path.dirname(os.path.abspath(__file__))
KEYWORDS = set('''and as boolean byref byte byval call case const currency date dim do double each else elseif empty end
erase error exit explicit false for function get goto if in integer is let like long loop me mod new next not nothing null
on option optional or preserve private property public put redim rem resume select set single static step string sub then
to true type until variant wend while with xor binary access read write open close as append output random lock shared
lbound ubound debug print attribute variant object collection range worksheet workbook listobject listrow listcolumn
mac vba'''.split())
BUILTINS = set('''abs array asc ascw atn cbool cbyte ccur cdate cdbl cdec chr chrw chr$ chrw$ cint clng csng cstr cvar
dateserial datevalue day dir doevents environ eof err error exp filelen fix format format$ freefile hex hex$ hour iif instr
instrrev int isarray isdate isempty iserror ismissing isnull isnumeric isobject join kill lcase lcase$ left left$ len lof
log ltrim mid mid$ minute month msgbox now oct replace right right$ rnd round rtrim second sgn sin space split sqr str
str$ strcomp strconv string trim trim$ typename ucase ucase$ val vartype weekday year date time timer lcase$ ucase$
application thisworkbook activecell activesheet intersect union worksheetfunction names range cells'''.split())

mods = {}
for f in sorted(glob.glob(os.path.join(AQUI, 'vba', '*.bas')) + glob.glob(os.path.join(AQUI, 'vba', 'pruebas', '*.bas'))
               + glob.glob(os.path.join(AQUI, 'vba', '*.cls'))):
    # unir las líneas partidas con " _" para analizar sentencias completas
    mods[os.path.basename(f)] = re.sub(r' _\n\s*', ' ', open(f, encoding='utf-8').read())

def sin_cadenas(l):
    l = re.sub(r'"(?:[^"]|"")*"', '""', l)
    return l.split("'")[0]

procs, publicos, modvars = {}, set(), {}
for m, src in mods.items():
    for mm in re.finditer(r'^(Public |Private )?(Function|Sub) (\w+)', src, re.M):
        procs.setdefault(mm.group(3).lower(), []).append(m)
        if mm.group(1) != 'Private ':
            publicos.add(mm.group(3).lower())
    modvars[m] = {v.lower() for v in re.findall(r'^(?:Private|Public|Dim) (\w+)(?:\(\))? As', src, re.M)}
    modvars[m] |= {v.lower() for v in re.findall(r'^Private Const (\w+)', src, re.M)}
codenames = {'shinicio', 'shentradas', 'shsalidasins', 'shproduccion', 'shsalidasprod', 'shinsumos', 'shproductos',
             'shcatalogos', 'shrecetas', 'shcalculadora'}
problemas = []
for m, src in mods.items():
    privados_aqui = {mm.group(1).lower() for mm in re.finditer(r'^Private (?:Function|Sub) (\w+)', src, re.M)}
    visibles = publicos | privados_aqui
    bloques = re.split(r'^(?=(?:Public |Private )?(?:Function|Sub) )', src, flags=re.M)
    for b in bloques:
        cab = re.match(r'(?:Public |Private )?(?:Function|Sub) (\w+)\((.*)\)(?: As \w+(?:\(\))?)?[ \t]*$', b.splitlines()[0])
        if not cab:
            continue
        nombre = cab.group(1)
        locales = {p.lower() for p in re.findall(r'(?:ByVal |ByRef |Optional )*(\w+)(?:\(\))? As', cab.group(2))}
        for d in re.findall(r'^\s*Dim (.+)$', b, re.M):
            locales |= {v.lower() for v in re.findall(r'(\w+)(?:\([^)]*\))? As', d)}
        locales |= {l.lower() for l in re.findall(r'^(\w+):\s*$', b, re.M)}  # etiquetas
        for v in locales & (visibles - {nombre.lower()}):
            if v in privados_aqui or v in publicos and procs[v] == [m]:
                problemas.append(f'{m} {nombre}: la variable "{v}" tapa una función del mismo módulo')
        for n, l in enumerate(b.splitlines()[1:], 2):
            l = sin_cadenas(l)
            if re.match(r'\s*(Dim|ReDim|End|#)', l):
                continue
            for tok in re.finditer(r'(?<![.\w])([A-Za-z_]\w*\$?)', l):
                t = tok.group(1).lower()
                antes = l[:tok.start()].rstrip()
                if antes.endswith(':=') or l[tok.end():].lstrip().startswith(':='):
                    continue
                if t in KEYWORDS or t in BUILTINS or t in locales or t in modvars[m] or t in visibles or t in codenames \
                        or t == nombre.lower() or t.startswith('vb') or t.startswith('xl_') or re.match(r'^&?h[0-9a-f]+&?$', t):
                    continue
                if re.match(r'^\s*\w+:\s*$', l):
                    continue
                problemas.append(f'{m} {nombre}: "{tok.group(1)}" no está definido (línea {n} del procedimiento): {l.strip()[:70]}')
for p in sorted(set(problemas)):
    print('✗', p)
print('Revisión VBA:', 'sin problemas' if not problemas else f'{len(set(problemas))} problema(s)')
sys.exit(1 if problemas else 0)
