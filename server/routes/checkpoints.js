const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { load, save } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = load();
  res.json(db.checkpoints);
});

router.post('/', requireAuth, requireRole('supervisor'), (req, res) => {
  const { name, order } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const db = load();
  const checkpoint = {
    id: crypto.randomUUID(),
    name: name.trim(),
    code: crypto.randomBytes(6).toString('hex'),
    order: Number.isFinite(order) ? order : db.checkpoints.length,
    active: true,
    createdAt: Date.now(),
  };
  db.checkpoints.push(checkpoint);
  save();
  res.status(201).json(checkpoint);
});

router.patch('/:id', requireAuth, requireRole('supervisor'), (req, res) => {
  const db = load();
  const cp = db.checkpoints.find((c) => c.id === req.params.id);
  if (!cp) return res.status(404).json({ error: 'Punto de control no encontrado' });
  const { name, active, order } = req.body || {};
  if (typeof name === 'string' && name.trim()) cp.name = name.trim();
  if (typeof active === 'boolean') cp.active = active;
  if (Number.isFinite(order)) cp.order = order;
  save();
  res.json(cp);
});

router.delete('/:id', requireAuth, requireRole('supervisor'), (req, res) => {
  const db = load();
  const before = db.checkpoints.length;
  db.checkpoints = db.checkpoints.filter((c) => c.id !== req.params.id);
  if (db.checkpoints.length === before) return res.status(404).json({ error: 'No encontrado' });
  save();
  res.json({ ok: true });
});

router.get('/:id/qr.png', requireAuth, requireRole('supervisor'), async (req, res) => {
  const db = load();
  const cp = db.checkpoints.find((c) => c.id === req.params.id);
  if (!cp) return res.status(404).json({ error: 'No encontrado' });
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}/scan/${cp.code}`;
  res.setHeader('Content-Type', 'image/png');
  QRCode.toFileStream(res, url, { width: 400, margin: 2 });
});

module.exports = router;
