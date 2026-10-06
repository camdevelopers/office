import { store } from './store.js';

const BASE = 'https://api.github.com';

function headers() {
  const { user } = store.state;
  return {
    'Authorization': `token ${user.pat}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'OfficeTasks-PWA',
  };
}

async function gh(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub API ${res.status}`);
  }
  return res;
}

export const api = {

  async validatePat(pat) {
    const res = await fetch(`${BASE}/user`, {
      headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!res.ok) throw new Error('Invalid PAT');
    return res.json();
  },

  async getLatestCommit() {
    const { repo } = store.state;
    const res = await gh(`/repos/${repo.owner}/${repo.name}/commits?per_page=1`);
    return res.json();
  },

  async getFileContent(path, sha) {
    const { repo } = store.state;
    const ref = sha ? `?ref=${sha}` : '';
    const res = await gh(`/repos/${repo.owner}/${repo.name}/contents/${path}${ref}`, {
      headers: { ...headers(), 'Accept': 'application/vnd.github.raw' },
    });
    return res.text();
  },

  async getFileMeta(path) {
    const { repo } = store.state;
    const res = await gh(`/repos/${repo.owner}/${repo.name}/contents/${path}`);
    return res.json();
  },

  async pushFile(path, content, message, sha) {
    const { repo } = store.state;
    const body = {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
    };
    if (sha) body.sha = sha;
    const res = await gh(`/repos/${repo.owner}/${repo.name}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return res.json();
  },

  async sync() {
    const { lastSeenSha } = store.state;
    const commits = await this.getLatestCommit();
    const latestSha = commits[0]?.sha;

    if (latestSha === lastSeenSha) return false; // no change

    const [tasksRaw, eventsRaw, configRaw] = await Promise.all([
      this.getFileContent('tasks.json', latestSha).catch(() => '[]'),
      this.getFileContent('events.json', latestSha).catch(() => '[]'),
      this.getFileContent('config.json', latestSha).catch(() => '{}'),
    ]);

    const tasks = JSON.parse(tasksRaw);
    const events = JSON.parse(eventsRaw);
    const config = JSON.parse(configRaw || '{}');

    store.set({
      tasks,
      events,
      config: { workdays: config.workdays || [1,2,3,4,5,6], holidays: config.holidays || [] },
      lastSeenSha: latestSha,
    });
    return true;
  },

  async appendEvent(event) {
    const { repo, lastSeenSha } = store.state;
    event.ts = new Date().toISOString();

    let sha;
    try {
      const meta = await this.getFileMeta('events.json');
      sha = meta.sha;
    } catch {
      sha = undefined; // file doesn't exist yet
    }

    const current = sha
      ? JSON.parse(await this.getFileContent('events.json'))
      : [];

    current.push(event);

    await this.pushFile(
      'events.json',
      JSON.stringify(current, null, 2),
      `${event.type}: ${event.task_id || 'global'} by ${event.user}`,
      sha
    );

    // Re-sync to get the new SHA
    await this.sync();
  },

  async saveTask(task, isNew) {
    const { repo } = store.state;
    let sha;
    let tasks;

    try {
      const meta = await this.getFileMeta('tasks.json');
      sha = meta.sha;
      tasks = JSON.parse(await this.getFileContent('tasks.json'));
    } catch {
      tasks = [];
    }

    if (isNew) {
      tasks.push(task);
    } else {
      const idx = tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) tasks[idx] = task;
    }

    await this.pushFile(
      'tasks.json',
      JSON.stringify(tasks, null, 2),
      `${isNew ? 'Add' : 'Update'} task: ${task.name}`,
      sha
    );

    await this.sync();
  },
};   