// Carga a SQLite el JSON descargado con el botón "Descargar backup" de la app.
// Uso: node server/migrate-backup.js ruta/al/backup.json
const fs = require('fs');
const { STORES, storeAdd } = require('./db');

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node server/migrate-backup.js ruta/al/backup.json');
    process.exit(1);
  }
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));

  // El backup usa "catalogos" y "salidas_ins" con esos mismos nombres, y guarda
  // cada store como arreglo de registros con un "id" viejo que no se reutiliza
  // (SQLite genera ids nuevos); si ya existiera algo en la tabla no se duplica.
  let total = 0;
  for (const store of STORES) {
    const rows = backup[store];
    if (!Array.isArray(rows) || !rows.length) continue;
    for (const row of rows) {
      const { id, ...data } = row;
      storeAdd(store, data);
      total++;
    }
    console.log(`${store}: ${rows.length} registro(s) migrados`);
  }
  console.log(`Listo. ${total} registro(s) en total.`);
}

main();
