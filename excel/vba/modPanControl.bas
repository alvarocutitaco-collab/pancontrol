Attribute VB_Name = "modPanControl"
' ════════════════════════════════════════════════════════════════
' PanControl — macros de la versión Excel.
' Los cálculos (stock, resúmenes, calculadora) son fórmulas y funcionan sin
' macros. Estas macros solo agregan comodidad en Excel de PC: formularios con
' botón Guardar, eliminar filas, importar/exportar el respaldo de la app web.
' ════════════════════════════════════════════════════════════════
Option Explicit

Private Const APP As String = "PanControl"
' Los registros creados en Excel usan ids desde 1 000 001 para no chocar con
' los de la app web si luego se importan allá.
Private Const ID_MIN_NUEVOS As Double = 1000000
Private Const XL_MANUAL As Long = -4135
Private Const XL_AUTOMATICO As Long = -4105
Private Const XL_ARRIBA As Long = -4162

' ═══════════════════════ Navegación ═══════════════════════
Public Sub IrInicio()
    Ir shInicio
End Sub
Public Sub IrEntradas()
    Ir shEntradas, "entInsumo"
End Sub
Public Sub IrSalidasInsumos()
    Ir shSalidasIns, "salInsumo"
End Sub
Public Sub IrProduccion()
    Ir shProduccion, "proProducto"
End Sub
Public Sub IrSalidasProductos()
    Ir shSalidasProd, "sprProducto"
End Sub
Public Sub IrInsumos()
    Ir shInsumos
End Sub
Public Sub IrProductos()
    Ir shProductos
End Sub
Public Sub IrCatalogos()
    Ir shCatalogos
End Sub
Public Sub IrRecetas()
    Ir shRecetas
End Sub
Public Sub IrCalculadora()
    Ir shCalculadora, "calcProducto"
End Sub

Private Sub Ir(ByVal ws As Worksheet, Optional ByVal campoInicial As String = "")
    ws.Activate
    If campoInicial <> "" Then
        Campo(campoInicial).Select
    Else
        ws.Range("B1").Select
    End If
End Sub

Public Sub IrHoy()
    Campo("rngFecha").Formula = "=TODAY()"
    Campo("rngPeriodo").Value = "Día"
End Sub

' ═══════════════════════ Ayudantes ═══════════════════════
Private Function Campo(ByVal nombre As String) As Range
    Set Campo = ThisWorkbook.Names(nombre).RefersToRange
End Function

Private Function ValorCampo(ByVal nombre As String) As Variant
    ValorCampo = Campo(nombre).Value
    If IsError(ValorCampo) Then ValorCampo = Empty
End Function

Private Function TextoCampo(ByVal nombre As String) As String
    Dim v As Variant
    v = ValorCampo(nombre)
    If Not IsEmpty(v) Then TextoCampo = Trim$(CStr(v))
End Function

' Número del campo; Empty si está vacío o no es número.
Private Function NumeroCampo(ByVal nombre As String) As Variant
    Dim v As Variant
    v = ValorCampo(nombre)
    NumeroCampo = Empty
    If IsEmpty(v) Then Exit Function
    If VarType(v) = vbString Then
        If Trim$(v) = "" Then Exit Function
        v = Replace(Trim$(v), ",", Application.DecimalSeparator)
        If Not IsNumeric(v) Then Exit Function
    End If
    If IsNumeric(v) Then NumeroCampo = CDbl(v)
End Function

Private Function FechaCampo(ByVal nombre As String) As Date
    Dim v As Variant
    v = ValorCampo(nombre)
    If IsDate(v) Then FechaCampo = DateValue(CDate(v)) Else FechaCampo = Date
End Function

Private Sub LimpiarCampos(ByVal nombres As Variant)
    Dim i As Long
    For i = LBound(nombres) To UBound(nombres)
        Campo(nombres(i)).MergeArea.ClearContents   ' algunas celdas están combinadas
    Next i
End Sub

Public Function Tabla(ByVal nombre As String) As ListObject
    Dim ws As Worksheet, lo As ListObject
    For Each ws In ThisWorkbook.Worksheets
        For Each lo In ws.ListObjects
            If lo.Name = nombre Then Set Tabla = lo: Exit Function
        Next lo
    Next ws
    Err.Raise vbObjectError + 700, APP, "No encuentro la tabla " & nombre & ". ¿Se cambió su nombre?"
End Function

Private Function Col(ByVal lo As ListObject, ByVal encabezado As String) As Long
    On Error Resume Next
    Col = lo.ListColumns(encabezado).Index
    On Error GoTo 0
    If Col = 0 Then Err.Raise vbObjectError + 701, APP, "La tabla " & lo.Name & " no tiene la columna """ & encabezado & """."
End Function

Private Sub Poner(ByVal lo As ListObject, ByVal fila As Range, ByVal encabezado As String, ByVal valor As Variant)
    fila.Cells(1, Col(lo, encabezado)).Value = valor
End Sub

' Una fila sin datos escritos (las columnas con fórmula no cuentan).
Private Function FilaVacia(ByVal fila As Range) As Boolean
    Dim c As Range
    For Each c In fila.Cells
        If Not c.HasFormula Then
            If Len(c.Formula) > 0 Then Exit Function
        End If
    Next c
    FilaVacia = True
End Function

' Fila nueva al final de la tabla (reutiliza la fila en blanco inicial).
Private Function NuevaFila(ByVal lo As ListObject) As Range
    QuitarFiltro lo
    If lo.ListRows.Count = 0 Then
        Set NuevaFila = lo.ListRows.Add.Range
    ElseIf FilaVacia(lo.ListRows(lo.ListRows.Count).Range) Then
        Set NuevaFila = lo.ListRows(lo.ListRows.Count).Range
    Else
        Set NuevaFila = lo.ListRows.Add(AlwaysInsert:=True).Range
    End If
    RestaurarFormulasFila lo, NuevaFila
End Function

' Si alguna celda con fórmula de la tabla quedó sin fórmula en la fila, la repone.
Private Sub RestaurarFormulasFila(ByVal lo As ListObject, ByVal fila As Range)
    Dim j As Long, modelo As Range
    For j = 1 To lo.ListColumns.Count
        Set modelo = CeldaModelo(lo, j)
        If Not modelo Is Nothing Then
            If Not fila.Cells(1, j).HasFormula Then fila.Cells(1, j).Formula = modelo.Formula
        End If
    Next j
End Sub

' Primera celda con fórmula de una columna (o Nothing si la columna es de datos).
Private Function CeldaModelo(ByVal lo As ListObject, ByVal j As Long) As Range
    Dim c As Range
    If lo.ListRows.Count = 0 Then Exit Function
    For Each c In lo.ListColumns(j).DataBodyRange.Cells
        If c.HasFormula Then Set CeldaModelo = c: Exit Function
        If c.Row - lo.HeaderRowRange.Row > 50 Then Exit Function
    Next c
End Function

Private Function SiguienteId(ByVal lo As ListObject) As Double
    Dim m As Double
    If lo.ListRows.Count > 0 Then m = Application.WorksheetFunction.Max(lo.ListColumns("ID").DataBodyRange)
    If m < ID_MIN_NUEVOS Then m = ID_MIN_NUEVOS
    SiguienteId = m + 1
End Function

Private Function Buscar(ByVal tablaN As String, ByVal colBusca As String, ByVal valor As String, ByVal colDevuelve As String) As Variant
    Dim lo As ListObject, k As Variant
    Set lo = Tabla(tablaN)
    Buscar = Empty
    If lo.ListRows.Count = 0 Then Exit Function
    k = Application.Match(valor, lo.ListColumns(colBusca).DataBodyRange, 0)
    If IsError(k) Then Exit Function
    Buscar = lo.ListColumns(colDevuelve).DataBodyRange.Cells(k, 1).Value
    If IsError(Buscar) Then Buscar = Empty
End Function

Private Function Existe(ByVal tablaN As String, ByVal colBusca As String, ByVal valor As String) As Boolean
    Dim lo As ListObject
    Set lo = Tabla(tablaN)
    If lo.ListRows.Count = 0 Then Exit Function
    Existe = Not IsError(Application.Match(valor, lo.ListColumns(colBusca).DataBodyRange, 0))
End Function

' Factor de la presentación según Catálogos (0 si no hay equivalencia).
Private Function FactorCatalogo(ByVal articulo As String, ByVal presentacion As String) As Double
    Dim lo As ListObject
    Set lo = Tabla("tblEquivalencias")
    If lo.ListRows.Count = 0 Then Exit Function
    FactorCatalogo = Application.WorksheetFunction.SumIfs(lo.ListColumns("Factor").DataBodyRange, _
        lo.ListColumns("Artículo").DataBodyRange, articulo, lo.ListColumns("Presentación").DataBodyRange, presentacion)
End Function

' Factor a registrar; pregunta si la presentación no tiene equivalencia.
' Devuelve 0 si el usuario decide no guardar.
Private Function FactorParaGuardar(ByVal articulo As String, ByVal presentacion As String, ByVal unidadBase As String) As Double
    Dim f As Double
    If StrComp(presentacion, unidadBase, vbTextCompare) = 0 Then FactorParaGuardar = 1: Exit Function
    f = FactorCatalogo(articulo, presentacion)
    If f > 0 Then FactorParaGuardar = f: Exit Function
    If MsgBox("No hay equivalencia para 1 """ & presentacion & """ de " & articulo & "." & vbCr & vbCr & _
              "Se guardará como 1 " & presentacion & " = 1 " & unidadBase & "." & vbCr & _
              "Puedes agregar la equivalencia en la hoja Catálogos." & vbCr & vbCr & "¿Guardar igual?", _
              vbYesNo + vbQuestion, APP) = vbYes Then FactorParaGuardar = 1
End Function

Private Sub Mensaje(ByVal prefijo As String, ByVal texto As String)
    Campo(prefijo & "Mensaje").Value = ChrW$(&H2714) & " " & texto & "  (" & Format$(Now, "hh:nn") & ")"
End Sub

Private Function Aviso(ByVal texto As String) As Boolean
    MsgBox texto, vbExclamation, APP
End Function

Private Function Fmt(ByVal d As Double) As String
    Fmt = Format$(d, "#,##0.###")
    If Right$(Fmt, 1) = Application.DecimalSeparator Then Fmt = Left$(Fmt, Len(Fmt) - 1)
End Function

' ═══════════════════════ Entradas de insumos ═══════════════════════
Public Sub GuardarEntrada()
    Dim insumo As String, pres As String, ub As String, cant As Variant, factor As Double, lo As ListObject, fila As Range
    On Error GoTo Fallo
    insumo = TextoCampo("entInsumo")
    If insumo = "" Then Aviso "Elige el insumo.": Campo("entInsumo").Select: Exit Sub
    If Not Existe("tblInsumos", "Insumo", insumo) Then
        Aviso "El insumo """ & insumo & """ no está en la hoja Insumos. Agrégalo allí primero."
        Exit Sub
    End If
    cant = NumeroCampo("entCantidad")
    If IsEmpty(cant) Then Aviso "Escribe la cantidad.": Campo("entCantidad").Select: Exit Sub
    If cant <= 0 Then Aviso "La cantidad debe ser mayor que 0.": Campo("entCantidad").Select: Exit Sub
    ub = CStr(Buscar("tblInsumos", "Insumo", insumo, "Unidad base"))
    pres = TextoCampo("entPresentacion")
    If pres = "" Then pres = ub
    factor = FactorParaGuardar(insumo, pres, ub)
    If factor = 0 Then Exit Sub

    Set lo = Tabla("tblEntradas")
    Set fila = NuevaFila(lo)
    Poner lo, fila, "ID", SiguienteId(lo)
    Poner lo, fila, "Fecha", FechaCampo("entFecha")
    Poner lo, fila, "Tipo doc.", TextoCampo("entTipoDoc")
    Poner lo, fila, "N° doc.", TextoCampo("entNumDoc")
    Poner lo, fila, "Proveedor", TextoCampo("entProveedor")
    Poner lo, fila, "Insumo", insumo
    Poner lo, fila, "Presentación", pres
    Poner lo, fila, "Cantidad", cant
    Poner lo, fila, "Precio total", NumeroO0(NumeroCampo("entPrecioTotal"))
    Poner lo, fila, "Obs.", TextoCampo("entObs")
    Poner lo, fila, "Factor registrado", factor

    LimpiarCampos Array("entInsumo", "entPresentacion", "entCantidad", "entPrecioTotal", "entObs")
    Mensaje "ent", "Guardado: " & Fmt(CDbl(cant)) & " " & pres & " de " & insumo & " (= " & Fmt(cant * factor) & " " & ub & ")"
    Campo("entInsumo").Select
    Exit Sub
Fallo:
    MsgBox "No se pudo guardar la entrada:" & vbCr & Err.Description, vbExclamation, APP
End Sub

Public Sub LimpiarEntrada()
    LimpiarCampos Array("entTipoDoc", "entNumDoc", "entProveedor", "entInsumo", "entPresentacion", "entCantidad", "entPrecioTotal", "entObs", "entMensaje")
    Campo("entFecha").Formula = "=TODAY()"
    Campo("entInsumo").Select
End Sub

' ═══════════════════════ Salidas de insumos ═══════════════════════
Public Sub GuardarSalidaInsumo()
    Dim insumo As String, pres As String, ub As String, cant As Variant, factor As Double, lo As ListObject, fila As Range
    On Error GoTo Fallo
    insumo = TextoCampo("salInsumo")
    If insumo = "" Then Aviso "Elige el insumo.": Campo("salInsumo").Select: Exit Sub
    If Not Existe("tblInsumos", "Insumo", insumo) Then
        Aviso "El insumo """ & insumo & """ no está en la hoja Insumos. Agrégalo allí primero."
        Exit Sub
    End If
    cant = NumeroCampo("salCantidad")
    If IsEmpty(cant) Then Aviso "Escribe la cantidad.": Campo("salCantidad").Select: Exit Sub
    If cant <= 0 Then Aviso "La cantidad debe ser mayor que 0.": Campo("salCantidad").Select: Exit Sub
    ub = CStr(Buscar("tblInsumos", "Insumo", insumo, "Unidad base"))
    pres = TextoCampo("salPresentacion")
    If pres = "" Then pres = ub
    factor = FactorParaGuardar(insumo, pres, ub)
    If factor = 0 Then Exit Sub

    Set lo = Tabla("tblSalidasIns")
    Set fila = NuevaFila(lo)
    Poner lo, fila, "ID", SiguienteId(lo)
    Poner lo, fila, "Fecha", FechaCampo("salFecha")
    Poner lo, fila, "Motivo", TextoCampo("salMotivo")
    Poner lo, fila, "Ticket", TextoCampo("salTicket")
    Poner lo, fila, "Insumo", insumo
    Poner lo, fila, "Presentación", pres
    Poner lo, fila, "Cantidad", cant
    Poner lo, fila, "Obs.", TextoCampo("salObs")
    Poner lo, fila, "Factor registrado", factor

    LimpiarCampos Array("salInsumo", "salPresentacion", "salCantidad", "salObs")
    Mensaje "sal", "Guardado: " & Fmt(CDbl(cant)) & " " & pres & " de " & insumo & " (= " & Fmt(cant * factor) & " " & ub & ")"
    Campo("salInsumo").Select
    Exit Sub
Fallo:
    MsgBox "No se pudo guardar la salida:" & vbCr & Err.Description, vbExclamation, APP
End Sub

Public Sub LimpiarSalidaInsumo()
    LimpiarCampos Array("salMotivo", "salTicket", "salInsumo", "salPresentacion", "salCantidad", "salObs", "salMensaje")
    Campo("salFecha").Formula = "=TODAY()"
    Campo("salInsumo").Select
End Sub

' ═══════════════════════ Producción ═══════════════════════
Public Sub GuardarProduccion()
    Dim producto As String, tipo As String, producido As Variant, defect As Variant, lo As ListObject, fila As Range
    On Error GoTo Fallo
    producto = TextoCampo("proProducto")
    If producto = "" Then Aviso "Elige el producto.": Campo("proProducto").Select: Exit Sub
    If Not Existe("tblProductos", "Producto", producto) Then
        Aviso "El producto """ & producto & """ no está en la hoja Productos. Agrégalo allí primero."
        Exit Sub
    End If
    producido = NumeroCampo("proProducido")
    If IsEmpty(producido) Then Aviso "Escribe cuántas unidades se produjeron.": Campo("proProducido").Select: Exit Sub
    If producido <= 0 Then Aviso "Lo producido debe ser mayor que 0.": Campo("proProducido").Select: Exit Sub
    defect = NumeroCampo("proDefectuoso")
    If IsEmpty(defect) Then defect = 0
    If defect < 0 Or defect > producido Then Aviso "Revisa la cantidad defectuosa (entre 0 y lo producido).": Campo("proDefectuoso").Select: Exit Sub
    tipo = CStr(Buscar("tblProductos", "Producto", producto, "Tipo"))

    Set lo = Tabla("tblProduccion")
    Set fila = NuevaFila(lo)
    Poner lo, fila, "ID", SiguienteId(lo)
    Poner lo, fila, "Fecha", FechaCampo("proFecha")
    Poner lo, fila, "Turno", TextoCampo("proTurno")
    Poner lo, fila, "Tipo", tipo
    Poner lo, fila, "Producto", producto
    Poner lo, fila, "Presentación", TextoCampo("proPresentacion")
    Poner lo, fila, "Cant. presentación", NumeroCampo("proCantPresentacion")
    Poner lo, fila, "Unidad teórica", TextoCampo("proUnidadTeorica")
    Poner lo, fila, "Cant. teórica", NumeroCampo("proCantTeorica")
    Poner lo, fila, "Producido", producido
    Poner lo, fila, "Defectuoso", defect
    Poner lo, fila, "Obs.", TextoCampo("proObs")

    LimpiarCampos Array("proProducto", "proPresentacion", "proCantPresentacion", "proUnidadTeorica", "proCantTeorica", _
                        "proProducido", "proDefectuoso", "proObs")
    Mensaje "pro", "Guardado: " & producto & " — neto " & Fmt(producido - defect)
    Campo("proProducto").Select
    Exit Sub
Fallo:
    MsgBox "No se pudo guardar la producción:" & vbCr & Err.Description, vbExclamation, APP
End Sub

Public Sub LimpiarProduccion()
    LimpiarCampos Array("proTurno", "proProducto", "proPresentacion", "proCantPresentacion", "proUnidadTeorica", "proCantTeorica", _
                        "proProducido", "proDefectuoso", "proObs", "proMensaje")
    Campo("proFecha").Formula = "=TODAY()"
    Campo("proProducto").Select
End Sub

' ═══════════════════════ Salidas de productos ═══════════════════════
Public Sub GuardarSalidaProducto()
    Dim producto As String, pres As String, ub As String, cant As Variant, factor As Double, tipo As String
    Dim lo As ListObject, fila As Range
    On Error GoTo Fallo
    producto = TextoCampo("sprProducto")
    If producto = "" Then Aviso "Elige el producto.": Campo("sprProducto").Select: Exit Sub
    If Not Existe("tblProductos", "Producto", producto) Then
        Aviso "El producto """ & producto & """ no está en la hoja Productos. Agrégalo allí primero."
        Exit Sub
    End If
    cant = NumeroCampo("sprCantidad")
    If IsEmpty(cant) Then Aviso "Escribe la cantidad.": Campo("sprCantidad").Select: Exit Sub
    If cant <= 0 Then Aviso "La cantidad debe ser mayor que 0.": Campo("sprCantidad").Select: Exit Sub
    ub = CStr(Buscar("tblProductos", "Producto", producto, "Unidad base"))
    pres = TextoCampo("sprPresentacion")
    If pres = "" Then pres = ub
    factor = FactorParaGuardar(producto, pres, ub)
    If factor = 0 Then Exit Sub
    tipo = CStr(Buscar("tblProductos", "Producto", producto, "Tipo"))

    Set lo = Tabla("tblSalidasProd")
    Set fila = NuevaFila(lo)
    Poner lo, fila, "ID", SiguienteId(lo)
    Poner lo, fila, "Fecha", FechaCampo("sprFecha")
    Poner lo, fila, "Categoría", IIf(LCase$(tipo) = "pastel", "Pasteles", "Panes")
    Poner lo, fila, "Producto", producto
    Poner lo, fila, "Presentación", pres
    Poner lo, fila, "Cantidad", cant
    Poner lo, fila, "Destino", TextoCampo("sprDestino")
    Poner lo, fila, "Encargado", TextoCampo("sprEncargado")
    Poner lo, fila, "Documento", TextoCampo("sprDocumento")
    Poner lo, fila, "Obs.", TextoCampo("sprObs")
    Poner lo, fila, "Factor registrado", factor

    LimpiarCampos Array("sprProducto", "sprPresentacion", "sprCantidad", "sprDocumento", "sprObs")
    Mensaje "spr", "Guardado: " & Fmt(CDbl(cant)) & " " & pres & " de " & producto & " (= " & Fmt(cant * factor) & " " & ub & ")"
    Campo("sprProducto").Select
    Exit Sub
Fallo:
    MsgBox "No se pudo guardar la salida:" & vbCr & Err.Description, vbExclamation, APP
End Sub

Public Sub LimpiarSalidaProducto()
    LimpiarCampos Array("sprDestino", "sprEncargado", "sprProducto", "sprPresentacion", "sprDocumento", "sprCantidad", "sprObs", "sprMensaje")
    Campo("sprFecha").Formula = "=TODAY()"
    Campo("sprProducto").Select
End Sub

Private Function NumeroO0(ByVal v As Variant) As Double
    If Not IsEmpty(v) Then NumeroO0 = CDbl(v)
End Function

' ═══════════════════════ Tablas: eliminar y filtrar ═══════════════════════
Public Sub EliminarFila()
    Dim lo As ListObject, c As Range, i As Long, resumen As String
    Set c = ActiveCell
    On Error Resume Next
    Set lo = c.ListObject
    On Error GoTo 0
    If lo Is Nothing Then
        Aviso "Primero haz clic en una celda de la fila que quieres eliminar (dentro de la tabla de abajo)."
        Exit Sub
    End If
    If lo.ListRows.Count = 0 Then Exit Sub
    If Intersect(c, lo.DataBodyRange) Is Nothing Then
        Aviso "Haz clic en una fila de datos (no en el encabezado)."
        Exit Sub
    End If
    i = c.Row - lo.HeaderRowRange.Row
    resumen = ResumenFila(lo, i)
    If MsgBox("¿Eliminar esta fila?" & vbCr & vbCr & resumen, vbYesNo + vbQuestion + vbDefaultButton2, APP) <> vbYes Then Exit Sub
    If lo.ListRows.Count = 1 Then
        Dim celda As Range
        For Each celda In lo.ListRows(1).Range.Cells
            If Not celda.HasFormula Then celda.ClearContents
        Next celda
    Else
        lo.ListRows(i).Delete
    End If
End Sub

Private Function ResumenFila(ByVal lo As ListObject, ByVal i As Long) As String
    Dim j As Long, v As Variant, n As Long
    For j = 1 To lo.ListColumns.Count
        v = lo.ListRows(i).Range.Cells(1, j).Value
        If Not IsError(v) Then
            If Len(CStr(v)) > 0 And lo.ListColumns(j).Range.EntireColumn.Hidden = False Then
                ResumenFila = ResumenFila & lo.ListColumns(j).Name & ": " & CStr(v) & vbCr
                n = n + 1
                If n >= 8 Then Exit For
            End If
        End If
    Next j
End Function

Private Sub QuitarFiltro(ByVal lo As ListObject)
    On Error Resume Next
    If lo.ShowAutoFilter Then
        If lo.AutoFilter.FilterMode Then lo.AutoFilter.ShowAllData
    End If
End Sub

Public Sub FiltrarBajoMinimo()
    Dim lo As ListObject
    Set lo = Tabla("tblInsumos")
    If Not lo.ShowAutoFilter Then lo.ShowAutoFilter = True
    lo.Range.AutoFilter Field:=Col(lo, "Crit"), Criteria1:="1"
End Sub

Public Sub QuitarFiltros()
    QuitarFiltro Tabla("tblInsumos")
End Sub

' ═══════════════════════ Copia de seguridad ═══════════════════════
Public Sub GuardarCopia()
    Dim ruta As String
    On Error GoTo Fallo
    If ThisWorkbook.Path = "" Then
        Aviso "Primero guarda este archivo (Archivo > Guardar como, tipo ""Libro de Excel habilitado para macros"")."
        Exit Sub
    End If
    ruta = ThisWorkbook.Path & Application.PathSeparator & "PanControl copia " & Format$(Now, "yyyy-mm-dd hh-nn") & ".xlsm"
    ThisWorkbook.SaveCopyAs ruta
    MsgBox "Copia guardada:" & vbCr & ruta, vbInformation, APP
    Exit Sub
Fallo:
    MsgBox "No se pudo guardar la copia:" & vbCr & Err.Description & vbCr & vbCr & _
           "Si el archivo está en OneDrive, guarda una copia con Archivo > Guardar como.", vbExclamation, APP
End Sub

' ═══════════════════════ Importar respaldo de la app ═══════════════════════
Public Sub ImportarRespaldo()
    Dim ruta As Variant, texto As String, raiz As Variant, resumen As String, calc As Long
    On Error GoTo Fallo
    #If Mac Then
        ruta = Application.GetOpenFilename()
    #Else
        ruta = Application.GetOpenFilename("Respaldo de PanControl (*.json),*.json", , "Elige el respaldo descargado de PanControl")
    #End If
    If VarType(ruta) = vbBoolean Then Exit Sub
    Application.StatusBar = "Leyendo el respaldo..."
    texto = LeerArchivoUtf8(CStr(ruta))
    Asignar raiz, JsonParse(texto)
    If Not JsonEsObjeto(raiz) Or Not JsonHas(raiz, "entradas") Then
        Application.StatusBar = False
        Aviso "Ese archivo no parece un respaldo de PanControl (falta la lista de entradas)."
        Exit Sub
    End If
    If MsgBox("Respaldo del " & Left$(Txt(raiz, "fecha_exportacion"), 10) & ":" & vbCr & _
              JsonLargo(JsonGet(raiz, "entradas")) & " entradas, " & JsonLargo(JsonGet(raiz, "salidas_ins")) & " salidas de insumos, " & _
              JsonLargo(JsonGet(raiz, "produccion")) & " registros de producción, " & JsonLargo(JsonGet(raiz, "salida_prod")) & _
              " salidas de productos." & vbCr & vbCr & _
              "Esto REEMPLAZA los datos de este Excel (catálogos, inventario y movimientos) por los del respaldo. " & _
              "Las recetas no se tocan." & vbCr & vbCr & "¿Continuar?", vbYesNo + vbQuestion + vbDefaultButton2, APP) <> vbYes Then
        Application.StatusBar = False
        Exit Sub
    End If

    calc = Application.Calculation
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = XL_MANUAL
    Application.StatusBar = "Importando catálogos..."
    VolcarEnTabla "tblInsumos", ColsInsumos(), FilasInsumos(raiz)
    VolcarEnTabla "tblProductos", ColsProductos(), FilasProductos(raiz)
    VolcarEnTabla "tblEquivalencias", ColsEquivalencias(), FilasEquivalencias(raiz)
    VolcarEnTabla "tblUnidades", Array("Unidad"), FilasUnidades(raiz, UnidadesActuales())
    VolcarEnTabla "tblDestinos", Array("Destino"), FilasLista(raiz, "destinos")
    VolcarEnTabla "tblEncargados", Array("Encargado"), FilasLista(raiz, "encargados")
    Application.StatusBar = "Importando movimientos..."
    VolcarEnTabla "tblEntradas", ColsEntradas(), FilasEntradas(raiz)
    VolcarEnTabla "tblSalidasIns", ColsSalidasIns(), FilasSalidasIns(raiz)
    VolcarEnTabla "tblProduccion", ColsProduccion(), FilasProduccion(raiz)
    VolcarEnTabla "tblSalidasProd", ColsSalidasProd(), FilasSalidasProd(raiz)
    Application.Calculation = calc
    Application.Calculate
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Application.StatusBar = False

    resumen = "Importado:" & vbCr & _
        "• " & Filas("tblInsumos") & " insumos y " & Filas("tblProductos") & " productos" & vbCr & _
        "• " & Filas("tblEntradas") & " entradas, " & Filas("tblSalidasIns") & " salidas de insumos" & vbCr & _
        "• " & Filas("tblProduccion") & " registros de producción, " & Filas("tblSalidasProd") & " salidas de productos" & vbCr & vbCr & _
        "Revisa la hoja Inicio y el inventario. Recuerda guardar el archivo (Ctrl+G)."
    shInicio.Activate
    MsgBox resumen, vbInformation, APP
    Exit Sub
Fallo:
    Application.Calculation = XL_AUTOMATICO
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Application.StatusBar = False
    MsgBox "No se pudo importar el respaldo:" & vbCr & Err.Description, vbExclamation, APP
End Sub

Private Function Filas(ByVal tablaN As String) As Long
    Dim lo As ListObject, i As Long
    Set lo = Tabla(tablaN)
    Filas = lo.ListRows.Count
    If Filas = 1 Then If FilaVacia(lo.ListRows(1).Range) Then Filas = 0
End Function

Private Function UnidadesActuales() As Variant
    Dim lo As ListObject, v As Variant, i As Long, r() As Variant
    Set lo = Tabla("tblUnidades")
    If lo.ListRows.Count = 0 Then UnidadesActuales = Array(): Exit Function
    v = lo.ListColumns(1).DataBodyRange.Value
    If Not IsArray(v) Then UnidadesActuales = Array(CStr(v)): Exit Function
    ReDim r(0 To UBound(v, 1) - 1)
    For i = 1 To UBound(v, 1)
        If Not IsError(v(i, 1)) Then r(i - 1) = CStr(v(i, 1))
    Next i
    UnidadesActuales = r
End Function

' Reemplaza el contenido de una tabla. cols: encabezados de las columnas de
' datos (en el orden de "datos"); las columnas con fórmula se recalculan solas.
Private Sub VolcarEnTabla(ByVal tablaN As String, ByVal cols As Variant, ByVal datos As Variant)
    Dim lo As ListObject, n As Long, j As Long, i As Long, columna() As Variant, idx() As Long, modelos() As String
    Set lo = Tabla(tablaN)
    QuitarFiltro lo
    ' Recordar las fórmulas de la tabla antes de vaciarla.
    ReDim modelos(1 To lo.ListColumns.Count)
    For j = 1 To lo.ListColumns.Count
        Dim m As Range
        Set m = CeldaModelo(lo, j)
        If Not m Is Nothing Then modelos(j) = m.Formula
    Next j
    ' Vaciar: dejar una sola fila y borrar sus datos.
    If lo.ListRows.Count > 1 Then
        lo.DataBodyRange.Offset(1, 0).Resize(lo.ListRows.Count - 1).Delete XL_ARRIBA
    End If
    If lo.ListRows.Count = 0 Then lo.ListRows.Add
    For j = 1 To lo.ListColumns.Count
        If modelos(j) = "" Then lo.ListRows(1).Range.Cells(1, j).ClearContents
    Next j
    If IsEmpty(datos) Then GoTo Formulas
    n = UBound(datos, 1)
    If n > 1 Then lo.Resize lo.Range.Resize(lo.HeaderRowRange.Rows.Count + n)
    ReDim idx(LBound(cols) To UBound(cols))
    For j = LBound(cols) To UBound(cols)
        idx(j) = Col(lo, CStr(cols(j)))
        lo.ListColumns(idx(j)).DataBodyRange.NumberFormat = lo.ListColumns(idx(j)).DataBodyRange.Cells(1, 1).NumberFormat
        ReDim columna(1 To n, 1 To 1)
        For i = 1 To n
            columna(i, 1) = datos(i, j - LBound(cols) + 1)
        Next i
        lo.ListColumns(idx(j)).DataBodyRange.Value = columna
    Next j
Formulas:
    For j = 1 To lo.ListColumns.Count
        If modelos(j) <> "" Then lo.ListColumns(j).DataBodyRange.Formula = modelos(j)
    Next j
End Sub

' ═══════════════════════ Exportar respaldo para la app ═══════════════════════
Public Sub ExportarRespaldo()
    Dim ruta As Variant, json As String, nombreArchivo As String
    On Error GoTo Fallo
    AsignarIdsFaltantes "tblEntradas", "Insumo"
    AsignarIdsFaltantes "tblSalidasIns", "Insumo"
    AsignarIdsFaltantes "tblProduccion", "Producto"
    AsignarIdsFaltantes "tblSalidasProd", "Producto"
    Application.Calculate
    json = JsonRespaldo(Format$(Now, "yyyy-mm-dd") & "T" & Format$(Now, "hh:nn:ss"), _
        JsonDeTabla("entradas", "tblEntradas"), JsonDeTabla("salidas_ins", "tblSalidasIns"), _
        JsonDeTabla("produccion", "tblProduccion"), JsonDeTabla("salida_prod", "tblSalidasProd"), _
        JsonDeCatalogo(Encabezados("tblInsumos"), DatosDeTabla("tblInsumos"), Encabezados("tblProductos"), DatosDeTabla("tblProductos"), _
                       Encabezados("tblEquivalencias"), DatosDeTabla("tblEquivalencias"), DatosDeTabla("tblDestinos"), DatosDeTabla("tblEncargados")))
    nombreArchivo = "PanControl_Backup_Excel_" & Format$(Date, "yyyy-mm-dd") & ".json"
    #If Mac Then
        ruta = Application.GetSaveAsFilename(nombreArchivo)
    #Else
        ruta = Application.GetSaveAsFilename(nombreArchivo, "Respaldo de PanControl (*.json),*.json", , "Guardar respaldo para la app")
    #End If
    If VarType(ruta) = vbBoolean Then Exit Sub
    EscribirArchivoUtf8 CStr(ruta), json
    MsgBox "Respaldo guardado:" & vbCr & ruta & vbCr & vbCr & _
           "En la app web pulsa ""Cargar backup"" y elige este archivo. Se agregan los registros que la app no tenga.", _
           vbInformation, APP
    Exit Sub
Fallo:
    MsgBox "No se pudo exportar el respaldo:" & vbCr & Err.Description, vbExclamation, APP
End Sub

Private Function Encabezados(ByVal tablaN As String) As Variant
    Encabezados = Tabla(tablaN).HeaderRowRange.Value
End Function

Private Function DatosDeTabla(ByVal tablaN As String) As Variant
    Dim lo As ListObject, v As Variant, r(1 To 1, 1 To 1) As Variant
    Set lo = Tabla(tablaN)
    If lo.ListRows.Count = 0 Then DatosDeTabla = Empty: Exit Function
    v = lo.DataBodyRange.Value
    If Not IsArray(v) Then r(1, 1) = v: v = r
    DatosDeTabla = v
End Function

Private Function JsonDeTabla(ByVal tipo As String, ByVal tablaN As String) As String
    JsonDeTabla = JsonDeMovimientos(tipo, Encabezados(tablaN), DatosDeTabla(tablaN))
End Function

' Las filas escritas directo en la tabla (tablet) no tienen ID: se les asigna uno.
Private Sub AsignarIdsFaltantes(ByVal tablaN As String, ByVal colClave As String)
    Dim lo As ListObject, i As Long, cId As Long, cClave As Long, sig As Double, v As Variant
    Set lo = Tabla(tablaN)
    If lo.ListRows.Count = 0 Then Exit Sub
    cId = Col(lo, "ID")
    cClave = Col(lo, colClave)
    sig = SiguienteId(lo)
    For i = 1 To lo.ListRows.Count
        v = lo.ListRows(i).Range.Cells(1, cClave).Value
        If Not IsError(v) Then
            If Len(Trim$(CStr(v))) > 0 And IsEmpty(lo.ListRows(i).Range.Cells(1, cId).Value) Then
                lo.ListRows(i).Range.Cells(1, cId).Value = sig
                sig = sig + 1
            End If
        End If
    Next i
End Sub
