// ============================================================================
// auth.js — simple role-based auth (demo). Session persisted via LocalStore
// (js/local-store.js -- IndexedDB-backed, replaces window.localStorage; see
// Step "Replace Local Storage").
// Roles: Field Surveyor, Agronomist, Manager, Administrator
// ============================================================================

const Auth = (() => {
  const SESSION_KEY = 'cct_session';

  function login(username, password) {
    return DB.get('users', username).then(user => {
      if (!user || user.password !== password) throw new Error('Invalid username or password');
      const session = { username: user.username, name: user.name, role: user.role, loginAt: Utils.nowIso() };
      LocalStore.setItem(SESSION_KEY, JSON.stringify(session));
      DB.logAudit(session, 'LOGIN', 'session', user.username);
      return session;
    });
  }

  function logout() {
    const s = currentUser();
    if (s) DB.logAudit(s, 'LOGOUT', 'session', s.username);
    LocalStore.removeItem(SESSION_KEY);
  }

  function currentUser() {
    try {
      const raw = LocalStore.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function isAuthenticated() { return !!currentUser(); }

  function hasRole(...roles) {
    const u = currentUser();
    return u ? roles.includes(u.role) : false;
  }

  const PERMISSIONS = {
    'Field Surveyor':  { createSurvey: true,  editOwnSurvey: true,  editAnySurvey: false, validate: false, adjustEstimate: false, viewDashboards: true,  manageUsers: false, manageMasterData: false },
    'Agronomist':      { createSurvey: true,  editOwnSurvey: true,  editAnySurvey: true,  validate: true,  adjustEstimate: true,  viewDashboards: true,  manageUsers: false, manageMasterData: false },
    'Manager':         { createSurvey: false, editOwnSurvey: false, editAnySurvey: false, validate: false, adjustEstimate: true,  viewDashboards: true,  manageUsers: false, manageMasterData: false },
    'Administrator':   { createSurvey: true,  editOwnSurvey: true,  editAnySurvey: true,  validate: true,  adjustEstimate: true,  viewDashboards: true,  manageUsers: true,  manageMasterData: true },
  };

  function can(permission) {
    const u = currentUser();
    if (!u) return false;
    const p = PERMISSIONS[u.role];
    return !!(p && p[permission]);
  }

  return { login, logout, currentUser, isAuthenticated, hasRole, can, PERMISSIONS };
})();
