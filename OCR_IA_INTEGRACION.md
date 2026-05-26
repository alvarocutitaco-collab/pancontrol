# Integracion OCR + IA para entradas de insumos

La pantalla **Insumos > Entradas** ya incluye un bloque para tomar una foto con la camara o cargar una foto desde galeria. La app envia el archivo a un backend y espera recibir datos estructurados para precargar el formulario. El usuario siempre puede corregir antes de presionar **Guardar Ingreso**.

## Flujo recomendado

1. La app envia el archivo a `POST /api/ocr-factura`.
2. El backend aplica OCR para extraer texto del documento.
3. El backend usa IA para convertir ese texto a JSON.
4. La app llena fecha, documento, proveedor, total y lineas de insumos.
5. El usuario revisa/corrige y confirma el registro.

## Request esperado

`multipart/form-data`

- `documento`: imagen o PDF de la factura/boleta.
- `catalogo_insumos`: JSON con los insumos existentes en la app.
- `unidades`: JSON con unidades configuradas por insumo.

## Response esperado

```json
{
  "tipo_documento": "Factura",
  "numero_documento": "F001-12345",
  "fecha": "2026-05-26",
  "proveedor": "Molinos del Sur SAC",
  "total": 348.10,
  "items": [
    {
      "insumo": "Harina de trigo",
      "descripcion_original": "HARINA PANADERA X 50 KG",
      "cantidad": 50,
      "unidad": "kilogramo",
      "precio_unitario": 3.80,
      "precio_total": 190.00
    }
  ]
}
```

Tambien se aceptan nombres alternativos como `lineas`, `detalle`, `numdoc`, `tipodoc`, `descripcion`, `nombre`, `presentacion`, `importe` o `total` por linea.

## Reglas para facturas con formatos distintos

El backend debe tratar como items solo las filas reales de productos. No debe cargar IGV, descuentos, percepciones, detracciones, envios, redondeos ni formas de pago como insumos.

Campos recomendados por item:

- `descripcion_original`: texto tal como aparece en la factura.
- `insumo`: nombre normalizado contra el catalogo de PanControl cuando hay coincidencia clara.
- `cantidad`
- `unidad`
- `presentacion`
- `trae`
- `unidad_interna`
- `contenido_cu`
- `unidad_base`
- `total_base`
- `precio_unitario`
- `precio_total`
- `precio_unitario_original`
- `precio_total_original`
- `descuento_linea`
- `precio_total_sin_igv`
- `igv_linea`
- `incluye_igv`
- `confianza`
- `observacion`

Si falta `precio_total` pero existe `cantidad` y `precio_unitario`, se calcula. Si falta `precio_unitario` pero existe `precio_total`, tambien se calcula. Si la suma de lineas no coincide con el total del documento, la app muestra advertencia para revision manual.

## Regla de precios para PanControl

Para registrar inventario, PanControl debe guardar por producto el **precio final con IGV y descuentos aplicados**.

Ejemplo:

```text
Linea impresa sin IGV: 100.00
Descuento de linea: 10.00
Base neta: 90.00
IGV 18%: 16.20
Precio total de registro: 106.20
```

Si el documento tiene descuentos globales, cargos, redondeos o IGV al final, el backend los prorratea proporcionalmente entre las lineas de producto para que:

```text
suma(precio_total de productos) = total final de la factura/boleta
```

Los campos `precio_unitario_original` y `precio_total_original` conservan lo leido del documento. Los campos `precio_unitario` y `precio_total` son los valores finales que se cargan al formulario de registro.

## Importante

No pongas la clave de la IA dentro de `index.html`. La clave debe vivir en el backend o en una funcion serverless. La app solo llama al endpoint configurado en el campo **URL servicio OCR + IA**.
