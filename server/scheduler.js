const cron = require('node-cron');
const crypto = require('crypto');
const { load, save } = require('./db');
const { getIntervalMinutes, getSlot, getRoundStatus, getCurrentShift } = require('./rounds');
const { sendAlertEmail } = require('./notify');

function addAlert(db, type, message, meta) {
  db.alerts.unshift({
    id: crypto.randomUUID(),
    type,
    message,
    meta: meta || null,
    createdAt: Date.now(),
    acknowledged: false,
  });
  // Mantener el log de alertas en un tamano razonable
  db.alerts = db.alerts.slice(0, 500);
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString('es-ES');
}

async function processMissedSlot(db, slotStart, slotEnd) {
  const result = getRoundStatus(db, slotStart, slotEnd);
  db.roundsHistory.unshift({
    id: crypto.randomUUID(),
    slotStart,
    slotEnd,
    status: result.status,
    scannedIds: result.scannedIds,
    missing: result.missing.map((c) => c.id),
  });
  db.roundsHistory = db.roundsHistory.slice(0, 1000);

  if (result.status === 'sin_configurar') return;

  if (result.status !== 'completa') {
    const missingNames = result.missing.map((c) => c.name).join(', ');
    const msg =
      result.status === 'no_iniciada'
        ? `Ronda de ${fmtTime(slotStart)} a ${fmtTime(slotEnd)} NO se realizo (ningun punto escaneado).`
        : `Ronda de ${fmtTime(slotStart)} a ${fmtTime(slotEnd)} quedo INCOMPLETA. Puntos no visitados: ${missingNames}.`;
    addAlert(db, 'ronda_incompleta', msg, { slotStart, slotEnd, missing: result.missing.map((c) => c.id) });
    await sendAlertEmail('Ronda no completada', msg);
  }
}

async function checkHeartbeat(db, now) {
  const shift = getCurrentShift(db);
  if (!shift) return;
  const checkpoints = db.checkpoints.filter((c) => c.active);
  if (checkpoints.length === 0) return;

  const scansSinceShift = db.scans.filter((s) => s.timestamp >= shift.startedAt);
  const lastScanTime =
    scansSinceShift.length > 0
      ? Math.max(...scansSinceShift.map((s) => s.timestamp))
      : shift.startedAt;

  const minutesSinceLastScan = (now.getTime() - lastScanTime) / 60000;
  const heartbeatMinutes = db.settings.heartbeatMinutes || 12;
  const cooldown = db.settings.alertCooldownMinutes || 10;

  if (minutesSinceLastScan > heartbeatMinutes) {
    const lastAlert = db.settings.lastHeartbeatAlertAt;
    const minutesSinceLastAlert = lastAlert ? (now.getTime() - lastAlert) / 60000 : Infinity;
    if (minutesSinceLastAlert > cooldown) {
      const msg = `Sin actividad desde hace ${Math.round(
        minutesSinceLastScan
      )} minutos. Posible ausencia del puesto o vigilante dormido. Ultimo registro: ${fmtTime(
        lastScanTime
      )}.`;
      addAlert(db, 'sin_actividad', msg, { minutesSinceLastScan: Math.round(minutesSinceLastScan) });
      await sendAlertEmail('Posible ausencia / sin actividad', msg);
      db.settings.lastHeartbeatAlertAt = now.getTime();
    }
  }
}

async function tick() {
  const db = load();
  const now = new Date();
  const shift = getCurrentShift(db);

  if (shift) {
    const interval = getIntervalMinutes(db);
    const { slotStart } = getSlot(now, interval);

    if (db.settings.lastCheckedSlotStart === null) {
      db.settings.lastCheckedSlotStart = slotStart;
    } else if (slotStart !== db.settings.lastCheckedSlotStart) {
      // Ha empezado un nuevo slot: evaluamos el que acaba de terminar.
      const prevSlotStart = db.settings.lastCheckedSlotStart;
      const prevSlotEnd = prevSlotStart + interval * 60000;
      await processMissedSlot(db, prevSlotStart, prevSlotEnd);
      db.settings.lastCheckedSlotStart = slotStart;
    }

    await checkHeartbeat(db, now);
  } else {
    // Sin turno abierto: no evaluamos rondas, pero mantenemos el puntero al slot actual
    // para no generar una alerta falsa nada mas abrir el proximo turno.
    const interval = getIntervalMinutes(db);
    const { slotStart } = getSlot(now, interval);
    db.settings.lastCheckedSlotStart = slotStart;
  }

  save();
}

function start() {
  // Se ejecuta cada minuto
  cron.schedule('* * * * *', () => {
    tick().catch((e) => console.error('[scheduler] error:', e));
  });
  console.log('[scheduler] iniciado (comprobacion cada minuto)');
}

module.exports = { start, addAlert };
