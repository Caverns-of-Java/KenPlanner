const TASKS_SHEET = 'Tasks';
const JOURNAL_SHEET = 'Journal';

const TASK_COL = {
  id: 1,
  date: 2,
  description: 3,
  completed: 4,
  createdAt: 5,
  updatedAt: 6,
  status: 7,
};

const JOURNAL_COL = {
  date: 1,
  entry: 2,
  updatedAt: 3,
  version: 4,
};

function initializeSheets() {
  ensureSheetWithHeaders_(TASKS_SHEET, [
    'id',
    'date',
    'description',
    'completed',
    'created_at',
    'updated_at',
    'status',
  ]);

  ensureSheetWithHeaders_(JOURNAL_SHEET, [
    'date',
    'entry',
    'updated_at',
    'version',
  ]);
}

function doGet(e) {
  try {
    const endpoint = getEndpoint_(e);

    if (endpoint === 'ping') {
      return ok_({ now: new Date().toISOString() });
    }

    if (endpoint === 'week') {
      const start = (e.parameter.start || '').trim();
      if (!isIsoDate_(start)) {
        return err_('VALIDATION_ERROR', 'Invalid or missing start date (YYYY-MM-DD).');
      }
      return ok_(getWeekData_(start));
    }

    if (endpoint === 'year') {
      const year = (e.parameter.year || '').trim();
      if (!/^\d{4}$/.test(year)) {
        return err_('VALIDATION_ERROR', 'Invalid or missing year (YYYY).');
      }
      return ok_(getYearData_(year));
    }

    return err_('NOT_FOUND', 'Unknown endpoint.');
  } catch (error) {
    return err_('INTERNAL_ERROR', String(error));
  }
}

function doPost(e) {
  try {
    const endpoint = getEndpoint_(e);
    const payload = parsePayload_(e);

    if (!isAuthorized_(payload.secret)) {
      return err_('UNAUTHORIZED', 'Invalid shared secret.');
    }

    if (endpoint === 'auth-check') {
      return ok_({ authorized: true });
    }

    if (endpoint === 'task-add') {
      const date = (payload.date || '').trim();
      const description = (payload.description || '').trim();

      if (!isIsoDate_(date) || !description) {
        return err_('VALIDATION_ERROR', 'Task add requires date and description.');
      }

      const task = addTask_(date, description);
      return ok_({ task: task });
    }

    if (endpoint === 'task-update') {
      const id = (payload.id || '').trim();
      if (!id) {
        return err_('VALIDATION_ERROR', 'Task update requires id.');
      }

      const result = updateTask_(id, payload);
      return ok_({ task: result });
    }

    if (endpoint === 'task-delete') {
      const id = (payload.id || '').trim();
      if (!id) {
        return err_('VALIDATION_ERROR', 'Task delete requires id.');
      }

      softDeleteTask_(id);
      return ok_({ id: id });
    }

    if (endpoint === 'journal-update') {
      const date = (payload.date || '').trim();
      const entry = payload.entry === undefined ? '' : String(payload.entry);
      const expectedVersion = payload.expectedVersion;

      if (!isIsoDate_(date)) {
        return err_('VALIDATION_ERROR', 'Journal update requires date.');
      }

      const journal = upsertJournal_(date, entry, expectedVersion);
      return ok_({ journal: journal });
    }

    return err_('NOT_FOUND', 'Unknown endpoint.');
  } catch (error) {
    return err_('INTERNAL_ERROR', String(error));
  }
}

function getWeekData_(startIso) {
  const start = new Date(startIso + 'T00:00:00Z');
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const endIso = Utilities.formatDate(end, 'UTC', 'yyyy-MM-dd');

  const tasksSheet = getRequiredSheet_(TASKS_SHEET);
  const journalSheet = getRequiredSheet_(JOURNAL_SHEET);

  const taskValues = getDataRows_(tasksSheet);
  const journalValues = getDataRows_(journalSheet);

  const tasks = taskValues
    .filter((row) => {
      const date = normalizeIsoDate_(row[TASK_COL.date - 1]);
      const status = normalizeStatus_(row[TASK_COL.status - 1]);
      return status === 'ACTIVE' && inIsoRange_(date, startIso, endIso);
    })
    .map((row) => ({
      id: String(row[TASK_COL.id - 1] || ''),
      date: normalizeIsoDate_(row[TASK_COL.date - 1]),
      description: String(row[TASK_COL.description - 1] || ''),
      completed: toBool_(row[TASK_COL.completed - 1]),
      updated_at: String(row[TASK_COL.updatedAt - 1] || ''),
    }));

  const journals = {};
  journalValues.forEach((row) => {
    const date = normalizeIsoDate_(row[JOURNAL_COL.date - 1]);
    if (inIsoRange_(date, startIso, endIso)) {
      journals[date] = {
        date: date,
        entry: String(row[JOURNAL_COL.entry - 1] || ''),
        updated_at: String(row[JOURNAL_COL.updatedAt - 1] || ''),
        version: Number(row[JOURNAL_COL.version - 1] || 1),
      };
    }
  });

  return { tasks: tasks, journals: journals };
}

function getYearData_(year) {
  const prefix = year + '-';
  const tasksSheet = getRequiredSheet_(TASKS_SHEET);
  const journalSheet = getRequiredSheet_(JOURNAL_SHEET);

  const tasksByDate = {};
  getDataRows_(tasksSheet).forEach((row) => {
    const date = normalizeIsoDate_(row[TASK_COL.date - 1]);
    const status = normalizeStatus_(row[TASK_COL.status - 1]);
    if (!date.startsWith(prefix) || status !== 'ACTIVE') {
      return;
    }

    if (!tasksByDate[date]) {
      tasksByDate[date] = [];
    }

    tasksByDate[date].push({
      id: String(row[TASK_COL.id - 1] || ''),
      description: String(row[TASK_COL.description - 1] || ''),
      completed: toBool_(row[TASK_COL.completed - 1]),
      updated_at: String(row[TASK_COL.updatedAt - 1] || ''),
    });
  });

  const journalsByDate = {};
  getDataRows_(journalSheet).forEach((row) => {
    const date = normalizeIsoDate_(row[JOURNAL_COL.date - 1]);
    if (!date.startsWith(prefix)) {
      return;
    }

    journalsByDate[date] = {
      date: date,
      entry: String(row[JOURNAL_COL.entry - 1] || ''),
      updated_at: String(row[JOURNAL_COL.updatedAt - 1] || ''),
      version: Number(row[JOURNAL_COL.version - 1] || 1),
    };
  });

  return { tasksByDate: tasksByDate, journalsByDate: journalsByDate };
}

function addTask_(date, description) {
  const sheet = getRequiredSheet_(TASKS_SHEET);
  const now = new Date().toISOString();
  const id = Utilities.getUuid();

  sheet.appendRow([
    id,
    date,
    description,
    false,
    now,
    now,
    'ACTIVE',
  ]);

  return {
    id: id,
    date: date,
    description: description,
    completed: false,
    created_at: now,
    updated_at: now,
    status: 'ACTIVE',
  };
}

function updateTask_(id, payload) {
  const sheet = getRequiredSheet_(TASKS_SHEET);
  const row = findTaskRowById_(sheet, id);
  if (row < 2) {
    throw new Error('TASK_NOT_FOUND');
  }

  const now = new Date().toISOString();

  if (payload.description !== undefined) {
    sheet.getRange(row, TASK_COL.description).setValue(String(payload.description));
  }

  if (payload.completed !== undefined) {
    sheet.getRange(row, TASK_COL.completed).setValue(Boolean(payload.completed));
  }

  if (payload.status !== undefined) {
    sheet.getRange(row, TASK_COL.status).setValue(String(payload.status));
  }

  sheet.getRange(row, TASK_COL.updatedAt).setValue(now);

  const values = sheet.getRange(row, 1, 1, 7).getValues()[0];
  return {
    id: String(values[TASK_COL.id - 1]),
    date: String(values[TASK_COL.date - 1]),
    description: String(values[TASK_COL.description - 1]),
    completed: toBool_(values[TASK_COL.completed - 1]),
    created_at: String(values[TASK_COL.createdAt - 1]),
    updated_at: String(values[TASK_COL.updatedAt - 1]),
    status: String(values[TASK_COL.status - 1]),
  };
}

function softDeleteTask_(id) {
  updateTask_(id, { status: 'DELETED' });
}

function upsertJournal_(date, entry, expectedVersion) {
  const sheet = getRequiredSheet_(JOURNAL_SHEET);
  const row = findJournalRowByDate_(sheet, date);
  const now = new Date().toISOString();

  if (row < 2) {
    sheet.appendRow([date, entry, now, 1]);
    return { date: date, entry: entry, updated_at: now, version: 1 };
  }

  const currentVersion = Number(sheet.getRange(row, JOURNAL_COL.version).getValue() || 1);
  if (expectedVersion !== undefined && Number(expectedVersion) !== currentVersion) {
    throw new Error('STALE_WRITE');
  }

  const nextVersion = currentVersion + 1;
  sheet.getRange(row, JOURNAL_COL.entry).setValue(entry);
  sheet.getRange(row, JOURNAL_COL.updatedAt).setValue(now);
  sheet.getRange(row, JOURNAL_COL.version).setValue(nextVersion);

  return { date: date, entry: entry, updated_at: now, version: nextVersion };
}

function findTaskRowById_(sheet, id) {
  const values = getDataRows_(sheet);
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][TASK_COL.id - 1]) === id) {
      return i + 2;
    }
  }
  return -1;
}

function findJournalRowByDate_(sheet, date) {
  const values = getDataRows_(sheet);
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][JOURNAL_COL.date - 1]) === date) {
      return i + 2;
    }
  }
  return -1;
}

function getRequiredSheet_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) {
    throw new Error('MISSING_SHEET: ' + name);
  }
  return sheet;
}

function ensureSheetWithHeaders_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];

  const needsHeaders = headers.some((header, i) => String(existing[i] || '') !== header);
  if (needsHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.setFrozenRows(1);
}

function getDataRows_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return [];
  }
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
}

function inRange_(isoDate, start, end) {
  if (!isIsoDate_(isoDate)) {
    return false;
  }
  const date = new Date(isoDate + 'T00:00:00Z');
  return date >= start && date <= end;
}

function inIsoRange_(isoDate, startIso, endIso) {
  if (!isIsoDate_(isoDate) || !isIsoDate_(startIso) || !isIsoDate_(endIso)) {
    return false;
  }
  return isoDate >= startIso && isoDate <= endIso;
}

function isIsoDate_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeIsoDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, getAppTimeZone_(), 'yyyy-MM-dd');
  }

  const asString = String(value || '').trim();
  if (isIsoDate_(asString)) {
    return asString;
  }

  return '';
}

function normalizeStatus_(value) {
  const status = String(value || '').trim().toUpperCase();
  return status || 'ACTIVE';
}

function getAppTimeZone_() {
  try {
    const ss = SpreadsheetApp.getActive();
    if (ss) {
      return ss.getSpreadsheetTimeZone();
    }
  } catch (error) {
    // Fall back to script timezone when spreadsheet timezone cannot be read.
  }

  return Session.getScriptTimeZone() || 'UTC';
}

function toBool_(value) {
  return String(value).toLowerCase() === 'true' || value === true;
}

function getEndpoint_(e) {
  return ((e.parameter && e.parameter.endpoint) || '').trim();
}

function parsePayload_(e) {
  try {
    return JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (error) {
    throw new Error('PARSE_ERROR');
  }
}

function isAuthorized_(secret) {
  const expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!expected) {
    throw new Error('MISSING_SHARED_SECRET');
  }
  return String(secret || '') === expected;
}

function ok_(data) {
  return json_({ success: true, data: data });
}

function err_(code, message) {
  return json_({ success: false, error: code, message: message });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
