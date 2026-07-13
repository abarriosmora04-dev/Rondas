const Api = (() => {
  function getToken() {
    return localStorage.getItem('rondas_token');
  }
  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('rondas_user') || 'null');
    } catch {
      return null;
    }
  }
  function setSession(token, user) {
    localStorage.setItem('rondas_token', token);
    localStorage.setItem('rondas_user', JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem('rondas_token');
    localStorage.removeItem('rondas_user');
  }

  async function request(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.status === 401) {
      clearSession();
      if (!location.pathname.endsWith('index.html') && location.pathname !== '/') {
        location.href = '/index.html';
      }
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `Error ${res.status}`);
    }
    return data;
  }

  return {
    getToken,
    getUser,
    setSession,
    clearSession,
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body || {}),
    patch: (url, body) => request('PATCH', url, body || {}),
    del: (url) => request('DELETE', url),
  };
})();

function requireRole(role) {
  const user = Api.getUser();
  if (!user || !Api.getToken()) {
    location.href = '/index.html';
    return null;
  }
  if (user.role !== role) {
    location.href = user.role === 'supervisor' ? '/supervisor.html' : '/guard.html';
    return null;
  }
  return user;
}
