/**
 * Rondas - backend en Google Apps Script (fichero unico).
 *
 * Todo el backend vive en este unico fichero para que dar de alta el
 * proyecto sea lo mas simple posible: solo hay que pegar este contenido
 * sobre el "Code.gs" que Apps Script crea por defecto, sin tener que crear
 * ficheros adicionales.
 *
 * Contiene: el esquema de las hojas, las funciones genericas de
 * lectura/escritura sobre la Google Sheet, login y sesiones, el calculo de
 * rondas/heartbeat y el envio de alertas por email, la puesta en marcha
 * inicial (initSheets/setupTrigger), y el enrutador doGet/doPost con todos
 * los manejadores de cada accion.
 */

// =============================================================================
// Esquema de las hojas
// =============================================================================

var SHEETS_SCHEMA = {
  Users: ['id', 'name', 'username', 'passwordHash', 'salt', 'role', 'createdAt'],
  Checkpoints: ['id', 'name', 'code', 'active', 'order', 'createdAt'],
  Scans: ['id', 'checkpointId', 'auxiliarId', 'timestamp'],
  Shifts: ['id', 'auxiliarId', 'auxiliarName', 'startedAt', 'endedAt'],
  Alerts: ['id', 'type', 'message', 'meta', 'createdAt', 'acknowledged'],
  RoundsHistory: ['id', 'slotStart', 'slotEnd', 'status', 'scannedIds', 'missing', 'auxiliarId', 'auxiliarName'],
  Sessions: ['token', 'userId', 'createdAt', 'expiresAt'],
  Settings: ['key', 'value'],
};

// =============================================================================
// Acceso generico a las hojas (cada fila se lee/escribe como un objeto plano
// usando la cabecera de la hoja como nombres de campo).
// =============================================================================

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

// =============================================================================
// Login, hash de contrasenas y sesiones (hoja "Sessions"). No usamos JWT: un
// token aleatorio se guarda en la hoja junto al usuario y a una fecha de
// caducidad; viaja en el body/query de cada llamada, nunca en una cabecera,
// para evitar peticiones "preflight" de CORS que Apps Script no gestiona bien.
// =============================================================================

function hashPassword_(password, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password);
  return bytes
    .map(function (b) {
      var v = (b + 256) % 256;
      return ('0' + v.toString(16)).slice(-2);
    })
    .join('');
}

function publicUser_(user) {
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

function handleLogin_(params) {
  var username = params.username;
  var password = params.password;
  if (!username || !password) throw new Error('Usuario y contrasena son obligatorios');
  var user = readAll_('Users').filter(function (u) {
    return u.username === username;
  })[0];
  if (!user) throw new Error('Credenciales incorrectas');
  if (hashPassword_(password, user.salt) !== user.passwordHash) {
    throw new Error('Credenciales incorrectas');
  }
  var token = createSession_(user.id);
  return { token: token, user: publicUser_(user) };
}

function handleMe_(params, user) {
  return { user: publicUser_(user) };
}

function createSession_(userId) {
  var token = Utilities.getUuid() + Utilities.getUuid();
  var now = Date.now();
  var expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 dias
  appendRow_('Sessions', { token: token, userId: userId, createdAt: now, expiresAt: expiresAt });
  return token;
}

function getUserByToken_(token) {
  if (!token) throw new Error('No autenticado');
  var session = readAll_('Sessions').filter(function (s) {
    return s.token === token;
  })[0];
  if (!session) throw new Error('Token invalido o caducado');
  if (Number(session.expiresAt) < Date.now()) throw new Error('Token invalido o caducado');
  var user = readAll_('Users').filter(function (u) {
    return u.id === session.userId;
  })[0];
  if (!user) throw new Error('Usuario no encontrado');
  return user;
}

function pruneExpiredSessions_() {
  var sh = getSheet_('Sessions');
  var headers = headerRow_(sh);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  var expCol = headers.indexOf('expiresAt');
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var now = Date.now();
  for (var i = values.length - 1; i >= 0; i--) {
    if (Number(values[i][expCol]) < now) sh.deleteRow(i + 2);
  }
}

// =============================================================================
// Calculo de rondas (bloques de tiempo alineados al reloj), deteccion de
// rondas incompletas y de inactividad prolongada (heartbeat), y envio de
// alertas por email. checkRoundsAndHeartbeat() es la funcion que dispara el
// trigger de "cada 1 minuto" creado por setupTrigger().
// =============================================================================

function getIntervalMinutes_() {
  var perHour = Number(getSetting_('roundsPerHour', 3));
  return 60 / perHour;
}

function getSlot_(now, intervalMin) {
  var hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  var minutesSinceHour = (now.getTime() - hourStart.getTime()) / 60000;
  var slotIndex = Math.floor(minutesSinceHour / intervalMin);
  var slotStart = hourStart.getTime() + slotIndex * intervalMin * 60000;
  var slotEnd = slotStart + intervalMin * 60000;
  return { slotStart: slotStart, slotEnd: slotEnd };
}

function getRoundStatus_(slotStart, slotEnd) {
  var checkpoints = readAll_('Checkpoints').filter(function (c) {
    return c.active;
  });
  if (checkpoints.length === 0) {
    return { status: 'sin_configurar', scannedIds: [], missing: [], checkpoints: checkpoints };
  }
  var scans = readAll_('Scans').filter(function (s) {
    return s.timestamp >= slotStart && s.timestamp < slotEnd;
  });
  var scannedIds = uniq_(
    scans.map(function (s) {
      return s.checkpointId;
    })
  );
  var missing = checkpoints.filter(function (c) {
    return scannedIds.indexOf(c.id) === -1;
  });
  var status;
  if (missing.length === 0) status = 'completa';
  else if (scannedIds.length === 0) status = 'no_iniciada';
  else status = 'incompleta';
  return { status: status, scannedIds: scannedIds, missing: missing, checkpoints: checkpoints };
}

function getCurrentShift_() {
  var shifts = readAll_('Shifts');
  for (var i = 0; i < shifts.length; i++) {
    if (!shifts[i].endedAt) return shifts[i];
  }
  return null;
}

/**
 * Turno que estuvo abierto en algun momento dentro de la ventana de un
 * bloque de ronda ya pasado (no necesariamente el turno abierto ahora
 * mismo). Se usa al cerrar cada bloque para saber a quien atribuirlo aunque
 * el auxiliar ya haya terminado turno antes de que el disparador de "cada 1
 * minuto" llegue a procesar ese bloque.
 */
function findShiftForSlot_(slotStart, slotEnd) {
  var shifts = readAll_('Shifts');
  for (var i = 0; i < shifts.length; i++) {
    var started = Number(shifts[i].startedAt);
    var ended = shifts[i].endedAt ? Number(shifts[i].endedAt) : Infinity;
    if (started < slotEnd && ended > slotStart) return shifts[i];
  }
  return null;
}

function addAlert_(type, message, meta) {
  appendRow_('Alerts', {
    id: Utilities.getUuid(),
    type: type,
    message: message,
    meta: meta ? JSON.stringify(meta) : '',
    createdAt: Date.now(),
    acknowledged: false,
  });
}

function sendAlertEmail_(subject, text) {
  var to = getSetting_('alertEmailTo', '');
  if (!to) {
    Logger.log('Sin alertEmailTo configurado, no se envia email: ' + subject);
    return;
  }
  try {
    MailApp.sendEmail({ to: to, subject: '[Rondas] ' + subject, body: text, name: 'Rondas Alertas' });
  } catch (err) {
    Logger.log('Error enviando email de alerta: ' + err.message);
  }
}

function fmtTime_(ts) {
  return Utilities.formatDate(new Date(ts), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

var statusLabels_ = {
  completa: 'Completa',
  incompleta: 'Incompleta',
  no_iniciada: 'No iniciada',
  sin_configurar: 'Sin puntos configurados',
};

function processMissedSlot_(slotStart, slotEnd, shift) {
  var result = getRoundStatus_(slotStart, slotEnd);
  appendRow_('RoundsHistory', {
    id: Utilities.getUuid(),
    slotStart: slotStart,
    slotEnd: slotEnd,
    status: result.status,
    scannedIds: JSON.stringify(result.scannedIds),
    missing: JSON.stringify(
      result.missing.map(function (c) {
        return c.id;
      })
    ),
    auxiliarId: shift ? shift.auxiliarId : '',
    auxiliarName: shift ? shift.auxiliarName : '',
  });

  if (result.status === 'sin_configurar') return;

  if (result.status !== 'completa') {
    var missingNames = result.missing
      .map(function (c) {
        return c.name;
      })
      .join(', ');
    var msg =
      result.status === 'no_iniciada'
        ? 'Ronda de ' + fmtTime_(slotStart) + ' a ' + fmtTime_(slotEnd) + ' NO se realizo (ningun punto escaneado).'
        : 'Ronda de ' +
          fmtTime_(slotStart) +
          ' a ' +
          fmtTime_(slotEnd) +
          ' quedo INCOMPLETA. Puntos no visitados: ' +
          missingNames +
          '.';
    addAlert_('ronda_incompleta', msg, { slotStart: slotStart, slotEnd: slotEnd });
    sendAlertEmail_('Ronda no completada', msg);
  }
}

function checkHeartbeat_(now) {
  var shift = getCurrentShift_();
  if (!shift) return;
  var checkpoints = readAll_('Checkpoints').filter(function (c) {
    return c.active;
  });
  if (checkpoints.length === 0) return;

  var scans = readAll_('Scans').filter(function (s) {
    return s.timestamp >= shift.startedAt;
  });
  var lastScanTime = shift.startedAt;
  scans.forEach(function (s) {
    if (s.timestamp > lastScanTime) lastScanTime = s.timestamp;
  });

  var minutesSinceLastScan = (now.getTime() - lastScanTime) / 60000;
  var heartbeatMinutes = Number(getSetting_('heartbeatMinutes', 12));
  var cooldown = Number(getSetting_('alertCooldownMinutes', 10));

  if (minutesSinceLastScan > heartbeatMinutes) {
    var lastAlert = getSetting_('lastHeartbeatAlertAt', '');
    var minutesSinceLastAlert = lastAlert ? (now.getTime() - Number(lastAlert)) / 60000 : Infinity;
    if (minutesSinceLastAlert > cooldown) {
      var msg =
        'Sin actividad desde hace ' +
        Math.round(minutesSinceLastScan) +
        ' minutos. Posible ausencia del puesto o auxiliar dormido. Ultimo registro: ' +
        fmtTime_(lastScanTime) +
        '.';
      addAlert_('sin_actividad', msg, { minutesSinceLastScan: Math.round(minutesSinceLastScan) });
      sendAlertEmail_('Posible ausencia / sin actividad', msg);
      setSetting_('lastHeartbeatAlertAt', now.getTime());
    }
  }
}

function pruneOldData_() {
  // Evita que las lecturas se degraden con el tiempo: fuera escaneos de mas
  // de 90 dias y sesiones caducadas.
  var cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  var sh = getSheet_('Scans');
  var headers = headerRow_(sh);
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var tsCol = headers.indexOf('timestamp');
    var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var i = values.length - 1; i >= 0; i--) {
      if (values[i][tsCol] < cutoff) sh.deleteRow(i + 2);
    }
  }
  pruneExpiredSessions_();
}

/**
 * Funcion que ejecuta el trigger de "cada 1 minuto". Comprueba si el bloque
 * de ronda anterior se completo y si hace demasiado tiempo que no hay
 * ningun escaneo (heartbeat), solo mientras haya un turno abierto.
 */
function checkRoundsAndHeartbeat() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var now = new Date();
    var shift = getCurrentShift_();
    var interval = getIntervalMinutes_();
    var slot = getSlot_(now, interval);

    // El cierre de cada bloque se procesa en cuanto cambia el "slot" actual,
    // independientemente de si hay un turno abierto AHORA MISMO: si solo se
    // mirara "hay turno abierto" en este preciso instante, un auxiliar que
    // termina turno justo despues de completar la ronda (antes de que este
    // disparador vuelva a pasar) hacia que ese bloque nunca se guardara en
    // el historial. En vez de eso, se busca que turno estuvo abierto durante
    // la ventana del bloque que acaba de cerrarse (findShiftForSlot_).
    var lastChecked = getSetting_('lastCheckedSlotStart', '');
    if (lastChecked === '' || lastChecked === null) {
      setSetting_('lastCheckedSlotStart', slot.slotStart);
    } else if (Number(lastChecked) !== slot.slotStart) {
      var prevSlotStart = Number(lastChecked);
      var prevSlotEnd = prevSlotStart + interval * 60000;
      var prevShift = findShiftForSlot_(prevSlotStart, prevSlotEnd);
      if (prevShift) {
        processMissedSlot_(prevSlotStart, prevSlotEnd, prevShift);
      }
      setSetting_('lastCheckedSlotStart', slot.slotStart);
    }

    if (shift) checkHeartbeat_(now);

    pruneOldData_();
  } finally {
    lock.releaseLock();
  }
}

/** Ejecuta esto UNA VEZ desde el editor de Apps Script para crear el trigger. */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkRoundsAndHeartbeat') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkRoundsAndHeartbeat').timeBased().everyMinutes(1).create();
  Logger.log('Trigger creado: checkRoundsAndHeartbeat cada 1 minuto.');
}

// =============================================================================
// Puesta en marcha inicial. Ejecuta initSheets() UNA VEZ desde el editor de
// Apps Script (arriba, en el selector de funciones, elige "initSheets" y
// pulsa "Ejecutar"; la primera vez pedira autorizar permisos, es normal).
// Crea las pestanas que hacen falta con sus cabeceras, y si estan vacias
// siembra el usuario supervisor y el auxiliar inicial.
// =============================================================================

function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SHEETS_SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = SHEETS_SCHEMA[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  });

  // Borra la hoja de ejemplo por defecto si sigue vacia.
  ['Hoja 1', 'Sheet1'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() === 0) ss.deleteSheet(sh);
  });

  seedUsersIfEmpty_();
  seedSettingsIfEmpty_();

  Logger.log('Hojas inicializadas correctamente.');
}

function seedUsersIfEmpty_() {
  var users = readAll_('Users');
  if (users.length > 0) return;

  var supSalt = Utilities.getUuid();
  var auxiliarSalt = Utilities.getUuid();

  appendRow_('Users', {
    id: Utilities.getUuid(),
    name: 'Supervisor',
    username: 'supervisor',
    passwordHash: hashPassword_('cambia-esta-clave', supSalt),
    salt: supSalt,
    role: 'supervisor',
    createdAt: Date.now(),
  });

  appendRow_('Users', {
    id: Utilities.getUuid(),
    name: 'Auxiliar',
    username: 'auxiliar',
    passwordHash: hashPassword_('cambia-esta-clave', auxiliarSalt),
    salt: auxiliarSalt,
    role: 'auxiliar',
    createdAt: Date.now(),
  });

  Logger.log(
    'Usuarios creados -> supervisor/cambia-esta-clave y auxiliar/cambia-esta-clave. ' +
      'CAMBIA ESTAS CONTRASENAS desde el panel de supervisor en cuanto entres.'
  );
}

function seedSettingsIfEmpty_() {
  var alreadySet = getSetting_('roundsPerHour', '');
  if (alreadySet !== '') return; // ya se inicializo antes, no se pisa nada

  setSetting_('roundsPerHour', 3);
  setSetting_('heartbeatMinutes', 12);
  setSetting_('alertCooldownMinutes', 10);
  setSetting_('lastCheckedSlotStart', '');
  setSetting_('lastHeartbeatAlertAt', '');
  // Por defecto las alertas llegan a la cuenta de Google duena del script;
  // se puede cambiar mas tarde editando la fila "alertEmailTo" en la pestana Settings.
  setSetting_('alertEmailTo', Session.getActiveUser().getEmail());
}

// =============================================================================
// Punto de entrada web: sirve la propia app (Index.html) y expone apiCall()
// para que el cliente la invoque via google.script.run. Al vivir la pagina y
// el backend en el mismo origen no hay ninguna llamada entre dominios
// distintos de por medio, asi que no hace falta lidiar con CORS de ningun
// tipo (ni fetch, ni JSONP): google.script.run es el puente oficial de
// Apps Script entre el HTML servido y las funciones del servidor.
// =============================================================================

function doGet(e) {
  // Se sirve como HTML estatico (sin plantilla/scriptlets): asi no hay
  // ningun procesado de plantilla que pueda romper el HTML si algo falla.
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Rondas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/**
 * Unico punto de entrada que llama el cliente (via google.script.run.apiCall).
 * "params" llega ya como objeto (google.script.run serializa JS <-> Apps
 * Script automaticamente), con al menos { action, token, ...datos }.
 * Devuelve el resultado del handler directamente, o lanza un Error que
 * google.script.run entrega al withFailureHandler() del cliente.
 */
function apiCall(params) {
  params = params || {};
  var action = params.action;
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
    return spec.handler(params, user);
  } finally {
    lock.releaseLock();
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
  'scans.create': { auth: true, roles: ['auxiliar'], handler: handleScansCreate_ },
  'scans.currentRound': { auth: true, handler: handleScansCurrentRound_ },
  'scans.mine': { auth: true, roles: ['auxiliar'], handler: handleScansMine_ },

  'shifts.current': { auth: true, handler: handleShiftsCurrent_ },
  'shifts.start': { auth: true, roles: ['auxiliar'], handler: handleShiftsStart_ },
  'shifts.end': { auth: true, roles: ['auxiliar'], handler: handleShiftsEnd_ },
  'shifts.panic': { auth: true, roles: ['auxiliar'], handler: handleShiftsPanic_ },
  'shifts.history': { auth: true, roles: ['supervisor'], handler: handleShiftsHistory_ },

  'alerts.list': { auth: true, roles: ['supervisor'], handler: handleAlertsList_ },
  'alerts.ack': { auth: true, roles: ['supervisor'], handler: handleAlertsAck_ },

  'users.list': { auth: true, roles: ['supervisor'], handler: handleUsersList_ },
  'users.create': { auth: true, roles: ['supervisor'], handler: handleUsersCreate_ },
  'users.delete': { auth: true, roles: ['supervisor'], handler: handleUsersDelete_ },

  'rounds.history': { auth: true, roles: ['supervisor'], handler: handleRoundsHistory_ },
  'rounds.exportPdf': { auth: true, roles: ['supervisor'], handler: handleRoundsExportPdf_ },
  'rounds.settingsGet': { auth: true, handler: handleRoundsSettingsGet_ },
  'rounds.settingsUpdate': { auth: true, roles: ['supervisor'], handler: handleRoundsSettingsUpdate_ },

  'scans.list': { auth: true, roles: ['supervisor'], handler: handleScansList_ },
};

// --- Puntos de control ---

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

// --- Escaneos y estado de la ronda actual ---

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
  var scan = { id: Utilities.getUuid(), checkpointId: cp.id, auxiliarId: user.id, timestamp: Date.now() };
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
    return s.auxiliarId === user.id;
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
      auxiliarId: s.auxiliarId,
      timestamp: s.timestamp,
      checkpointName: cp ? cp.name : '(eliminado)',
    };
  });
}

function handleScansList_(params) {
  params = params || {};
  var from = params.from !== undefined && params.from !== '' ? Number(params.from) : null;
  var to = params.to !== undefined && params.to !== '' ? Number(params.to) : null;
  var scans = readAll_('Scans').filter(function (s) {
    if (from !== null && s.timestamp < from) return false;
    if (to !== null && s.timestamp > to) return false;
    return true;
  });
  scans.sort(function (a, b) {
    return b.timestamp - a.timestamp;
  });
  scans = scans.slice(0, 300);
  var checkpoints = readAll_('Checkpoints');
  var users = readAll_('Users');
  return scans.map(function (s) {
    var cp = checkpoints.filter(function (c) {
      return c.id === s.checkpointId;
    })[0];
    var u = users.filter(function (x) {
      return x.id === s.auxiliarId;
    })[0];
    return {
      id: s.id,
      timestamp: s.timestamp,
      checkpointName: cp ? cp.name : '(eliminado)',
      auxiliarName: u ? u.name : '(eliminado)',
    };
  });
}

// --- Turnos ---

function handleShiftsCurrent_() {
  return getCurrentShift_();
}

function handleShiftsStart_(params, user) {
  if (getCurrentShift_()) throw new Error('Ya hay un turno abierto');
  var shift = {
    id: Utilities.getUuid(),
    auxiliarId: user.id,
    auxiliarName: user.name,
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
  addAlert_('panico', msg, { auxiliarId: user.id });
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

// --- Alertas ---

function handleAlertsList_(params) {
  params = params || {};
  var from = params.from !== undefined && params.from !== '' ? Number(params.from) : null;
  var to = params.to !== undefined && params.to !== '' ? Number(params.to) : null;
  var type = params.type;
  var alerts = readAll_('Alerts').filter(function (a) {
    if (from !== null && a.createdAt < from) return false;
    if (to !== null && a.createdAt > to) return false;
    if (type && a.type !== type) return false;
    return true;
  });
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

// --- Usuarios ---

function handleUsersList_() {
  return readAll_('Users').map(publicUser_);
}

function handleUsersCreate_(params) {
  var name = params.name;
  var username = params.username;
  var password = params.password;
  var role = params.role;
  if (!name || !username || !password || ['auxiliar', 'supervisor'].indexOf(role) === -1) {
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

// --- Historial de rondas y ajustes ---

function filterRoundsHistory_(params) {
  params = params || {};
  var from = params.from !== undefined && params.from !== '' ? Number(params.from) : null;
  var to = params.to !== undefined && params.to !== '' ? Number(params.to) : null;
  var status = params.status;
  var auxiliarId = params.auxiliarId;
  var rows = readAll_('RoundsHistory').filter(function (r) {
    if (from !== null && r.slotStart < from) return false;
    if (to !== null && r.slotStart > to) return false;
    if (status && r.status !== status) return false;
    if (auxiliarId && r.auxiliarId !== auxiliarId) return false;
    return true;
  });
  rows.sort(function (a, b) {
    return b.slotStart - a.slotStart;
  });
  return rows;
}

function handleRoundsHistory_(params) {
  return filterRoundsHistory_(params).slice(0, 500);
}

function handleRoundsExportPdf_(params) {
  try {
    return buildRoundsPdf_(params);
  } catch (err) {
    if (String(err.message || err).indexOf('DocumentApp') !== -1 || String(err.message || err).indexOf('auth/documents') !== -1) {
      throw new Error(
        'Hace falta autorizar el acceso a Documentos de Google para generar el PDF. ' +
          'Ve al editor de Apps Script, elige la funcion "authorizePdfAccess" en el desplegable ' +
          'de arriba, pulsa Ejecutar y acepta los permisos. Despues vuelve a intentar la descarga.'
      );
    }
    throw err;
  }
}

/**
 * Crea y borra en el acto un documento de Google temporal. No la usa la app:
 * es solo para ejecutarla UNA VEZ a mano desde el editor de Apps Script
 * cuando se instala esta funcionalidad (o si "Descargar PDF" falla pidiendo
 * autorizacion). Eso es lo unico que hace que Google detecte que el script
 * necesita el permiso de Documentos/Drive y muestre la pantalla para
 * concederlo; una vez aceptada, el propio despliegue web ya puede generar
 * PDFs sin este paso.
 */
function authorizePdfAccess() {
  var doc = DocumentApp.create('Rondas - autorizacion temporal');
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  Logger.log('Permisos de Documentos/Drive concedidos correctamente.');
}

function buildRoundsPdf_(params) {
  var rows = filterRoundsHistory_(params).slice(0, 1000);
  var total = rows.length;
  var counts = { completa: 0, incompleta: 0, no_iniciada: 0, sin_configurar: 0 };
  rows.forEach(function (r) {
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  var pct = function (n) {
    return total ? Math.round((n / total) * 100) : 0;
  };

  var doc = DocumentApp.create(
    'Rondas - historial ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm')
  );
  var body = doc.getBody();
  body.appendParagraph('Historial de rondas').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Generado el ' + fmtTime_(Date.now()));

  var filterDesc = [];
  if (params && params.from) filterDesc.push('Desde: ' + fmtTime_(Number(params.from)));
  if (params && params.to) filterDesc.push('Hasta: ' + fmtTime_(Number(params.to)));
  if (params && params.status) filterDesc.push('Estado: ' + (statusLabels_[params.status] || params.status));
  if (params && params.auxiliarId) {
    var auxUser = readAll_('Users').filter(function (u) {
      return u.id === params.auxiliarId;
    })[0];
    filterDesc.push('Auxiliar: ' + (auxUser ? auxUser.name : params.auxiliarId));
  }
  body.appendParagraph(filterDesc.length ? 'Filtros: ' + filterDesc.join(' | ') : 'Sin filtros aplicados.');

  body.appendParagraph(
    'Total: ' +
      total +
      ' rondas | Completas: ' +
      counts.completa +
      ' (' +
      pct(counts.completa) +
      '%) | Incompletas: ' +
      counts.incompleta +
      ' (' +
      pct(counts.incompleta) +
      '%) | No iniciadas: ' +
      counts.no_iniciada +
      ' (' +
      pct(counts.no_iniciada) +
      '%)'
  );

  var checkpoints = readAll_('Checkpoints');
  var cpName = function (id) {
    var c = checkpoints.filter(function (x) {
      return x.id === id;
    })[0];
    return c ? c.name : '(eliminado)';
  };

  var tableData = [['Fecha', 'Ventana', 'Estado', 'Auxiliar', 'Puntos no visitados']];
  rows.forEach(function (r) {
    var missingIds = [];
    try {
      missingIds = JSON.parse(r.missing || '[]');
    } catch (e) {
      missingIds = [];
    }
    var missingNames = missingIds.map(cpName).join(', ');
    tableData.push([
      fmtTime_(r.slotStart),
      Utilities.formatDate(new Date(r.slotStart), Session.getScriptTimeZone(), 'HH:mm') +
        ' - ' +
        Utilities.formatDate(new Date(r.slotEnd), Session.getScriptTimeZone(), 'HH:mm'),
      statusLabels_[r.status] || r.status,
      r.auxiliarName || '-',
      missingNames || '-',
    ]);
  });
  body.appendTable(tableData);

  doc.saveAndClose();
  var docFile = DriveApp.getFileById(doc.getId());
  var pdfBlob = docFile.getAs(MimeType.PDF);
  var base64 = Utilities.base64Encode(pdfBlob.getBytes());
  var filename = 'rondas_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm') + '.pdf';
  docFile.setTrashed(true);
  return { base64: base64, filename: filename };
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
