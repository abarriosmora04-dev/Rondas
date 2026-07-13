require('dotenv').config();
const path = require('path');
const express = require('express');

const { load } = require('./db');
const scheduler = require('./scheduler');

const authRoutes = require('./routes/auth');
const checkpointRoutes = require('./routes/checkpoints');
const scanRoutes = require('./routes/scans');
const shiftRoutes = require('./routes/shifts');
const alertRoutes = require('./routes/alerts');
const userRoutes = require('./routes/users');
const roundRoutes = require('./routes/rounds');

load(); // Inicializa/crea la base de datos y los usuarios semilla si hace falta

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/checkpoints', checkpointRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rounds', roundRoutes);

// Enlace que llevan los QR fisicos: abre la pagina de registro de escaneo para ese punto.
app.get('/scan/:code', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'scan.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Rondas escuchando en http://localhost:${PORT}`);
  scheduler.start();
});
