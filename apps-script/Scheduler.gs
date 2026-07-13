/**
 * Calculo de rondas (bloques de tiempo alineados al reloj), deteccion de
 * rondas incompletas y de inactividad prolongada (heartbeat), y envio de
 * alertas por email. checkRoundsAndHeartbeat() es la funcion que dispara el
 * trigger de "cada 1 minuto" creado por setupTrigger().
 */

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

function processMissedSlot_(slotStart, slotEnd) {
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
        ' minutos. Posible ausencia del puesto o vigilante dormido. Ultimo registro: ' +
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

    if (shift) {
      var lastChecked = getSetting_('lastCheckedSlotStart', '');
      if (lastChecked === '' || lastChecked === null) {
        setSetting_('lastCheckedSlotStart', slot.slotStart);
      } else if (Number(lastChecked) !== slot.slotStart) {
        var prevSlotStart = Number(lastChecked);
        var prevSlotEnd = prevSlotStart + interval * 60000;
        processMissedSlot_(prevSlotStart, prevSlotEnd);
        setSetting_('lastCheckedSlotStart', slot.slotStart);
      }
      checkHeartbeat_(now);
    } else {
      setSetting_('lastCheckedSlotStart', slot.slotStart);
    }

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
