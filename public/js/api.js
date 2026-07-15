// Cliente para el backend en Google Apps Script, usando JSONP (una etiqueta
// <script> dinamica) en vez de fetch(). Los Web Apps de Apps Script no
// devuelven de forma fiable las cabeceras CORS que fetch() exige para poder
// leer la respuesta entre dominios distintos (github.io -> script.google.com),
// asi que fetch falla con "Failed to fetch" incluso cuando el backend
// responde bien. Una etiqueta <script src="..."> no esta sujeta a CORS, por
// eso es la forma clasica y fiable de hablar con Apps Script desde fuera.
// El backend (ver jsonOutput_ en apps-script/Code.gs) responde con
// "callback(...)" cuando se le manda un parametro callback.

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

  let jsonpCounter = 0;

  function call(action, body) {
    return new Promise((resolve, reject) => {
      const scriptUrl = getScriptUrl();
      if (!scriptUrl) {
        reject(new Error('Falta configurar la URL de Apps Script.'));
        return;
      }
      const payload = Object.assign({ action, token: getToken() }, body || {});
      const params = new URLSearchParams();
      Object.keys(payload).forEach((k) => {
        if (payload[k] !== undefined && payload[k] !== null) params.set(k, payload[k]);
      });

      jsonpCounter += 1;
      const callbackName = `rondasCb${Date.now()}_${jsonpCounter}`;
      params.set('callback', callbackName);

      const separator = scriptUrl.includes('?') ? '&' : '?';
      const url = scriptUrl + separator + params.toString();

      const script = document.createElement('script');
      let settled = false;

      const cleanup = () => {
        delete window[callbackName];
        script.remove();
        clearTimeout(timer);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('No se pudo conectar con el backend (tiempo de espera agotado). Revisa la URL de Apps Script y tu conexion.'));
      }, 20000);

      window[callbackName] = (data) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!data.ok) {
          const message = data.error || 'Error desconocido';
          if (message === 'Token invalido o caducado' || message === 'No autenticado') {
            clearSession();
            const page = location.pathname.split('/').pop();
            if (page !== 'index.html' && page !== '') {
              location.href = 'index.html';
            }
          }
          reject(new Error(message));
        } else {
          resolve(data.data);
        }
      };

      script.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('No se pudo conectar con el backend. Revisa la URL de Apps Script y tu conexion.'));
      };

      script.src = url;
      document.head.appendChild(script);
    });
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
