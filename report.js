import { delayLegend, rowsPerSheet, sheetRecords, shortDate } from './model.js';

const width = 794;
const height = 1123;
const margin = 46;
const endOfTable = 1044;
const columns = [
  ['Fecha', 84], ['Desde', 80], ['Hasta', 80], ['Bodega', 83],
  ['Tipo de demora', 84], ['', 36], ['Descripción de la demora', 255],
];

function font(context, size, weight = 400) {
  context.font = weight + ' ' + size + 'px Arial, sans-serif';
}

function lines(context, value, maxWidth) {
  const result = [];
  let current = '';
  for (const word of String(value).split(/\s+/)) {
    const candidate = current ? current + ' ' + word : word;
    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) result.push(current);
    current = '';
    for (const char of word) {
      if (context.measureText(current + char).width > maxWidth) {
        result.push(current);
        current = '';
      }
      current += char;
    }
  }
  result.push(current);
  return result;
}

function createPage() {
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext('2d');
  context.scale(2, 2);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.textBaseline = 'top';
  return { canvas, context };
}

function pageHeading(context, turn, logo) {
  if (logo) {
    const scale = Math.min(179 / logo.naturalWidth, 68 / logo.naturalHeight);
    context.drawImage(logo, margin, 59, logo.naturalWidth * scale, logo.naturalHeight * scale);
  } else {
    font(context, 33, 700);
    context.fillStyle = '#171717';
    context.fillText('intertek', margin, 59);
    font(context, 12, 700);
    context.fillText('Total Quality. Assured.', margin, 99);
  }

  const fields = [
    ['BARCO', turn.ship], ['INSPECTOR', turn.inspector],
    ['PRODUCTO', turn.product], ['CLIENTE', turn.client],
  ];
  const columnGap = 30;
  const columnWidth = (width - 2 * margin - columnGap) / 2;
  const labelWidth = 84;
  const valueWidth = columnWidth - labelWidth;
  const lineHeight = 17;
  let y = 141;
  for (let index = 0; index < fields.length; index += 2) {
    font(context, 13, 600);
    const pair = fields.slice(index, index + 2).map(([label, value]) => ({
      label, parts: lines(context, value, valueWidth - 4),
    }));
    const rowHeight = Math.max(...pair.map(({ parts }) => parts.length)) * lineHeight + 5;
    pair.forEach(({ label, parts }, column) => {
      const x = margin + column * (columnWidth + columnGap);
      const valueX = x + labelWidth;
      context.fillStyle = '#171717';
      font(context, 13, 700);
      context.fillText(label + ':', x, y);
      font(context, 13, 600);
      parts.forEach((part, line) => context.fillText(part, valueX + 2, y + line * lineHeight));
      context.fillRect(valueX, y + rowHeight, valueWidth, 1);
    });
    y += rowHeight + 11;
  }
  y += 11;

  context.strokeStyle = '#161616';
  context.fillStyle = '#161616';
  context.lineWidth = 1.1;
  context.textAlign = 'center';
  font(context, 12, 700);
  let x = margin;
  const headers = [
    ...columns.slice(0, 5),
    [columns[6][0], columns[5][1] + columns[6][1]],
  ];
  for (const [label, columnWidth] of headers) {
    context.strokeRect(x, y, columnWidth, 35);
    if (label === 'Tipo de demora') {
      context.fillText('TIPO DE', x + columnWidth / 2, y + 5);
      context.fillText('DEMORA', x + columnWidth / 2, y + 18);
    } else {
      context.fillText(label.toUpperCase(), x + columnWidth / 2, y + 11);
    }
    x += columnWidth;
  }
  context.textAlign = 'left';
  return y + 35;
}

function prepareRow(context, record, hint, previousDate, ambiguousCodes) {
  const until = record?.endTime && record.endDate !== record.date
    ? record.endTime + ' ' + shortDate(record.endDate) : record?.endTime;
  const code = record?.code && ambiguousCodes.has(record.code) ? record.code + ' · ' + record.name : record?.code;
  const values = [
    record && record.date !== previousDate ? shortDate(record.date) : '',
    record?.time, until, record?.holds.join(', '), code, hint?.number, hint?.name.toUpperCase(),
  ];
  const cells = values.map((value, index) => {
    font(context, index >= 5 ? 10 : 12, index >= 5 ? 700 : 500);
    return lines(context, value || '', columns[index][1] - 9);
  });
  return { cells, rowHeight: Math.max(24, ...cells.map(cell => cell.length * 13 + 7)) };
}

function drawRow(context, { cells, rowHeight }, y) {
  let x = margin;
  cells.forEach((cell, index) => {
    const columnWidth = columns[index][1];
    context.strokeStyle = '#161616';
    context.strokeRect(x, y, columnWidth, rowHeight);
    context.fillStyle = '#161616';
    font(context, index >= 5 ? 10 : 12, index >= 5 ? 700 : 500);
    context.textAlign = index === 6 ? 'left' : 'center';
    const textX = index === 6 ? x + 5 : x + columnWidth / 2;
    cell.forEach((part, line) => context.fillText(part, textX, y + 5 + line * 13));
    x += columnWidth;
  });
  context.textAlign = 'left';
}

export function reportPages(turn, catalog, logo, { showPageNumber = true, imageTimestamp = '' } = {}) {
  const pages = [];
  const records = sheetRecords(turn.records);
  const legend = delayLegend(catalog, records.values());
  const ambiguousCodes = new Set(legend.filter((entry, index) => legend[index - 1]?.number === entry.number).map(entry => entry.number));
  const slots = Math.max(rowsPerSheet, legend.length, ...[...records.keys()].map(slot => slot + 1));
  let slot = 0;
  while (slot < slots) {
    const page = createPage();
    const { context } = page;
    let y = pageHeading(context, turn, logo);
    let previousDate = '';
    for (let line = 0; line < rowsPerSheet; line++) {
      const record = records.get(slot);
      const hint = legend[legend.length > rowsPerSheet ? slot : line];
      const row = prepareRow(context, record, hint, previousDate, ambiguousCodes);
      if (y + row.rowHeight > endOfTable && line > 0) break;
      drawRow(context, row, y);
      y += row.rowHeight;
      if (record) previousDate = record.date;
      slot++;
    }
    pages.push(page);
  }
  return pages.map(({ canvas, context }, index) => {
           if (imageTimestamp) {
      font(context, 26);
      context.fillStyle = '#171717';
      context.textAlign = 'right';
      context.fillText(imageTimestamp, width - margin, 1073);
    } else if (showPageNumber) {
      font(context, 11, 500);
      context.fillStyle = '#171717';
      context.textAlign = 'right';
      context.fillText('Hoja ' + (index + 1) + ' de ' + pages.length, width - margin, 1073);
    }
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Vista previa de la hoja ' + (index + 1) + ' de ' + pages.length);
    return canvas;
  });
}


function imageBytes(canvas, type) {
  const base64 = canvas.toDataURL(type, 0.95).split(',')[1];
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

export function filenameFor(turn) {
  const safeName = turn.ship.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return 'bitacora-' + (safeName || 'buque').toLowerCase() + '-' + turn.date;
}

export function pngFiles(pages, filename) {
  return pages.map((canvas, index) => new File(
    [imageBytes(canvas, 'image/png')], filename + '-hoja-' + (index + 1) + '.png', { type: 'image/png' },
  ));
}

// Each report canvas becomes a full A4 PDF page. Both formats share the same layout.
export function pdfFile(pages, filename) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let length = 0;
  function append(part) {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.byteLength;
  }
  function object(number, ...parts) {
    offsets[number] = length;
    append(number + ' 0 obj\n');
    parts.forEach(append);
    append('\nendobj\n');
  }

  append('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, index) => (3 + index * 3) + ' 0 R').join(' ');
  object(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
  pages.forEach((canvas, index) => {
    const page = 3 + index * 3;
    const image = page + 1;
    const drawing = page + 2;
    object(page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 '
      + image + ' 0 R >> >> /Contents ' + drawing + ' 0 R >>');
    const jpeg = imageBytes(canvas, 'image/jpeg');
    object(image, '<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height
      + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.byteLength
      + ' >>\nstream\n', jpeg, '\nendstream');
    const command = 'q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n';
    object(drawing, '<< /Length ' + command.length + ' >>\nstream\n' + command + 'endstream');
  });
  const xref = length;
  append('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) append(String(offset).padStart(10, '0') + ' 00000 n \n');
  append('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new File(chunks, filename + '.pdf', { type: 'application/pdf' });
}
