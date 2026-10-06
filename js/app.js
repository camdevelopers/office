import { store } from './store.js';
import { api } from './api.js';
import { renderDashboard, renderSignIn, renderAddTask, renderTaskDetail, renderSettings } from './render.js';

const app = {
  route: 'dashboard',
  selectedTask: null,

  async init() {
    await store.init();
    this.bindVisibility();
    this.render();

    if (store.state.user) {
      this.sync();
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  },

  bindVisibility() {
    const doSync = () => { if (store.state.user) this.sync(); };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') doSync();
    });
    window.addEventListener('pageshow', doSync);
    window.addEventListener('focus', doSync);
  },

  async sync() {
    try {
      const changed = await api.sync();
      if (changed) this.render();
    } catch (e) {
      console.warn('Sync failed:', e.message);
    }
  },

  render() {
    const appEl = document.getElementById('app');
    const { user } = store.state;

    if (!user) {
      appEl.innerHTML = renderSignIn();
      this.bindSignIn();
      return;
    }

    switch (this.route) {
      case 'dashboard':
        appEl.innerHTML = renderDashboard(store.state);
        this.bindCardActions();
        break;
      case 'add':
        appEl.innerHTML = renderAddTask(store.state);
        this.onTypeChange();
        break;
      case 'task':
        appEl.innerHTML = renderTaskDetail(this.selectedTask, store.state);
        break;
      case 'settings':
        appEl.innerHTML = renderSettings(store.state);
        break;
      case 'reports':
        appEl.innerHTML = `<div class="topbar"><div class="topbar-logo" onclick="app.navigate('dashboard')" style="cursor:pointer">← Back</div><div class="topbar-logo" style="color:var(--text)">Reports</div><div style="width:48px"></div></div><div class="empty-state"><div class="emoji">📊</div>Reports coming soon.</div>`;
        break;
    }
  },

  bindSignIn() {
    document.getElementById('si-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('si-name').value.trim();
      const pat = document.getElementById('si-pat').value.trim();
      const repoStr = document.getElementById('si-repo').value.trim();
      const errEl = document.getElementById('si-error');
      const btn = document.getElementById('si-btn');

      if (!name || !pat || !repoStr) {
        errEl.textContent = 'All fields required.';
        return;
      }

      const [owner, repoName] = repoStr.split('/');
      if (!owner || !repoName) {
        errEl.textContent = 'Repo format: owner/name';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Validating...';

      try {
        await api.validatePat(pat);
        store.set({
          user: { name, pat },
          repo: { owner, name: repoName },
        });
        await this.sync();
        this.render();
      } catch (e) {
        errEl.textContent = e.message || 'Failed to sign in.';
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });

    document.getElementById('si-pat')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('si-btn')?.click();
    });
  },

  navigate(route, param) {
    this.route = route;
    if (param) this.selectedTask = param;
    this.render();
  },

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.state.userPrefs.theme = next;
    store.set({ userPrefs: store.state.userPrefs });
  },

  async logEvent(taskId, type, extra = {}) {
    const { user } = store.state;
    if (!user) return;

    const event = {
      type,
      task_id: taskId,
      user: user.name,
      ...extra,
    };

    try {
      await api.appendEvent(event);
      const card = document.querySelector(`[data-task-id="${taskId}"]`);
      if (card) {
        card.classList.add('bounce');
        setTimeout(() => card.classList.remove('bounce'), 200);
      }
      this.render();
    } catch (e) {
      alert(`Failed to log: ${e.message}`);
    }
  },

  onTypeChange() {
    const typeEl = document.getElementById('task-type');
    const container = document.getElementById('type-fields');
    if (!typeEl || !container) return;
    const type = typeEl.value;

    const fields = {
      calendar: `
        <div class="form-group">
          <label>Frequency</label>
          <select id="cal-freq">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly (specific days)</option>
            <option value="monthly">Monthly (day of month)</option>
            <option value="monthly_nth">Monthly (Nth weekday)</option>
            <option value="quarterly">Quarterly</option>
            <option value="biannual">Bi-annual</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <div id="cal-sub-fields"></div>
      `,
      interval: `
        <div class="form-group">
          <label>Every</label>
          <input type="number" id="int-value" value="1" min="1">
        </div>
        <div class="form-group">
          <label>Unit</label>
          <select id="int-unit">
            <option value="days">Day(s)</option>
            <option value="weeks">Week(s)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Count workdays only?</label>
          <div class="toggle" id="int-workday" onclick="this.classList.toggle('active')"></div>
        </div>
        <div class="form-group">
          <label>Initial Due Date</label>
          <input type="date" id="int-initial">
        </div>
      `,
      stock: `
        <div class="form-group">
          <label>Item Name</label>
          <input type="text" id="stk-item" placeholder="e.g. water bottles">
        </div>
        <div class="form-group">
          <label>Unit</label>
          <input type="text" id="stk-unit" value="bottle" placeholder="e.g. bottle, pack">
        </div>
        <div class="form-group">
          <label>Initial Stock</label>
          <input type="number" id="stk-initial" value="12" min="0">
        </div>
        <div class="form-group">
          <label>Threshold (alert when ≤)</label>
          <input type="number" id="stk-threshold" value="2" min="0">
        </div>
        <div class="form-group">
          <label>Replenish To (target)</label>
          <input type="number" id="stk-replenish" value="12" min="1">
        </div>
      `,
      quota: `
        <div class="form-group">
          <label>Count per period</label>
          <input type="number" id="qta-count" value="4" min="1">
        </div>
        <div class="form-group">
          <label>Reset Period</label>
          <select id="qta-reset">
            <option value="weekly">Weekly</option>
            <option value="monthly" selected>Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </div>
      `,
      window: `
        <div class="form-group">
          <label>Window Start</label>
          <input type="time" id="win-start" value="09:00">
        </div>
        <div class="form-group">
          <label>Window End</label>
          <input type="time" id="win-end" value="09:30">
        </div>
        <div class="form-group">
          <label>Repeats</label>
          <select id="win-repeat">
            <option value="daily">Daily</option>
            <option value="workdays">Workdays only</option>
          </select>
        </div>
      `,
    };

    container.innerHTML = fields[type] || '';

    if (type === 'calendar') {
      const freqSelect = document.getElementById('cal-freq');
      const subContainer = document.getElementById('cal-sub-fields');

      const updateSub = () => {
        const freq = freqSelect.value;
        if (freq === 'weekly') {
          const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
          subContainer.innerHTML = `
            <div class="form-group">
              <label>Days</label>
              ${days.map((d, i) => `
                <label style="display:flex;align-items:center;gap:6px;margin:4px 0;font-size:13px">
                  <input type="checkbox" class="cal-day" value="${i + 1}"> ${d}
                </label>
              `).join('')}
            </div>`;
        } else if (freq === 'monthly') {
          subContainer.innerHTML = `
            <div class="form-group">
              <label>Day of month (1–31)</label>
              <input type="number" id="cal-dom" value="1" min="1" max="31">
            </div>`;
        } else if (freq === 'monthly_nth') {
          const weekdays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
          subContainer.innerHTML = `
            <div class="form-group">
              <label>Nth</label>
              <select id="cal-nth">
                <option value="1">1st</option><option value="2">2nd</option>
                <option value="3">3rd</option><option value="4">4th</option>
                <option value="5">Last</option>
              </select>
            </div>
            <div class="form-group">
              <label>Weekday</label>
              <select id="cal-nth-day">
                ${weekdays.map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}
              </select>
            </div>`;
        } else {
          subContainer.innerHTML = '';
        }
      };

      freqSelect.addEventListener('change', updateSub);
      updateSub();
    }
  },

  async saveTask() {
    const name = document.getElementById('task-name')?.value.trim();
    const assigned = document.getElementById('task-assigned')?.value.trim();
    const type = document.getElementById('task-type')?.value;
    const trackTime = document.getElementById('task-track')?.classList.contains('active');
    const grace = parseInt(document.getElementById('task-grace')?.value) || 0;

    if (!name) { alert('Task name required.'); return; }

    let recurrence = {};

    switch (type) {
      case 'calendar': {
        const freq = document.getElementById('cal-freq')?.value || 'daily';
        recurrence = { type: 'calendar', freq };
        if (freq === 'weekly') {
          recurrence.days = [...document.querySelectorAll('.cal-day:checked')].map(c => parseInt(c.value));
        } else if (freq === 'monthly') {
          recurrence.day_of_month = parseInt(document.getElementById('cal-dom')?.value) || 1;
        } else if (freq === 'monthly_nth') {
          recurrence.nth_weekday = {
            n: parseInt(document.getElementById('cal-nth')?.value),
            weekday: parseInt(document.getElementById('cal-nth-day')?.value),
          };
        }
        break;
      }
      case 'interval': {
        const value = parseInt(document.getElementById('int-value')?.value) || 1;
        const unit = document.getElementById('int-unit')?.value || 'days';
        const workdayCount = document.getElementById('int-workday')?.classList.contains('active');
        const initial = document.getElementById('int-initial')?.value;
        recurrence = { type: 'interval', interval: value, unit, workday_count: workdayCount };
        if (initial) recurrence.initial_due = initial;
        break;
      }
      case 'stock': {
        recurrence = {
          type: 'stock',
          item: document.getElementById('stk-item')?.value || 'item',
          unit: document.getElementById('stk-unit')?.value || 'unit',
          initial_stock: parseInt(document.getElementById('stk-initial')?.value) || 0,
          threshold: parseInt(document.getElementById('stk-threshold')?.value) || 0,
          replenish_to: parseInt(document.getElementById('stk-replenish')?.value) || 0,
        };
        break;
      }
      case 'quota': {
        recurrence = {
          type: 'quota',
          count: parseInt(document.getElementById('qta-count')?.value) || 1,
          reset: document.getElementById('qta-reset')?.value || 'monthly',
        };
        break;
      }
      case 'window': {
        recurrence = {
          type: 'window',
          start: document.getElementById('win-start')?.value || '09:00',
          end: document.getElementById('win-end')?.value || '09:30',
          repeat: document.getElementById('win-repeat')?.value || 'daily',
        };
        break;
      }
    }

    const task = {
      id: `task_${Date.now()}`,
      name,
      assigned_user: assigned || null,
      track_time: trackTime,
      grace_minutes: grace,
      recurrence,
      created_at: new Date().toISOString(),
      created_by: store.state.user?.name,
    };

    try {
      await api.saveTask(task, true);
      this.navigate('dashboard');
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    }
  },

  toggleWorkday(dayNum, el) {
    const { config } = store.state;
    const workdays = [...config.workdays];
    const idx = workdays.indexOf(dayNum);
    if (idx === -1) workdays.push(dayNum);
    else workdays.splice(idx, 1);
    workdays.sort();

    store.set({ config: { ...config, workdays } });
    el.classList.toggle('active');
    this._saveConfig();
  },

  togglePref(key, el) {
    const prefs = { ...store.state.userPrefs };
    prefs[key] = !prefs[key];
    store.set({ userPrefs: prefs });
    el.classList.toggle('active');
  },

  async _saveConfig() {
    try {
      const { config } = store.state;
      const meta = await api.getFileMeta('config.json').catch(() => null);
      await api.pushFile(
        'config.json',
        JSON.stringify(config, null, 2),
        `config: update by ${store.state.user?.name}`,
        meta?.sha
      );
      await this.sync();
    } catch (e) {
      console.warn('Config save failed:', e.message);
    }
  },

  signOut() {
    store.clear();
    this.route = 'dashboard';
    this.render();
  },

  bindCardActions() {
    document.querySelectorAll('.action-btn[data-action]')?.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const taskId = btn.dataset.task;
        this.logEvent(taskId, action);
      });
    });

    document.querySelectorAll('.task-card')?.forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn')) return;
        const id = card.dataset.taskId;
        const task = store.state.tasks.find(t => t.id === id);
        if (task) {
          this.selectedTask = task;
          this.navigate('task');
        }
      });
    });
  },
};

window.app = app;
app.init();   
