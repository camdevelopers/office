import { openDB, dbSet, dbGet, dbClear } from './db.js';

export const store = {
  state: {
    user: null,
    repo: null,
    tasks: [],
    events: [],
    config: { workdays: [1, 2, 3, 4, 5, 6], holidays: [] },
    lastSeenSha: null,
    userPrefs: { collapse_on_complete: false, theme: 'dark' },
  },

  listeners: new Set(),

  async init() {
    await openDB();
    this.restore();
  },

  set(partial) {
    Object.assign(this.state, partial);
    this._persist();
    this.listeners.forEach(fn => fn(this.state));
  },

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  _persist() {
    const { user, repo, tasks, events, config, lastSeenSha, userPrefs } = this.state;
    if (user) localStorage.setItem('ot_user', JSON.stringify(user));
    if (repo) localStorage.setItem('ot_repo', JSON.stringify(repo));
    if (lastSeenSha) localStorage.setItem('ot_lastSha', lastSeenSha);
    if (userPrefs) localStorage.setItem('ot_prefs', JSON.stringify(userPrefs));

    // Heavy data → IndexedDB
    if (tasks) dbSet('tasks', tasks);
    if (events) dbSet('events', events);
    if (config) dbSet('config', config);
  },

  restore() {
    const user = JSON.parse(localStorage.getItem('ot_user') || 'null');
    const repo = JSON.parse(localStorage.getItem('ot_repo') || 'null');
    const lastSeenSha = localStorage.getItem('ot_lastSha');
    const userPrefs = JSON.parse(localStorage.getItem('ot_prefs') || 'null');
    if (user) this.state.user = user;
    if (repo) this.state.repo = repo;
    if (lastSeenSha) this.state.lastSeenSha = lastSeenSha;
    if (userPrefs) this.state.userPrefs = { ...this.state.userPrefs, ...userPrefs };

    // Restore heavy data from IndexedDB (async)
    dbGet('tasks').then(t => { if (t) this.state.tasks = t; });
    dbGet('events').then(e => { if (e) this.state.events = e; });
    dbGet('config').then(c => { if (c) this.state.config = c; });
  },

  async clear() {
    localStorage.clear();
    await dbClear();
    this.state = {
      user: null, repo: null, tasks: [], events: [],
      config: { workdays: [1, 2, 3, 4, 5, 6], holidays: [] },
      lastSeenSha: null,
      userPrefs: { collapse_on_complete: false, theme: 'dark' },
    };
    this.listeners.forEach(fn => fn(this.state));
  },
};   
