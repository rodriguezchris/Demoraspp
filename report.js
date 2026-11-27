import { shortDate, sortedRecords } from './model.js';

const width = 794;
const height = 1123;
const margin = 46;
const endOfTable = 1044;
const columns = [
  ['Fecha', 90], ['Desde', 62], ['Hasta', 94], ['Bodegas', 105], ['Código', 70], ['Descripción del movimiento', 281],
];
const colors = { green: '#15362f', text: '#202b27', muted: '#56655e', rule: '#d4ded9' };

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

function pageHeading(context, turn) {
  context.fillStyle = colors.green;
  context.fillRect(margin, 42, width - margin * 2, 4);
  font(context, 31, 700);
  context.fillText('Hoja de movimientos de descarga', margin, 69);
  font(context, 14, 600);
  context.fillStyle = colors.muted;
  context.fillText('Fecha del turno   ' + shortDate(turn.date), margin, 111);

  const fields = [
    ['Buque', turn.ship], ['Inspector', turn.inspector],
    ['Producto', turn.product], ['Cliente', turn.client],
  ];
  let y = 149;
  for (let index = 0; index < fields.length; index += 2) {
    let rowHeight = 0;
    fields.slice(index, index + 2).forEach(([label, value], column) => {
      const x = margin + column * 351;
      font(context, 13, 700);
      context.fillStyle = colors.muted;
      context.fillText(label.toUpperCase(), x, y);
      font(context, 17, 600);
      context.fillStyle = colors.text;
      const wrapped = lines(context, value || '—', 326);
      wrapped.forEach((part, line) => context.fillText(part, x, y + 20 + line * 20));
      rowHeight = Math.max(rowHeight, 20 * wrapped.length);
    });
    y += rowHeight + 35;
  }

  context.fillStyle = colors.green;
  context.fillRect(margin, y, width - margin * 2, 36);
  context.fillStyle = '#fff';
  font(context, 13, 700);
  let x = margin;
  for (const [label, columnWidth] of columns) {
    context.fillText(label, x + 10, y + 10);
    x += columnWidth;
  }
  return y + 36;
}

function prepareRow(context, record) {
  const until = record.endTime && record.endDate !== record.date
    ? record.endTime + ' ' + shortDate(record.endDate) : record.endTime;
  const values = [shortDate(record.date), record.time, until, record.holds.join(', '), record.code, record.name];
  font(context, 13);
  const cells = values.map((value, index) => lines(context, value, columns[index][1] - 20));
  return { cells, rowHeight: Math.max(35, ...cells.map(cell => cell.length * 17 + 14)) };
}

function drawRow(context, row, y, striped) {
  context.fillStyle = striped ? '#f3f7f5' : '#fff';
  context.fillRect(margin, y, width - margin * 2, row.rowHeight);
  font(context, 13);
  let x = margin;
  row.cells.forEach((cell, index) => {
    context.strokeStyle = colors.rule;
    context.strokeRect(x, y, columns[index][1], row.rowHeight);
    context.fillStyle = colors.text;
    cell.forEach((part, line) => context.fillText(part, x + 10, y + 9 + line * 17));
    x += columns[index][1];
  });
}

export function reportPages(turn) {
  const pages = [];
  let page = createPage();
  let y = pageHeading(page.context, turn);
  const records = sortedRecords(turn.records);
  for (const [index, record] of records.entries()) {
    const row = prepareRow(page.context, record);
    if (y + row.rowHeight > endOfTable) {
      pages.push(page);
      page = createPage();
      y = pageHeading(page.context, turn);
    }
    drawRow(page.context, row, y, index % 2 === 1);
    y += row.rowHeight;
  }
  if (!records.length) {
    font(page.context, 14);
    page.context.fillStyle = colors.muted;
    page.context.fillText('Este turno aún no tiene movimientos registrados.', margin + 10, y + 14);
  }
  pages.push(page);
  return pages.map(({ canvas, context }, index) => {
    font(context, 13, 500);
    context.fillStyle = colors.muted;
    context.fillText(records.length + (records.length === 1 ? ' movimiento' : ' movimientos'), margin, 1073);
    context.textAlign = 'right';
    context.fillText('Hoja ' + (index + 1) + ' de ' + pages.length, width - margin, 1073);
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
