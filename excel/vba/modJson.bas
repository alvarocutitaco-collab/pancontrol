Attribute VB_Name = "modJson"
' ════════════════════════════════════════════════════════════════
' JSON y UTF-8 en VBA puro (sin referencias externas ni Scripting.Dictionary,
' para que funcione igual en Excel de Windows y de Mac).
'
'   JsonParse(texto)  → objeto JSON = Collection de pares Array(clave, valor)
'                       arreglo JSON = arreglo Variant (base 0; vacío = Array())
'                       texto / número (Double) / True / False / Null
'   JsonGet(obj, "clave"), JsonHas(obj, "clave"), JsonKeys(obj)
'   JsonTexto(s), JsonNumero(d)       → para escribir JSON
'   LeerArchivoUtf8(ruta), EscribirArchivoUtf8(ruta, texto)
' ════════════════════════════════════════════════════════════════
Option Explicit

Private pTexto As String
Private pB() As Byte
Private pPos As Long
Private pN As Long

' ── Lectura ──────────────────────────────────────────────────────
Public Function JsonParse(ByVal texto As String) As Variant
    Dim v As Variant
    pTexto = texto
    pN = Len(texto)
    pPos = 0
    If pN = 0 Then Err.Raise vbObjectError + 600, "JSON", "El archivo está vacío"
    pB = texto
    Asignar v, ParseValor()
    SaltarEspacios
    If pPos < pN Then Err.Raise vbObjectError + 601, "JSON", "Texto sobrante después del JSON (posición " & pPos & ")"
    If IsObject(v) Then Set JsonParse = v Else JsonParse = v
End Function

Public Sub Asignar(ByRef destino As Variant, ByVal origen As Variant)
    If IsObject(origen) Then Set destino = origen Else destino = origen
End Sub

Private Function Ch(ByVal i As Long) As Long
    If i >= pN Or i < 0 Then
        Ch = -1
    Else
        Ch = CLng(pB(2 * i)) + CLng(pB(2 * i + 1)) * 256
    End If
End Function

Private Sub SaltarEspacios()
    Dim c As Long
    Do While pPos < pN
        c = Ch(pPos)
        If c = 32 Or c = 9 Or c = 10 Or c = 13 Then
            pPos = pPos + 1
        Else
            Exit Do
        End If
    Loop
End Sub

Private Sub Fallar(ByVal msg As String)
    Err.Raise vbObjectError + 602, "JSON", msg & " (posición " & pPos & ")"
End Sub

Private Function ParseValor() As Variant
    SaltarEspacios
    Select Case Ch(pPos)
        Case 123 ' {
            Set ParseValor = ParseObjeto()
        Case 91 ' [
            ParseValor = ParseArreglo()
        Case 34 ' "
            ParseValor = ParseCadena()
        Case 116 ' t
            Esperar "true"
            ParseValor = True
        Case 102 ' f
            Esperar "false"
            ParseValor = False
        Case 110 ' n
            Esperar "null"
            ParseValor = Null
        Case -1
            Fallar "El JSON termina antes de tiempo"
        Case Else
            ParseValor = ParseNumero()
    End Select
End Function

Private Sub Esperar(ByVal palabra As String)
    If Mid$(pTexto, pPos + 1, Len(palabra)) <> palabra Then Fallar "Se esperaba " & palabra
    pPos = pPos + Len(palabra)
End Sub

Private Function ParseObjeto() As Collection
    Dim col As Collection, k As String, v As Variant, c As Long
    Set col = New Collection
    pPos = pPos + 1
    SaltarEspacios
    If Ch(pPos) = 125 Then
        pPos = pPos + 1
        Set ParseObjeto = col
        Exit Function
    End If
    Do
        SaltarEspacios
        If Ch(pPos) <> 34 Then Fallar "Se esperaba una clave entre comillas"
        k = ParseCadena()
        SaltarEspacios
        If Ch(pPos) <> 58 Then Fallar "Se esperaba ':'"
        pPos = pPos + 1
        Asignar v, ParseValor()
        AgregarPar col, k, v
        SaltarEspacios
        c = Ch(pPos)
        If c = 44 Then
            pPos = pPos + 1
        ElseIf c = 125 Then
            pPos = pPos + 1
            Exit Do
        Else
            Fallar "Se esperaba ',' o '}'"
        End If
    Loop
    Set ParseObjeto = col
End Function

' Las claves de Collection no distinguen mayúsculas: si dos claves chocan, la
' segunda se guarda sin clave (JsonGet la encuentra recorriendo).
Private Sub AgregarPar(col As Collection, ByVal k As String, ByVal v As Variant)
    On Error Resume Next
    col.Add Array(k, v), "k_" & k
    If Err.Number <> 0 Then
        Err.Clear
        col.Add Array(k, v)
    End If
    On Error GoTo 0
End Sub

Private Function ParseArreglo() As Variant
    Dim arr() As Variant, n As Long, v As Variant, c As Long
    pPos = pPos + 1
    SaltarEspacios
    If Ch(pPos) = 93 Then
        pPos = pPos + 1
        ParseArreglo = Array()
        Exit Function
    End If
    ReDim arr(0 To 15)
    Do
        Asignar v, ParseValor()
        If n > UBound(arr) Then
            ReDim Preserve arr(0 To 2 * UBound(arr) + 1)
        End If
        If IsObject(v) Then Set arr(n) = v Else arr(n) = v
        n = n + 1
        SaltarEspacios
        c = Ch(pPos)
        If c = 44 Then
            pPos = pPos + 1
        ElseIf c = 93 Then
            pPos = pPos + 1
            Exit Do
        Else
            Fallar "Se esperaba ',' o ']'"
        End If
    Loop
    ReDim Preserve arr(0 To n - 1)
    ParseArreglo = arr
End Function

Private Function ParseCadena() As String
    Dim inicio As Long, c As Long, s As String, hexa As String
    pPos = pPos + 1
    inicio = pPos
    ' Camino rápido: sin secuencias de escape.
    Do While pPos < pN
        c = Ch(pPos)
        If c = 34 Then
            ParseCadena = Mid$(pTexto, inicio + 1, pPos - inicio)
            pPos = pPos + 1
            Exit Function
        ElseIf c = 92 Then
            Exit Do
        End If
        pPos = pPos + 1
    Loop
    s = Mid$(pTexto, inicio + 1, pPos - inicio)
    Do While pPos < pN
        c = Ch(pPos)
        If c = 34 Then
            pPos = pPos + 1
            ParseCadena = s
            Exit Function
        ElseIf c = 92 Then
            pPos = pPos + 1
            Select Case Ch(pPos)
                Case 34: s = s & """"
                Case 92: s = s & "\"
                Case 47: s = s & "/"
                Case 98: s = s & ChrW$(8)
                Case 102: s = s & ChrW$(12)
                Case 110: s = s & vbLf
                Case 114: s = s & vbCr
                Case 116: s = s & vbTab
                Case 117
                    hexa = Mid$(pTexto, pPos + 2, 4)
                    s = s & ChrW$(CLng("&H" & hexa & "&"))
                    pPos = pPos + 4
                Case Else
                    Fallar "Secuencia de escape inválida"
            End Select
            pPos = pPos + 1
        Else
            s = s & ChrW$(c)
            pPos = pPos + 1
        End If
    Loop
    Fallar "Texto sin cerrar"
End Function

Private Function ParseNumero() As Double
    Dim inicio As Long, c As Long
    inicio = pPos
    Do While pPos < pN
        c = Ch(pPos)
        If (c >= 48 And c <= 57) Or c = 45 Or c = 43 Or c = 46 Or c = 101 Or c = 69 Then
            pPos = pPos + 1
        Else
            Exit Do
        End If
    Loop
    If pPos = inicio Then Fallar "Valor JSON inválido"
    ParseNumero = Val(Mid$(pTexto, inicio + 1, pPos - inicio))
End Function

' ── Acceso a objetos ─────────────────────────────────────────────
' En este módulo el único objeto posible es una Collection (objeto JSON).
Public Function JsonEsObjeto(ByVal v As Variant) As Boolean
    If IsObject(v) Then JsonEsObjeto = Not (v Is Nothing)
End Function

Public Function JsonHas(ByVal obj As Variant, ByVal clave As String) As Boolean
    Dim par As Variant
    JsonHas = BuscarPar(obj, clave, par)
End Function

Public Function JsonGet(ByVal obj As Variant, ByVal clave As String) As Variant
    Dim par As Variant
    If BuscarPar(obj, clave, par) Then
        If IsObject(par(1)) Then Set JsonGet = par(1) Else JsonGet = par(1)
    Else
        JsonGet = Empty
    End If
End Function

Private Function BuscarPar(ByVal obj As Variant, ByVal clave As String, ByRef par As Variant) As Boolean
    If JsonEsObjeto(obj) Then BuscarPar = BuscarParEn(obj, clave, par)
End Function

Private Function BuscarParEn(ByVal col As Collection, ByVal clave As String, ByRef par As Variant) As Boolean
    Dim it As Variant
    On Error Resume Next
    par = col("k_" & clave)
    If Err.Number = 0 Then
        On Error GoTo 0
        If StrComp(par(0), clave, vbBinaryCompare) = 0 Then BuscarParEn = True: Exit Function
    End If
    Err.Clear
    On Error GoTo 0
    For Each it In col
        If StrComp(it(0), clave, vbBinaryCompare) = 0 Then
            par = it
            BuscarParEn = True
            Exit Function
        End If
    Next it
End Function

' Claves de un objeto, en orden (arreglo base 0; vacío = Array()).
Public Function JsonKeys(ByVal obj As Variant) As Variant
    If JsonEsObjeto(obj) Then JsonKeys = ClavesDe(obj) Else JsonKeys = Array()
End Function

Private Function ClavesDe(ByVal col As Collection) As Variant
    Dim arr() As Variant, i As Long, it As Variant
    If col.Count = 0 Then ClavesDe = Array(): Exit Function
    ReDim arr(0 To col.Count - 1)
    For Each it In col
        arr(i) = it(0)
        i = i + 1
    Next it
    ClavesDe = arr
End Function

Public Function JsonLargo(ByVal v As Variant) As Long
    If IsArray(v) Then JsonLargo = UBound(v) - LBound(v) + 1
End Function

' ── Escritura ────────────────────────────────────────────────────
Public Function JsonTexto(ByVal s As String) As String
    Dim i As Long, c As Long, r As String
    s = Replace(s, "\", "\\")
    s = Replace(s, """", "\""")
    s = Replace(s, vbCr, "\r")
    s = Replace(s, vbLf, "\n")
    s = Replace(s, vbTab, "\t")
    For i = 1 To Len(s)
        If AscW(Mid$(s, i, 1)) >= 0 And AscW(Mid$(s, i, 1)) < 32 Then
            r = ""
            For c = 1 To Len(s)
                If AscW(Mid$(s, c, 1)) >= 0 And AscW(Mid$(s, c, 1)) < 32 Then
                    r = r & "\u" & Right$("000" & Hex$(AscW(Mid$(s, c, 1))), 4)
                Else
                    r = r & Mid$(s, c, 1)
                End If
            Next c
            s = r
            Exit For
        End If
    Next i
    JsonTexto = """" & s & """"
End Function

Public Function JsonNumero(ByVal d As Double) As String
    Dim t As String
    t = Trim$(Str$(d))
    If Left$(t, 1) = "." Then t = "0" & t
    If Left$(t, 2) = "-." Then t = "-0" & Mid$(t, 2)
    JsonNumero = t
End Function

' Serializa cualquier valor devuelto por JsonParse (lo usan las pruebas).
Public Function JsonStringify(ByVal v As Variant) As String
    If JsonEsObjeto(v) Then
        JsonStringify = ObjetoATexto(v)
    ElseIf IsArray(v) Then
        JsonStringify = ArregloATexto(v)
    ElseIf IsNull(v) Or IsEmpty(v) Then
        JsonStringify = "null"
    ElseIf VarType(v) = vbBoolean Then
        If v Then JsonStringify = "true" Else JsonStringify = "false"
    ElseIf VarType(v) = vbString Then
        JsonStringify = JsonTexto(v)
    ElseIf IsNumeric(v) Then
        JsonStringify = JsonNumero(CDbl(v))
    Else
        JsonStringify = JsonTexto(CStr(v))
    End If
End Function

Private Function ObjetoATexto(ByVal col As Collection) As String
    Dim partes() As String, i As Long, it As Variant
    If col.Count = 0 Then ObjetoATexto = "{}": Exit Function
    ReDim partes(0 To col.Count - 1)
    For Each it In col
        partes(i) = JsonTexto(CStr(it(0))) & ":" & JsonStringify(it(1))
        i = i + 1
    Next it
    ObjetoATexto = "{" & Join(partes, ",") & "}"
End Function

Private Function ArregloATexto(ByVal a As Variant) As String
    Dim partes() As String, i As Long, n As Long
    n = JsonLargo(a)
    If n = 0 Then ArregloATexto = "[]": Exit Function
    ReDim partes(0 To n - 1)
    For i = 0 To n - 1
        partes(i) = JsonStringify(a(LBound(a) + i))
    Next i
    ArregloATexto = "[" & Join(partes, ",") & "]"
End Function

' ── UTF-8 y archivos ─────────────────────────────────────────────
Public Function Utf8ATexto(b() As Byte) As String
    Dim i As Long, j As Long, c As Long, hi As Long, ult As Long, o() As Byte
    ult = UBound(b)
    If ult < LBound(b) Then Exit Function
    ReDim o(0 To 2 * (ult - LBound(b) + 1) + 3)
    i = LBound(b)
    If ult - i >= 2 Then
        If b(i) = &HEF And b(i + 1) = &HBB And b(i + 2) = &HBF Then i = i + 3
    End If
    Do While i <= ult
        c = b(i)
        If c < &H80 Then
            i = i + 1
        ElseIf c < &HE0 And i + 1 <= ult Then
            c = ((c And &H1F) * &H40&) Or (b(i + 1) And &H3F)
            i = i + 2
        ElseIf c < &HF0 And i + 2 <= ult Then
            c = ((c And &HF) * &H1000&) Or ((b(i + 1) And &H3F) * &H40&) Or (b(i + 2) And &H3F)
            i = i + 3
        ElseIf i + 3 <= ult Then
            c = ((c And &H7) * &H40000) Or ((b(i + 1) And &H3F) * &H1000&) Or ((b(i + 2) And &H3F) * &H40&) Or (b(i + 3) And &H3F)
            i = i + 4
            c = c - &H10000
            hi = &HD800& + (c \ &H400&)
            o(j) = hi And &HFF
            o(j + 1) = hi \ &H100&
            j = j + 2
            c = &HDC00& + (c And &H3FF&)
        Else
            c = &HFFFD&
            i = i + 1
        End If
        o(j) = c And &HFF
        o(j + 1) = c \ &H100&
        j = j + 2
    Loop
    If j = 0 Then Exit Function
    ReDim Preserve o(0 To j - 1)
    Utf8ATexto = o
End Function

' Devuelve un arreglo de bytes (dentro de un Variant).
Public Function TextoAUtf8(ByVal s As String) As Variant
    Dim n As Long, i As Long, j As Long, c As Long, c2 As Long, w() As Byte, o() As Byte
    n = Len(s)
    If n = 0 Then
        ReDim o(0 To 0)
        TextoAUtf8 = o
        Exit Function
    End If
    w = s
    ReDim o(0 To 4 * n)
    i = 0
    Do While i < n
        c = CLng(w(2 * i)) + CLng(w(2 * i + 1)) * 256
        If c >= &HD800& And c <= &HDBFF& And i + 1 < n Then
            c2 = CLng(w(2 * i + 2)) + CLng(w(2 * i + 3)) * 256
            If c2 >= &HDC00& And c2 <= &HDFFF& Then
                c = &H10000 + (c - &HD800&) * &H400& + (c2 - &HDC00&)
                i = i + 1
            End If
        End If
        If c < &H80 Then
            o(j) = c: j = j + 1
        ElseIf c < &H800& Then
            o(j) = &HC0 Or (c \ &H40&)
            o(j + 1) = &H80 Or (c And &H3F)
            j = j + 2
        ElseIf c < &H10000 Then
            o(j) = &HE0 Or (c \ &H1000&)
            o(j + 1) = &H80 Or ((c \ &H40&) And &H3F)
            o(j + 2) = &H80 Or (c And &H3F)
            j = j + 3
        Else
            o(j) = &HF0 Or (c \ &H40000)
            o(j + 1) = &H80 Or ((c \ &H1000&) And &H3F)
            o(j + 2) = &H80 Or ((c \ &H40&) And &H3F)
            o(j + 3) = &H80 Or (c And &H3F)
            j = j + 4
        End If
        i = i + 1
    Loop
    ReDim Preserve o(0 To j - 1)
    TextoAUtf8 = o
End Function

Public Function LeerArchivoUtf8(ByVal ruta As String) As String
    Dim f As Integer, b() As Byte, n As Long
    f = FreeFile
    Open ruta For Binary Access Read As #f
    n = LOF(f)
    If n > 0 Then
        ReDim b(0 To n - 1)
        Get #f, , b
    End If
    Close #f
    If n > 0 Then LeerArchivoUtf8 = Utf8ATexto(b)
End Function

Public Sub EscribirArchivoUtf8(ByVal ruta As String, ByVal texto As String)
    Dim f As Integer, b() As Byte
    On Error Resume Next
    Kill ruta
    On Error GoTo 0
    f = FreeFile
    Open ruta For Binary Access Write As #f
    If Len(texto) > 0 Then
        b = TextoAUtf8(texto)
        Put #f, , b
    End If
    Close #f
End Sub
