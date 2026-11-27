import {
  dateWithWords, demoTurn, durationLabel, emptyState, minutesBetween, newId, nowLocal,
  readTransfer, shiftDate, shortDate, sortedCodes, sortedRecords, storageKey, timestamp, transfer,
  validCodeNumber, validDate, validTime,
} from './model.js';
import { filenameFor, pdfFile, pngFiles, reportPages } from './report.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const importInput = document.querySelector('#import-file');
const toast = document.querySelector('#toast');
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

function render() {
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
  if (view === 'report' && turn) {
    currentPages = reportPages(turn);
    document.querySelector('#report-pages').replaceChildren(...currentPages);
  }
}

function renderConnection() {
  const status = document.querySelector('#connection');
  if (status) status.innerHTML = navigator.onLine
    ? '<span class="status-dot"></span>En línea'
    : '<span class="status-dot offline"></span>Sin conexión';
}

function renderTurn(turn) {
  if (!turn) {
    return heading('Turno de descarga', 'Registra demoras y maniobras por bodega.')
      + `<section class="overview"><div class="empty-overview">
        <p class="kicker">Bitácora del turno</p><h2 class="overview-title">Abre un turno</h2>
        <p>Ingresa los datos del buque una vez y agrega las anotaciones durante la descarga.</p>
        <div class="actions">${button('Nuevo turno', 'new-turn', 'mint', 'plus')} ${button('Importar registro', 'import', 'outline-light', 'down')}</div></div>
      </section>
      <section class="card history"><header class="card-heading"><h2>Movimientos del turno</h2></header>
      ${emptyPanel('clipboard', 'Sin movimientos', 'Abre un turno para registrar, o carga un ejemplo para probar la bitácora.', button('Cargar turno de ejemplo', 'demo', 'plain'))}</section>
      ${installPrompt ? `<div class="turn-footer">${button('Instalar app', 'install', 'secondary', 'down')}</div>` : ''}`;
  }

  const recordAction = turn.closedAt ? '' : button('Registrar movimiento', 'new-record', 'primary', 'plus', '', 'desktop-only');
  const data = [
    ['Producto', turn.product], ['Inspector', turn.inspector], ['Cliente', turn.client], ['Bodegas', turn.holdCount], ['Fecha', shortDate(turn.date)],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value || '—')}</dd></div>`).join('');
  return heading('Turno de descarga', '', recordAction)
    + `<section class="overview">
        <div><p class="kicker">${turn.closedAt ? 'Turno finalizado' : 'Turno en curso'}</p><h2 class="overview-title">${esc(turn.ship)}</h2><dl class="overview-dl">${data}</dl></div>
        <div class="actions">${button('Hoja del turno', 'report', 'mint', 'file')} ${button('Editar datos', 'edit-turn', 'outline-light', 'edit')}</div>
      </section>
      <section class="card history"><header class="card-heading"><div><h2>Movimientos del turno</h2></div><span class="badge">${countLabel(turn.records.length)}</span></header>
        ${turn.records.length ? renderRecords(turn) : emptyPanel('clock', 'Sin movimientos registrados', 'Las anotaciones de este turno aparecerán aquí.')}
      </section>
      <div class="turn-footer">
        ${button('Transferir registro', 'transfer', 'secondary', 'transfer')}
        ${turn.closedAt ? button('Reabrir turno', 'reopen', 'plain') : button('Finalizar turno', 'finish', 'plain', 'check')}
        ${installPrompt ? button('Instalar app', 'install', 'secondary', 'down') : ''}
      </div>
      ${turn.closedAt ? '' : button('Registrar movimiento', 'new-record', 'primary', 'plus', '', 'mobile-only mobile-action')}`;
}

function renderRecords(turn) {
  const rows = sortedRecords(turn.records).map(record => `<tr>
    <td class="row-start time"><span class="inline-label">Desde</span>${record.time}${record.date === turn.date ? '' : `<span class="row-date">${shortDate(record.date)}</span>`}</td>
    <td class="row-end time">${record.endTime ? `<span class="inline-label">Hasta</span>${record.endTime}${record.endDate !== record.date ? `<span class="row-date">${shortDate(record.endDate)}</span>` : ''}` : ''}</td>
    <td class="row-holds"><span class="inline-label">Bodegas</span><div class="hold-badges">${record.holds.map(hold => `<span class="badge bodega">${hold}</span>`).join('')}</div></td>
    <td class="row-movement"><span class="badge">${esc(record.code)}</span> <span class="movement-name">${esc(record.name)}</span></td>
    <td class="row-duration time">${durationLabel(minutesBetween(record))}</td>
    <td class="row-action">${iconButton('Editar movimiento', 'edit-record', 'edit', record.id)}</td>
  </tr>`).join('');
  return `<div class="table-shell record-list"><table aria-label="Movimientos del turno"><thead><tr>
    <th scope="col">Desde</th><th scope="col">Hasta</th><th scope="col">Bodegas</th><th scope="col">Movimiento</th><th scope="col">Duración</th><th scope="col"><span class="inline-label">Editar</span></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
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
    button('Imagen PNG', 'png', 'secondary', 'picture') + button('PDF', 'pdf', 'primary', 'file'))
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

function showTurnForm(turn = null) {
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
    notify(turn ? 'Datos del turno actualizados.' : 'Turno creado.');
  });
}

function showRecordForm(turn, record = null) {
  const catalog = sortedCodes(catalogFor(turn));
  const now = nowLocal();
  if (!record && !catalog.length) {
    openDialog('Agrega un código', `<p>El catálogo está vacío. Agrega un código antes de registrar un movimiento.</p>
      <div class="modal-actions">${button('Abrir códigos', 'navigate', 'primary', 'tag', 'catalog')}</div>`);
    return;
  }

  const holds = Array.from({ length: turn.holdCount }, (_, index) => {
    const number = index + 1;
    return `<label class="hold-choice"><input type="checkbox" name="hold" value="${number}" aria-label="Bodega ${number}" ${record?.holds.includes(number) ? 'checked' : ''}><span>${number}</span></label>`;
  }).join('');
  const catalogOptions = catalog.filter(code => !record || code.id !== record.codeId
    || code.number !== record.code || code.name !== record.name);
  const options = catalogOptions.map(code => `<option value="code:${esc(code.id)}">${esc(code.number + ' · ' + code.name)}</option>`).join('');
  const startingOption = record
    ? `<option value="saved" selected>${esc(record.code + ' · ' + record.name)} (guardado)</option>`
    : '<option value="" disabled selected>Selecciona un movimiento</option>';
  const date = record?.date ?? now.date;
  const fields = [
    `<fieldset class="full"><legend>Bodegas</legend><div class="hold-picker">${holds}</div></fieldset>`,
    `<label class="field full">Movimiento<select name="movement" required>${startingOption}${options}</select></label>`,
    field('Fecha de inicio', 'date', date, { type: 'date', attributes: 'required' }),
    field('Desde', 'time', record?.time ?? now.time, { type: 'time', attributes: 'required' }),
    field('Hasta (opcional)', 'endTime', record?.endTime, { type: 'time' }),
    field('Fecha de fin', 'endDate', record?.endDate || date, { type: 'date', attributes: record?.endTime ? '' : 'disabled' }),
    '<p class="field-note full" id="end-note">Puedes dejar «Hasta» en blanco.</p>',
  ].join('');

  const form = showForm(record ? 'Editar movimiento' : 'Registrar movimiento', fields, data => {
    const selected = data.get('movement');
    const date = data.get('date');
    const time = data.get('time');
    const endTime = data.get('endTime');
    const endDate = endTime ? data.get('endDate') : '';
    const holds = data.getAll('hold').map(Number);
    if (!holds.length) throw new Error('Selecciona al menos una bodega.');
    if (!validDate(date) || !validTime(time) || endTime && (!validDate(endDate) || !validTime(endTime))) {
      throw new Error('Revisa las fechas y horas del movimiento.');
    }
    if (minutesBetween({ date, time, endDate, endTime }) < 0) throw new Error('La fecha y hora de fin deben ser iguales o posteriores al inicio.');
    updateTurn(turn.id, (current, next) => {
      if (!record && current.closedAt) throw new Error('Reabre el turno antes de agregar movimientos.');
      if (holds.some(hold => hold > current.holdCount)) throw new Error('Una bodega seleccionada ya no está disponible.');
      const previous = current.records.find(item => item.id === record?.id);
      if (record && !previous) throw new Error('La anotación ya no está disponible.');
      const code = (current.catalog ?? next.catalog).find(item => 'code:' + item.id === selected);
      const snapshot = selected === 'saved' && previous
        ? { codeId: previous.codeId, code: previous.code, name: previous.name }
        : code && { codeId: code.id, code: code.number, name: code.name };
      if (!snapshot) throw new Error('Selecciona un código disponible.');
      const row = { id: previous?.id ?? newId(), date, time, endDate, endTime, holds, ...snapshot };
      if (previous) Object.assign(previous, row);
      else current.records.push(row);
    });
    notify(record ? 'Movimiento actualizado.' : 'Movimiento registrado.');
  }, record ? button('Eliminar', 'delete-record', 'plain', 'trash', record.id, 'push') : '');

  const { date: startDay, time: startTime, endDate, endTime } = form.elements;
  let manualEndDate = Boolean(record?.endTime);
  const endNote = form.querySelector('#end-note');
  function updateEnd() {
    endDate.disabled = !endTime.value;
    endDate.required = Boolean(endTime.value);
    if (!manualEndDate && validDate(startDay.value)) {
      const overnight = endTime.value && startTime.value && endTime.value < startTime.value;
      if (overnight) {
        const nextDate = shiftDate(startDay.value, 1);
        endDate.value = validDate(nextDate) ? nextDate : '';
      } else {
        endDate.value = startDay.value;
      }
      endNote.textContent = overnight
        ? 'Se sugirió el día siguiente. Puedes cambiar la fecha de fin.'
        : 'Puedes dejar «Hasta» en blanco.';
    }
  }
  endDate.addEventListener('input', () => {
    manualEndDate = true;
    endNote.textContent = 'Puedes dejar «Hasta» en blanco.';
  });
  for (const input of [startDay, startTime, endTime]) input.addEventListener('input', updateEnd);
}

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

function exportReport(turn, format) {
  const pages = currentPages.length ? currentPages : reportPages(turn);
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
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const turn = activeTurn();
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
      case 'new-record':
        showRecordForm(turn);
        break;
      case 'edit-record': {
        const record = turn.records.find(item => item.id === id);
        if (record) showRecordForm(turn, record);
        break;
      }
      case 'delete-record':
        confirmAction('Eliminar movimiento', 'Se quitará esta anotación de la hoja del turno.', 'Eliminar movimiento', () => {
          updateTurn(turn.id, current => { current.records = current.records.filter(item => item.id !== id); });
          notify('Movimiento eliminado.');
        });
        break;
      case 'demo': {
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
        exportReport(turn, action);
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
  if (event.target.id === 'catalog-scope') {
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

render();
if (storeUnavailable) notify('Los registros guardados no están disponibles en este navegador.');
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    notify('La app no pudo preparar el acceso sin conexión en este navegador.');
  });
}
