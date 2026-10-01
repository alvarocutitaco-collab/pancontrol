# PanControl en Excel (versión de prueba)

`PanControl.xlsm` es una versión de PanControl en un solo archivo de Excel con
macros, para probar si te sirve más que la app web.

## Abrirlo por primera vez (Windows)

Windows bloquea las macros de los archivos descargados de internet. Antes de
abrirlo:

1. Clic derecho sobre `PanControl.xlsm` → **Propiedades**.
2. Abajo, marca **Desbloquear** → **Aceptar**.
3. Ábrelo. Si aparece una barra amarilla, pulsa **Habilitar contenido**.

Guárdalo en una carpeta de tu PC (no lo abras directo desde el correo o el
navegador).

## Qué tiene

| Hoja | Para qué |
|---|---|
| **Inicio** | Resumen del día, la semana o el mes: entradas, salidas, panes y pasteles netos, insumos bajo mínimo. Botones para ir a cada hoja. |
| **Entradas** | Compras de insumos, con presentación (saco, jaba…) que se convierte sola a la unidad base. |
| **Salidas insumos** | Insumos usados en producción, mermas y devoluciones. |
| **Producción** | Panes y pasteles por turno: producido, defectuoso y neto. |
| **Salidas productos** | Lo que sale a tienda, delivery o pedidos. |
| **Insumos** / **Productos** | Inventario y catálogo a la vez: stock inicial, ajustes, mínimo y stock actual (se calcula solo). |
| **Catálogos** | Equivalencias (1 saco = 50000 g), unidades, destinos y encargados. |
| **Recetas** + **Calculadora** | Insumos por lote de cada producto y cuánto necesitas para N lotes, con aviso si no alcanza el stock. |

**No incluye** (sigue solo en la app web): versiones y aprobación de recetas,
órdenes y lotes, control de calidad con fotos, operadores y certificaciones,
organizaciones y la lectura de facturas con IA.

## Cómo se usa

- **En la PC:** en cada hoja llenas el formulario de arriba y pulsas
  **Guardar**. La línea se agrega a la tabla de abajo. **Eliminar fila
  seleccionada** borra la fila donde está el cursor.
- **En tablet o celular** (Excel móvil o Excel en la web): las macros no
  funcionan ahí. Escribe directo en la fila vacía al final de cada tabla. Las
  columnas que se calculan solas (factor, cantidad base, stock) se llenan
  igual.
- Guarda seguido (**Ctrl+G**). El botón **Guardar copia de seguridad** crea
  una copia con la fecha en la misma carpeta.

## Probar con tus datos reales

1. En la app web, en el Resumen del día, pulsa **💾 Descargar backup**.
2. En el Excel, en Inicio, pulsa **Importar respaldo de la app** y elige ese
   archivo.

Se cargan los catálogos, el inventario y todos los movimientos. Esto
**reemplaza** lo que haya en el Excel; las recetas no se tocan.

## Volver a la app web

**Exportar respaldo para la app** crea un archivo que la app acepta en
**📂 Cargar backup**. Se agregan los registros que la app no tenga. Hazlo una
sola vez por cada tanda de datos nuevos: si lo cargas dos veces, se duplican.

---

## Para quien mantenga el archivo

El `.xlsm` **se genera**; no lo edites a mano. Las fuentes son:

- `construir_excel.py`: hojas, tablas, fórmulas, validaciones y botones (XlsxWriter).
- `vba/*.bas`: las macros. `modJson` (JSON y UTF-8), `modRespaldo` (respaldo
  de la app ↔ filas de las tablas, sin objetos de Excel) y `modPanControl`
  (botones y tablas de Excel).
- `vba_project.py`: arma el proyecto de macros (`vbaProject.bin`) a partir del
  código, sin Excel (especificación MS-OVBA).

```bash
pip install xlsxwriter oletools
python3 excel/construir_excel.py                 # genera excel/PanControl.xlsm
python3 excel/verificar_vba.py                   # revisión estática del VBA
/usr/bin/python3 excel/probar_excel.py           # pruebas con LibreOffice (necesita libreoffice-calc y python3-uno)
```

Las pruebas abren el libro en LibreOffice, recalculan y comprueban stock,
resúmenes y calculadora, y ejecutan las macros de JSON, importar y exportar.
Las macros que usan tablas de Excel (`ListObject`: Guardar, Eliminar, y el
volcado a las tablas al importar) solo corren en Excel. LibreOffice no las
soporta.

Cuidados al escribir VBA aquí (LibreOffice es más estricto que Excel):

- El código se guarda en Windows-1252: nada de emojis en `vba/*.bas`. Para
  textos especiales usa `ChrW$()`.
- Nada de `As Byte()` como tipo de retorno; usa `Variant`.
- `ReDim Preserve` siempre en un `If` de bloque, no de una línea.
- No uses `.Count` ni `For Each` sobre un `Variant` que podría no ser objeto;
  pásalo a una función con parámetro `As Collection`.
- No llames a una variable igual que una función (por ejemplo `base`, `inv`).
