/**
 * Login, hash de contrasenas y gestion de sesiones (hoja "Sessions").
 * No usamos JWT: un token aleatorio se guarda en la hoja junto al usuario y
 * a una fecha de caducidad; se manda de vuelta en cada llamada dentro del
 * body/query (nunca en una cabecera, para evitar peticiones "preflight" de
 * CORS que Apps Script no gestiona bien).
 */

function hashPassword_(password, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password);
  return bytes
    .map(function (b) {
      var v = (b + 256) % 256;
      return ('0' + v.toString(16)).slice(-2);
    })
    .join('');
}

function publicUser_(user) {
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

function handleLogin_(params) {
  var username = params.username;
  var password = params.password;
  if (!username || !password) throw new Error('Usuario y contrasena son obligatorios');
  var user = readAll_('Users').filter(function (u) {
    return u.username === username;
  })[0];
  if (!user) throw new Error('Credenciales incorrectas');
  if (hashPassword_(password, user.salt) !== user.passwordHash) {
    throw new Error('Credenciales incorrectas');
  }
  var token = createSession_(user.id);
  return { token: token, user: publicUser_(user) };
}

function handleMe_(params, user) {
  return { user: publicUser_(user) };
}

function createSession_(userId) {
  var token = Utilities.getUuid() + Utilities.getUuid();
  var now = Date.now();
  var expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 dias
  appendRow_('Sessions', { token: token, userId: userId, createdAt: now, expiresAt: expiresAt });
  return token;
}

function getUserByToken_(token) {
  if (!token) throw new Error('No autenticado');
  var session = readAll_('Sessions').filter(function (s) {
    return s.token === token;
  })[0];
  if (!session) throw new Error('Token invalido o caducado');
  if (Number(session.expiresAt) < Date.now()) throw new Error('Token invalido o caducado');
  var user = readAll_('Users').filter(function (u) {
    return u.id === session.userId;
  })[0];
  if (!user) throw new Error('Usuario no encontrado');
  return user;
}

function pruneExpiredSessions_() {
  var sh = getSheet_('Sessions');
  var headers = headerRow_(sh);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  var expCol = headers.indexOf('expiresAt');
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var now = Date.now();
  for (var i = values.length - 1; i >= 0; i--) {
    if (Number(values[i][expCol]) < now) sh.deleteRow(i + 2);
  }
}
