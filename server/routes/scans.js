const express = require('express');
const crypto = require('crypto');
const { load, save } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { getIntervalMinutes, getSlot, getRoundStatus, getCurrentShift } = require('../rounds');

const router = express.Router();

router.get('/lookup/:code', requireAuth, (req, res) => {
  const db = load();
  const cp = db.checkpoints.find((c) => c.code === req.params.code);
  if (!cp) return res.status(404).json({ error: 'Codigo de punto de control no valido' });
  res.json({ id: cp.id, name: cp.name, active: cp.active });
});

router.post('/', requireAuth, requireRole('guard'), (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Falta el codigo' });
  const db = load();
  const cp = db.checkpoints.find((c) => c.code === code);
  if (!cp) return res.status(404).json({ error: 'Punto de control no reconocido' });
  if (!cp.active) return res.status(400).json({ error: 'Este punto de control esta desactivado' });

  const shift = getCurrentShift(db);
  if (!shift) {
    return res.status(400).json({ error: 'No tienes un turno abierto. Inicia turno antes de escanear.' });
  }

  const scan = {
    id: crypto.randomUUID(),
    checkpointId: cp.id,
    guardId: req.user.id,
    timestamp: Date.now(),
  };
  db.scans.push(scan);
  save();
  res.status(201).json({ ok: true, checkpoint: { id: cp.id, name: cp.name }, timestamp: scan.timestamp });
});

router.get('/current-round', requireAuth, (req, res) => {
  const db = load();
  const interval = getIntervalMinutes(db);
  const now = new Date();
  const { slotStart, slotEnd } = getSlot(now, interval);
  const result = getRoundStatus(db, slotStart, slotEnd);
  res.json({
    slotStart,
    slotEnd,
    intervalMinutes: interval,
    status: result.status,
    checkpoints: result.checkpoints.map((c) => ({
      id: c.id,
      name: c.name,
      scanned: result.scannedIds.includes(c.id),
    })),
    shiftOpen: !!getCurrentShift(db),
  });
});

router.get('/mine', requireAuth, requireRole('guard'), (req, res) => {
  const db = load();
  const mine = db.scans
    .filter((s) => s.guardId === req.user.id)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50)
    .map((s) => {
      const cp = db.checkpoints.find((c) => c.id === s.checkpointId);
      return { ...s, checkpointName: cp ? cp.name : '(eliminado)' };
    });
  res.json(mine);
});

module.exports = router;
