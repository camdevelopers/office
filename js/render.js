import { isDue, nextDue, getStatus, stockStatus, quotaStatus } from './recurrence.js';

function getInitials(name) {
  return name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function renderAvatar(name, isSelf) {
  return `<div class="avatar ${isSelf ? 'self' : 'other'}">${getInitials(name)}</div>`;
}

function renderTaskCard(task, state) {
  const { events, config, user } = state;
  const now = new Date();
  const status = getStatus(task, now, events, config);
  const isSelf = (name) => name === user?.name;

  const doneEvent = status.detail?.type === 'done' ? status.detail : null;
  const doer = doneEvent?.user || task.assigned_user;

  let badge = '';
  let badgeClass = '';
  switch (status.status) {
    case 'done': badge = '✓ Done'; badgeClass = 'badge-done'; break;
    case 'missed': badge = '✗ Missed'; badgeClass = 'badge-missed'; break;
    case 'paused': badge = '⏸ Paused'; badgeClass = 'badge-paused'; break;
    case 'doing': badge = '▶ Doing'; badgeClass = 'badge-doing'; break;
    case 'will_do': badge = '◷ Will do'; badgeClass = 'badge-will-do'; break;
    case 'due': badge = 'Due'; badgeClass = 'badge-due'; break;
  }

  // Stock bar
  let stockHtml = '';
  if (task.recurrence.type === 'stock') {
    const s = stockStatus(task, events);
    const max = task.recurrence.replenish_to || Math.max(s.current, s.threshold * 3);
    const pct = Math.min(100, Math.max(0, (s.current / max) * 100));
    const level = pct > 50 ? 'high' : pct > 25 ? 'medium' : 'low';
    stockHtml = `
      <div class="stock-bar-container">
        <div class="stock-bar-label">
          <span>${s.current} ${task.recurrence.unit || ''}</span>
          <span>threshold: ${s.threshold}</span>
        </div>
        <div class="stock-bar"><div class="stock-bar-fill ${level}" style="width:${pct}%"></div></div>
      </div>`;
  }

  // Quota ring
  let quotaHtml = '';
  if (task.recurrence.type === 'quota') {
    const q = quotaStatus(task, now, events);
    const pct = q.done / q.target;
    const circumference = 2 * Math.PI * 13;
    const offset = circumference * (1 - pct);
    quotaHtml = `
      <div class="quota-display">
        <svg class="quota-ring" viewBox="0 0 32 32">
          <circle class="bg" cx="16" cy="16" r="13"/>
          <circle class="fg" cx="16" cy="16" r="13"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"
            transform="rotate(-90 16 16)"/>
        </svg>
        <span>${q.done}/${q.target} this period</span>
      </div>`;
  }

  // Unavailability badge
  let unavailBadge = '';
  const unavailEvents = events.filter(e =>
    e.type === 'unavailable' && e.user === task.assigned_user
  );
  const lastUnavail = unavailEvents[unavailEvents.length - 1];
  if (lastUnavail) {
    const cleared = events.some(e => e.type === 'available' && e.user === task.assigned_user && e.ts > lastUnavail.ts);
    const ended = lastUnavail.end && new Date(lastUnavail.end) < now;
    if (!cleared && !ended) {
      unavailBadge = `<span title="${task.assigned_user} is ${lastUnavail.type}">🚫</span>`;
    }
  }

  const duration = task.track_time && doneEvent?.started_at
    ? `<span>⏱ ${Math.round((new Date(doneEvent.ts) - new Date(doneEvent.started_at)) / 60000)}m</span>`
    : '';

  return `
    <div class="task-card status-${status.status}" data-task-id="${task.id}">
      <div class="task-card-header">
        <div class="task-card-title">${task.name}</div>
        ${badge ? `<span class="task-card-badge ${badgeClass}">${badge}</span>` : ''}
      </div>
      <div class="task-card-meta">
        <span>${renderAvatar(doer, isSelf(doer))} ${doer}</span>
        ${unavailBadge}
        ${duration}
        ${doneEvent ? `<span>${timeAgo(doneEvent.ts)}</span>` : ''}
      </div>
      ${stockHtml}
      ${quotaHtml}
      <div class="task-card-actions">
        <button class="action-btn btn-will-do ${status.status === 'will_do' ? 'active-doing' : ''}" data-action="will_do" data-task="${task.id}">Will do</button>
        <button class="action-btn btn-doing ${status.status === 'doing' ? 'active-doing' : ''}" data-action="doing" data-task="${task.id}">Doing</button>
        <button class="action-btn btn-done ${status.status === 'done' ? 'active-done' : ''}" data-action="done" data-task="${task.id}">Done</button>
      </div>
    </div>`;
}

function renderSection(title, tasks, state, opts = {}) {
  if (!tasks.length && !opts.alwaysShow) {
    return '';
  }

  const allDone = tasks.length > 0 && tasks.every(t => getStatus(t, new Date(), state.events, state.config).status === 'done');
  const collapse = state.userPrefs.collapse_on_complete && allDone;

  if (collapse) {
    return `
      <div class="section">
        <div class="section-header">
          <span class="section-title accent">${title} ✓</span>
          <button class="action-btn" style="flex:none" onclick="this.closest('.section').classList.toggle('expanded')">Show</button>
        </div>
      </div>`;
  }

  return `
    <div class="section">
      <div class="section-header">
        <span class="section-title ${allDone ? 'accent' : ''}">${allDone ? `${title} ✓` : title}</span>
        <span class="section-count">${tasks.length}</span>
      </div>
      ${tasks.length
        ? `<div class="cards">${tasks.map(t => renderTaskCard(t, state)).join('')}</div>`
        : `<div class="empty-state"><div class="emoji">🎉</div>All clear!</div>`
      }
    </div>`;
}

function renderUnavailableStrip(state) {
  const now = new Date();
  const chips = state.events
    .filter(e => e.type === 'unavailable')
    .map(e => {
      const cleared = state.events.some(c => c.type === 'available' && c.user === e.user && c.ts > e.ts);
      const ended = e.end && new Date(e.end) < now;
      return !cleared && !ended ? e : null;
    })
    .filter(Boolean);

  // Deduplicate: only latest per user
  const seen = new Set();
  const unique = chips.filter(e => {
    if (seen.has(e.user)) return false;
    seen.add(e.user);
    return true;
  });

  if (!unique.length) return '';

  return `
    <div class="unavailable-strip">
      ${unique.map(e => `
        <div class="unavailable-chip">
          <span class="chip-icon">🚫</span>
          ${e.user} (${e.type})
        </div>
      `).join('')}
    </div>`;
}

export function renderDashboard(state) {
  const now = new Date();
  const { tasks, events, config } = state;

  const paused = tasks.filter(t => getStatus(t, now, events, config).status === 'paused');
  const active = tasks.filter(t => getStatus(t, now, events, config).status !== 'paused');

  const todayTasks = active.filter(t => isDue(t, now, events, config));
  const missed = active.filter(t => getStatus(t, now, events, config).status === 'missed');
  const upcoming = active.filter(t => {
    const nd = nextDue(t, now, events, config);
    return nd && nd > now && nd < new Date(now.getTime() + 7 * 86400000);
  });

  const stockTasks = active.filter(t => t.recurrence.type === 'stock');
  const quotaTasks = active.filter(t => t.recurrence.type === 'quota');

  return `
    <div class="topbar">
      <div class="topbar-logo">📋 Office Tasks</div>
      <div class="topbar-actions">
        <button class="topbar-btn" onclick="app.navigate('settings')">⚙️</button>
        <button class="topbar-btn" onclick="app.toggleTheme()">🌓</button>
      </div>
    </div>

    ${renderUnavailableStrip(state)}

    ${renderSection('Today', todayTasks, state)}
    ${renderSection('Missed', missed, state)}
    ${renderSection('Upcoming (7d)', upcoming, state)}
    ${stockTasks.length ? renderSection('Stock', stockTasks, state) : ''}
    ${quotaTasks.length ? renderSection('Quotas', quotaTasks, state) : ''}
    ${renderSection('Paused', paused, state)}

    <button class="fab" onclick="app.navigate('add')">+</button>

    <nav class="bottom-nav">
      <button class="nav-item active" onclick="app.navigate('dashboard')"><span class="nav-icon">📋</span>Dashboard</button>
      <button class="nav-item" onclick="app.navigate('reports')"><span class="nav-icon">📊</span>Reports</button>
      <button class="nav-item" onclick="app.navigate('settings')"><span class="nav-icon">⚙️</span>Settings</button>
    </nav>
  `;
}

export function renderSignIn() {
  return `
    <div class="signin-container">
      <div class="signin-card">
        <h1>📋 Office Tasks</h1>
        <p>Sign in to sync your team's tasks.</p>
        <div class="form-group">
          <label>Your Name</label>
          <input type="text" id="si-name" placeholder="e.g. Rahul" autocomplete="off">
        </div>
        <div class="form-group">
          <label>GitHub Personal Access Token</label>
          <input type="password" id="si-pat" placeholder="ghp_..." autocomplete="off">
          <div class="hint">Needs <code>repo</code> scope for private repos.</div>
        </div>
        <div class="form-group">
          <label>Repository (owner/name)</label>
          <input type="text" id="si-repo" placeholder="e.g. myorg/office-tasks" autocomplete="off">
        </div>
        <button class="btn-primary" id="si-btn">Sign In</button>
        <div class="form-error" id="si-error"></div>
      </div>
    </div>`;
}

export function renderAddTask(state) {
  return `
    <div class="topbar">
      <div class="topbar-logo" onclick="app.navigate('dashboard')" style="cursor:pointer">← Back</div>
      <div class="topbar-logo" style="color:var(--text)">Add Task</div>
      <div style="width:48px"></div>
    </div>

    <div class="settings-group">
      <div class="form-group">
        <label>Task Name</label>
        <input type="text" id="task-name" placeholder="e.g. Water plants">
      </div>
      <div class="form-group">
        <label>Assigned To (display only)</label>
        <input type="text" id="task-assigned" placeholder="e.g. Rahul">
      </div>
      <div class="form-group">
        <label>Recurrence Type</label>
        <select id="task-type" onchange="app.onTypeChange()">
          <option value="calendar">Calendar (daily, weekly, monthly...)</option>
          <option value="interval">Interval / Sequence (every N days)</option>
          <option value="stock">Stock / Inventory</option>
          <option value="quota">Quota / Count</option>
          <option value="window">Time Window</option>
        </select>
      </div>

      <div id="type-fields"></div>

      <div class="form-group">
        <label>Track Time? (show duration on done)</label>
        <div class="toggle" id="task-track" onclick="this.classList.toggle('active')"></div>
      </div>

      <div class="form-group">
        <label>Grace Period (minutes)</label>
        <input type="number" id="task-grace" value="15" min="0" max="1440">
      </div>

      <button class="btn-primary" onclick="app.saveTask()">Save Task</button>
    </div>
  `;
}

export function renderTaskDetail(task, state) {
  const now = new Date();
  const status = getStatus(task, now, state.events, state.config);
  const taskEvents = state.events.filter(e => e.task_id === task.id).sort((a, b) => b.ts.localeCompare(a.ts));

  const actionLabels = {
    done: '✓ Done', doing: '▶ Doing', will_do: '◷ Will do',
    pause: '⏸ Paused', resume: '▶ Resumed',
    consume: '− Consumed', restock: '+ Restocked',
  };

  return `
    <div class="topbar">
      <div class="topbar-logo" onclick="app.navigate('dashboard')" style="cursor:pointer">← Back</div>
      <div class="topbar-logo" style="color:var(--text);font-size:16px">${task.name}</div>
      <div style="width:48px"></div>
    </div>

    <div class="settings-group">
      <div class="setting-row">
        <label>Status</label>
        <span class="task-card-badge badge-${status.status}">${status.status}</span>
      </div>
      <div class="setting-row">
        <label>Assigned</label>
        <span>${task.assigned_user || '—'}</span>
      </div>
      <div class="setting-row">
        <label>Type</label>
        <span>${task.recurrence.type}</span>
      </div>
      ${task.grace_minutes ? `<div class="setting-row"><label>Grace</label><span>${task.grace_minutes} min</span></div>` : ''}
    </div>

    <div class="settings-group">
      <h3>Event Log</h3>
      ${taskEvents.length ? `
        <ul class="timeline">
          ${taskEvents.map(e => `
            <li class="timeline-item">
              <div class="timeline-dot ${e.type}"></div>
              <div class="timeline-content">
                <div class="timeline-action">${actionLabels[e.type] || e.type} — ${e.user}</div>
                <div class="timeline-meta">${new Date(e.ts).toLocaleString()}${e.reason ? ` · ${e.reason}` : ''}${e.qty ? ` · qty: ${e.qty}` : ''}</div>
              </div>
            </li>
          `).join('')}
        </ul>
      ` : '<div class="empty-state">No events yet.</div>'}
    </div>

    <div class="settings-group" style="display:flex;gap:8px">
      <button class="action-btn btn-will-do" style="flex:1" onclick="app.logEvent('${task.id}','will_do')">Will do</button>
      <button class="action-btn btn-doing" style="flex:1" onclick="app.logEvent('${task.id}','doing')">Doing</button>
      <button class="action-btn btn-done" style="flex:1" onclick="app.logEvent('${task.id}','done')">Done</button>
    </div>
  `;
}

export function renderSettings(state) {
  const { config, userPrefs, repo } = state;
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  return `
    <div class="topbar">
      <div class="topbar-logo" onclick="app.navigate('dashboard')" style="cursor:pointer">← Back</div>
      <div class="topbar-logo" style="color:var(--text)">Settings</div>
      <div style="width:48px"></div>
    </div>

    <div class="settings-group">
      <h3>Workdays</h3>
      ${days.map((d, i) => {
        const dayNum = i + 1;
        const active = config.workdays.includes(dayNum);
        return `
          <div class="setting-row">
            <label>${d}</label>
            <div class="toggle ${active ? 'active' : ''}" onclick="app.toggleWorkday(${dayNum}, this)"></div>
          </div>`;
      }).join('')}
    </div>

    <div class="settings-group">
      <h3>Preferences</h3>
      <div class="setting-row">
        <label>Collapse completed sections</label>
        <div class="toggle ${userPrefs.collapse_on_complete ? 'active' : ''}" onclick="app.togglePref('collapse_on_complete', this)"></div>
      </div>
    </div>

    <div class="settings-group">
      <h3>Repository</h3>
      <div class="setting-row"><label>Owner / Name</label><span>${repo?.owner}/${repo?.name}</span></div>
      <div class="setting-row"><label>User</label><span>${state.user?.name}</span></div>
    </div>

    <div class="settings-group">
      <h3>Danger Zone</h3>
      <button class="action-btn" style="width:100%;color:var(--missed);border-color:var(--missed)" onclick="if(confirm('Clear all local data?')) app.signOut()">Sign Out & Clear Data</button>
    </div>
  `;
}   