const express = require('express');
const crypto = require('crypto');
const { load, save } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { getCurrentShift } = require('../rounds');
const { addAlert } = require('../scheduler');

const router = express.Router();

router.get('/current', requireAuth, (req, res) => {
  const db = load();
  const shift = getCurrentShift(db);
  res.json(shift);
});

router.post('/start', requireAuth, requireRole('guard'), (req, res) => {
  const db = load();
  const existing = getCurrentShift(db);
  if (existing) return res.status(400).json({ error: 'Ya hay un turno abierto' });
  const shift = {
    id: crypto.randomUUID(),
    guardId: req.user.id,
    guardName: req.user.name,
    startedAt: Date.now(),
    endedAt: null,
  };
  db.shifts.push(shift);
  db.settings.lastHeartbeatAlertAt = null;
  save();
  res.status(201).json(shift);
});

router.post('/end', requireAuth, requireRole('guard'), (req, res) => {
  const db = load();
  const shift = getCurrentShift(db);
  if (!shift) return res.status(400).json({ error: 'No hay turno abierto' });
  shift.endedAt = Date.now();
  save();
  res.json(shift);
});

router.get('/history', requireAuth, requireRole('supervisor'), (req, res) => {
  const db = load();
  const list = [...db.shifts].sort((a, b) => b.startedAt - a.startedAt).slice(0, 100);
  res.json(list);
});

router.post('/panic', requireAuth, requireRole('guard'), async (req, res) => {
  const db = load();
  const shift = getCurrentShift(db);
  const msg = `BOTON DE EMERGENCIA pulsado por ${req.user.name}${
    shift ? '' : ' (sin turno abierto)'
  }.`;
  addAlert(db, 'panico', msg, { guardId: req.user.id });
  save();
  res.json({ ok: true });
  const { sendAlertEmail } = require('../notify');
  sendAlertEmail('EMERGENCIA - boton de panico activado', msg).catch((e) =>
    console.error('[panic] error enviando email:', e.message)
  );
});

module.exports = router;
