export const storageKey = 'bitacora-de-muelle:v1';
export const transferFormat = 'bitacora-de-muelle/turno';
export const newId = () => crypto.randomUUID();
export const timestamp = () => new Date().toISOString();

const names = [
  'Inicia descarga', 'Paro por lluvia / amenaza de lluvia', 'Falta de transporte',
  'Reanudada descarga', 'Ingresando Bobcat / payloader', 'Sacando Bobcat / payloader',
  'Paro por solicitud del barco', 'Paro por solicitud del muelle', 'Abriendo bodega',
  'Cerrando bodega', 'Rotura / mantenimiento de grúa', 'Rotura / mantenimiento de almeja',
  'Congestionamiento de báscula', 'Rotura sistema de aduanas', 'Shifting de muelle',
  'Finaliza bodega', 'Cambio de personal', 'Receso de aduana', 'Falta de equipo',
  'Apilando producto', 'Fallo / mantenimiento de banda', 'Shifting de barco',
];

export function seedCodes() {
  return names.map((name, index) => ({ id: 'default-' + (index + 1), number: String(index + 1), name }));
}

export function emptyState() {
  return { schema: 1, catalog: seedCodes(), turns: [], activeId: null };
}

const localClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function nowLocal() {
  const parts = Object.fromEntries(localClock.formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return { date: [parts.year, parts.month, parts.day].join('-'), time: parts.hour + ':' + parts.minute };
}

export function shiftDate(date, days) {
  const midnight = new Date(date + 'T00:00:00Z');
  midnight.setUTCDate(midnight.getUTCDate() + days);
  return midnight.toISOString().slice(0, 10);
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const shortDate = date => date.split('-').reverse().join('/');
export const dateWithWords = date => new Intl.DateTimeFormat('es-HN', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(date + 'T00:00:00Z'));

export function minutesBetween(record) {
  if (!record.endTime) return null;
  const date = new Date(record.date + 'T' + record.time + ':00Z');
  const end = new Date(record.endDate + 'T' + record.endTime + ':00Z');
  return (end - date) / 60000;
}

export function durationLabel(minutes) {
  if (minutes === null) return '';
  if (minutes < 60) return minutes + ' min';
  const hours = Math.floor(minutes / 60) + ' h';
  return minutes % 60 ? hours + ' ' + minutes % 60 + ' min' : hours;
}

export const sortedRecords = records => [...records].sort((a, b) =>
  (a.date + a.time).localeCompare(b.date + b.time));
export const sortedCodes = catalog => [...catalog].sort((a, b) =>
  a.number.localeCompare(b.number, 'es', { numeric: true }));

export function transfer(turn, catalog) {
  return { format: transferFormat, version: 1, exportedAt: timestamp(), turn: { ...turn, catalog } };
}

const validString = (value, max, allowEmpty = false) =>
  typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);
export const validCodeNumber = value => typeof value === 'string' && /^[\p{L}\p{N}-]{1,12}$/u.test(value);
const validStamp = value => typeof value === 'string' && value.length <= 32
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));

export function readTransfer(fileText) {
  let file;
  try {
    file = JSON.parse(fileText);
  } catch {
    throw new Error('El archivo no tiene un formato válido.');
  }
  if (file?.format !== transferFormat || file.version !== 1 || !validStamp(file.exportedAt)) {
    throw new Error('Selecciona un archivo de turno exportado desde Bitácora de Muelle.');
  }

  const turn = file.turn;
  if (!turn || !validString(turn.id, 100) || !validString(turn.ship, 100)
    || !validString(turn.product, 100, true) || !validString(turn.client, 100, true)
    || !validString(turn.inspector, 100, true) || !validDate(turn.date)
    || !validStamp(turn.updatedAt) || ![null, undefined].includes(turn.closedAt) && !validStamp(turn.closedAt)
    || !Number.isInteger(turn.holdCount) || turn.holdCount < 1 || turn.holdCount > 30
    || !Array.isArray(turn.records) || !Array.isArray(turn.catalog)) {
    throw new Error('Faltan datos del turno o hay valores inválidos.');
  }

  const catalogIds = new Set();
  const catalogNumbers = new Set();
  const catalog = turn.catalog.map(code => {
    if (!code || !validString(code.id, 100) || !validCodeNumber(code.number) || !validString(code.name, 120)
      || catalogIds.has(code.id) || catalogNumbers.has(code.number.toUpperCase())) {
      throw new Error('El archivo contiene códigos inválidos o repetidos.');
    }
    catalogIds.add(code.id);
    catalogNumbers.add(code.number.toUpperCase());
    return { id: code.id, number: code.number, name: code.name };
  });

  const recordIds = new Set();
  const records = turn.records.map(record => {
    if (!record || !validString(record.id, 100) || recordIds.has(record.id)
      || !validString(record.codeId, 100) || !validCodeNumber(record.code)
      || !validString(record.name, 120) || !validDate(record.date) || !validTime(record.time)
      || !Array.isArray(record.holds) || !record.holds.length
      || record.holds.some(hold => !Number.isInteger(hold) || hold < 1 || hold > turn.holdCount)
      || new Set(record.holds).size !== record.holds.length
      || (record.endTime === '' ? record.endDate !== '' : !validDate(record.endDate) || !validTime(record.endTime))
      || minutesBetween(record) < 0) {
      throw new Error('El archivo contiene movimientos con datos u horas inválidas.');
    }
    recordIds.add(record.id);
    const { id, date, time, endDate, endTime, codeId, code, name } = record;
    return { id, date, time, endDate, endTime, codeId, code, name, holds: [...record.holds].sort((a, b) => a - b) };
  });

  const { id, ship, product, client, inspector, date, updatedAt, holdCount } = turn;
  return {
    exportedAt: file.exportedAt,
    turn: { id, ship, product, client, inspector, date, updatedAt, holdCount, records, catalog, closedAt: turn.closedAt ?? null },
  };
}

export function demoTurn() {
  const date = nowLocal().date;
  const catalog = seedCodes();
  const row = (time, endTime, holds, number) => {
    const code = catalog[number - 1];
    return { id: newId(), date, time, endTime, endDate: endTime ? date : '',
      holds, codeId: code.id, code: code.number, name: code.name };
  };
  return {
    id: newId(), ship: 'Buque de ejemplo', product: 'Fertilizantes', inspector: 'Inspector de ejemplo',
    client: 'Cliente de ejemplo', date, holdCount: 5, updatedAt: timestamp(), closedAt: null,
    catalog, records: [
      row('12:53', '13:05', [3], 9),
      row('13:20', '13:30', [3, 5], 21),
      row('13:30', '', [3, 5], 4),
      row('13:30', '', [1], 3),
      row('13:50', '14:15', [1, 2, 3, 5], 17),
    ],
  };
}
