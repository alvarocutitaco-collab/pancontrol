Attribute VB_Name = "modRespaldo"
' ════════════════════════════════════════════════════════════════
' Traducción entre el respaldo JSON de la app web ("Descargar backup") y
' las tablas de este Excel. Solo usa VBA puro (sin objetos de Excel): recibe y
' devuelve arreglos, así se puede probar fuera de Excel.
'
' Cada Filas*() devuelve un arreglo 2D (1..n, 1..columnas) en el orden de
' Cols*(); las columnas se nombran igual que los encabezados de las tablas.
' ════════════════════════════════════════════════════════════════
Option Explicit

' ── Columnas que se llenan (el resto de cada tabla son fórmulas) ──
Public Function ColsEntradas() As Variant
    ColsEntradas = Array("ID", "Fecha", "Tipo doc.", "N° doc.", "Proveedor", "Insumo", "Presentación", "Cantidad", _
        "Precio total", "Total doc.", "Obs.", "Factor registrado")
End Function
Public Function ColsSalidasIns() As Variant
    ColsSalidasIns = Array("ID", "Fecha", "Motivo", "Ticket", "Insumo", "Presentación", "Cantidad", "Obs.", "Factor registrado")
End Function
Public Function ColsProduccion() As Variant
    ColsProduccion = Array("ID", "Fecha", "Turno", "Tipo", "Producto", "Presentación", "Cant. presentación", _
        "Unidad teórica", "Cant. teórica", "Producido", "Defectuoso", "Obs.")
End Function
Public Function ColsSalidasProd() As Variant
    ColsSalidasProd = Array("ID", "Fecha", "Categoría", "Producto", "Presentación", "Cantidad", "Destino", "Encargado", _
        "Documento", "Obs.", "Factor registrado")
End Function
Public Function ColsInsumos() As Variant
    ColsInsumos = Array("Insumo", "Unidad base", "Mínimo", "Stock inicial", "Ajuste")
End Function
Public Function ColsProductos() As Variant
    ColsProductos = Array("Producto", "Tipo", "Unidad base", "Rinde por lote", "Stock inicial", "Ajuste")
End Function
Public Function ColsEquivalencias() As Variant
    ColsEquivalencias = Array("Artículo", "Presentación", "Factor", "Detalle")
End Function

' ── Lectura de campos ────────────────────────────────────────────
Public Function Txt(ByVal obj As Variant, ByVal clave As String) As String
    Dim v As Variant
    Asignar v, JsonGet(obj, clave)
    If IsObject(v) Or IsArray(v) Or IsNull(v) Or IsEmpty(v) Then Exit Function
    If VarType(v) = vbBoolean Then
        Txt = IIf(v, "true", "false")
    ElseIf VarType(v) = vbString Then
        Txt = v
    Else
        Txt = JsonNumero(CDbl(v))
    End If
End Function

' Número del campo, o Empty si no hay (acepta "12,5" o "12.5" como texto).
Public Function Num(ByVal obj As Variant, ByVal clave As String) As Variant
    Dim v As Variant, t As String
    Asignar v, JsonGet(obj, clave)
    Num = Empty
    If IsObject(v) Or IsArray(v) Or IsNull(v) Or IsEmpty(v) Then Exit Function
    If VarType(v) = vbString Then
        t = Trim$(Replace(v, ",", "."))
        If t = "" Then Exit Function
        If Not EsNumeroTexto(t) Then Exit Function
        Num = Val(t)
    ElseIf VarType(v) = vbBoolean Then
        Exit Function
    Else
        Num = CDbl(v)
    End If
End Function

Private Function EsNumeroTexto(ByVal t As String) As Boolean
    Dim i As Long, c As String, digitos As Boolean
    For i = 1 To Len(t)
        c = Mid$(t, i, 1)
        If c Like "#" Then
            digitos = True
        ElseIf InStr("+-.eE", c) = 0 Then
            Exit Function
        End If
    Next i
    EsNumeroTexto = digitos
End Function

Public Function NumO0(ByVal obj As Variant, ByVal clave As String) As Double
    Dim v As Variant
    v = Num(obj, clave)
    If Not IsEmpty(v) Then NumO0 = v
End Function

' "2026-09-30" (o "2026-09-30T10:00…") → Date; Empty si no es fecha.
Public Function FechaIso(ByVal s As String) As Variant
    Dim a As Long, m As Long, d As Long
    FechaIso = Empty
    s = Trim$(s)
    If Len(s) < 10 Then Exit Function
    If Mid$(s, 5, 1) <> "-" Or Mid$(s, 8, 1) <> "-" Then Exit Function
    a = Val(Left$(s, 4)): m = Val(Mid$(s, 6, 2)): d = Val(Mid$(s, 9, 2))
    If a < 1900 Or m < 1 Or m > 12 Or d < 1 Or d > 31 Then Exit Function
    FechaIso = DateSerial(a, m, d)
End Function

Public Function FechaAIso(ByVal v As Variant) As String
    If IsDate(v) Then FechaAIso = Format$(CDate(v), "yyyy-mm-dd")
End Function

' Igual que factorFromText de la app: "6x800" → 4800, "50" → 50.
Public Function FactorDeTexto(ByVal v As Variant) As Double
    Dim t As String, partes As Variant, i As Long, p As Double, total As Double, alguno As Boolean
    If IsEmpty(v) Or IsNull(v) Or IsObject(v) Or IsArray(v) Then Exit Function
    If VarType(v) <> vbString Then
        If IsNumeric(v) Then If CDbl(v) > 0 Then FactorDeTexto = CDbl(v)
        Exit Function
    End If
    t = Trim$(Replace(v, ",", "."))
    If t = "" Then Exit Function
    t = Replace(Replace(t, "X", "x"), "*", "x")
    partes = Split(t, "x")
    total = 1
    For i = LBound(partes) To UBound(partes)
        p = Val(Trim$(partes(i)))
        If p > 0 Then total = total * p: alguno = True
    Next i
    If alguno Then FactorDeTexto = total
End Function

' Unidad por defecto de la app (defaultUnitFor).
Public Function UnidadPorDefecto(ByVal clave As String, ByVal nombre As String) As String
    Dim n As String
    n = LCase$(nombre)
    UnidadPorDefecto = "unidad"
    If clave <> "insumos" Then Exit Function
    If n Like "*leche*" Or n Like "*aceite*" Or n Like "*vainilla*" Or n Like "*agua*" Or n Like "*crema*" Then
        UnidadPorDefecto = "litro"
    ElseIf n Like "*huevo*" Then
        UnidadPorDefecto = "unidad"
    ElseIf n Like "*harina*" Or n Like "*azucar*" Or n Like "*az" & ChrW$(250) & "car*" Or n Like "*sal*" Or n Like "*cacao*" _
        Or n Like "*polvo*" Or n Like "*manteca*" Or n Like "*mantequilla*" Then
        UnidadPorDefecto = "kilogramo"
    End If
End Function

' ── Catálogo ─────────────────────────────────────────────────────
' El respaldo trae "catalogos" como lista: la app usa el último registro.
Public Function UltimoCatalogo(ByVal raiz As Variant) As Variant
    Dim arr As Variant, n As Long, c As Variant
    Asignar arr, JsonGet(raiz, "catalogos")
    n = JsonLargo(arr)
    If n > 0 Then Asignar c, arr(UBound(arr))
    If JsonEsObjeto(c) Then Set UltimoCatalogo = c Else Set UltimoCatalogo = New Collection
End Function

Private Function Lista(ByVal obj As Variant, ByVal clave As String) As Variant
    Dim v As Variant
    Asignar v, JsonGet(obj, clave)
    If IsArray(v) Then Lista = v Else Lista = Array()
End Function

Private Function SubObjeto(ByVal obj As Variant, ByVal c1 As String, ByVal c2 As String) As Variant
    Dim v As Variant, r As Variant
    Asignar v, JsonGet(obj, c1)
    Asignar r, JsonGet(v, c2)
    If IsObject(r) Then Set SubObjeto = r Else SubObjeto = r
End Function

' Unidad base de un artículo según el catálogo de la app.
Public Function UnidadBaseCatalogo(ByVal cats As Variant, ByVal clave As String, ByVal nombre As String) As String
    Dim v As Variant, u As Variant
    Asignar v, JsonGet(SubObjeto(cats, "baseUnits", clave), nombre)
    If VarType(v) = vbString Then
        If Trim$(v) <> "" Then UnidadBaseCatalogo = Trim$(v): Exit Function
    End If
    Asignar u, JsonGet(SubObjeto(cats, "unidades", clave), nombre)
    If IsArray(u) Then
        If JsonLargo(u) > 0 Then
            If VarType(u(LBound(u))) = vbString Then
                If Trim$(u(LBound(u))) <> "" Then UnidadBaseCatalogo = Trim$(u(LBound(u))): Exit Function
            End If
        End If
    ElseIf VarType(u) = vbString Then
        If Trim$(Split(u & ",", ",")(0)) <> "" Then UnidadBaseCatalogo = Trim$(Split(u & ",", ",")(0)): Exit Function
    End If
    UnidadBaseCatalogo = UnidadPorDefecto(clave, nombre)
End Function

' Inventario: Collection clave → Array(si, aj, min).
Public Function IndiceInventario(ByVal raiz As Variant) As Collection
    Dim col As New Collection, arr As Variant, i As Long, r As Variant, k As String
    Asignar arr, JsonGet(raiz, "inventario")
    For i = 0 To JsonLargo(arr) - 1
        Asignar r, arr(LBound(arr) + i)
        k = Txt(r, "key")
        If k <> "" Then
            On Error Resume Next
            col.Remove "k_" & k
            col.Add Array(NumO0(r, "si"), NumO0(r, "aj"), NumO0(r, "min")), "k_" & k
            On Error GoTo 0
        End If
    Next i
    Set IndiceInventario = col
End Function

Private Function DatosInventario(ByVal idx As Collection, ByVal k As String) As Variant
    On Error Resume Next
    DatosInventario = Array(0#, 0#, 0#)
    DatosInventario = idx("k_" & k)
End Function

Public Function FilasInsumos(ByVal raiz As Variant) As Variant
    Dim cats As Variant, nombres As Variant, idx As Collection, n As Long, i As Long, d() As Variant, nom As String, inv As Variant
    Asignar cats, UltimoCatalogo(raiz)
    nombres = Lista(cats, "insumos")
    Set idx = IndiceInventario(raiz)
    n = JsonLargo(nombres)
    If n = 0 Then FilasInsumos = Empty: Exit Function
    ReDim d(1 To n, 1 To 5)
    For i = 1 To n
        nom = CStr(nombres(LBound(nombres) + i - 1))
        inv = DatosInventario(idx, "ins_" & nom)
        d(i, 1) = nom
        d(i, 2) = UnidadBaseCatalogo(cats, "insumos", nom)
        d(i, 3) = inv(2)
        d(i, 4) = inv(0)
        d(i, 5) = inv(1)
    Next i
    FilasInsumos = d
End Function

Public Function FilasProductos(ByVal raiz As Variant) As Variant
    Dim cats As Variant, panes As Variant, pasteles As Variant, idx As Collection, n As Long, i As Long, k As Long
    Dim d() As Variant, nom As String, inv As Variant, clave As String
    Asignar cats, UltimoCatalogo(raiz)
    panes = Lista(cats, "panes")
    pasteles = Lista(cats, "pasteles")
    Set idx = IndiceInventario(raiz)
    n = JsonLargo(panes) + JsonLargo(pasteles)
    If n = 0 Then FilasProductos = Empty: Exit Function
    ReDim d(1 To n, 1 To 6)
    For i = 1 To n
        If i <= JsonLargo(panes) Then
            nom = CStr(panes(LBound(panes) + i - 1)): clave = "panes": d(i, 2) = "Pan"
        Else
            k = i - JsonLargo(panes)
            nom = CStr(pasteles(LBound(pasteles) + k - 1)): clave = "pasteles": d(i, 2) = "Pastel"
        End If
        inv = DatosInventario(idx, "prod_" & nom)
        d(i, 1) = nom
        d(i, 3) = UnidadBaseCatalogo(cats, clave, nom)
        d(i, 4) = Empty
        d(i, 5) = inv(0)
        d(i, 6) = inv(1)
    Next i
    FilasProductos = d
End Function

Public Function FilasEquivalencias(ByVal raiz As Variant) As Variant
    Dim cats As Variant, claves As Variant, c As Long, porNombre As Variant, nombres As Variant, j As Long
    Dim items As Variant, i As Long, it As Variant, nom As String, uni As String, fac As Double, det As String
    Dim filas As New Collection, d() As Variant, r As Variant, partes As Variant
    Asignar cats, UltimoCatalogo(raiz)
    claves = Array("insumos", "panes", "pasteles")
    For c = 0 To 2
        Asignar porNombre, SubObjeto(cats, "equivalencias", claves(c))
        nombres = JsonKeys(porNombre)
        For j = 0 To JsonLargo(nombres) - 1
            Asignar items, JsonGet(porNombre, nombres(j))
            If VarType(items) = vbString Then items = Split(Replace(items, ";", vbLf), vbLf)
            For i = 0 To JsonLargo(items) - 1
                Asignar it, items(LBound(items) + i)
                If JsonEsObjeto(it) Then
                    nom = Trim$(Txt(it, "nombre"))
                    If nom = "" Then nom = Trim$(Txt(it, "name"))
                    If nom = "" Then nom = Trim$(Txt(it, "presentacion"))
                    If nom = "" Then nom = Trim$(Txt(it, "label"))
                    uni = Trim$(Txt(it, "unidad"))
                    If uni = "" Then uni = Trim$(Txt(it, "unit"))
                    fac = PrimerFactor(it, Array("factorBase", "factor", "equivalencia", "value"))
                    det = Trim$(Txt(it, "detalle"))
                    If det = "" Then det = Trim$(Txt(it, "detail"))
                ElseIf VarType(it) = vbString Then
                    partes = Split(it & "|||", "|")
                    nom = Trim$(partes(0)): uni = Trim$(partes(1)): fac = FactorDeTexto(Trim$(partes(2))): det = Trim$(partes(3))
                Else
                    nom = ""
                End If
                If nom <> "" And fac > 0 Then
                    filas.Add Array(CStr(nombres(j)), nom, fac, det)
                    If uni <> "" And StrComp(uni, nom, vbTextCompare) <> 0 Then filas.Add Array(CStr(nombres(j)), uni, fac, det)
                End If
            Next i
        Next j
    Next c
    If filas.Count = 0 Then FilasEquivalencias = Empty: Exit Function
    ReDim d(1 To filas.Count, 1 To 4)
    i = 0
    For Each r In filas
        i = i + 1
        d(i, 1) = r(0): d(i, 2) = r(1): d(i, 3) = r(2): d(i, 4) = r(3)
    Next r
    FilasEquivalencias = d
End Function

Private Function PrimerFactor(ByVal it As Variant, ByVal claves As Variant) As Double
    Dim i As Long, v As Variant
    For i = LBound(claves) To UBound(claves)
        If JsonHas(it, claves(i)) Then
            Asignar v, JsonGet(it, claves(i))
            If Not IsNull(v) Then PrimerFactor = FactorDeTexto(v): Exit Function
        End If
    Next i
End Function

' Lista de textos del catálogo (destinos, encargados) como columna 2D.
Public Function FilasLista(ByVal raiz As Variant, ByVal clave As String) As Variant
    Dim cats As Variant, arr As Variant, n As Long, i As Long, d() As Variant
    Asignar cats, UltimoCatalogo(raiz)
    arr = Lista(cats, clave)
    n = JsonLargo(arr)
    If n = 0 Then FilasLista = Empty: Exit Function
    ReDim d(1 To n, 1 To 1)
    For i = 1 To n
        d(i, 1) = CStr(arr(LBound(arr) + i - 1))
    Next i
    FilasLista = d
End Function

' Todas las unidades conocidas (las de siempre + las del catálogo + presentaciones).
Public Function FilasUnidades(ByVal raiz As Variant, ByVal iniciales As Variant) As Variant
    Dim vistas As New Collection, cats As Variant, claves As Variant, c As Long, porNombre As Variant, nombres As Variant
    Dim j As Long, u As Variant, i As Long, eq As Variant, d() As Variant, it As Variant
    For i = LBound(iniciales) To UBound(iniciales)
        AgregarUnico vistas, CStr(iniciales(i))
    Next i
    Asignar cats, UltimoCatalogo(raiz)
    claves = Array("insumos", "panes", "pasteles")
    For c = 0 To 2
        Asignar porNombre, SubObjeto(cats, "unidades", claves(c))
        nombres = JsonKeys(porNombre)
        For j = 0 To JsonLargo(nombres) - 1
            Asignar u, JsonGet(porNombre, nombres(j))
            If VarType(u) = vbString Then u = Split(u, ",")
            For i = 0 To JsonLargo(u) - 1
                If VarType(u(LBound(u) + i)) = vbString Then AgregarUnico vistas, Trim$(u(LBound(u) + i))
            Next i
        Next j
        Asignar porNombre, SubObjeto(cats, "baseUnits", claves(c))
        nombres = JsonKeys(porNombre)
        For j = 0 To JsonLargo(nombres) - 1
            AgregarUnico vistas, Txt(porNombre, CStr(nombres(j)))
        Next j
    Next c
    eq = FilasEquivalencias(raiz)
    If Not IsEmpty(eq) Then
        For i = 1 To UBound(eq, 1)
            AgregarUnico vistas, CStr(eq(i, 2))
        Next i
    End If
    ReDim d(1 To vistas.Count, 1 To 1)
    i = 0
    For Each it In vistas
        i = i + 1
        d(i, 1) = it
    Next it
    FilasUnidades = d
End Function

Private Sub AgregarUnico(col As Collection, ByVal s As String)
    s = Trim$(s)
    If s = "" Then Exit Sub
    On Error Resume Next
    col.Add s, "k_" & LCase$(s)
    On Error GoTo 0
End Sub

' ── Movimientos ──────────────────────────────────────────────────
Private Function Registros(ByVal raiz As Variant, ByVal clave As String) As Variant
    Dim v As Variant
    Asignar v, JsonGet(raiz, clave)
    If IsArray(v) Then Registros = v Else Registros = Array()
End Function

' Factor con el que se guardó el registro (cantidadBase / cantidad), o Empty.
Private Function FactorRegistrado(ByVal r As Variant) As Variant
    Dim cant As Variant, cantBase As Variant, fb As Variant
    FactorRegistrado = Empty
    cant = Num(r, "cantidad")
    cantBase = Num(r, "cantidadBase")
    If Not IsEmpty(cant) And Not IsEmpty(cantBase) Then
        If cant <> 0 Then FactorRegistrado = cantBase / cant: Exit Function
    End If
    fb = Num(r, "factorBase")
    If Not IsEmpty(fb) Then If fb > 0 Then FactorRegistrado = fb
End Function

Private Function IdDe(ByVal r As Variant) As Variant
    IdDe = Num(r, "id")
End Function

Public Function FilasEntradas(ByVal raiz As Variant) As Variant
    Dim arr As Variant, n As Long, i As Long, r As Variant, d() As Variant, pt As Variant
    arr = Registros(raiz, "entradas")
    n = JsonLargo(arr)
    If n = 0 Then FilasEntradas = Empty: Exit Function
    ReDim d(1 To n, 1 To 12)
    For i = 1 To n
        Asignar r, arr(LBound(arr) + i - 1)
        d(i, 1) = IdDe(r)
        d(i, 2) = FechaIso(Txt(r, "fecha"))
        d(i, 3) = Txt(r, "tipodoc")
        d(i, 4) = Txt(r, "numdoc")
        d(i, 5) = Txt(r, "proveedor")
        d(i, 6) = Txt(r, "insumo")
        d(i, 7) = Txt(r, "unidad")
        d(i, 8) = Num(r, "cantidad")
        pt = Num(r, "precioTotal")
        If IsEmpty(pt) Then pt = NumO0(r, "precio") * NumO0(r, "cantidad")
        d(i, 9) = pt
        d(i, 10) = Num(r, "totalDoc")
        d(i, 11) = Txt(r, "obs")
        d(i, 12) = FactorRegistrado(r)
    Next i
    FilasEntradas = d
End Function

Public Function FilasSalidasIns(ByVal raiz As Variant) As Variant
    Dim arr As Variant, n As Long, i As Long, r As Variant, d() As Variant, obs As String
    arr = Registros(raiz, "salidas_ins")
    n = JsonLargo(arr)
    If n = 0 Then FilasSalidasIns = Empty: Exit Function
    ReDim d(1 To n, 1 To 9)
    For i = 1 To n
        Asignar r, arr(LBound(arr) + i - 1)
        d(i, 1) = IdDe(r)
        d(i, 2) = FechaIso(Txt(r, "fecha"))
        d(i, 3) = Txt(r, "motivo")
        d(i, 4) = Txt(r, "ticket")
        d(i, 5) = Txt(r, "insumo")
        d(i, 6) = Txt(r, "unidad")
        d(i, 7) = Num(r, "cantidad")
        obs = Txt(r, "obs")
        If Txt(r, "obs_linea") <> "" Then obs = obs & IIf(obs <> "", " · ", "") & Txt(r, "obs_linea")
        d(i, 8) = obs
        d(i, 9) = FactorRegistrado(r)
    Next i
    FilasSalidasIns = d
End Function

Public Function FilasProduccion(ByVal raiz As Variant) As Variant
    Dim arr As Variant, n As Long, i As Long, r As Variant, d() As Variant, tipo As String, teo As Variant, ut As String
    arr = Registros(raiz, "produccion")
    n = JsonLargo(arr)
    If n = 0 Then FilasProduccion = Empty: Exit Function
    ReDim d(1 To n, 1 To 12)
    For i = 1 To n
        Asignar r, arr(LBound(arr) + i - 1)
        tipo = LCase$(Txt(r, "tipo"))
        d(i, 1) = IdDe(r)
        d(i, 2) = FechaIso(Txt(r, "fecha"))
        d(i, 3) = Txt(r, "turno")
        If tipo = "pan" Then
            d(i, 4) = "Pan"
        ElseIf tipo = "pastel" Then
            d(i, 4) = "Pastel"
        Else
            d(i, 4) = Txt(r, "tipo")
        End If
        d(i, 5) = Txt(r, "producto")
        d(i, 6) = Txt(r, "unidad")
        d(i, 7) = Num(r, "cantidadPresentacion")
        ut = Txt(r, "unidadTeorica")
        If ut = "" Then ut = IIf(tipo = "pan", "quintal", "lata")
        d(i, 8) = ut
        ' Igual que prodCantidadTeorica de la app.
        teo = Num(r, "cantidadTeorica")
        If IsEmpty(teo) Then
            teo = NumO0(r, "cantidadPresentacion")
            If teo = 0 Then teo = NumO0(r, "cantidad")
            If NumO0(r, "eqA") <> 0 Then teo = teo * NumO0(r, "eqA")
        End If
        d(i, 9) = teo
        d(i, 10) = Num(r, "cantidad")
        d(i, 11) = NumO0(r, "defectuosa")
        d(i, 12) = Txt(r, "obs")
    Next i
    FilasProduccion = d
End Function

Public Function FilasSalidasProd(ByVal raiz As Variant) As Variant
    Dim arr As Variant, n As Long, i As Long, r As Variant, d() As Variant
    arr = Registros(raiz, "salida_prod")
    n = JsonLargo(arr)
    If n = 0 Then FilasSalidasProd = Empty: Exit Function
    ReDim d(1 To n, 1 To 11)
    For i = 1 To n
        Asignar r, arr(LBound(arr) + i - 1)
        d(i, 1) = IdDe(r)
        d(i, 2) = FechaIso(Txt(r, "fecha"))
        d(i, 3) = Txt(r, "categoria")
        d(i, 4) = Txt(r, "producto")
        d(i, 5) = Txt(r, "unidad")
        d(i, 6) = Num(r, "cantidad")
        d(i, 7) = Txt(r, "destino")
        d(i, 8) = Txt(r, "encargado")
        d(i, 9) = Txt(r, "documento")
        d(i, 10) = Txt(r, "obs")
        d(i, 11) = FactorRegistrado(r)
    Next i
    FilasSalidasProd = d
End Function

' ── Exportar (tablas → JSON de la app) ───────────────────────────
' enc: encabezados de la tabla (arreglo 2D 1×n o 1D); datos: arreglo 2D de la tabla.
Public Function IndiceColumnas(ByVal enc As Variant) As Collection
    Dim col As New Collection, j As Long
    If ArregloDims(enc) = 2 Then
        For j = LBound(enc, 2) To UBound(enc, 2)
            On Error Resume Next
            col.Add j, "k_" & CStr(enc(LBound(enc, 1), j))
            On Error GoTo 0
        Next j
    Else
        For j = LBound(enc) To UBound(enc)
            On Error Resume Next
            col.Add j, "k_" & CStr(enc(j))
            On Error GoTo 0
        Next j
    End If
    Set IndiceColumnas = col
End Function

Public Function ArregloDims(ByVal a As Variant) As Long
    Dim d As Long, x As Long
    If Not IsArray(a) Then Exit Function
    On Error GoTo Fin
    Do
        d = d + 1
        x = UBound(a, d)
    Loop
Fin:
    ArregloDims = d - 1
End Function

Private Function Celda(ByVal datos As Variant, ByVal fila As Long, ByVal idx As Collection, ByVal nombre As String) As Variant
    Dim j As Long
    Celda = Empty
    On Error Resume Next
    j = idx("k_" & nombre)
    If Err.Number <> 0 Then Exit Function
    On Error GoTo 0
    Celda = datos(fila, j)
End Function

Private Function JTxt(ByVal v As Variant) As String
    If IsError(v) Or IsEmpty(v) Or IsNull(v) Then
        JTxt = """"""
    Else
        JTxt = JsonTexto(CStr(v))
    End If
End Function

Private Function JNum(ByVal v As Variant) As String
    If IsError(v) Or IsEmpty(v) Or IsNull(v) Then
        JNum = "0"
    ElseIf IsNumeric(v) Then
        JNum = JsonNumero(CDbl(v))
    Else
        JNum = "0"
    End If
End Function

Private Function Par(ByVal clave As String, ByVal valorJson As String) As String
    Par = JsonTexto(clave) & ":" & valorJson
End Function

Private Function FilaVaciaDatos(ByVal datos As Variant, ByVal fila As Long, ByVal idx As Collection, ByVal clave As String) As Boolean
    Dim v As Variant
    v = Celda(datos, fila, idx, clave)
    FilaVaciaDatos = IsEmpty(v) Or IsError(v) Or Trim$(CStr(IIf(IsError(v), "", v))) = ""
End Function

' Devuelve un arreglo JSON con los registros de una tabla de movimientos.
' tipo: "entradas" | "salidas_ins" | "produccion" | "salida_prod"
Public Function JsonDeMovimientos(ByVal tipo As String, ByVal enc As Variant, ByVal datos As Variant) As String
    Dim idx As Collection, n As Long, i As Long, partes() As String, k As Long, clave As String, c As Variant
    Set idx = IndiceColumnas(enc)
    If tipo = "produccion" Or tipo = "salida_prod" Then clave = "Producto" Else clave = "Insumo"
    If ArregloDims(datos) <> 2 Then JsonDeMovimientos = "[]": Exit Function
    n = UBound(datos, 1) - LBound(datos, 1) + 1
    ReDim partes(0 To n)
    For i = LBound(datos, 1) To UBound(datos, 1)
        If Not FilaVaciaDatos(datos, i, idx, clave) Then
            partes(k) = "{" & CamposMovimiento(tipo, datos, i, idx) & "}"
            k = k + 1
        End If
    Next i
    If k = 0 Then JsonDeMovimientos = "[]": Exit Function
    ReDim Preserve partes(0 To k - 1)
    JsonDeMovimientos = "[" & vbLf & Join(partes, "," & vbLf) & vbLf & "]"
End Function

Private Function CamposMovimiento(ByVal tipo As String, ByVal d As Variant, ByVal i As Long, ByVal idx As Collection) As String
    Dim p As New Collection, s As String, it As Variant, tipoProd As String
    p.Add Par("id", JNum(Celda(d, i, idx, "ID")))
    p.Add Par("fecha", JsonTexto(FechaAIso(Celda(d, i, idx, "Fecha"))))
    Select Case tipo
        Case "entradas"
            p.Add Par("tipodoc", JTxt(Celda(d, i, idx, "Tipo doc.")))
            p.Add Par("numdoc", JTxt(Celda(d, i, idx, "N° doc.")))
            p.Add Par("proveedor", JTxt(Celda(d, i, idx, "Proveedor")))
            p.Add Par("insumo", JTxt(Celda(d, i, idx, "Insumo")))
            AgregarCantidades p, d, i, idx
            p.Add Par("precio", JNum(Celda(d, i, idx, "Precio unit.")))
            p.Add Par("precioTotal", JNum(Celda(d, i, idx, "Precio total")))
            If IsNumeric(Celda(d, i, idx, "Total doc.")) And Not IsEmpty(Celda(d, i, idx, "Total doc.")) Then
                p.Add Par("totalDoc", JNum(Celda(d, i, idx, "Total doc.")))
            Else
                p.Add Par("totalDoc", JNum(Celda(d, i, idx, "Precio total")))
            End If
            p.Add Par("obs", JTxt(Celda(d, i, idx, "Obs.")))
        Case "salidas_ins"
            p.Add Par("motivo", JTxt(Celda(d, i, idx, "Motivo")))
            p.Add Par("ticket", JTxt(Celda(d, i, idx, "Ticket")))
            p.Add Par("insumo", JTxt(Celda(d, i, idx, "Insumo")))
            AgregarCantidades p, d, i, idx
            p.Add Par("obs", JTxt(Celda(d, i, idx, "Obs.")))
            p.Add Par("obs_linea", """""")
        Case "produccion"
            tipoProd = LCase$(CStr(IIf(IsError(Celda(d, i, idx, "Tipo")), "", Celda(d, i, idx, "Tipo"))))
            p.Add Par("tipo", JsonTexto(tipoProd))
            p.Add Par("turno", JTxt(Celda(d, i, idx, "Turno")))
            p.Add Par("producto", JTxt(Celda(d, i, idx, "Producto")))
            p.Add Par("unidad", JTxt(Celda(d, i, idx, "Presentación")))
            p.Add Par("cantidad", JNum(Celda(d, i, idx, "Producido")))
            p.Add Par("cantidadPresentacion", JNum(Celda(d, i, idx, "Cant. presentación")))
            p.Add Par("unidadTeorica", JTxt(Celda(d, i, idx, "Unidad teórica")))
            p.Add Par("cantidadTeorica", JNum(Celda(d, i, idx, "Cant. teórica")))
            p.Add Par("eqA", JNum(Celda(d, i, idx, "Cant. teórica")))
            p.Add Par("defectuosa", JNum(Celda(d, i, idx, "Defectuoso")))
            p.Add Par("neto", JNum(Celda(d, i, idx, "Neto")))
            p.Add Par("obs", JTxt(Celda(d, i, idx, "Obs.")))
        Case "salida_prod"
            p.Add Par("categoria", JTxt(Celda(d, i, idx, "Categoría")))
            p.Add Par("producto", JTxt(Celda(d, i, idx, "Producto")))
            AgregarCantidades p, d, i, idx
            p.Add Par("destino", JTxt(Celda(d, i, idx, "Destino")))
            p.Add Par("encargado", JTxt(Celda(d, i, idx, "Encargado")))
            p.Add Par("documento", JTxt(Celda(d, i, idx, "Documento")))
            p.Add Par("obs", JTxt(Celda(d, i, idx, "Obs.")))
    End Select
    For Each it In p
        s = s & IIf(s = "", "", ",") & it
    Next it
    CamposMovimiento = s
End Function

Private Sub AgregarCantidades(p As Collection, ByVal d As Variant, ByVal i As Long, ByVal idx As Collection)
    Dim pres As Variant, ub As Variant
    pres = Celda(d, i, idx, "Presentación")
    ub = Celda(d, i, idx, "Unidad base")
    If IsError(pres) Then pres = ""
    If IsError(ub) Then ub = ""
    If Trim$(CStr(pres)) = "" Then pres = ub
    p.Add Par("unidad", JsonTexto(CStr(pres)))
    p.Add Par("cantidad", JNum(Celda(d, i, idx, "Cantidad")))
    p.Add Par("cantidadBase", JNum(Celda(d, i, idx, "Cant. base")))
    p.Add Par("unidadBase", JsonTexto(CStr(ub)))
    p.Add Par("factorBase", JNum(Celda(d, i, idx, "Factor")))
End Sub

' Objeto "catalogos" de la app a partir de las tablas de catálogo.
Public Function JsonDeCatalogo(ByVal encIns As Variant, ByVal datIns As Variant, ByVal encProd As Variant, ByVal datProd As Variant, _
                               ByVal encEq As Variant, ByVal datEq As Variant, ByVal destinos As Variant, ByVal encargados As Variant) As String
    Dim iIns As Collection, iProd As Collection, iEq As Collection, i As Long, nom As String, uni As String, clave As String
    Dim insumos As String, panes As String, pasteles As String, uIns As String, uPan As String, uPas As String
    Dim eqIns As New Collection, eqPan As New Collection, eqPas As New Collection, claveDe As New Collection
    Set iIns = IndiceColumnas(encIns): Set iProd = IndiceColumnas(encProd): Set iEq = IndiceColumnas(encEq)
    If ArregloDims(datIns) = 2 Then
        For i = LBound(datIns, 1) To UBound(datIns, 1)
            nom = Trim$(SoloTexto(Celda(datIns, i, iIns, "Insumo")))
            If nom <> "" Then
                uni = Trim$(SoloTexto(Celda(datIns, i, iIns, "Unidad base")))
                insumos = insumos & IIf(insumos = "", "", ",") & JsonTexto(nom)
                uIns = uIns & IIf(uIns = "", "", ",") & JsonTexto(nom) & ":" & JsonTexto(uni)
                On Error Resume Next: claveDe.Add "insumos", "k_" & nom: On Error GoTo 0
            End If
        Next i
    End If
    If ArregloDims(datProd) = 2 Then
        For i = LBound(datProd, 1) To UBound(datProd, 1)
            nom = Trim$(SoloTexto(Celda(datProd, i, iProd, "Producto")))
            If nom <> "" Then
                uni = Trim$(SoloTexto(Celda(datProd, i, iProd, "Unidad base")))
                If LCase$(Trim$(SoloTexto(Celda(datProd, i, iProd, "Tipo")))) = "pastel" Then
                    pasteles = pasteles & IIf(pasteles = "", "", ",") & JsonTexto(nom)
                    uPas = uPas & IIf(uPas = "", "", ",") & JsonTexto(nom) & ":" & JsonTexto(uni)
                    On Error Resume Next: claveDe.Add "pasteles", "k_" & nom: On Error GoTo 0
                Else
                    panes = panes & IIf(panes = "", "", ",") & JsonTexto(nom)
                    uPan = uPan & IIf(uPan = "", "", ",") & JsonTexto(nom) & ":" & JsonTexto(uni)
                    On Error Resume Next: claveDe.Add "panes", "k_" & nom: On Error GoTo 0
                End If
            End If
        Next i
    End If
    If ArregloDims(datEq) = 2 Then
        For i = LBound(datEq, 1) To UBound(datEq, 1)
            nom = Trim$(SoloTexto(Celda(datEq, i, iEq, "Artículo")))
            If nom <> "" Then
                clave = ""
                On Error Resume Next: clave = claveDe("k_" & nom): On Error GoTo 0
                If clave = "" Then clave = "insumos"
                Dim item As String
                item = "{" & Par("nombre", JTxt(Celda(datEq, i, iEq, "Presentación"))) & "," & _
                       Par("unidad", JTxt(Celda(datEq, i, iEq, "Presentación"))) & "," & _
                       Par("factor", JNum(Celda(datEq, i, iEq, "Factor"))) & "," & _
                       Par("detalle", JTxt(Celda(datEq, i, iEq, "Detalle"))) & "}"
                Select Case clave
                    Case "panes": AgregarEq eqPan, nom, item
                    Case "pasteles": AgregarEq eqPas, nom, item
                    Case Else: AgregarEq eqIns, nom, item
                End Select
            End If
        Next i
    End If
    JsonDeCatalogo = "{" & _
        Par("encargados", ListaJson(encargados)) & "," & Par("destinos", ListaJson(destinos)) & "," & _
        Par("insumos", "[" & insumos & "]") & "," & Par("panes", "[" & panes & "]") & "," & Par("pasteles", "[" & pasteles & "]") & "," & _
        Par("unidades", "{" & Par("insumos", "{" & ListaDeUnidades(uIns) & "}") & "," & Par("panes", "{" & ListaDeUnidades(uPan) & "}") & "," & _
            Par("pasteles", "{" & ListaDeUnidades(uPas) & "}") & "}") & "," & _
        Par("baseUnits", "{" & Par("insumos", "{" & uIns & "}") & "," & Par("panes", "{" & uPan & "}") & "," & Par("pasteles", "{" & uPas & "}") & "}") & "," & _
        Par("equivalencias", "{" & Par("insumos", EqJson(eqIns)) & "," & Par("panes", EqJson(eqPan)) & "," & Par("pasteles", EqJson(eqPas)) & "}") & _
        "}"
End Function

Private Function SoloTexto(ByVal v As Variant) As String
    If IsError(v) Or IsEmpty(v) Or IsNull(v) Then Exit Function
    SoloTexto = CStr(v)
End Function

' "nombre":"unidad",... → "nombre":["unidad"],...
Private Function ListaDeUnidades(ByVal pares As String) As String
    If pares = "" Then Exit Function
    ListaDeUnidades = Replace(Replace(pares, """:""", """:["""), """,""", """],""") & "]"
End Function

Private Sub AgregarEq(col As Collection, ByVal nombre As String, ByVal item As String)
    Dim actual As Variant
    On Error Resume Next
    actual = col("k_" & nombre)
    If Err.Number <> 0 Then
        Err.Clear
        col.Add Array(nombre, item), "k_" & nombre
    Else
        col.Remove "k_" & nombre
        col.Add Array(nombre, actual(1) & "," & item), "k_" & nombre
    End If
    On Error GoTo 0
End Sub

Private Function EqJson(col As Collection) As String
    Dim it As Variant, s As String
    For Each it In col
        s = s & IIf(s = "", "", ",") & JsonTexto(CStr(it(0))) & ":[" & it(1) & "]"
    Next it
    EqJson = "{" & s & "}"
End Function

Private Function ListaJson(ByVal datos As Variant) As String
    Dim i As Long, s As String, v As String
    If ArregloDims(datos) = 2 Then
        For i = LBound(datos, 1) To UBound(datos, 1)
            v = Trim$(SoloTexto(datos(i, LBound(datos, 2))))
            If v <> "" Then s = s & IIf(s = "", "", ",") & JsonTexto(v)
        Next i
    End If
    ListaJson = "[" & s & "]"
End Function

Public Function JsonRespaldo(ByVal cuando As String, ByVal entradas As String, ByVal salidasIns As String, _
                             ByVal produccion As String, ByVal salidaProd As String, ByVal catalogo As String) As String
    JsonRespaldo = "{" & vbLf & _
        Par("version", "2") & "," & vbLf & _
        Par("fecha_exportacion", JsonTexto(cuando)) & "," & vbLf & _
        Par("origen", JsonTexto("PanControl Excel")) & "," & vbLf & _
        Par("entradas", entradas) & "," & vbLf & _
        Par("salidas_ins", salidasIns) & "," & vbLf & _
        Par("produccion", produccion) & "," & vbLf & _
        Par("salida_prod", salidaProd) & "," & vbLf & _
        Par("inventario", "[]") & "," & vbLf & _
        Par("catalogos", "[" & catalogo & "]") & vbLf & "}"
End Function
