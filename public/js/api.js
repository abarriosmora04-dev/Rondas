// Cliente para el backend en Google Apps Script. Todas las llamadas van por
// POST con Content-Type: text/plain (asi se evita el preflight de CORS que
// Apps Script no gestiona bien) y el cuerpo es un JSON con { action, token, ...datos }.
// La respuesta siempre es HTTP 200 con { ok: true, data } o { ok: false, error }.

const Api = (() => {
  const URL_KEY = 'rondas_apps_script_url';
  const TOKEN_KEY = 'rondas_token';
  const USER_KEY = 'rondas_user';

  function getScriptUrl() {
    return localStorage.getItem(URL_KEY) || '';
  }
  function setScriptUrl(url) {
    localStorage.setItem(URL_KEY, url.trim());
  }
  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }
  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function call(action, body) {
    const scriptUrl = getScriptUrl();
    if (!scriptUrl) {
      throw new Error('Falta configurar la URL de Apps Script.');
    }
    const payload = Object.assign({ action, token: getToken() }, body || {});

    let res;
    try {
      res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error('No se pudo conectar con el backend. Revisa la URL de Apps Script y tu conexion.');
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('Respuesta inesperada del backend. Revisa que la URL de Apps Script sea correcta.');
    }

    if (!data.ok) {
      const message = data.error || 'Error desconocido';
      if (message === 'Token invalido o caducado' || message === 'No autenticado') {
        clearSession();
        const page = location.pathname.split('/').pop();
        if (page !== 'index.html' && page !== '') {
          location.href = 'index.html';
        }
      }
      throw new Error(message);
    }
    return data.data;
  }

  return { getScriptUrl, setScriptUrl, getToken, getUser, setSession, clearSession, call };
})();

// Redirige a la pantalla de configuracion si aun no se ha pegado la URL de
// Apps Script, o al login si no hay sesion. Devuelve el usuario si todo esta bien.
function requireRole(role) {
  if (!Api.getScriptUrl()) {
    location.href = 'setup.html';
    return null;
  }
  const user = Api.getUser();
  if (!user || !Api.getToken()) {
    location.href = 'index.html';
    return null;
  }
  if (user.role !== role) {
    location.href = user.role === 'supervisor' ? 'supervisor.html' : 'guard.html';
    return null;
  }
  return user;
}
