/**
 * Puesta en marcha inicial. Ejecuta initSheets() UNA VEZ desde el editor de
 * Apps Script (menu de arriba: selecciona la funcion "initSheets" y pulsa
 * "Ejecutar"; la primera vez te pedira autorizar permisos, es normal).
 * Crea las pestanas que hacen falta con sus cabeceras, y si estan vacias
 * siembra el usuario supervisor y el vigilante inicial.
 */
function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SHEETS_SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = SHEETS_SCHEMA[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  });

  // Borra la hoja de ejemplo por defecto si sigue vacia.
  ['Hoja 1', 'Sheet1'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() === 0) ss.deleteSheet(sh);
  });

  seedUsersIfEmpty_();
  seedSettingsIfEmpty_();

  Logger.log('Hojas inicializadas correctamente.');
}

function seedUsersIfEmpty_() {
  var users = readAll_('Users');
  if (users.length > 0) return;

  var supSalt = Utilities.getUuid();
  var guardSalt = Utilities.getUuid();

  appendRow_('Users', {
    id: Utilities.getUuid(),
    name: 'Supervisor',
    username: 'supervisor',
    passwordHash: hashPassword_('cambia-esta-clave', supSalt),
    salt: supSalt,
    role: 'supervisor',
    createdAt: Date.now(),
  });

  appendRow_('Users', {
    id: Utilities.getUuid(),
    name: 'Vigilante',
    username: 'vigilante',
    passwordHash: hashPassword_('cambia-esta-clave', guardSalt),
    salt: guardSalt,
    role: 'guard',
    createdAt: Date.now(),
  });

  Logger.log(
    'Usuarios creados -> supervisor/cambia-esta-clave y vigilante/cambia-esta-clave. ' +
      'CAMBIA ESTAS CONTRASENAS desde el panel de supervisor en cuanto entres.'
  );
}

function seedSettingsIfEmpty_() {
  var alreadySet = getSetting_('roundsPerHour', '');
  if (alreadySet !== '') return; // ya se inicializo antes, no se pisa nada

  setSetting_('roundsPerHour', 3);
  setSetting_('heartbeatMinutes', 12);
  setSetting_('alertCooldownMinutes', 10);
  setSetting_('lastCheckedSlotStart', '');
  setSetting_('lastHeartbeatAlertAt', '');
  // Por defecto las alertas llegan a la cuenta de Google duena del script;
  // se puede cambiar mas tarde editando la fila "alertEmailTo" en la pestana Settings.
  setSetting_('alertEmailTo', Session.getActiveUser().getEmail());
}
