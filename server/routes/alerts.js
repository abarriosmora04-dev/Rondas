const express = require('express');
const { load, save } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('supervisor'), (req, res) => {
  const db = load();
  res.json(db.alerts.slice(0, 200));
});

router.post('/:id/ack', requireAuth, requireRole('supervisor'), (req, res) => {
  const db = load();
  const alert = db.alerts.find((a) => a.id === req.params.id);
  if (!alert) return res.status(404).json({ error: 'No encontrada' });
  alert.acknowledged = true;
  save();
  res.json(alert);
});

module.exports = router;
