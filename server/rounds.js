// Logica compartida para calcular "slots" de ronda (bloques de tiempo alineados a la hora en
// punto) y el estado de cumplimiento de cada uno.

function getIntervalMinutes(db) {
  const perHour = db.settings.roundsPerHour || 3;
  return 60 / perHour;
}

function getSlot(date, intervalMin) {
  const hourStart = new Date(date);
  hourStart.setMinutes(0, 0, 0);
  const minutesSinceHour = (date.getTime() - hourStart.getTime()) / 60000;
  const slotIndex = Math.floor(minutesSinceHour / intervalMin);
  const slotStart = new Date(hourStart.getTime() + slotIndex * intervalMin * 60000);
  const slotEnd = new Date(slotStart.getTime() + intervalMin * 60000);
  return { slotStart: slotStart.getTime(), slotEnd: slotEnd.getTime() };
}

function getRoundStatus(db, slotStart, slotEnd) {
  const checkpoints = db.checkpoints.filter((c) => c.active);
  if (checkpoints.length === 0) {
    return { status: 'sin_configurar', scannedIds: [], missing: [], checkpoints };
  }
  const scansInSlot = db.scans.filter((s) => s.timestamp >= slotStart && s.timestamp < slotEnd);
  const scannedIds = [...new Set(scansInSlot.map((s) => s.checkpointId))];
  const missing = checkpoints.filter((c) => !scannedIds.includes(c.id));
  let status;
  if (missing.length === 0) status = 'completa';
  else if (scannedIds.length === 0) status = 'no_iniciada';
  else status = 'incompleta';
  return { status, scannedIds, missing, checkpoints };
}

function getCurrentShift(db) {
  return db.shifts.find((s) => !s.endedAt) || null;
}

module.exports = { getIntervalMinutes, getSlot, getRoundStatus, getCurrentShift };
