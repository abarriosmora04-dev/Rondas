const jwt = require('jsonwebtoken');
const { load } = require('./db');

function signToken(user) {
  const db = load();
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    db.jwtSecret,
    { expiresIn: '30d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const db = load();
    const payload = jwt.verify(token, db.jwtSecret);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido o caducado' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole };
