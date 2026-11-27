import { maxSheetRows, nowLocal, shiftDate, shortDate, timestamp, validDate, validTime } from './model.js';

export const countTransferFormat = 'bitacora-de-muelle/almejazos';
export const countRowsPerPage = 30;
export const countColumns = [
  ['#', 40], ['Fecha', 96], ['Hora', 124], ['Cantidad', 90],
  ['Nro. Almeja', 101], ['Capacidad almeja', 125], ['Total por hora', 126],
];

const numberFormat = new Intl.NumberFormat('es-HN', { useGrouping: false, maximumFractionDigits: 20 });
export const countNumber = value => numberFormat.format(Number(value.toPrecision(15)));
const intervalTotal = row => row.quantity * row.capacity;
export const sheetTotal = sheet => sheet.rows.reduce((total, row) => total + intervalTotal(row), 0);
const intervalLabel = row => row.start + '–' + row.end;
export const equipmentKey = equipment => equipment.trim().toUpperCase();

export function countValues(row, index, previousDate = '') {
  if (!row) return [String(index + 1), '', '', '', '', '', ''];
  return [
    String(index + 1), row.date === previousDate ? '' : shortDate(row.date),
    intervalLabel(row), String(row.quantity), row.equipment,
    countNumber(row.capacity), countNumber(intervalTotal(row)),
  ];
}

export function countFields(sheet) {
  return [
    ['Buque', sheet.ship], ['Bodega', sheet.hold],
    ['Puerto / terminal', sheet.terminal], ['Producto', sheet.product],
  ];
}

export function suggestInterval(sheet) {
  const last = sheet.rows.at(-1);
  if (last) {
    const date = last.end < last.start ? shiftDate(last.date, 1) : last.date;
    const nextHour = (Number(last.end.slice(0, 2)) + 1) % 24;
    return { date, start: last.end, end: String(nextHour).padStart(2, '0') + ':00',
      equipment: last.equipment, capacity: last.capacity };
  }

  const { time } = nowLocal();
  const hour = Number(time.slice(0, 2));
  if (hour === 0) return { date: shiftDate(sheet.date, -1), start: '23:00', end: '00:00' };
  return { date: sheet.date, start: String(hour - 1).padStart(2, '0') + ':00', end: time.slice(0, 2) + ':00' };
}

const validText = (value, max, optional = false) =>
  typeof value === 'string' && value.length <= max && (optional || Boolean(value.trim()));
const validStamp = value => typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value));

export function validateCountSheet(sheet) {
  if (!sheet || !validText(sheet.id, 100) || !validDate(sheet.date) || !validStamp(sheet.updatedAt)
    || !validText(sheet.ship, 100) || !validText(sheet.hold, 30)
    || !validText(sheet.product, 100, true) || !validText(sheet.terminal, 100, true)
    || !Array.isArray(sheet.rows) || sheet.rows.length > maxSheetRows) {
    throw new Error('Revisa los datos de la hoja de almejazos.');
  }
}

export function validateCountRow(row) {
  if (!row || !validText(row.id, 100) || !validDate(row.date)
    || !validTime(row.start) || !validTime(row.end) || row.start === row.end) {
    throw new Error('Revisa la fecha y escribe dos horas distintas en formato de 24 horas.');
  }
  if (!validText(row.equipment, 30) || !Number.isSafeInteger(row.quantity) || row.quantity < 0
    || !Number.isFinite(row.capacity) || row.capacity <= 0 || !Number.isFinite(intervalTotal(row))) {
    throw new Error('Ingresa el número de almeja, una cantidad entera y una capacidad mayor que cero.');
  }
}

export function countTransfer(sheet) {
  return { format: countTransferFormat, version: 1, exportedAt: timestamp(), sheet };
}

export function readCountTransfer(file) {
  if (file.version !== 1 || !validStamp(file.exportedAt)) {
    throw new Error('El archivo de almejazos tiene una versión inválida.');
  }
  validateCountSheet(file.sheet);
  const { id, ship, hold, product, terminal, date, updatedAt } = file.sheet;
  const ids = new Set();
  const rows = file.sheet.rows.map(row => {
    validateCountRow(row);
    if (ids.has(row.id)) throw new Error('El archivo contiene filas repetidas.');
    ids.add(row.id);
    const { id, date, start, end, equipment, quantity, capacity } = row;
    return { id, date, start, end, equipment, quantity, capacity };
  });
  const sheet = { id, ship, hold, product, terminal, date, updatedAt, rows };
  if (!Number.isFinite(sheetTotal(sheet))) throw new Error('El total de la hoja está fuera del rango permitido.');
  return { sheet, exportedAt: file.exportedAt };
}
