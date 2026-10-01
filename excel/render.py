"""Exporta cada hoja (recalculada) a PNG para revisar el diseño. Uso: /usr/bin/python3 excel/render.py libro.xlsm carpeta"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import probar_excel as P
libro, carpeta = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(carpeta, exist_ok=True)
with P.LibreOffice() as lo:
    doc = lo.abrir(libro)
    try:
        if len(sys.argv) > 3:
            P.celda(doc, 'Inicio!C6').setValue(P.fecha_serial(__import__('datetime').date(2026, 9, 30)))
        doc.calculateAll()
        pdf = os.path.join(carpeta, 'libro.pdf')
        doc.storeToURL(P.uno.systemPathToFileUrl(pdf), (P.prop('FilterName', 'calc_pdf_Export'),))
    finally:
        doc.close(True)
subprocess.run(['pdftoppm', '-r', '75', '-png', pdf, os.path.join(carpeta, 'hoja')], check=True)
print(sorted(f for f in os.listdir(carpeta) if f.endswith('.png')))
