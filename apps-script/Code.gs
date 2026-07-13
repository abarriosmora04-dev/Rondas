/**
 * Rondas - backend en Google Apps Script.
 *
 * Este fichero contiene: el esquema de las hojas, las funciones genericas de
 * lectura/escritura sobre la Google Sheet, el enrutador doGet/doPost, y los
 * manejadores de cada accion (checkpoints, scans, shifts, alerts, users,
 * ajustes de rondas). La logica de turnos/heartbeat y el envio de emails
 * vive en Scheduler.gs; el login y las sesiones en Auth.gs; la creacion
 * inicial de las hojas en Setup.gs. Todos los ficheros comparten el mismo
 * ambito global (asi funciona un proyecto de Apps Script), por lo que no
 * hace falta ningun require/import entre ellos.
 */

var SHEETS_SCHEMA = {
  Users: ['id', 'name', 'username', 'passwordHash', 'salt', 'role', 'createdAt'],
  Checkpoints: ['id', 'name', 'code', 'active', 'order', 'createdAt'],
  Scans: ['id', 'checkpointId', 'guardId', 'timestamp'],
  Shifts: ['id', 'guardId', 'guardName', 'startedAt', 'endedAt'],
  Alerts: ['id', 'type', 'message', 'meta', 'createdAt', 'acknowledged'],
  RoundsHistory: ['id', 'slotStart', 'slotEnd', 'status', 'scannedIds', 'missing'],
  Sessions: ['token', 'userId', 'createdAt', 'expiresAt'],
  Settings: ['key', 'value'],
};

// ---------------------------------------------------------------------------
// Acceso genérico a las hojas (cada fila se lee/escribe como un objeto plano
// usando la cabecera de la hoja como nombres de campo).
// ---------------------------------------------------------------------------

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Hoja no encontrada: ' + name + '. Ejecuta initSheets() primero.');
  return sh;
}

function headerRow_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0];
}

function readAll_(name) {
  var sh = getSheet_(name);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var headers = headerRow_(sh);
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (row[0] === '' || row[0] === null || row[0] === undefined) continue; // fila en blanco
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = row[j];
    out.push(obj);
  }
  return out;
}

function appendRow_(name, obj) {
  var sh = getSheet_(name);
  var headers = headerRow_(sh);
  var row = headers.map(function (h) {
    return obj[h] !== undefined ? obj[h] : '';
  });
  sh.appendRow(row);
  return obj;
}

function findRowIndex_(sh, headers, idColName, id) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  var idColIndex = headers.indexOf(idColName);
  var ids = sh.getRange(2, idColIndex + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // fila 1-based
  }
  return -1;
}

function updateById_(name, id, patch) {
  var sh = getSheet_(name);
  var headers = headerRow_(sh);
  var rowNum = findRowIndex_(sh, headers, 'id', id);
  if (rowNum === -1) return null;
  var range = sh.getRange(rowNum, 1, 1, headers.length);
  var values = range.getValues()[0];
  var obj = {};
  for (var i = 0; i < headers.length; i++) obj[headers[i]] = values[i];
  Object.keys(patch).forEach(function (k) {
    if (headers.indexOf(k) !== -1) obj[k] = patch[k];
  });
  var newRow = headers.map(function (h) {
    return obj[h] !== undefined ? obj[h] : '';
  });
  range.setValues([newRow]);
  return obj;
}

function deleteById_(name, id) {
  var sh = getSheet_(name);
  var headers = headerRow_(sh);
  var rowNum = findRowIndex_(sh, headers, 'id', id);
  if (rowNum === -1) return false;
  sh.deleteRow(rowNum);
  return true;
}

function getSetting_(key, defaultValue) {
  var sh = getSheet_('Settings');
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var data = sh.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === key) return data[i][1];
    }
  }
  return defaultValue;
}

function setSetting_(key, value) {
  var sh = getSheet_('Settings');
  var lastRow = sh.getLastRow();
  var rowNum = -1;
  if (lastRow >= 2) {
    var data = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === key) {
        rowNum = i + 2;
        break;
      }
    }
  }
  if (rowNum === -1) {
    sh.appendRow([key, value]);
  } else {
    sh.getRange(rowNum, 2).setValue(value);
  }
}

function uniq_(arr) {
  var seen = {};
  var out = [];
  arr.forEach(function (x) {
    if (!seen[x]) {
      seen[x] = true;
      out.push(x);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Enrutador HTTP
// ---------------------------------------------------------------------------

function extractParams_(e) {
  var params = {};
  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (k) {
      params[k] = e.parameter[k];
    });
  }
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      Object.keys(body).forEach(function (k) {
        params[k] = body[k];
      });
    } catch (err) {
      // El cuerpo no era JSON: se ignora y se usan solo los parametros de query.
    }
  }
  return params;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return route_(e);
}

function doPost(e) {
  return route_(e);
}

function route_(e) {
  var params = extractParams_(e);
  var action = params.action;
  try {
    if (!action) throw new Error('Falta el parametro action');
    var spec = ROUTES[action];
    if (!spec) throw new Error('Accion no reconocida: ' + action);
    var user = null;
    if (spec.auth) {
      user = getUserByToken_(params.token);
      if (spec.roles && spec.roles.indexOf(user.role) === -1) {
        throw new Error('No autorizado');
      }
    }
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var data = spec.handler(params, user);
      return jsonOutput_({ ok: true, data: data });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonOutput_({ ok: false, error: (err && err.message) || String(err) });
  }
}

var ROUTES = {
  ping: { auth: false, handler: function () { return { pong: true, time: Date.now() }; } },
  login: { auth: false, handler: handleLogin_ },
  me: { auth: true, handler: handleMe_ },

  'checkpoints.list': { auth: true, handler: handleCheckpointsList_ },
  'checkpoints.create': { auth: true, roles: ['supervisor'], handler: handleCheckpointsCreate_ },
  'checkpoints.update': { auth: true, roles: ['supervisor'], handler: handleCheckpointsUpdate_ },
  'checkpoints.delete': { auth: true, roles: ['supervisor'], handler: handleCheckpointsDelete_ },

  'scans.lookup': { auth: true, handler: handleScansLookup_ },
  'scans.create': { auth: true, roles: ['guard'], handler: handleScansCreate_ },
  'scans.currentRound': { auth: true, handler: handleScansCurrentRound_ },
  'scans.mine': { auth: true, roles: ['guard'], handler: handleScansMine_ },

  'shifts.current': { auth: true, handler: handleShiftsCurrent_ },
  'shifts.start': { auth: true, roles: ['guard'], handler: handleShiftsStart_ },
  'shifts.end': { auth: true, roles: ['guard'], handler: handleShiftsEnd_ },
  'shifts.panic': { auth: true, roles: ['guard'], handler: handleShiftsPanic_ },
  'shifts.history': { auth: true, roles: ['supervisor'], handler: handleShiftsHistory_ },

  'alerts.list': { auth: true, roles: ['supervisor'], handler: handleAlertsList_ },
  'alerts.ack': { auth: true, roles: ['supervisor'], handler: handleAlertsAck_ },

  'users.list': { auth: true, roles: ['supervisor'], handler: handleUsersList_ },
  'users.create': { auth: true, roles: ['supervisor'], handler: handleUsersCreate_ },
  'users.delete': { auth: true, roles: ['supervisor'], handler: handleUsersDelete_ },

  'rounds.history': { auth: true, roles: ['supervisor'], handler: handleRoundsHistory_ },
  'rounds.settingsGet': { auth: true, handler: handleRoundsSettingsGet_ },
  'rounds.settingsUpdate': { auth: true, roles: ['supervisor'], handler: handleRoundsSettingsUpdate_ },
};

// ---------------------------------------------------------------------------
// Puntos de control
// ---------------------------------------------------------------------------

function handleCheckpointsList_() {
  var list = readAll_('Checkpoints');
  list.sort(function (a, b) {
    return a.order - b.order;
  });
  return list;
}

function handleCheckpointsCreate_(params) {
  var name = params.name && String(params.name).trim();
  if (!name) throw new Error('El nombre es obligatorio');
  var existing = readAll_('Checkpoints');
  var checkpoint = {
    id: Utilities.getUuid(),
    name: name,
    code: Utilities.getUuid().replace(/-/g, '').slice(0, 12),
    active: true,
    order: existing.length,
    createdAt: Date.now(),
  };
  appendRow_('Checkpoints', checkpoint);
  return checkpoint;
}

function handleCheckpointsUpdate_(params) {
  if (!params.id) throw new Error('Falta el id');
  var patch = {};
  if (typeof params.name === 'string' && params.name.trim()) patch.name = params.name.trim();
  if (params.active !== undefined) patch.active = params.active === true || params.active === 'true';
  if (params.order !== undefined && !isNaN(Number(params.order))) patch.order = Number(params.order);
  var updated = updateById_('Checkpoints', params.id, patch);
  if (!updated) throw new Error('Punto de control no encontrado');
  return updated;
}

function handleCheckpointsDelete_(params) {
  if (!params.id) throw new Error('Falta el id');
  var ok = deleteById_('Checkpoints', params.id);
  if (!ok) throw new Error('No encontrado');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Escaneos y estado de la ronda actual
// ---------------------------------------------------------------------------

function handleScansLookup_(params) {
  var cp = readAll_('Checkpoints').filter(function (c) {
    return c.code === params.code;
  })[0];
  if (!cp) throw new Error('Codigo de punto de control no valido');
  return { id: cp.id, name: cp.name, active: cp.active };
}

function handleScansCreate_(params, user) {
  var code = params.code;
  if (!code) throw new Error('Falta el codigo');
  var cp = readAll_('Checkpoints').filter(function (c) {
    return c.code === code;
  })[0];
  if (!cp) throw new Error('Punto de control no reconocido');
  if (!cp.active) throw new Error('Este punto de control esta desactivado');
  var shift = getCurrentShift_();
  if (!shift) throw new Error('No tienes un turno abierto. Inicia turno antes de escanear.');
  var scan = { id: Utilities.getUuid(), checkpointId: cp.id, guardId: user.id, timestamp: Date.now() };
  appendRow_('Scans', scan);
  return { checkpoint: { id: cp.id, name: cp.name }, timestamp: scan.timestamp };
}

function handleScansCurrentRound_() {
  var interval = getIntervalMinutes_();
  var slot = getSlot_(new Date(), interval);
  var result = getRoundStatus_(slot.slotStart, slot.slotEnd);
  return {
    slotStart: slot.slotStart,
    slotEnd: slot.slotEnd,
    intervalMinutes: interval,
    status: result.status,
    checkpoints: result.checkpoints.map(function (c) {
      return { id: c.id, name: c.name, scanned: result.scannedIds.indexOf(c.id) !== -1 };
    }),
    shiftOpen: !!getCurrentShift_(),
  };
}

function handleScansMine_(params, user) {
  var scans = readAll_('Scans').filter(function (s) {
    return s.guardId === user.id;
  });
  scans.sort(function (a, b) {
    return b.timestamp - a.timestamp;
  });
  scans = scans.slice(0, 50);
  var checkpoints = readAll_('Checkpoints');
  return scans.map(function (s) {
    var cp = checkpoints.filter(function (c) {
      return c.id === s.checkpointId;
    })[0];
    return {
      id: s.id,
      checkpointId: s.checkpointId,
      guardId: s.guardId,
      timestamp: s.timestamp,
      checkpointName: cp ? cp.name : '(eliminado)',
    };
  });
}

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------

function handleShiftsCurrent_() {
  return getCurrentShift_();
}

function handleShiftsStart_(params, user) {
  if (getCurrentShift_()) throw new Error('Ya hay un turno abierto');
  var shift = {
    id: Utilities.getUuid(),
    guardId: user.id,
    guardName: user.name,
    startedAt: Date.now(),
    endedAt: '',
  };
  appendRow_('Shifts', shift);
  setSetting_('lastHeartbeatAlertAt', '');
  return shift;
}

function handleShiftsEnd_() {
  var shift = getCurrentShift_();
  if (!shift) throw new Error('No hay turno abierto');
  return updateById_('Shifts', shift.id, { endedAt: Date.now() });
}

function handleShiftsPanic_(params, user) {
  var shift = getCurrentShift_();
  var msg = 'BOTON DE EMERGENCIA pulsado por ' + user.name + (shift ? '' : ' (sin turno abierto)') + '.';
  addAlert_('panico', msg, { guardId: user.id });
  sendAlertEmail_('EMERGENCIA - boton de panico activado', msg);
  return { ok: true };
}

function handleShiftsHistory_() {
  var shifts = readAll_('Shifts');
  shifts.sort(function (a, b) {
    return b.startedAt - a.startedAt;
  });
  return shifts.slice(0, 100);
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

function handleAlertsList_() {
  var alerts = readAll_('Alerts');
  alerts.sort(function (a, b) {
    return b.createdAt - a.createdAt;
  });
  return alerts.slice(0, 200);
}

function handleAlertsAck_(params) {
  if (!params.id) throw new Error('Falta el id');
  var updated = updateById_('Alerts', params.id, { acknowledged: true });
  if (!updated) throw new Error('No encontrada');
  return updated;
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

function handleUsersList_() {
  return readAll_('Users').map(publicUser_);
}

function handleUsersCreate_(params) {
  var name = params.name;
  var username = params.username;
  var password = params.password;
  var role = params.role;
  if (!name || !username || !password || ['guard', 'supervisor'].indexOf(role) === -1) {
    throw new Error('Faltan campos o el rol no es valido');
  }
  var existing = readAll_('Users');
  var taken = existing.some(function (u) {
    return u.username === username;
  });
  if (taken) throw new Error('Ese usuario ya existe');
  var salt = Utilities.getUuid();
  var newUser = {
    id: Utilities.getUuid(),
    name: name,
    username: username,
    passwordHash: hashPassword_(password, salt),
    salt: salt,
    role: role,
    createdAt: Date.now(),
  };
  appendRow_('Users', newUser);
  return publicUser_(newUser);
}

function handleUsersDelete_(params, user) {
  if (!params.id) throw new Error('Falta el id');
  if (params.id === user.id) throw new Error('No puedes eliminar tu propio usuario');
  var ok = deleteById_('Users', params.id);
  if (!ok) throw new Error('No encontrado');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Historial de rondas y ajustes
// ---------------------------------------------------------------------------

function handleRoundsHistory_() {
  var rows = readAll_('RoundsHistory');
  rows.sort(function (a, b) {
    return b.slotStart - a.slotStart;
  });
  return rows.slice(0, 200);
}

function handleRoundsSettingsGet_() {
  return {
    roundsPerHour: Number(getSetting_('roundsPerHour', 3)),
    heartbeatMinutes: Number(getSetting_('heartbeatMinutes', 12)),
    alertCooldownMinutes: Number(getSetting_('alertCooldownMinutes', 10)),
  };
}

function handleRoundsSettingsUpdate_(params) {
  if (params.roundsPerHour !== undefined) {
    var rph = Number(params.roundsPerHour);
    if (rph > 0 && rph <= 12) setSetting_('roundsPerHour', rph);
  }
  if (params.heartbeatMinutes !== undefined) {
    var hb = Number(params.heartbeatMinutes);
    if (hb > 0) setSetting_('heartbeatMinutes', hb);
  }
  if (params.alertCooldownMinutes !== undefined) {
    var cd = Number(params.alertCooldownMinutes);
    if (cd > 0) setSetting_('alertCooldownMinutes', cd);
  }
  return handleRoundsSettingsGet_();
}
