const express = require('express');
const bcrypt = require('bcryptjs');
const { load } = require('../db');
const { signToken, requireAuth } = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contrasena son obligatorios' });
  }
  const db = load();
  const user = db.users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
