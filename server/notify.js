const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Evita que un SMTP mal configurado o sin red deje la peticion colgada.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
  return transporter;
}

async function sendAlertEmail(subject, text) {
  const t = getTransporter();
  const to = process.env.ALERT_EMAIL_TO;
  if (!t || !to) {
    console.warn('[notify] SMTP no configurado, alerta no enviada por email:', subject);
    return false;
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `[Rondas] ${subject}`,
      text,
    });
    return true;
  } catch (e) {
    console.error('[notify] Error enviando email de alerta:', e.message);
    return false;
  }
}

module.exports = { sendAlertEmail };
