export const store = {
  state: {
    user: null,       // { name, pat }
    repo: null,       // { owner, name }
    tasks: [],
    events: [],
    config: { workdays: [1,2,3,4,5,6], holidays: [] },
    lastSeenSha: null,
    userPrefs: { collapse_on_complete: false, theme: 'dark' },
  },

  listeners: new Set(),

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
    const { user, repo, lastSeenSha, userPrefs } = this.state;
    if (user) localStorage.setItem('ot_user', JSON.stringify(user));
    if (repo) localStorage.setItem('ot_repo', JSON.stringify(repo));
    if (lastSeenSha) localStorage.setItem('ot_lastSha', lastSeenSha);
    if (userPrefs) localStorage.setItem('ot_prefs', JSON.stringify(userPrefs));
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
  },

  clear() {
    localStorage.clear();
    this.state = {
      user: null, repo: null, tasks: [], events: [],
      config: { workdays: [1,2,3,4,5,6], holidays: [] },
      lastSeenSha: null,
      userPrefs: { collapse_on_complete: false, theme: 'dark' },
    };
    this.listeners.forEach(fn => fn(this.state));
  },
};   