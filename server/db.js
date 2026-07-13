const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

function defaultData() {
  return {
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    users: [],
    checkpoints: [],
    scans: [],
    shifts: [],
    alerts: [],
    roundsHistory: [],
    settings: {
      roundsPerHour: 3,
      heartbeatMinutes: 12,
      alertCooldownMinutes: 10,
      lastCheckedSlotStart: null,
      lastHeartbeatAlertAt: null,
    },
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    cache = defaultData();
    seedUsers(cache);
    save();
    return cache;
  }
  cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  return cache;
}

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2));
}

function seedUsers(data) {
  const supUser = process.env.SEED_SUPERVISOR_USER || 'supervisor';
  const supPass = process.env.SEED_SUPERVISOR_PASS || 'cambia-esta-clave';
  const guardUser = process.env.SEED_GUARD_USER || 'vigilante';
  const guardPass = process.env.SEED_GUARD_PASS || 'cambia-esta-clave';

  data.users.push({
    id: crypto.randomUUID(),
    name: 'Supervisor',
    username: supUser,
    passwordHash: bcrypt.hashSync(supPass, 10),
    role: 'supervisor',
    createdAt: Date.now(),
  });

  data.users.push({
    id: crypto.randomUUID(),
    name: 'Vigilante',
    username: guardUser,
    passwordHash: bcrypt.hashSync(guardPass, 10),
    role: 'guard',
    createdAt: Date.now(),
  });
}

module.exports = { load, save };
