/**
 * Core recurrence engine.
 * Each function returns:
 *   isDue(task, now, events, config) → boolean
 *   nextDue(task, now, events, config) → Date | null
 *   getStatus(task, now, events, config) → { status, detail }
 */

function getTaskEvents(events, taskId) {
  return events.filter(e => e.task_id === taskId);
}

function isWorkday(date, config) {
  const dow = date.getDay() === 0 ? 7 : date.getDay(); // 1=Mon..7=Sun
  return config.workdays.includes(dow);
}

function isHoliday(date, config) {
  const d = date.toISOString().slice(0, 10);
  return (config.holidays || []).includes(d);
}

function isSeasonActive(task, date) {
  if (!task.season_gate || task.season_gate === 'all') return true;
  const month = date.getMonth() + 1;
  const seasons = {
    summer: [3, 4, 5, 6],
    monsoon: [7, 8, 9],
    winter: [10, 11, 12, 1, 2],
  };
  return (seasons[task.season_gate] || []).includes(month);
}

function isActiveMonth(task, date) {
  if (!task.active_months?.length) return true;
  return task.active_months.includes(date.getMonth() + 1);
}

function isPaused(task, now, events) {
  const taskEvents = getTaskEvents(events, task.id);
  const pauses = taskEvents.filter(e => e.type === 'pause');
  const resumes = taskEvents.filter(e => e.type === 'resume');

  const lastPause = pauses[pauses.length - 1];
  if (!lastPause) return false;

  const resumeAfterPause = resumes.find(r => r.ts > lastPause.ts);
  if (resumeAfterPause) return false;

  if (lastPause.duration === 'indefinite') return true;

  const pauseDate = new Date(lastPause.ts);
  if (lastPause.duration?.endsWith('d')) {
    const days = parseInt(lastPause.duration);
    return now < new Date(pauseDate.getTime() + days * 86400000);
  }
  if (lastPause.duration?.endsWith('w')) {
    const weeks = parseInt(lastPause.duration);
    return now < new Date(pauseDate.getTime() + weeks * 7 * 86400000);
  }
  // duration is a date string
  return now < new Date(lastPause.duration);
}

function isGatePassed(task, date, config) {
  if (!isWorkday(date, config) && task.recurrence.type !== 'stock') return false;
  if (isHoliday(date, config) && task.skip_calendar !== false) return false;
  if (!isSeasonActive(task, date)) return false;
  if (!isActiveMonth(task, date)) return false;
  return true;
}

// ─── Calendar-anchored ───
function calendarNextDue(task, now) {
  const { freq, days, count, day_of_month, nth_weekday } = task.recurrence;

  if (freq === 'daily') {
    return now; // due today
  }

  if (freq === 'weekly') {
    const targetDays = days || [];
    const today = new Date(now);
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dow = d.getDay() === 0 ? 7 : d.getDay();
      if (targetDays.includes(dow)) return d;
    }
    return null;
  }

  if (freq === 'monthly') {
    if (day_of_month) {
      const d = new Date(now.getFullYear(), now.getMonth(), day_of_month);
      if (d < now) d.setMonth(d.getMonth() + 1);
      return d;
    }
    if (nth_weekday) {
      // nth_weekday: { n: 2, weekday: 1 } (2nd Monday)
      const { n, weekday } = nth_weekday;
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstDow = first.getDay() === 0 ? 7 : first.getDay();
      let offset = (weekday - firstDow + 7) % 7;
      const target = new Date(first);
      target.setDate(1 + offset + (n - 1) * 7);
      if (target < now) {
        target.setMonth(target.getMonth() + 1);
        // recalculate for next month
        const nf = new Date(target.getFullYear(), target.getMonth(), 1);
        const nfDow = nf.getDay() === 0 ? 7 : nf.getDay();
        target.setDate(1 + ((weekday - nfDow + 7) % 7) + (n - 1) * 7);
      }
      return target;
    }
  }

  if (freq === 'quarterly' || freq === 'biannual' || freq === 'annual') {
    const months = freq === 'quarterly' ? 3 : freq === 'biannual' ? 6 : 12;
    const next = new Date(now);
    next.setMonth(next.getMonth() + months);
    return next;
  }

  return now;
}

// ─── Interval / Sequence ───
function intervalNextDue(task, now, events, config) {
  const { interval, unit = 'days' } = task.recurrence;
  const taskEvents = getTaskEvents(events, task.id);
  const doneEvents = taskEvents.filter(e => e.type === 'done');
  const lastDone = doneEvents[doneEvents.length - 1];

  const intervalMs = unit === 'days' ? interval * 86400000 : interval * 7 * 86400000;

  if (!lastDone) {
    // Never done — use task's initial_due or creation date
    const anchor = task.initial_due ? new Date(task.initial_due) : new Date(now);
    return new Date(anchor.getTime() + intervalMs);
  }

  const lastDoneDate = new Date(lastDone.ts);
  let next = new Date(lastDoneDate.getTime() + intervalMs);

  // If using workdays, skip non-workdays
  if (task.recurrence.workday_count) {
    let count = 0;
    while (count < interval) {
      next.setDate(next.getDate() + 1);
      if (isWorkday(next, config) && !isHoliday(next, config)) count++;
    }
  }

  return next;
}

// ─── Stock ───
function stockStatus(task, events) {
  const { threshold, initial_stock = 0 } = task.recurrence;
  const taskEvents = getTaskEvents(events, task.id);
  const consumes = taskEvents.filter(e => e.type === 'consume');
  const restocks = taskEvents.filter(e => e.type === 'restock');

  const consumed = consumes.reduce((s, e) => s + (e.qty || 1), 0);
  const restocked = restocks.reduce((s, e) => s + (e.qty || 0), 0);
  const current = initial_stock + restocked - consumed;

  return { current, threshold, due: current <= threshold };
}

// ─── Quota ───
function quotaStatus(task, now, events) {
  const { count, reset = 'monthly' } = task.recurrence;
  const taskEvents = getTaskEvents(events, task.id);
  const doneEvents = taskEvents.filter(e => e.type === 'done');

  // Filter to current period
  const periodStart = new Date(now);
  if (reset === 'monthly') {
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);
  } else if (reset === 'weekly') {
    const dow = periodStart.getDay() || 7;
    periodStart.setDate(periodStart.getDate() - dow + 1);
    periodStart.setHours(0, 0, 0, 0);
  } else if (reset === 'quarterly') {
    periodStart.setMonth(Math.floor(now.getMonth() / 3) * 3, 1);
    periodStart.setHours(0, 0, 0, 0);
  }

  const inPeriod = doneEvents.filter(e => new Date(e.ts) >= periodStart);
  const done = inPeriod.length;

  return { done, target: count, due: done < count };
}

// ─── Main dispatch ───
export function isDue(task, now, events, config) {
  if (isPaused(task, now, events)) return false;
  if (!isGatePassed(task, now, config)) return false;

  switch (task.recurrence.type) {
    case 'calendar': {
      const next = calendarNextDue(task, now);
      if (!next) return false;
      const isToday = next.toDateString() === now.toDateString();
      const isPast = next < now;
      return isToday || isPast;
    }
    case 'interval': {
      const next = intervalNextDue(task, now, events, config);
      return next <= now;
    }
    case 'stock': {
      const s = stockStatus(task, events);
      return s.due;
    }
    case 'quota': {
      const q = quotaStatus(task, now, events);
      return q.due;
    }
    case 'window': {
      const { start, end } = task.recurrence; // "09:00", "09:30"
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const nowH = now.getHours(), nowM = now.getMinutes();
      const inWindow = (nowH > sh || (nowH === sh && nowM >= sm)) &&
                       (nowH < eh || (nowH === eh && nowM <= em));
      return inWindow || (nowH > eh); // after window = missed
    }
    default:
      return false;
  }
}

export function nextDue(task, now, events, config) {
  if (isPaused(task, now, events)) return null;

  switch (task.recurrence.type) {
    case 'calendar': return calendarNextDue(task, now);
    case 'interval': return intervalNextDue(task, now, events, config);
    case 'stock': {
      const s = stockStatus(task, events);
      return s.due ? now : null;
    }
    case 'quota': {
      const q = quotaStatus(task, now, events);
      return q.due ? now : null;
    }
    case 'window': {
      const d = new Date(now);
      const [h, m] = task.recurrence.start.split(':').map(Number);
      d.setHours(h, m, 0, 0);
      if (d < now) d.setDate(d.getDate() + 1);
      return d;
    }
    default: return null;
  }
}

export function getStatus(task, now, events, config) {
  if (isPaused(task, now, events)) return { status: 'paused' };

  const doneEvents = getTaskEvents(events, task.id).filter(e => e.type === 'done');
  const todayDone = doneEvents.find(e => new Date(e.ts).toDateString() === now.toDateString());
  if (todayDone) return { status: 'done', detail: todayDone };

  const doingEvent = getTaskEvents(events, task.id).filter(e => e.type === 'doing').pop();
  if (doingEvent && !todayDone) return { status: 'doing', detail: doingEvent };

  const willDoEvent = getTaskEvents(events, task.id).filter(e => e.type === 'will_do').pop();
  if (willDoEvent && !todayDone) return { status: 'will_do', detail: willDoEvent };

  if (isDue(task, now, events, config)) {
    const nd = nextDue(task, now, events, config);
    const graceMs = (task.grace_minutes || 0) * 60000;
    if (nd && nd.getTime() + graceMs < now.getTime()) {
      return { status: 'missed' };
    }
    return { status: 'due' };
  }

  return { status: 'upcoming' };
}

export { stockStatus, quotaStatus, isPaused, isGatePassed };   