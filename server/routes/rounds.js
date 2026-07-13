const express = require('express');
const { load, save } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.get('/history', requireAuth, requireRole('supervisor'), (req, res) => {
  const db = load();
  res.json(db.roundsHistory.slice(0, 200));
});

router.get('/settings', requireAuth, (req, res) => {
  const db = load();
  res.json(db.settings);
});

router.patch('/settings', requireAuth, requireRole('supervisor'), (req, res) => {
  const { roundsPerHour, heartbeatMinutes, alertCooldownMinutes } = req.body || {};
  const db = load();
  if (Number.isFinite(roundsPerHour) && roundsPerHour > 0 && roundsPerHour <= 12) {
    db.settings.roundsPerHour = roundsPerHour;
  }
  if (Number.isFinite(heartbeatMinutes) && heartbeatMinutes > 0) {
    db.settings.heartbeatMinutes = heartbeatMinutes;
  }
  if (Number.isFinite(alertCooldownMinutes) && alertCooldownMinutes > 0) {
    db.settings.alertCooldownMinutes = alertCooldownMinutes;
  }
  save();
  res.json(db.settings);
});

module.exports = router;
