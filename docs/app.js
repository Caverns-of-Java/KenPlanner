const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzfV_2FEvqnA4PDALuB_5t7flqQFTX9pDQBvWege6xnWmXu0xILK-eZK1vwiTdaRfLc/exec';

const state = {
  apiBase: APPS_SCRIPT_URL.trim(),
  secret: '',
  weekStart: getMonday(new Date()),
  lastAutoScrolledWeekStart: null,
  selectedYear: new Date().getFullYear(),
  yearCache: new Map(),
};

const YEAR_CACHE_TTL_MS = 5 * 60 * 1000;
let passcodeResolver = null;
const TODAY_ISO = toIsoDate(new Date());

const el = {
  passcodeBtn: document.getElementById('passcodeBtn'),
  passcodeModal: document.getElementById('passcodeModal'),
  passcodeInput: document.getElementById('passcodeInput'),
  rememberPasscode: document.getElementById('rememberPasscode'),
  passcodeUnlockBtn: document.getElementById('passcodeUnlockBtn'),
  passcodeCloseBtn: document.getElementById('passcodeCloseBtn'),
  weeklyTab: document.getElementById('weeklyTab'),
  yearlyTab: document.getElementById('yearlyTab'),
  weeklyView: document.getElementById('weeklyView'),
  yearlyView: document.getElementById('yearlyView'),
  weekLabel: document.getElementById('weekLabel'),
  yearLabel: document.getElementById('yearLabel'),
  prevWeekBtn: document.getElementById('prevWeekBtn'),
  nextWeekBtn: document.getElementById('nextWeekBtn'),
  prevYearBtn: document.getElementById('prevYearBtn'),
  nextYearBtn: document.getElementById('nextYearBtn'),
  refreshYearBtn: document.getElementById('refreshYearBtn'),
  weekGrid: document.getElementById('weekGrid'),
  yearGrid: document.getElementById('yearGrid'),
  statusChip: document.getElementById('statusChip'),
  statusBar: document.getElementById('statusBar'),
};

init().catch((error) => {
  setStatus(`Startup failed: ${error.message}`);
});

async function init() {
  el.passcodeBtn.addEventListener('click', async () => {
    await openPasscodeModal(false);
  });

  el.passcodeUnlockBtn.addEventListener('click', savePasscode);
  el.passcodeCloseBtn.addEventListener('click', () => closePasscodeModal(true));

  el.weeklyTab.addEventListener('click', () => setView('weekly'));
  el.yearlyTab.addEventListener('click', () => setView('yearly'));

  el.prevWeekBtn.addEventListener('click', async () => {
    state.weekStart = addDays(state.weekStart, -7);
    await renderWeek();
  });

  el.nextWeekBtn.addEventListener('click', async () => {
    state.weekStart = addDays(state.weekStart, 7);
    await renderWeek();
  });

  el.prevYearBtn.addEventListener('click', async () => {
    state.selectedYear -= 1;
    await renderYear();
  });

  el.nextYearBtn.addEventListener('click', async () => {
    state.selectedYear += 1;
    await renderYear();
  });

  el.refreshYearBtn.addEventListener('click', async () => {
    state.yearCache.delete(state.selectedYear);
    await renderYear();
  });

  if (!state.apiBase) {
    setStatus('Set APPS_SCRIPT_URL in app.js, then reload.');
    return;
  }

  hydrateSecret();
  updatePasscodeButton();

  setView('weekly');
  await renderWeek();

  if (!state.secret) {
    setStatus('Read-only mode. Add/update/delete will prompt for passcode.');
  }
}

function setView(view) {
  const weekly = view === 'weekly';
  el.weeklyTab.classList.toggle('active', weekly);
  el.yearlyTab.classList.toggle('active', !weekly);
  el.weeklyView.classList.toggle('active', weekly);
  el.yearlyView.classList.toggle('active', !weekly);

  if (!weekly) {
    renderYear();
  }
}

async function renderWeek() {
  try {
    const startIso = toIsoDate(state.weekStart);
    const endIso = toIsoDate(addDays(state.weekStart, 6));
    const isCurrentWeek = TODAY_ISO >= startIso && TODAY_ISO <= endIso;
    el.weekLabel.textContent = `${formatWeeklyDate(startIso)} to ${formatWeeklyDate(endIso)}`;
    setStatus('Loading week...');

    const result = await apiGet('week', { start: startIso });
    const tasksByDate = groupByDate(result.tasks || []);
    const journals = result.journals || {};

    const frag = document.createDocumentFragment();
    for (let i = 0; i < 7; i += 1) {
      const date = toIsoDate(addDays(state.weekStart, i));
      frag.appendChild(createDayCard(date, tasksByDate[date] || [], journals[date] || null));
    }

    el.weekGrid.replaceChildren(frag);

    if (isCurrentWeek && state.lastAutoScrolledWeekStart !== startIso) {
      state.lastAutoScrolledWeekStart = startIso;
      requestAnimationFrame(() => {
        const todayCard = el.weekGrid.querySelector('.day-card.today');
        if (todayCard) {
          todayCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
      });
    }

    if (!isCurrentWeek) {
      state.lastAutoScrolledWeekStart = null;
    }

    setStatus('Week loaded.');
  } catch (error) {
    setStatus(`Week load failed: ${error.message}`);
  }
}

function createDayCard(date, tasks, journal) {
  const card = document.createElement('article');
  card.className = 'day-card';
  if (date === TODAY_ISO) {
    card.classList.add('today');
  }

  const title = document.createElement('h3');
  title.textContent = formatWeeklyDate(date);

  const list = document.createElement('ul');
  list.className = 'tasks';
  tasks.forEach((task) => list.appendChild(createTaskRow(task)));
  if (tasks.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'task-empty';
    empty.textContent = 'No tasks for this day.';
    list.appendChild(empty);
  }

  const newTaskInput = document.createElement('input');
  newTaskInput.placeholder = 'New task';

  const addTaskBtn = document.createElement('button');
  addTaskBtn.className = 'add-task-btn';
  addTaskBtn.setAttribute('aria-label', 'Add Task');
  addTaskBtn.innerHTML = `${plusIconSvg()}<span class="btn-label">Add Task</span>`;
  addTaskBtn.addEventListener('click', async () => {
    if (addTaskBtn.disabled) {
      return;
    }

    const description = newTaskInput.value.trim();
    if (!description) return;

    try {
      setButtonBusy(addTaskBtn, true);
      setStatus('Adding task...');
      await apiPost('task-add', { date, description });
      newTaskInput.value = '';
      setStatus('Task added.');
      await renderWeek();
      state.yearCache.delete(state.selectedYear);
    } catch (error) {
      setStatus(`Add task failed: ${error.message}`);
    } finally {
      setButtonBusy(addTaskBtn, false);
    }
  });

  const journalBox = document.createElement('textarea');
  journalBox.className = 'journal-box';
  journalBox.value = journal?.entry || '';
  journalBox.placeholder = 'Journal...';

  const saveJournalBtn = document.createElement('button');
  saveJournalBtn.className = 'save-journal-btn';
  saveJournalBtn.textContent = 'Save Journal';
  const saveJournal = async () => {
    if (saveJournalBtn.disabled) {
      return;
    }
    try {
      setButtonBusy(saveJournalBtn, true);
      setStatus('Saving journal...');
      await apiPost('journal-update', {
        date,
        entry: journalBox.value,
        expectedVersion: journal?.version,
      });
      setStatus('Journal saved.');
      await renderWeek();
      state.yearCache.delete(state.selectedYear);
    } catch (error) {
      setStatus(`Journal save failed: ${error.message}`);
    } finally {
      setButtonBusy(saveJournalBtn, false);
    }
  };
  saveJournalBtn.addEventListener('click', saveJournal);
  journalBox.addEventListener('blur', saveJournal);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  actions.appendChild(newTaskInput);
  actions.appendChild(addTaskBtn);

  const taskSection = document.createElement('div');
  taskSection.className = 'task-section';
  taskSection.appendChild(actions);
  taskSection.appendChild(list);

  const contentContainer = document.createElement('div');
  contentContainer.className = 'contentContainer';
  contentContainer.appendChild(journalBox);
  contentContainer.appendChild(taskSection);

  card.appendChild(title);
  card.appendChild(contentContainer);
  card.appendChild(saveJournalBtn);
  return card;
}

function createTaskRow(task) {
  const item = document.createElement('li');
  item.className = `task-row ${task.completed ? 'done' : ''}`;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.addEventListener('change', async () => {
    try {
      await apiPost('task-update', { id: task.id, completed: checkbox.checked });
      await renderWeek();
      state.yearCache.delete(state.selectedYear);
    } catch (error) {
      setStatus(`Task update failed: ${error.message}`);
    }
  });

  const text = document.createElement('span');
  text.textContent = task.description;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-task-btn';
  deleteBtn.setAttribute('aria-label', 'Delete Task');
  deleteBtn.innerHTML = `${trashIconSvg()}<span class="btn-label">Delete</span>`;
  deleteBtn.addEventListener('click', async () => {
    if (deleteBtn.disabled) {
      return;
    }

    try {
      setButtonBusy(deleteBtn, true);
      setStatus('Deleting task...');
      await apiPost('task-delete', { id: task.id });
      setStatus('Task deleted.');
      await renderWeek();
      state.yearCache.delete(state.selectedYear);
    } catch (error) {
      setStatus(`Task delete failed: ${error.message}`);
    } finally {
      setButtonBusy(deleteBtn, false);
    }
  });

  item.appendChild(checkbox);
  item.appendChild(text);
  item.appendChild(deleteBtn);
  return item;
}

async function renderYear() {
  try {
    disableAllButtons(true);
    el.yearLabel.textContent = String(state.selectedYear);
    setStatus('Loading year...');

    const yearData = await getYearData(state.selectedYear);
    const tasksByDate = yearData.tasksByDate || {};
    const journalsByDate = yearData.journalsByDate || {};

    const frag = document.createDocumentFragment();
    for (let month = 0; month < 12; month += 1) {
      frag.appendChild(createMonth(state.selectedYear, month, tasksByDate, journalsByDate));
    }

    el.yearGrid.replaceChildren(frag);
    setStatus('Year loaded.');
  } catch (error) {
    setStatus(`Year load failed: ${error.message}`);
  } finally {
    disableAllButtons(false);
  }
}

function createMonth(year, month, tasksByDate, journalsByDate) {
  const wrap = document.createElement('section');
  wrap.className = 'month';

  const label = document.createElement('h3');
  label.textContent = new Date(Date.UTC(year, month, 1)).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const days = document.createElement('div');
  days.className = 'month-days';

  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let day = 1; day <= count; day += 1) {
    const date = toIsoDate(new Date(Date.UTC(year, month, day)));

    const cell = document.createElement('button');
    cell.className = 'day-cell';
    if (date === TODAY_ISO) {
      cell.classList.add('today');
    }
    cell.type = 'button';
    const taskCount = (tasksByDate[date] || []).length;
    const hasJournal = Boolean(journalsByDate[date]?.entry);

    const dateLabel = document.createElement('div');
    dateLabel.className = 'n';
    dateLabel.textContent = formatYearlyDate(date);

    const summary = document.createElement('div');
    summary.className = 's';
    if (taskCount === 0 && hasJournal) {
      summary.textContent = 'Journal only';
    } else {
      summary.textContent = `${taskCount} task${taskCount === 1 ? '' : 's'}${hasJournal ? ' | journal' : ''}`;
    }

    cell.appendChild(dateLabel);
    cell.appendChild(summary);

    cell.addEventListener('click', async () => {
      state.weekStart = getMonday(new Date(`${date}T00:00:00Z`));
      setView('weekly');
      await renderWeek();
    });

    days.appendChild(cell);
  }

  wrap.appendChild(label);
  wrap.appendChild(days);
  return wrap;
}

async function getYearData(year) {
  const cached = state.yearCache.get(year);
  if (cached && Date.now() - cached.at < YEAR_CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await apiGet('year', { year: String(year) });
  state.yearCache.set(year, { at: Date.now(), data });
  return data;
}

async function apiGet(endpoint, query = {}) {
  assertApiBase();

  const url = new URL(state.apiBase);
  url.searchParams.set('endpoint', endpoint);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), { method: 'GET' });
  const payload = await res.json();
  return unwrap(payload);
}

async function apiPost(endpoint, body) {
  assertApiBase();
  await ensureSecret();

  const url = new URL(state.apiBase);
  url.searchParams.set('endpoint', endpoint);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, secret: state.secret }),
  });

  const payload = await res.json();

  if (payload?.error === 'UNAUTHORIZED') {
    clearSecret();
    await ensureSecret();

    const retryRes = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, secret: state.secret }),
    });
    const retryPayload = await retryRes.json();
    return unwrap(retryPayload);
  }

  return unwrap(payload);
}

function unwrap(payload) {
  if (!payload || !payload.success) {
    throw new Error(payload?.error || 'UNKNOWN_ERROR');
  }
  return payload.data;
}

function assertApiBase() {
  if (!state.apiBase) {
    throw new Error('Missing APPS_SCRIPT_URL in app.js');
  }
}

async function ensureSecret() {
  if (state.secret) {
    return;
  }
  await openPasscodeModal(true);
  if (!state.secret) {
    throw new Error('Passcode is required for write actions.');
  }
}

function savePasscode() {
  const passcode = el.passcodeInput.value.trim();
  if (!passcode) {
    setStatus('Please enter your passcode.');
    return;
  }

  validateAndStorePasscode(passcode).catch((error) => {
    setStatus(`Passcode check failed: ${error.message}`);
  });
}

function openPasscodeModal(required) {
  el.passcodeInput.value = '';
  el.rememberPasscode.checked = true;
  el.passcodeModal.classList.remove('hidden');
  el.passcodeCloseBtn.disabled = required;
  return new Promise((resolve) => {
    passcodeResolver = resolve;
    requestAnimationFrame(() => el.passcodeInput.focus());
  });
}

function closePasscodeModal(cancelled) {
  el.passcodeModal.classList.add('hidden');
  if (passcodeResolver) {
    const resolver = passcodeResolver;
    passcodeResolver = null;
    resolver(!cancelled);
  }
}

async function validateAndStorePasscode(passcode) {
  const url = new URL(state.apiBase);
  url.searchParams.set('endpoint', 'auth-check');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: passcode }),
  });

  const payload = await res.json();
  unwrap(payload);

  state.secret = passcode;
  sessionStorage.setItem('kp.secret', passcode);
  if (el.rememberPasscode.checked) {
    localStorage.setItem('kp.secret', passcode);
  } else {
    localStorage.removeItem('kp.secret');
  }

  updatePasscodeButton();
  closePasscodeModal(false);
  setStatus('Passcode accepted.');
}

function hydrateSecret() {
  const saved = sessionStorage.getItem('kp.secret') || localStorage.getItem('kp.secret');
  if (saved) {
    state.secret = saved;
  }
}

function clearSecret() {
  state.secret = '';
  sessionStorage.removeItem('kp.secret');
  localStorage.removeItem('kp.secret');
  updatePasscodeButton();
}

function updatePasscodeButton() {
  if (!el.passcodeBtn) {
    return;
  }

  el.passcodeBtn.hidden = Boolean(state.secret);
}

function setButtonBusy(button, isBusy) {
  button.disabled = isBusy;
  button.classList.toggle('is-busy', isBusy);
}

function disableAllButtons(disabled) {
  // Disable year navigation buttons (keep week nav enabled for quick flicking)
  el.prevYearBtn.disabled = disabled;
  el.nextYearBtn.disabled = disabled;
  el.refreshYearBtn.disabled = disabled;
  el.weeklyTab.disabled = disabled;
  el.yearlyTab.disabled = disabled;

  // Disable all dynamically created buttons
  document.querySelectorAll('.add-task-btn, .save-journal-btn, .delete-task-btn, .day-cell').forEach((btn) => {
    btn.disabled = disabled;
  });
}

function formatWeeklyDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = date.toLocaleString(undefined, { weekday: 'short', timeZone: 'UTC' });
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${weekday} ${year}年${month}月${day}日`;
}

function formatYearlyDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = date.toLocaleString(undefined, { weekday: 'short', timeZone: 'UTC' });
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${weekday} ${day}日`;
}

function groupByDate(tasks) {
  const out = {};
  tasks.forEach((task) => {
    if (!out[task.date]) out[task.date] = [];
    out[task.date].push(task);
  });
  return out;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const clone = new Date(date);
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

function getMonday(date) {
  const clone = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = clone.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  clone.setUTCDate(clone.getUTCDate() + offset);
  return clone;
}

function setStatus(message, kind = inferStatusKind(message)) {
  el.statusBar.textContent = message;

  if (!el.statusChip) {
    return;
  }

  const normalized = kind === 'loading' || kind === 'error' ? kind : 'ready';
  el.statusChip.classList.remove('loading', 'ready', 'error');
  el.statusChip.classList.add(normalized);
  el.statusChip.textContent = normalized;
}

function inferStatusKind(message) {
  const text = String(message || '').toLowerCase();

  if (
    text.includes('loading') ||
    text.includes('adding') ||
    text.includes('deleting') ||
    text.includes('saving')
  ) {
    return 'loading';
  }

  if (
    text.includes('failed') ||
    text.includes('error') ||
    text.includes('unauthorized') ||
    text.includes('required')
  ) {
    return 'error';
  }

  return 'ready';
}

function plusIconSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-plus btn-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/></svg>';
}

function trashIconSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash btn-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>';
}

// Register service worker for PWA install prompt
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
