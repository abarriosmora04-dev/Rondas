const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { load, save } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('supervisor'), (req, res) => {
  const db = load();
  res.json(db.users.map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role })));
});

router.post('/', requireAuth, requireRole('supervisor'), (req, res) => {
  const { name, username, password, role } = req.body || {};
  if (!name || !username || !password || !['guard', 'supervisor'].includes(role)) {
    return res.status(400).json({ error: 'Faltan campos o el rol no es valido' });
  }
  const db = load();
  if (db.users.some((u) => u.username === username)) {
    return res.status(400).json({ error: 'Ese usuario ya existe' });
  }
  const user = {
    id: crypto.randomUUID(),
    name,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    createdAt: Date.now(),
  };
  db.users.push(user);
  save();
  res.status(201).json({ id: user.id, name: user.name, username: user.username, role: user.role });
});

router.delete('/:id', requireAuth, requireRole('supervisor'), (req, res) => {
  const db = load();
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }
  const before = db.users.length;
  db.users = db.users.filter((u) => u.id !== req.params.id);
  if (db.users.length === before) return res.status(404).json({ error: 'No encontrado' });
  save();
  res.json({ ok: true });
});

module.exports = router;
