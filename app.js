import {
  blankSheetRecord, dateWithWords, delayLegend, demoTurn, durationLabel, emptyState, minutesBetween,
  maxSheetRows, newId, nowLocal, parseSheetTime, readTransfer, rowsPerSheet, setSheetTime, sheetRecords, shiftDate,
  shortDate, sortedCodes, storageKey, timestamp, transfer,
  validCodeNumber, validDate, validTime,
} from './model.js';
import { filenameFor, pdfFile, pngFiles, reportPages } from './report.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const importInput = document.querySelector('#import-file');
const toast = document.querySelector('#toast');
const cellEditor = document.querySelector('#cell-editor');
const paperLogoFiles = { original: './intertek.png', nuevo: './intertek-nuevo.webp' };
const paperLogoImages = new Map();
let storeUnavailable = false;

function loadState() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.schema !== 1 || !Array.isArray(parsed.turns) || !Array.isArray(parsed.catalog)) throw new Error();
      return parsed;
    }
    return emptyState();
  } catch {
    storeUnavailable = true;
    return emptyState();
  }
}

let state = loadState();
let view = 'turn';
let catalogScope = 'turn';
let toastTimer;
let currentPages = [];
let installPrompt;
let downloadUrls = [];
let minimumRows = rowsPerSheet;
let editingCell = null;
const cellFields = [
  ['date', 'Fecha'], ['time', 'Desde'], ['endTime', 'Hasta'],
  ['holds', 'Bodega'], ['code', 'Tipo de demora'],
];

const navItems = [
  ['turn', 'Turno', 'clipboard'], ['archive', 'Turnos guardados', 'archive'],
  ['catalog', 'Códigos', 'tag'], ['report', 'Hoja del turno', 'file'],
];
const icons = {
  clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 11h6m-6 4h6m-6 3h4"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9m-10 4h6"/>',
  tag: '<path d="M3 4h8l9 9a2 2 0 0 1 0 3l-4 4a2 2 0 0 1-3 0l-9-9z"/><circle cx="8" cy="8" r="1"/>',
  file: '<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Zm0 0v7h7M8 14h8m-8 3h8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="m14 6 4 4M5 19l4.5-1 11-11-3.5-3.5-11 11L5 19Zm7 0h8"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  transfer: '<path d="M3 7h17m-4-4 4 4-4 4m5 6H4m4-4-4 4 4 4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
  down: '<path d="M12 3v12m-4-4 4 4 4-4M5 17v3h14v-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  picture: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-4 4 3 3-3 4 4"/>',
  box: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M9 15h6"/>',
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icon = (name, size = 19) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const button = (label, action, variant = 'secondary', glyph = '', id = '', extra = '') =>
  `<button type="button" class="btn ${variant} ${extra}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ''}>${glyph ? icon(glyph) : ''}${label}</button>`;
const iconButton = (label, action, glyph, id = '', extra = '') =>
  `<button type="button" class="icon-button ${extra}" aria-label="${label}" title="${label}" data-action="${action}" data-id="${esc(id)}">${icon(glyph, 18)}</button>`;
const activeTurn = () => state.turns.find(turn => turn.id === state.activeId);
const catalogFor = turn => turn?.catalog ?? state.catalog;
const scopedCatalog = () => catalogScope === 'turn' ? catalogFor(activeTurn()) : state.catalog;
const countLabel = count => count + (count === 1 ? ' movimiento' : ' movimientos');

function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toastTimer = setTimeout(() => { toast.textContent = ''; }, 4800);
}

function updateState(update) {
  if (storeUnavailable) throw new Error('El navegador no puede abrir el almacenamiento. Exporta tus apuntes si están disponibles.');
  const nextState = loadState();
  if (storeUnavailable) throw new Error('El navegador no puede abrir el almacenamiento.');
  update(nextState);
  try {
    localStorage.setItem(storageKey, JSON.stringify(nextState));
  } catch {
    throw new Error('No se pudo guardar en este teléfono. Libera espacio y vuelve a intentar.');
  }
  state = nextState;
}

function updateTurn(id, update) {
  updateState(next => {
    const turn = next.turns.find(item => item.id === id);
    if (!turn) throw new Error('El turno ya no está disponible.');
    update(turn, next);
    turn.updatedAt = timestamp();
  });
}

function heading(title, description, actions = '') {
  return `<header class="page-heading"><div><h1 id="page-title" tabindex="-1">${title}</h1>${description ? `<p class="subtitle">${description}</p>` : ''}</div>
    ${actions ? `<div class="actions">${actions}</div>` : ''}</header>`;
}

function emptyPanel(glyph, title, message, actions = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon(glyph, 23)}</div><h3>${title}</h3>
    <p>${message}</p>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

function selectedPaperLogo() {
  return state.paperLogo === 'nuevo' ? 'nuevo' : 'original';
}

function loadPaperLogo(selection) {
  if (!paperLogoImages.has(selection)) {
    const image = new Image();
    image.src = paperLogoFiles[selection];
    paperLogoImages.set(selection, image.decode().then(() => image, () => null));
  }
  return paperLogoImages.get(selection);
}

function renderLogoPicker() {
  return `<label class="logo-picker">Logo <select id="paper-logo-select">
    <option value="original" ${selectedPaperLogo() === 'original' ? 'selected' : ''}>Original</option>
    <option value="nuevo" ${selectedPaperLogo() === 'nuevo' ? 'selected' : ''}>Nuevo</option>
  </select></label>`;
}

function render() {
  const sheetScroll = document.querySelector('.paper-scroll')?.scrollLeft ?? 0;
  currentPages = [];
  const turn = activeTurn();
  const today = dateWithWords(nowLocal().date);
  const title = navItems.find(item => item[0] === view)[1];
  app.innerHTML = `<div class="workspace">
    <aside class="rail">
      <div class="brand"><span class="brand-mark">${icon('clipboard', 21)}</span>Bitácora de Muelle</div>
      <nav aria-label="Navegación principal">${navItems.map(([key, name, glyph]) => `<button type="button" class="nav-button${view === key ? ' active' : ''}" data-action="navigate" data-id="${key}"${view === key ? ' aria-current="page"' : ''}>
        ${icon(glyph)}${key === 'archive' ? '<span class="desktop-only">Turnos guardados</span><span class="mobile-only">Turnos</span>' : esc(name)}</button>`).join('')}</nav>
      <div class="rail-status" id="connection"></div>
    </aside>
    <div class="surface">
      <header class="topbar"><span class="topbar-label">${icon('box', 17)} ${esc(title)}</span><span class="topbar-date">${icon('calendar', 17)} ${esc(today)}</span></header>
      <main aria-labelledby="page-title">${view === 'archive' ? renderArchive() : view === 'catalog' ? renderCatalog() : view === 'report' ? renderReport(turn) : renderTurn(turn)}</main>
    </div>
  </div>`;
  renderConnection();
  const paperScroll = document.querySelector('.paper-scroll');
  if (paperScroll) paperScroll.scrollLeft = sheetScroll;
  if (view === 'report' && turn) {
    const preview = document.querySelector('#report-pages');
    loadPaperLogo(selectedPaperLogo()).then(logo => {
      if (!preview.isConnected) return;
      currentPages = reportPages(turn, catalogFor(turn), logo);
      preview.replaceChildren(...currentPages);
    });
  }
  positionCellEditor();
}

function renderConnection() {
  const status = document.querySelector('#connection');
  if (status) status.innerHTML = navigator.onLine
    ? '<span class="status-dot"></span>En línea'
    : '<span class="status-dot offline"></span>Sin conexión';
}

function renderTurn(turn) {
  const actions = renderLogoPicker() + (turn
    ? button('Editar datos', 'edit-turn', 'secondary', 'edit') + button('Vista previa', 'report', 'primary', 'file')
    : button('Importar registro', 'import', 'secondary', 'down') + button('Nuevo turno', 'new-turn', 'primary', 'plus'));
  const controls = turn
    ? button('Transferir registro', 'transfer', 'secondary', 'transfer')
      + (turn.closedAt ? button('Reabrir turno', 'reopen', 'secondary') : button('Finalizar turno', 'finish', 'plain', 'check'))
    : button('Cargar turno de ejemplo', 'demo', 'plain');
  const metadata = [
    ['Barco', turn?.ship], ['Inspector', turn?.inspector],
    ['Producto', turn?.product], ['Cliente', turn?.client],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('');
  const detail = turn ? (turn.closedAt ? 'Turno finalizado' : 'Turno en curso') + ' · ' + countLabel(turn.records.length) : '';
  return `<div class="sheet-workspace">
    ${heading('Hoja de demoras', detail, actions)}
    <section class="paper" aria-label="Formato de demoras">
      <header class="paper-heading">
        <img src="${paperLogoFiles[selectedPaperLogo()]}" alt="Intertek. Total Quality. Assured." width="157" height="60">
        <dl class="paper-fields">${metadata}</dl>
      </header>
      <div class="paper-scroll" tabindex="0" aria-label="Cuadrícula. Desliza hacia la derecha para ver la leyenda.">
        ${renderSheetGrid(turn)}
      </div>
    </section>
    <div class="sheet-footer">
      ${turn ? button('Añadir filas', 'more-rows', 'secondary', 'plus') : ''}
      ${controls}
      ${installPrompt ? button('Instalar app', 'install', 'secondary', 'down') : ''}
    </div>
  </div>`;
}

function renderSheetGrid(turn) {
  const records = sheetRecords(turn?.records ?? []);
  const legend = delayLegend(catalogFor(turn), records.values());
  const requiredRows = Math.max(rowsPerSheet, legend.length, ...[...records.keys()].map(slot => slot + 1));
  const rowCount = Math.min(maxSheetRows, Math.max(minimumRows, Math.ceil(requiredRows / rowsPerSheet) * rowsPerSheet));
  const rows = Array.from({ length: rowCount }, (_, slot) => {
    const record = records.get(slot);
    const hint = legend[slot];
    const cells = cellFields.map(([key, label]) => {
      let value = record?.[key] ?? '';
      let detail = '';
      if (key === 'date' && value) value = shortDate(value);
      if (key === 'holds' && record) value = record.holds.join(', ');
      if (key === 'endTime' && record?.endTime) {
        detail = durationLabel(minutesBetween(record));
        if (record.endDate !== record.date) detail = shortDate(record.endDate) + (detail ? ' · ' + detail : '');
      }
      if (key === 'code' && record) detail = record.name;
      const name = label + ', fila ' + (slot + 1) + (value ? ': ' + value : '') + (detail ? ' · ' + detail : '');
      const editable = !turn?.closedAt || record;
      return `<td>${editable
        ? `<button type="button" class="sheet-cell" data-action="edit-cell" data-slot="${slot}" data-field="${key}"
            aria-label="${esc(name)}" aria-expanded="false"${detail ? ` title="${esc(detail)}"` : ''}>${esc(value)}</button>`
        : ''}</td>`;
    }).join('');
    return `<tr>${cells}<td class="legend-number">${esc(hint?.number)}</td><td class="legend-name">${esc(hint?.name)}</td></tr>`;
  }).join('');
  return `<table class="sheet-grid" aria-label="Hoja del turno">
    <colgroup>${cellFields.map(([key]) => `<col class="column-${key}">`).join('')}</colgroup>
    <colgroup><col class="column-legend-number"><col class="column-legend-name"></colgroup>
    <thead><tr>
      ${cellFields.map(([key, label]) => `<th scope="col" class="column-${key}">${label}</th>`).join('')}
      <th scope="colgroup" colspan="2">Descripción de la demora</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderArchive() {
  const turns = [...state.turns].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  return heading('Turnos guardados', 'Abre un turno anterior o importa los apuntes de otro inspector.',
    button('Importar registro', 'import', 'secondary', 'down') + button('Nuevo turno', 'new-turn', 'primary', 'plus'))
    + (turns.length ? `<div class="section-list">${turns.map(turn => `<article class="card turn-item">
        <div class="turn-item-info"><h2>${esc(turn.ship)}</h2><p>${shortDate(turn.date)} · ${countLabel(turn.records.length)} · ${turn.closedAt ? 'Finalizado' : 'En curso'}</p></div>
        <div class="actions">${button('Abrir', 'activate-turn', 'secondary', '', turn.id)}${iconButton('Eliminar turno', 'delete-turn', 'trash', turn.id, 'danger')}</div>
      </article>`).join('')}</div>`
      : `<section class="card">${emptyPanel('archive', 'Sin turnos guardados', 'Los turnos que crees o importes aparecerán aquí.')}</section>`);
}

function renderCatalog() {
  const localTurn = activeTurn();
  const rows = sortedCodes(scopedCatalog()).map(code => `<tr data-code-search="${esc((code.number + ' ' + code.name).toLowerCase())}">
    <td><span class="badge">${esc(code.number)}</span></td><td class="movement-name">${esc(code.name)}</td>
    <td class="row-action">${iconButton('Editar código', 'edit-code', 'edit', code.id)}${iconButton('Quitar código', 'delete-code', 'trash', code.id, 'danger')}</td>
  </tr>`).join('');
  return heading('Códigos y movimientos', 'Edita la lista para nuevas anotaciones. Las anteriores conservan sus códigos y nombres.',
    button('Agregar código', 'new-code', 'primary', 'plus'))
    + `<div class="catalog-tools"><input type="search" id="code-search" aria-label="Buscar código o movimiento" placeholder="Buscar código o movimiento">
      ${localTurn?.catalog ? `<label class="field">Catálogo<select id="catalog-scope"><option value="turn" ${catalogScope === 'turn' ? 'selected' : ''}>De este turno</option><option value="mine" ${catalogScope === 'mine' ? 'selected' : ''}>Mi catálogo</option></select></label>` : ''}</div>
      <section class="card table-shell catalog-list">${rows ? `<table aria-label="Catálogo de movimientos"><thead><tr><th scope="col">Código</th><th scope="col">Movimiento</th><th scope="col">Acciones</th></tr></thead><tbody>${rows}</tbody></table><p id="no-codes" class="empty-state" hidden>Sin resultados.</p>`
      : emptyPanel('tag', 'Catálogo vacío', 'Agrega un código para usarlo en una anotación.')}</section>`;
}

function renderReport(turn) {
  if (!turn) return heading('Hoja del turno', '')
    + `<section class="card">${emptyPanel('file', 'Abre un turno', 'La vista previa y los formatos de descarga estarán disponibles al abrir un turno.',
      button('Ir al turno', 'navigate', 'primary', 'clipboard', 'turn'))}</section>`;
  return heading('Hoja del turno', esc(turn.ship + ' · ' + shortDate(turn.date)),
    renderLogoPicker() + button('Imagen PNG', 'png', 'secondary', 'picture') + button('PDF', 'pdf', 'primary', 'file'))
    + '<div class="report-area" id="report-pages" aria-label="Vista previa de la hoja"></div>';
}

function openDialog(title, content) {
  dialog.innerHTML = `<header class="modal-head"><h2 id="dialog-title">${title}</h2>${iconButton('Cerrar', 'close-dialog', 'close')}</header>
    <div class="modal-content">${content}</div>`;
  if (!dialog.open) dialog.showModal();
  const firstField = dialog.querySelector('[autofocus], form input, form select, .btn.primary, .btn.danger');
  (firstField ?? dialog.querySelector('button')).focus({ preventScroll: true });
  dialog.scrollTop = 0;
}

function showForm(title, fields, onSave, extraActions = '') {
  openDialog(title, `<form><div class="form-grid">${fields}<p class="error full" role="alert"></p></div>
    <footer class="modal-actions">${extraActions}${button('Cancelar', 'close-dialog', 'secondary')}<button class="btn primary" type="submit">Guardar</button></footer></form>`);
  const form = dialog.querySelector('form');
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      onSave(new FormData(form));
      dialog.close();
      render();
    } catch (error) {
      form.querySelector('.error').textContent = error.message;
    }
  });
  return form;
}

function field(label, name, value = '', options = {}) {
  return `<label class="field ${options.full ? 'full' : ''}">${label}
    <input type="${options.type ?? 'text'}" name="${name}" value="${esc(value)}" ${options.attributes ?? ''}>
    ${options.note ? `<span class="field-note">${options.note}</span>` : ''}</label>`;
}

function showTurnForm(turn = null, nextCell = null) {
  const fields = [
    field('Nombre del buque', 'ship', turn?.ship, { full: true, attributes: 'required maxlength="100" autofocus' }),
    field('Producto', 'product', turn?.product, { attributes: 'maxlength="100"' }),
    field('Cliente', 'client', turn?.client, { attributes: 'maxlength="100"' }),
    field('Inspector', 'inspector', turn?.inspector, { full: true, attributes: 'maxlength="100"' }),
    field('Fecha del turno', 'date', turn?.date ?? nowLocal().date, { type: 'date', attributes: 'required' }),
    field('Cantidad de bodegas', 'holdCount', turn?.holdCount ?? 5, { type: 'number', attributes: 'required min="1" max="30"' }),
  ].join('');
  showForm(turn ? 'Editar datos del turno' : 'Nuevo turno', fields, data => {
    const ship = data.get('ship').trim();
    const date = data.get('date');
    const holdCount = Number(data.get('holdCount'));
    if (!ship) throw new Error('Escribe el nombre del buque.');
    if (!validDate(date) || !Number.isInteger(holdCount) || holdCount < 1 || holdCount > 30) {
      throw new Error('Revisa la fecha y la cantidad de bodegas.');
    }
    const values = { ship, date, holdCount, product: data.get('product').trim(),
      client: data.get('client').trim(), inspector: data.get('inspector').trim() };
    if (turn) {
      updateTurn(turn.id, current => {
        if (current.records.some(record => record.holds.some(hold => hold > holdCount))) {
          throw new Error('Ya hay anotaciones para una bodega que quedaría fuera.');
        }
        Object.assign(current, values);
      });
    } else {
      updateState(next => {
        const id = newId();
        next.turns.push({ ...values, id, records: [], closedAt: null, updatedAt: timestamp() });
        next.activeId = id;
      });
    }
    view = 'turn';
    if (!turn) minimumRows = rowsPerSheet;
    notify(turn ? 'Datos del turno actualizados.' : 'Turno creado.');
    if (nextCell) {
      queueMicrotask(() => {
        try {
          openCell(activeTurn(), nextCell.slot, nextCell.key);
        } catch (error) {
          notify(error.message);
        }
      });
    }
  });
}

function cellAnchor(slot, key) {
  return document.querySelector('.sheet-cell[data-slot="' + slot + '"][data-field="' + key + '"]');
}

function closeCell(restoreFocus = false) {
  if (!editingCell) return;
  const anchor = cellAnchor(editingCell.slot, editingCell.key);
  anchor?.setAttribute('aria-expanded', 'false');
  cellEditor.hidden = true;
  cellEditor.replaceChildren();
  editingCell = null;
  if (restoreFocus) anchor?.focus({ preventScroll: true });
}

function positionCellEditor() {
  if (!editingCell || cellEditor.hidden) return;
  const anchor = cellAnchor(editingCell.slot, editingCell.key);
  if (!anchor) {
    closeCell();
    return;
  }
  anchor.setAttribute('aria-expanded', 'true');
  const bounds = anchor.getBoundingClientRect();
  const viewport = window.visualViewport;
  const screenHeight = viewport?.height ?? window.innerHeight;
  const topBound = viewport?.offsetTop ?? 0;
  const screenBottom = topBound + screenHeight;
  const panelHeight = cellEditor.offsetHeight;
  const below = bounds.bottom + 5;
  const top = below + panelHeight <= screenBottom - 8
    ? below : Math.max(topBound + 8, Math.min(bounds.top - panelHeight - 5, screenBottom - panelHeight - 8));
  const left = Math.max(8, Math.min(bounds.left, document.documentElement.clientWidth - cellEditor.offsetWidth - 8));
  cellEditor.style.top = top + 'px';
  cellEditor.style.left = left + 'px';
  positionClockPicker(topBound, screenBottom);
}

function openCell(turn, slot, key) {
  const field = cellFields.find(([name]) => name === key);
  if (!field || !Number.isInteger(slot) || slot < 0 || slot >= maxSheetRows) return;
  if (!turn) {
    showTurnForm(null, { slot, key });
    return;
  }
  if (editingCell?.slot === slot && editingCell.key === key) {
    closeCell(true);
    return;
  }
  closeCell();
  const existing = sheetRecords(turn.records).get(slot);
  if (!existing || key === 'time' && !existing.time) {
    updateTurn(turn.id, current => {
      const rows = sheetRecords(current.records);
      let row = rows.get(slot);
      const now = nowLocal();
      if (!row) {
        if (current.closedAt) throw new Error('Reabre el turno antes de agregar movimientos.');
        const rowDate = now.date === shiftDate(current.date, 1) ? now.date : current.date;
        row = blankSheetRecord(slot, rowDate);
        rows.set(slot, row);
      }
      if (key === 'time' && !row.time && !(minutesBetween({ ...row, time: now.time }) < 0)) row.time = now.time;
      current.records = [...rows.values()];
    });
    turn = activeTurn();
    render();
  }
  const row = sheetRecords(turn.records).get(slot);
  editingCell = { turnId: turn.id, rowId: row.id, slot, key };
  cellEditor.innerHTML = `<header class="cell-editor-head"><h2>${field[1]} <span>Fila ${slot + 1}</span></h2>
    <button type="button" class="icon-button" data-cell-command="close" aria-label="Cerrar casilla">${icon('close', 17)}</button></header>
    ${cellEditorFields(turn, row, key)}
    <p class="error cell-error" role="alert"></p>
    <footer class="cell-editor-footer">${button('Limpiar fila', 'delete-record', 'plain', 'trash', row.id)}</footer>`;
  cellEditor.hidden = false;
  positionCellEditor();
  const target = cellEditor.querySelector('input, button[data-cell-value]') ?? cellEditor.querySelector('button');
  if (matchMedia('(pointer: fine)').matches) {
    target.focus({ preventScroll: true });
    if (target.matches('[data-sheet-time]')) target.select();
  }
}

function cellEditorFields(turn, row, key) {
  if (key === 'holds') {
    const options = Array.from({ length: turn.holdCount }, (_, index) => {
      const hold = index + 1;
      return `<button type="button" class="hold-toggle" aria-label="Bodega ${hold}" aria-pressed="${row.holds.includes(hold)}"
        data-cell-value="${hold}">${hold}</button>`;
    }).join('');
    return `<div class="cell-holds">${options}</div>`;
  }
  if (key === 'code') {
    const catalog = sortedCodes(catalogFor(turn));
    return `<div class="cell-codes">
      <input type="search" aria-label="Buscar tipo de demora" placeholder="Buscar código o descripción" id="cell-code-search">
      <div class="cell-code-list">${catalog.map(code => `<button type="button" class="cell-code"
        data-cell-value="${esc(code.id)}" data-search-code="${esc((code.number + ' ' + code.name).toLowerCase())}">
        <strong>${esc(code.number)}</strong><span>${esc(code.name)}</span></button>`).join('')}
        <p id="cell-no-codes" class="muted-note"${catalog.length ? ' hidden' : ''}>No hay códigos disponibles.</p>
      </div>
      ${row.code ? '<button type="button" class="btn plain" data-cell-command="clear">Borrar código</button>' : ''}
    </div>`;
  }
  const label = cellFields.find(([name]) => name === key)[1];
  const input = key === 'date'
    ? `<label class="field">${label}<input type="date" name="value" value="${row.date}" required></label>`
    : renderClockField(label, row[key]);
  const finishDate = key === 'endTime'
    ? `<label class="field">Fecha de fin<input type="date" name="endDate" value="${row.endDate || row.date}"></label>` : '';
  const clear = key === 'date' ? '' : '<button type="button" class="btn plain" data-cell-command="clear">Borrar</button>';
  return `<form class="cell-form">
    ${input}
    ${finishDate}
    <div class="actions">${clear}<button type="submit" class="btn primary">Guardar</button></div>
  </form>`;
}

function renderClockField(label, value) {
  function column(name, part, count) {
    const options = Array.from({ length: count }, (_, index) => {
      const number = String(index).padStart(2, '0');
      return `<button type="button" class="clock-option" role="option" aria-selected="false"
        tabindex="-1" data-clock-value="${number}">${number}</button>`;
    }).join('');
    return `<div class="clock-column" role="listbox" aria-label="${name}" data-clock-part="${part}">${options}</div>`;
  }

  return `<div class="field">
    <label for="sheet-time-value">${label}</label>
    <div class="clock-entry">
      <input type="text" id="sheet-time-value" inputmode="numeric" autocomplete="off" placeholder="HH:MM"
        aria-describedby="sheet-time-format" data-sheet-time name="value" value="${value}" required>
      <button type="button" class="icon-button clock-toggle" data-cell-command="clock"
        aria-label="Seleccionar hora" aria-controls="sheet-clock-picker" aria-expanded="false">${icon('clock', 22)}</button>
      <div class="clock-picker" id="sheet-clock-picker" role="group" aria-label="Selector de 24 horas" hidden>
        ${column('Horas', 0, 24)}${column('Minutos', 1, 60)}
      </div>
    </div>
    <p id="sheet-time-format" class="field-note">24 horas · Ej. 18:05</p>
  </div>`;
}

function positionClockPicker(viewportTop, viewportBottom) {
  const picker = cellEditor.querySelector('.clock-picker:not([hidden])');
  if (!picker) return;
  const field = picker.closest('.clock-entry').getBoundingClientRect();
  const below = viewportBottom - field.bottom - 10;
  const above = field.top - viewportTop - 10;
  const opensAbove = below < 312 && above > below;
  picker.style.maxHeight = Math.max(0, opensAbove ? above : below) + 'px';
  picker.style.top = (opensAbove ? field.top - picker.offsetHeight - 4 : field.bottom + 4) + 'px';
  picker.style.left = Math.max(8, Math.min(field.left, document.documentElement.clientWidth - picker.offsetWidth - 8)) + 'px';
}

function syncClockPicker(picker, time, center = false) {
  const parts = time.split(':');
  for (const column of picker.querySelectorAll('.clock-column')) {
    const selected = column.querySelector('[data-clock-value="' + parts[column.dataset.clockPart] + '"]');
    const previous = column.querySelector('[aria-selected="true"]');
    if (previous && previous !== selected) {
      previous.setAttribute('aria-selected', 'false');
      previous.tabIndex = -1;
    }
    selected.setAttribute('aria-selected', 'true');
    selected.tabIndex = 0;
    if (center) {
      column.scrollTop += selected.getBoundingClientRect().top - column.getBoundingClientRect().top
        - (column.clientHeight - selected.offsetHeight) / 2;
    }
  }
}

function showClockPicker(open) {
  const toggle = cellEditor.querySelector('[data-cell-command="clock"]');
  const picker = cellEditor.querySelector('#sheet-clock-picker');
  picker.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  positionCellEditor();
  if (open) {
    const input = cellEditor.querySelector('[data-sheet-time]');
    syncClockPicker(picker, parseSheetTime(input.value) ?? nowLocal().time, true);
  }
}

function selectClockOption(option) {
  const picker = option.closest('.clock-picker');
  const time = [...picker.querySelectorAll('.clock-column')].map(column => {
    const selected = column.contains(option) ? option : column.querySelector('[aria-selected="true"]');
    return selected.dataset.clockValue;
  }).join(':');
  const input = picker.closest('form').querySelector('[data-sheet-time]');
  input.value = time;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function saveCell(update, keepOpen = false) {
  const { turnId, rowId, slot, key } = editingCell;
  try {
    updateTurn(turnId, (turn, next) => {
      const rows = sheetRecords(turn.records);
      const row = [...rows.values()].find(item => item.id === rowId);
      if (!row) throw new Error('La fila ya no está disponible.');
      update(row, turn, next);
      turn.records = [...rows.values()];
    });
    if (!keepOpen) closeCell();
    render();
    if (!keepOpen) cellAnchor(slot, key)?.focus({ preventScroll: true });
    else cellEditor.querySelector('.cell-error').textContent = '';
  } catch (error) {
    cellEditor.querySelector('.cell-error').textContent = error.message;
    positionCellEditor();
    return false;
  }
  return true;
}

cellEditor.addEventListener('click', event => {
  const control = event.target.closest('button');
  if (!control || !editingCell) return;
  const { key } = editingCell;
  const { cellValue, cellCommand, clockValue } = control.dataset;
  if (clockValue !== undefined) {
    selectClockOption(control);
  } else if (cellCommand === 'close') {
    closeCell(true);
  } else if (cellCommand === 'clock') {
    showClockPicker(control.getAttribute('aria-expanded') === 'false');
  } else if (cellCommand === 'clear') {
    saveCell(row => {
      if (key === 'code') Object.assign(row, { codeId: '', code: '', name: '' });
      else setSheetTime(row, key, '', '');
    });
  } else if (cellValue && key === 'holds') {
    const hold = Number(cellValue);
    let selected;
    if (saveCell((row, turn) => {
      if (hold > turn.holdCount) throw new Error('Esa bodega ya no está disponible.');
      selected = !row.holds.includes(hold);
      row.holds = selected ? [...row.holds, hold].sort((a, b) => a - b) : row.holds.filter(item => item !== hold);
    }, true)) control.setAttribute('aria-pressed', String(selected));
  } else if (cellValue && key === 'code') {
    saveCell((row, turn, next) => {
      const code = (turn.catalog ?? next.catalog).find(item => item.id === cellValue);
      if (!code) throw new Error('Ese código ya no está disponible.');
      Object.assign(row, { codeId: code.id, code: code.number, name: code.name });
    });
  }
});

cellEditor.addEventListener('input', event => {
  const input = event.target;
  if (input.matches('[data-sheet-time]')) {
    const picker = cellEditor.querySelector('.clock-picker:not([hidden])');
    const time = parseSheetTime(input.value);
    if (picker && time) syncClockPicker(picker, time);
  }
  if (input.id === 'cell-code-search') {
    const query = input.value.trim().toLowerCase();
    const options = [...cellEditor.querySelectorAll('[data-search-code]')];
    for (const option of options) option.hidden = !option.dataset.searchCode.includes(query);
    cellEditor.querySelector('#cell-no-codes').hidden = options.some(option => !option.hidden);
  } else if (editingCell?.key === 'endTime') {
    const form = input.form;
    if (input.name === 'endDate') form.dataset.manualEndDate = 'true';
    if (input.name === 'value' && !form.dataset.manualEndDate) {
      const row = sheetRecords(activeTurn().records).get(editingCell.slot);
      if (row.endDate && row.endDate !== row.date && row.endDate !== shiftDate(row.date, 1)) return;
      const time = parseSheetTime(input.value);
      if (!time) return;
      const nextDate = row.time && time < row.time ? shiftDate(row.date, 1) : row.date;
      form.elements.endDate.value = validDate(nextDate) ? nextDate : row.date;
    }
  }
  positionCellEditor();
});

cellEditor.addEventListener('keydown', event => {
  if (!event.target.matches('.clock-option')) return;
  const options = [...event.target.parentElement.children];
  const index = options.indexOf(event.target);
  const nextIndex = {
    ArrowUp: Math.max(0, index - 1),
    ArrowDown: Math.min(options.length - 1, index + 1),
    Home: 0,
    End: options.length - 1,
  }[event.key];
  if (nextIndex === undefined) return;
  event.preventDefault();
  const option = options[nextIndex];
  selectClockOption(option);
  option.focus();
});

cellEditor.addEventListener('focusout', event => {
  if (!event.target.matches('[data-sheet-time]')) return;
  const time = parseSheetTime(event.target.value);
  if (time) event.target.value = time;
});

cellEditor.addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const { key } = editingCell;
  const value = data.get('value');
  saveCell(row => {
    if (key !== 'date') {
      const time = parseSheetTime(value);
      if (!time) throw new Error('Ingresa una hora entre 00:00 y 23:59.');
      setSheetTime(row, key, time, data.get('endDate'));
      return;
    }
    if (!validDate(value)) throw new Error('Revisa la fecha ingresada.');
    if (row.endDate) {
      const days = (Date.parse(row.endDate) - Date.parse(row.date)) / 86400000;
      const endDate = shiftDate(value, days);
      if (!validDate(endDate)) throw new Error('Revisa la fecha ingresada.');
      row.endDate = endDate;
    }
    row.date = value;
  });
});

function updateCatalog(scope, turnId, update) {
  if (scope === 'turn' && activeTurn()?.catalog) {
    updateTurn(turnId, turn => { turn.catalog = update(turn.catalog); });
  } else {
    updateState(next => { next.catalog = update(next.catalog); });
  }
}

function showCodeForm(code = null) {
  const scope = catalogScope;
  const turnId = state.activeId;
  const fields = field('Código', 'number', code?.number, { attributes: 'required maxlength="12" autofocus', note: 'Hasta 12 letras, números o guiones.' })
    + field('Nombre del movimiento', 'name', code?.name, { full: true, attributes: 'required maxlength="120"' });
  showForm(code ? 'Editar código' : 'Agregar código', fields, data => {
    const number = data.get('number').trim();
    const name = data.get('name').trim();
    if (!validCodeNumber(number) || !name) throw new Error('Escribe un código válido y un nombre para el movimiento.');
    updateCatalog(scope, turnId, catalog => {
      if (catalog.some(item => item.id !== code?.id && item.number.toUpperCase() === number.toUpperCase())) {
        throw new Error('Ese código ya existe en este catálogo.');
      }
      if (code) {
        if (!catalog.some(item => item.id === code.id)) throw new Error('El código ya no está disponible.');
        return catalog.map(item => item.id === code.id ? { id: code.id, number, name } : item);
      }
      return [...catalog, { id: newId(), number, name }];
    });
    notify(code ? 'Código actualizado.' : 'Código agregado.');
  });
}

function confirmAction(title, note, label, onConfirm, variant = 'danger') {
  openDialog(title, `<p>${note}</p><p class="error" role="alert"></p><div class="modal-actions">
    ${button('Cancelar', 'close-dialog', 'secondary')}<button type="button" class="btn ${variant}" id="confirm-action">${label}</button></div>`);
  dialog.querySelector('#confirm-action').addEventListener('click', () => {
    try {
      onConfirm();
      dialog.close();
      render();
    } catch (error) {
      dialog.querySelector('.error').textContent = error.message;
    }
  });
}

function openFiles(title, description, files) {
  const canShare = Boolean(navigator.share && navigator.canShare?.({ files }));
  const links = files.map((file, index) => {
    const url = URL.createObjectURL(file);
    downloadUrls.push(url);
    const label = files.length > 1 ? 'Guardar hoja ' + (index + 1) : 'Guardar archivo';
    return `<a class="btn secondary" href="${url}" download="${esc(file.name)}">${icon('down')}${label}</a>`;
  }).join('');
  openDialog(title, `<p>${description}</p><div class="file-links">${links}</div><p class="error" role="alert"></p>
    ${canShare ? '<div class="modal-actions"><button type="button" class="btn primary" id="share-files">Compartir</button></div>' : ''}`);
  dialog.querySelector('#share-files')?.addEventListener('click', async () => {
    try {
      await navigator.share({ files });
    } catch (error) {
      if (error.name !== 'AbortError') {
        const message = dialog.querySelector('.error');
        if (message) message.textContent = 'Guarda el archivo y compártelo desde el teléfono.';
      }
    }
  });
}

async function exportReport(turn, format) {
  const previewPages = currentPages;
  const logo = await loadPaperLogo(selectedPaperLogo());
  const pages = previewPages.length ? previewPages : reportPages(turn, catalogFor(turn), logo);
  const filename = filenameFor(turn);
  const files = format === 'png' ? pngFiles(pages, filename) : [pdfFile(pages, filename)];
  const description = format === 'png'
    ? (files.length === 1 ? 'Imagen lista para enviar por WhatsApp.' : 'Se generó una imagen numerada por hoja.')
    : 'Todas las hojas del turno están en un solo PDF.';
  openFiles(format === 'png' ? 'Imagen de la hoja' : 'PDF del turno', description, files);
}

function exportTransfer(turn) {
  const file = new File([JSON.stringify(transfer(turn, catalogFor(turn)), null, 2)],
    filenameFor(turn) + '.json', { type: 'application/json' });
  openFiles('Transferir registro', 'Envía este archivo para que otro inspector pueda importarlo y continuar tus anotaciones.', [file]);
}

function saveImport(incoming, choice = 'new') {
  updateState(next => {
    const index = next.turns.findIndex(turn => turn.id === incoming.id);
    if (choice === 'replace') {
      if (index === -1) throw new Error('El turno que quieres sustituir ya no está disponible.');
      next.turns[index] = incoming;
    } else if (choice === 'copy') {
      incoming = { ...incoming, id: newId() };
      next.turns.push(incoming);
    } else {
      if (index !== -1) throw new Error('Este turno ya está guardado. Vuelve a importar para comparar las versiones.');
      next.turns.push(incoming);
    }
    next.activeId = incoming.id;
  });
  catalogScope = 'turn';
  minimumRows = rowsPerSheet;
  view = 'turn';
  notify('Registro importado.');
}

const versionDate = new Intl.DateTimeFormat('es-HN', {
  timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short',
});

async function importRecord(file) {
  try {
    const { turn, exportedAt } = readTransfer(await file.text());
    const existing = state.turns.find(item => item.id === turn.id);
    if (!existing) {
      saveImport(turn);
      render();
      return;
    }

    openDialog('Este turno ya existe', `<p>Compara las versiones de <strong>${esc(turn.ship)}</strong>.</p>
      <div class="import-versions">
        <p>En este teléfono · ${versionDate.format(new Date(existing.updatedAt))} · ${countLabel(existing.records.length)}</p>
        <p>En el archivo · ${versionDate.format(new Date(turn.updatedAt))} · ${countLabel(turn.records.length)}</p>
        <p class="muted-note">Archivo generado el ${versionDate.format(new Date(exportedAt))}.</p>
      </div><p class="error" role="alert"></p>
      <div class="modal-actions">${button('Conservar actual', 'close-dialog', 'secondary')}
      <button type="button" class="btn secondary" id="import-copy">Guardar copia</button><button type="button" class="btn primary" id="import-replace">Sustituir</button></div>`);

    for (const choice of ['copy', 'replace']) {
      dialog.querySelector('#import-' + choice).addEventListener('click', () => {
        try {
          if (choice === 'replace' && loadState().turns.find(item => item.id === turn.id)?.updatedAt !== existing.updatedAt) {
            throw new Error('El turno cambió. Vuelve a importar para revisar las versiones actualizadas.');
          }
          saveImport(turn, choice);
          dialog.close();
          render();
        } catch (error) {
          dialog.querySelector('.error').textContent = error.message;
        }
      });
    }
  } catch (error) {
    notify(error.message || 'No se pudo importar el registro.');
  }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]')
    ?? event.target.closest('.sheet-grid td')?.querySelector('.sheet-cell');
  if (!button) return;
  const { action, id } = button.dataset;
  const turn = activeTurn();
  if (action !== 'edit-cell' && !cellEditor.contains(button)) closeCell();
  try {
    switch (action) {
      case 'navigate':
        if (dialog.open) dialog.close();
        view = id;
        if (id === 'catalog') catalogScope = 'turn';
        render();
        document.querySelector('#page-title').focus({ preventScroll: true });
        window.scrollTo(0, 0);
        break;
      case 'new-turn':
        showTurnForm();
        break;
      case 'edit-turn':
        showTurnForm(turn);
        break;
      case 'edit-cell':
        openCell(turn, Number(button.dataset.slot), button.dataset.field);
        break;
      case 'more-rows':
        minimumRows = Math.min(maxSheetRows, document.querySelector('.sheet-grid tbody').rows.length + rowsPerSheet);
        render();
        break;
      case 'delete-record':
        closeCell();
        confirmAction('Eliminar movimiento', 'Se limpiará esta fila de la hoja del turno.', 'Limpiar fila', () => {
          updateTurn(turn.id, current => {
            current.records = [...sheetRecords(current.records).values()].filter(item => item.id !== id);
          });
          notify('Fila limpiada.');
        });
        break;
      case 'demo': {
        minimumRows = rowsPerSheet;
        const sample = demoTurn();
        updateState(next => { next.turns.push(sample); next.activeId = sample.id; });
        render();
        notify('Turno de ejemplo cargado.');
        break;
      }
      case 'activate-turn':
        updateState(next => {
          if (!next.turns.some(item => item.id === id)) throw new Error('El turno ya no está disponible.');
          next.activeId = id;
        });
        catalogScope = 'turn';
        minimumRows = rowsPerSheet;
        view = 'turn';
        render();
        break;
      case 'delete-turn':
        confirmAction('Eliminar turno', 'Se eliminará el turno de este dispositivo con todas sus anotaciones.', 'Eliminar turno', () => {
          updateState(next => {
            next.turns = next.turns.filter(item => item.id !== id);
            if (next.activeId === id) next.activeId = null;
          });
          notify('Turno eliminado.');
        });
        break;
      case 'finish':
        confirmAction('Finalizar turno', 'Se guardarán todas las anotaciones, incluidas las que tienen «Hasta» en blanco.', 'Finalizar y ver hoja', () => {
          updateTurn(turn.id, current => { current.closedAt = timestamp(); });
          view = 'report';
          notify('Turno finalizado.');
        }, 'primary');
        break;
      case 'reopen':
        updateTurn(turn.id, current => { current.closedAt = null; });
        render();
        notify('Turno reabierto.');
        break;
      case 'report':
        view = 'report';
        render();
        window.scrollTo(0, 0);
        break;
      case 'new-code':
        showCodeForm();
        break;
      case 'edit-code': {
        const code = scopedCatalog().find(item => item.id === id);
        if (code) showCodeForm(code);
        break;
      }
      case 'delete-code': {
        const scope = catalogScope;
        const turnId = state.activeId;
        confirmAction('Quitar código', 'Desaparecerá de la lista para nuevas anotaciones. Tus registros anteriores lo conservan.', 'Quitar código', () => {
          updateCatalog(scope, turnId, catalog => catalog.filter(item => item.id !== id));
          notify('Código quitado.');
        });
        break;
      }
      case 'png':
      case 'pdf':
        await exportReport(turn, action);
        break;
      case 'transfer':
        exportTransfer(turn);
        break;
      case 'import':
        importInput.click();
        break;
      case 'close-dialog':
        dialog.close();
        break;
      case 'install':
        if (installPrompt) {
          const prompt = installPrompt;
          installPrompt = null;
          await prompt.prompt();
          render();
        }
        break;
    }
  } catch (error) {
    notify(error.message || 'No se pudo completar esta operación.');
  }
});

document.addEventListener('input', event => {
  if (event.target.id !== 'code-search') return;
  const query = event.target.value.trim().toLowerCase();
  const rows = [...document.querySelectorAll('[data-code-search]')];
  for (const row of rows) row.hidden = !row.dataset.codeSearch.includes(query);
  const message = document.querySelector('#no-codes');
  if (message) message.hidden = rows.some(row => !row.hidden);
});

document.addEventListener('change', event => {
  if (event.target.id === 'paper-logo-select') {
    try {
      updateState(next => { next.paperLogo = event.target.value; });
    } catch (error) {
      notify(error.message);
    }
    render();
    document.querySelector('#paper-logo-select').focus({ preventScroll: true });
  } else if (event.target.id === 'catalog-scope') {
    catalogScope = event.target.value;
    render();
    document.querySelector('#catalog-scope').focus();
  }
});

dialog.addEventListener('close', () => {
  const expired = downloadUrls;
  downloadUrls = [];
  setTimeout(() => expired.forEach(url => URL.revokeObjectURL(url)), 30000);
});
importInput.addEventListener('change', () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (file) importRecord(file);
});
window.addEventListener('online', renderConnection);
window.addEventListener('offline', renderConnection);
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  if (view === 'turn' && !dialog.open) render();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  if (!dialog.open) render();
});
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) {
    state = loadState();
    render();
  }
});

document.addEventListener('pointerdown', event => {
  if (!editingCell) return;
  if (!cellEditor.contains(event.target)) {
    if (!event.target.closest('.sheet-cell')) closeCell();
  } else if (!event.target.closest('.clock-entry') && cellEditor.querySelector('.clock-picker:not([hidden])')) {
    showClockPicker(false);
  }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !editingCell) return;
  const toggle = cellEditor.querySelector('[data-cell-command="clock"][aria-expanded="true"]');
  if (toggle) {
    showClockPicker(false);
    toggle.focus({ preventScroll: true });
    event.preventDefault();
  } else {
    closeCell(true);
  }
});
window.addEventListener('resize', positionCellEditor);
window.visualViewport?.addEventListener('resize', positionCellEditor);
window.addEventListener('scroll', positionCellEditor, true);

render();
if (storeUnavailable) notify('Los registros guardados no están disponibles en este navegador.');
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    notify('La app no pudo preparar el acceso sin conexión en este navegador.');
  });
}
