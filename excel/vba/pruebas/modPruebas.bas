Attribute VB_Name = "modPruebas"
' Solo para las pruebas automáticas (tests/excel): no va en el archivo final.
Option Explicit

' Lee un JSON (UTF-8), lo interpreta y lo vuelve a escribir: debe quedar igual.
Public Function PruebaJsonIdaVuelta(ByVal entrada As String, ByVal salida As String) As String
    On Error GoTo Fallo
    Dim v As Variant
    Asignar v, JsonParse(LeerArchivoUtf8(entrada))
    EscribirArchivoUtf8 salida, JsonStringify(v)
    PruebaJsonIdaVuelta = "ok"
    Exit Function
Fallo:
    PruebaJsonIdaVuelta = "ERR " & Err.Number & ": " & Err.Description
End Function

' Convierte un respaldo de la app en las filas de cada tabla y las escribe como JSON.
Public Function PruebaRespaldo(ByVal entrada As String, ByVal salida As String) As String
    On Error GoTo Fallo
    Dim raiz As Variant, partes As String
    Asignar raiz, JsonParse(LeerArchivoUtf8(entrada))
    partes = "{" & _
        """insumos"":" & Matriz(FilasInsumos(raiz)) & "," & _
        """productos"":" & Matriz(FilasProductos(raiz)) & "," & _
        """equivalencias"":" & Matriz(FilasEquivalencias(raiz)) & "," & _
        """unidades"":" & Matriz(FilasUnidades(raiz, Array("unidad", "gramo"))) & "," & _
        """destinos"":" & Matriz(FilasLista(raiz, "destinos")) & "," & _
        """encargados"":" & Matriz(FilasLista(raiz, "encargados")) & "," & _
        """entradas"":" & Matriz(FilasEntradas(raiz)) & "," & _
        """salidas_ins"":" & Matriz(FilasSalidasIns(raiz)) & "," & _
        """produccion"":" & Matriz(FilasProduccion(raiz)) & "," & _
        """salida_prod"":" & Matriz(FilasSalidasProd(raiz)) & "}"
    EscribirArchivoUtf8 salida, partes
    PruebaRespaldo = "ok"
    Exit Function
Fallo:
    PruebaRespaldo = "ERR " & Err.Number & ": " & Err.Description
End Function

Private Function Matriz(ByVal d As Variant) As String
    Dim i As Long, j As Long, filas() As String, celdas() As String
    If IsEmpty(d) Then Matriz = "[]": Exit Function
    ReDim filas(1 To UBound(d, 1))
    For i = 1 To UBound(d, 1)
        ReDim celdas(1 To UBound(d, 2))
        For j = 1 To UBound(d, 2)
            celdas(j) = Valor(d(i, j))
        Next j
        filas(i) = "[" & Join(celdas, ",") & "]"
    Next i
    Matriz = "[" & Join(filas, ",") & "]"
End Function

Private Function Valor(ByVal v As Variant) As String
    If IsEmpty(v) Or IsNull(v) Then
        Valor = "null"
    ElseIf VarType(v) = vbDate Then
        Valor = JsonTexto(FechaAIso(v))
    ElseIf VarType(v) = vbString Then
        Valor = JsonTexto(v)
    ElseIf IsNumeric(v) Then
        Valor = JsonNumero(CDbl(v))
    Else
        Valor = JsonTexto(CStr(v))
    End If
End Function

' Exportación: arma el respaldo desde tablas de ejemplo (arreglos) y lo escribe.
Public Function PruebaExportar(ByVal salida As String) As String
    On Error GoTo Fallo
    Dim encE As Variant, datE(1 To 2, 1 To 16) As Variant, encP As Variant, datP(1 To 1, 1 To 13) As Variant
    Dim encI As Variant, datI(1 To 2, 1 To 5) As Variant, encPr As Variant, datPr(1 To 2, 1 To 6) As Variant
    Dim encQ As Variant, datQ(1 To 2, 1 To 5) As Variant, dest(1 To 2, 1 To 1) As Variant, enc(1 To 1, 1 To 1) As Variant
    encE = Fila(Array("ID", "Fecha", "Tipo doc.", "N° doc.", "Proveedor", "Insumo", "Presentación", "Cantidad", "Factor", "Cant. base", _
                      "Unidad base", "Precio unit.", "Precio total", "Total doc.", "Obs.", "Factor registrado"))
    Llenar datE, 1, Array(7, DateSerial(2026, 9, 30), "Factura", "F-1", "Molino ""El Sol""", "Harina de trigo", "saco", 2, 50000, 100000, _
                          "gramo", 150, 300, Empty, "línea 1" & vbLf & "nota", Empty)
    Llenar datE, 2, Array(Empty, Empty, Empty, Empty, Empty, Empty, Empty, Empty, 1, 0, "", 0, Empty, Empty, Empty, Empty)
    encP = Fila(Array("ID", "Fecha", "Turno", "Tipo", "Producto", "Presentación", "Cant. presentación", "Unidad teórica", "Cant. teórica", _
                      "Producido", "Defectuoso", "Neto", "Obs."))
    Llenar datP, 1, Array(1000001, DateSerial(2026, 10, 1), "Mañana", "Pan", "Pan francés", "lata", 20, "quintal", 1, 1400, 20, 1380, "")
    encI = Fila(Array("Insumo", "Unidad base", "Mínimo", "Stock inicial", "Ajuste"))
    Llenar datI, 1, Array("Harina de trigo", "gramo", 100000, 0, 0)
    Llenar datI, 2, Array("Huevos", "unidad", 60, 0, 0)
    encPr = Fila(Array("Producto", "Tipo", "Unidad base", "Rinde por lote", "Stock inicial", "Ajuste"))
    Llenar datPr, 1, Array("Pan francés", "Pan", "unidad", 1400, 0, 0)
    Llenar datPr, 2, Array("Torta", "Pastel", "unidad", 1, 0, 0)
    encQ = Fila(Array("Artículo", "Presentación", "Factor", "Unidad base", "Detalle"))
    Llenar datQ, 1, Array("Harina de trigo", "saco", 50000, "gramo", "saco 50 kg")
    Llenar datQ, 2, Array("Pan francés", "bolsa", 10, "unidad", "")
    dest(1, 1) = "Tienda": dest(2, 1) = "Delivery"
    enc(1, 1) = "Encargado 1"
    EscribirArchivoUtf8 salida, JsonRespaldo("2026-10-01T10:00:00", _
        JsonDeMovimientos("entradas", encE, datE), "[]", JsonDeMovimientos("produccion", encP, datP), "[]", _
        JsonDeCatalogo(encI, datI, encPr, datPr, encQ, datQ, dest, enc))
    PruebaExportar = "ok"
    Exit Function
Fallo:
    PruebaExportar = "ERR " & Err.Number & ": " & Err.Description
End Function

Private Function Fila(ByVal a As Variant) As Variant
    Dim r() As Variant, j As Long
    ReDim r(1 To 1, 1 To UBound(a) - LBound(a) + 1)
    For j = LBound(a) To UBound(a)
        r(1, j - LBound(a) + 1) = a(j)
    Next j
    Fila = r
End Function

Private Sub Llenar(d() As Variant, ByVal i As Long, ByVal a As Variant)
    Dim j As Long
    For j = LBound(a) To UBound(a)
        d(i, j - LBound(a) + 1) = a(j)
    Next j
End Sub

Public Function PruebaUtf8(ByVal salida As String) As String
    On Error GoTo Fallo
    Dim s As String
    s = "Año ñandú €" & ChrW$(&HD83C) & ChrW$(&HDF5E) & " " & ChrW$(&H4E2D)
    EscribirArchivoUtf8 salida, s
    If LeerArchivoUtf8(salida) <> s Then PruebaUtf8 = "distinto" Else PruebaUtf8 = "ok"
    Exit Function
Fallo:
    PruebaUtf8 = "ERR " & Err.Number & ": " & Err.Description
End Function

Public Function PruebaStringify(ByVal t As String) As String
    On Error GoTo Fallo
    Dim v As Variant
    Asignar v, JsonParse(t)
    PruebaStringify = JsonStringify(v)
    Exit Function
Fallo:
    PruebaStringify = "ERR " & Err.Number & ": " & Err.Description
End Function
