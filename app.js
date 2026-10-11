/* Fit Tracker - front end. Plain JavaScript, no build step. Talks to the Apps Script web app. */
'use strict';

const APP_VERSION = '1.1.1';
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('ft_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ft_' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem('ft_' + k); } catch (e) { /* ignore */ } }
};

const THEMES = [
  { id: 'fairway', name: 'Fairway', mode: 'light', note: 'Light · soft green-grey with fairway green', bg: '#F2F5F3', card: '#FFFFFF', accent: '#0B6B40', track: '#E3EAE6' },
  { id: 'night', name: 'Night Round', mode: 'dark', note: 'Dark · deep green with bright mint', bg: '#0D1512', card: '#16211C', accent: '#3DD68C', track: '#26352E' },
  { id: 'coast', name: 'Coast', mode: 'light', note: 'Light · cool blue-grey with ocean blue', bg: '#EFF3F7', card: '#FFFFFF', accent: '#0A5C8A', track: '#DDE5EC' },
  { id: 'midnight', name: 'Midnight', mode: 'dark', note: 'Dark · navy with sky blue', bg: '#0C1220', card: '#151D2E', accent: '#5CC8F5', track: '#263149' },
  { id: 'graphite', name: 'Graphite', mode: 'dark', note: 'Dark · true black with lime', bg: '#000000', card: '#141414', accent: '#C2E84B', track: '#2A2A2A' }
];

const S = {
  conn: LS.get('conn', null),          // { url, pin }
  data: null,                          // last copy of the Sheet data, loaded from the phone's cache at start-up
  queue: LS.get('queue', []),          // entries saved while offline
  prefs: LS.get('prefs', { follow: false, light: 'fairway', dark: 'night', theme: 'fairway' }),
  view: 'today', date: null, range: 30, syncing: false, syncError: ''
};

/* ---------- dates and numbers ---------- */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const nowTime = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const parseYmd = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nice = (s) => { const d = parseYmd(s); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; };
const fmt = (n, dp) => (n === null || n === undefined || isNaN(n)) ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: dp || 0, minimumFractionDigits: 0 });
const sum = (a) => a.reduce((s, v) => s + (Number(v) || 0), 0);
const avg = (a) => a.length ? sum(a) / a.length : null;
const shortUrl = (u) => { u = String(u || ''); return u.length > 70 ? u.slice(0, 44) + '…' + u.slice(-18) : u; };
const clock = (ms) => { const d = new Date(ms); return (ymd(d) === today() ? '' : nice(ymd(d)) + ' ') + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const hm = (min) => (min === null || min === undefined) ? '–' : Math.floor(min / 60) + ' h ' + pad(Math.round(min % 60)) + ' m';
const numOrNull = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; };

/* ---------- theme ---------- */
function applyTheme() {
  const p = S.prefs;
  let id = p.theme;
  if (p.follow) id = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? p.dark : p.light;
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.dataset.theme = t.id;
  const meta = $('meta[name="theme-color"]'); if (meta) meta.content = t.bg;
}
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------- toast ---------- */
let toastTimer = 0;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ---------- server ---------- */
async function api(action, payload, conn) {
  const c = conn || S.conn;
  if (/[?&]hook=/.test(c.url)) throw new Error('This phone is set up with the Watch webhook URL. Use Change connection and paste the App URL instead: the one ending in /exec.');
  const res = await fetch(c.url, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // keeps the browser from sending a pre-flight request Apps Script cannot answer
    body: JSON.stringify(Object.assign({ action: action, pin: c.pin }, payload || {}))
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error('Google could not find a web app at the App URL (error 404). The deployment it points to may have been archived or replaced, or the URL is incomplete. Copy the App URL again from the Sheet (Fit Tracker > Show connection details) and use Change connection.');
    if (res.status === 401 || res.status === 403) throw new Error('Google refused the request (error ' + res.status + '). In Apps Script, open Deploy > Manage deployments and check "Who has access" is set to Anyone.');
    throw new Error('Google answered with error ' + res.status + '. Try again in a minute.');
  }
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('Unexpected reply. Check the app URL, and that the web app is deployed for "Anyone".'); }
  if (!j.ok) throw new Error(j.error || 'Request failed.');
  return j.data;
}
const isOffline = (e) => e instanceof TypeError; // fetch throws TypeError when the network is unreachable

/* ---------- on-phone cache ----------
   The copy of your data is kept in IndexedDB. It has far more room than localStorage, whose small
   allowance is shared by every app on the same github.io address. */
const IDB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      if (!('indexedDB' in window)) { rej(new Error('IndexedDB is not available')); return; }
      const r = indexedDB.open('fit-tracker', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('Could not open the cache'));
    });
  },
  async tx(mode, fn) {
    if (!this.db) this.db = await this.open();
    return new Promise((res, rej) => {
      const t = this.db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => res(req.result);
      t.onerror = t.onabort = () => rej(t.error || new Error('Cache write failed'));
    });
  },
  get(k) { return this.tx('readonly', (st) => st.get(k)).then((v) => (v === undefined ? null : v)); },
  set(k, v) { return this.tx('readwrite', (st) => st.put(v, k)); },
  del(k) { return this.tx('readwrite', (st) => st.delete(k)); }
};

async function loadCache() {
  let d = null;
  try { d = await IDB.get('data'); } catch (e) { /* fall through to the older store */ }
  return d || LS.get('data', null);
}

/** Keeps the latest data on the phone so the app opens instantly next time. Records whether the save worked. */
/** A real reply has your meals in it. Anything else means the URL points at the wrong thing. */
function checkData(d) {
  if (!d || !Array.isArray(d.meals)) throw new Error('The URL answered, but not with your data. Make sure it is the App URL (ending in /exec), not the Watch webhook URL.');
  return d;
}

function saveData() {
  if (!S.data) return Promise.resolve();
  const count = (S.data.meals || []).length;
  return IDB.set('data', S.data).then(() => {
    LS.del('data'); // the older, smaller store is no longer needed
    S.cache = { ok: true, at: Date.now(), meals: count }; LS.set('cache', S.cache);
  }).catch((e) => {
    try { localStorage.setItem('ft_data', JSON.stringify(S.data)); S.cache = { ok: true, at: Date.now(), meals: count }; }
    catch (e2) { S.cache = { ok: false, error: String((e2 && e2.name) || (e && e.message) || 'unknown') }; }
    LS.set('cache', S.cache);
  });
}

async function flushQueue() {
  while (S.queue.length) {
    const q = S.queue[0];
    try { await api(q.action, q.payload); } catch (e) { if (isOffline(e)) return false; /* a rejected entry is dropped so it cannot block the rest */ }
    S.queue.shift(); LS.set('queue', S.queue);
  }
  return true;
}

async function sync(quiet) {
  if (!S.conn || S.syncing) return;
  S.syncing = true; S.syncError = ''; paintSync();
  const began = Date.now();
  try {
    await flushQueue();
    S.data = checkData(await api('bootstrap', { days: 100 }));
    saveData();
    S.lastSync = { at: Date.now(), ms: Date.now() - began }; LS.set('lastSync', S.lastSync);
    // redraw with the fresh data, unless you are in the middle of typing on this screen
    const el = document.activeElement;
    if (!(el && $('#view').contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) render();
  } catch (e) {
    S.syncError = isOffline(e) ? (S.data ? 'Offline - showing saved data' : 'Could not reach the Sheet, and there is no saved copy on this phone yet. Check your connection.') : e.message;
    if (!quiet) toast(S.syncError);
    if (/Wrong PIN|No PIN/.test(e.message)) { S.syncing = false; return showSetup(e.message); }
    if (!S.data) { S.syncing = false; return render(); } // nothing cached yet: show the problem on the loading screen
  }
  S.syncing = false; paintSync();
}
function paintSync() {
  const el = $('#syncState'); if (!el) return;
  el.textContent = S.syncing ? 'Syncing…' : (S.syncError || (S.queue.length ? S.queue.length + ' waiting to upload' : ''));
}

/** Saves to the Sheet; if offline, keeps simple new entries in a queue and shows them straight away. */
async function write(action, payload, applyLocal, canQueue) {
  try {
    const out = await api(action, payload);
    applyLocal(out, false); saveData(); return true;
  } catch (e) {
    if (isOffline(e) && canQueue) {
      S.queue.push({ action: action, payload: payload }); LS.set('queue', S.queue);
      applyLocal(null, true); saveData(); toast('Saved on this phone. It will upload when you are back online.'); return true;
    }
    toast(isOffline(e) ? 'You are offline. Try again when connected.' : e.message); return false;
  }
}

function upsert(list, row, key) {
  const i = list.findIndex((x) => x[key] === row[key]);
  if (i === -1) list.push(row); else list[i] = row;
}

/* ---------- bottom sheet ---------- */
const sheet = $('#sheet');
function openSheet(html, full) {
  sheet.className = full ? 'full' : '';
  sheet.innerHTML = '<div class="sheet-body">' + html + '</div>';
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
  return sheet;
}
function closeSheet() { if (sheet.open) sheet.close(); sheet.innerHTML = ''; }
sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-close]')) closeSheet(); });
const sheetHead = (title) => '<div class="sheet-head"><h2 id="sheetTitle">' + esc(title) + '</h2><button class="icon-btn" data-close aria-label="Close"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button></div>';
const field = (label, name, value, attrs) => '<label class="field">' + esc(label) + '<input name="' + name + '" value="' + esc(value === null || value === undefined ? '' : value) + '" ' + (attrs || '') + '></label>';
const numField = (label, name, value, step) => field(label, name, value, 'type="number" inputmode="decimal" step="' + (step || 'any') + '" min="0"');
const formValues = (form) => { const o = {}; new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; }); return o; };
function busy(btn, on, label) { if (!btn) return; btn.disabled = on; if (label) btn.textContent = label; }

/* ---------- data lookups ---------- */
const D = () => S.data || { meals: [], body: [], activities: [], sleep: [], reports: [], goals: null };
const goals = () => D().goals || {};
/** The targets that applied on a given day, so old days are judged against the target of the time. */
const goalsOn = (d) => {
  const hist = (D().goalHistory || []).filter((g) => g.effective_from).sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  let pick = hist[0] || goals();
  hist.forEach((g) => { if (g.effective_from <= d) pick = g; });
  return pick || {};
};
const mealsOn = (d) => D().meals.filter((m) => m.date === d).sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || (a.id > b.id ? 1 : -1));
const bodyOn = (d) => D().body.find((b) => b.date === d) || null;
const sleepOn = (d) => D().sleep.find((s) => s.date === d) || null;
const actsOn = (d) => D().activities.filter((a) => a.date === d);

/* ================================================================== */
/* Setup screen                                                        */
/* ================================================================== */
function showSetup(message) {
  $('#nav').hidden = true;
  const c = S.conn || { url: '', pin: '' };
  $('#view').innerHTML =
    '<div class="head"><div><div class="eyebrow">Welcome</div><h1>Fit Tracker</h1></div></div>' +
    '<div id="setupMsg" role="alert">' + (message ? '<div class="callout">' + esc(message) + '</div>' : '') + '</div>' +
    '<form id="setupForm" class="card">' +
    '<p class="mute small">Connect this app to your Google Sheet. In the Sheet, open the menu <b>Fit Tracker › Show connection details</b> and copy the App URL.</p>' +
    field('App URL', 'url', c.url, 'type="url" required placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"') +
    field('PIN', 'pin', '', 'type="password" required autocomplete="current-password"') +
    '<button class="btn primary" type="submit">Connect</button></form>' + (S.conn && S.data ? '<button class="btn" id="cancelSetup">Cancel</button>' : '');
  const cancel = $('#cancelSetup'); if (cancel) cancel.onclick = () => render();
  $('#setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(e.target), btn = $('button', e.target);
    busy(btn, true, 'Connecting…');
    try {
      const conn = { url: v.url.trim(), pin: v.pin };
      if (/[?&]hook=/.test(conn.url)) throw new Error('That is the Watch webhook URL. Paste the App URL instead: the one ending in /exec.');
      if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(conn.url) && !/^http:\/\/localhost/.test(conn.url)) throw new Error('The App URL should start with https://script.google.com/ and end with /exec.');
      await api('ping', {}, conn);
      const data = checkData(await api('bootstrap', { days: 100 }, conn));
      S.conn = conn; LS.set('conn', conn); IDB.set('conn', conn).catch(() => {});
      S.data = data; S.syncError = ''; saveData();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); // ask the browser not to clear this app's data
      S.view = 'today'; S.date = today(); render();
    } catch (err) {
      $('#setupMsg').innerHTML = '<div class="callout">' + esc(isOffline(err) ? 'Could not reach that URL. Check it and your connection.' : err.message) + '</div>';
      window.scrollTo(0, 0);
      busy(btn, false, 'Connect');
    }
  });
}

/* ================================================================== */
/* Today                                                               */
/* ================================================================== */
function macroCell(label, value, target, floor) {
  const pct = target ? Math.min(100, Math.round(value / target * 100)) : 0;
  const over = !floor && target && value > target * 1.05;
  return '<div class="list" style="gap:6px"><div class="small mute">' + label + '</div>' +
    '<div class="num">' + fmt(value) + ' <span>/ ' + fmt(target) + ' g</span></div>' +
    '<div class="bar thin' + (over ? ' over' : '') + '"><i style="width:' + pct + '%"></i></div></div>';
}

function viewToday() {
  const d = S.date, isToday = d === today();
  const ms = mealsOn(d), g = goalsOn(d), target = g.calorie_target || 0;
  const eaten = sum(ms.map((m) => m.calories));
  const left = target - eaten, over = target && left < 0;
  const b = bodyOn(d) || {}, sl = sleepOn(d), acts = actsOn(d);
  const done = ['weight_kg', 'snore_score', 'waist_cm'].filter((k) => b[k] !== null && b[k] !== undefined).length;
  const tile = (key, label, unit, dp) => (b[key] !== null && b[key] !== undefined)
    ? '<button class="tile done" data-body="' + key + '"><span class="lbl">' + label + '</span><span class="num">' + fmt(b[key], dp) + ' <small>' + unit + '</small></span></button>'
    : '<button class="tile" data-body="' + key + '"><span class="lbl">' + label + '</span><span class="add">+ Add</span></button>';

  let h = '<div class="head"><div><div class="eyebrow">' + esc(nice(d)) + '</div><h1>' + (isToday ? 'Today' : (d === addDays(today(), -1) ? 'Yesterday' : esc(nice(d)))) + '</h1><div class="sync" id="syncState"></div></div>' +
    '<div class="row" style="gap:8px"><button class="icon-btn" id="prevDay" aria-label="Previous day"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>' +
    '<button class="icon-btn" id="nextDay" aria-label="Next day"' + (isToday ? ' disabled' : '') + '><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button></div></div>';

  h += '<section class="card"><div class="row between" style="align-items:flex-end"><div class="row" style="align-items:baseline;gap:8px">' +
    '<div class="num hero' + (over ? ' over' : '') + '">' + fmt(Math.abs(left)) + '</div><div style="font-weight:600" class="mute">kcal ' + (over ? 'over' : 'left') + '</div></div>' +
    '<div class="small mute" style="text-align:right">' + fmt(eaten) + ' eaten<br>target ' + fmt(target) + '</div></div>' +
    '<div class="bar' + (over ? ' over' : '') + '"><i style="width:' + (target ? Math.min(100, Math.round(eaten / target * 100)) : 0) + '%"></i></div>' +
    '<div class="macros">' + macroCell('Protein', sum(ms.map((m) => m.protein_g)), g.protein_g, true) + macroCell('Carbs', sum(ms.map((m) => m.carbs_g)), g.carbs_g) + macroCell('Fat', sum(ms.map((m) => m.fat_g)), g.fat_g) + '</div></section>';

  h += '<section class="card tight"><div class="row between"><h2>Morning check-in</h2><div class="small mute">' + done + ' of 3 done</div></div>' +
    '<div class="tiles">' + tile('weight_kg', 'Weight', 'kg', 2) + tile('snore_score', 'Snore score', '', 0) + tile('waist_cm', 'Waist (weekly)', 'cm', 1) + '</div></section>';

  if (sl) {
    const bits = [sl.bedtime && sl.wake_time ? sl.bedtime + ' to ' + sl.wake_time : '', sl.deep_min !== null && sl.deep_min !== undefined ? 'deep ' + hm(sl.deep_min) : '', sl.rem_min ? 'REM ' + hm(sl.rem_min) : '', sl.spo2_avg ? 'oxygen ' + sl.spo2_avg + '%' : ''].filter(Boolean).join(' · ');
    h += '<button class="item" id="sleepCard"><div class="grow"><div class="small mute">Last night\'s sleep <span class="badge">' + esc(sl.source || '') + '</span></div><div class="num" style="font-size:24px">' + hm(sl.asleep_min) + '</div><div class="small mute">' + esc(bits) + '</div></div></button>';
  } else {
    h += '<div class="dashed row between"><span>No sleep recorded for last night yet. It arrives from your watch.</span><button class="link" id="sleepCard">Add by hand</button></div>';
  }

  h += '<section class="list"><div class="row between" style="padding:0 4px"><h2>Meals</h2><div class="small mute">' + ms.length + ' logged</div></div>';
  if (!ms.length) h += '<div class="dashed">Nothing logged ' + (isToday ? 'yet today' : 'on this day') + '. Tap the round button to scan or add food.</div>';
  ms.forEach((m) => {
    h += '<button class="item" data-meal="' + esc(m.id) + '"><div class="num time">' + esc(m.time || '–') + '</div><div class="grow"><div class="title">' + esc(m.title) + '</div>' +
      '<div class="small mute">P ' + fmt(m.protein_g) + ' · C ' + fmt(m.carbs_g) + ' · F ' + fmt(m.fat_g) + (m._pending ? ' · <span class="badge">waiting to upload</span>' : '') + (m.review_flag ? ' · <span class="badge warn">check</span>' : '') + '</div></div>' +
      '<div class="num kcal">' + fmt(m.calories) + '</div></button>';
  });
  h += '</section>';

  h += '<section class="list"><div class="row between" style="padding:0 4px"><h2>Activity</h2><div class="small mute">' + (b.steps ? fmt(b.steps) + ' steps' : '') + '</div></div>';
  acts.forEach((a) => {
    h += '<button class="item" data-act="' + esc(a.id) + '"><div class="num time">' + esc(a.start_time || '–') + '</div><div class="grow"><div class="title">' + esc(a.title) + '</div>' +
      '<div class="small mute">' + (a.duration_min ? fmt(a.duration_min) + ' min · ' : '') + '<span class="badge">' + esc(a.source === 'watch' ? 'watch' : (a.source === 'manual' ? 'manual' : 'old estimate')) + '</span></div></div>' +
      '<div class="num kcal">' + (a.calories_burned ? fmt(a.calories_burned) : '') + '</div></button>';
  });
  h += '<div class="dashed row between"><span>' + (acts.length ? 'Burned calories are recorded, not added to your budget.' : 'Golf rounds and walks arrive from your watch.') + '</span><button class="link" id="addAct">Add</button></div></section>';

  $('#view').innerHTML = h;
  paintSync();
  $('#prevDay').onclick = () => { S.date = addDays(S.date, -1); render(); };
  $('#nextDay').onclick = () => { if (S.date < today()) { S.date = addDays(S.date, 1); render(); } };
  $$('[data-body]').forEach((el) => { el.onclick = () => bodySheet(el.dataset.body); });
  $$('[data-meal]').forEach((el) => { el.onclick = () => { const m = D().meals.find((x) => String(x.id) === el.dataset.meal); if (m._pending) toast('This entry is still waiting to upload.'); else mealForm(m, false); }; });
  $$('[data-act]').forEach((el) => { el.onclick = () => activityForm(D().activities.find((x) => String(x.id) === el.dataset.act)); });
  $('#addAct').onclick = () => activityForm(null);
  $('#sleepCard').onclick = () => sleepForm(sl);
}

/* ---------- morning check-in ---------- */
function bodySheet(key) {
  const b = bodyOn(S.date) || {};
  const title = { weight_kg: 'Weight', snore_score: 'Snore score', waist_cm: 'Waist' }[key];
  let inner;
  if (key === 'weight_kg') inner = numField('Weight (kg)', 'weight_kg', b.weight_kg, '0.05') + '<div class="grid2">' + numField('Body fat % (optional)', 'body_fat_pct', b.body_fat_pct, '0.1') + numField('Visceral rating (optional)', 'visceral_rating', b.visceral_rating, '0.5') + '</div>';
  else if (key === 'snore_score') inner = numField('Last night\'s snore score', 'snore_score', b.snore_score, '1') + '<p class="small mute">Use the score from your snore app (for example SnoreLab). It describes the night that just ended.</p>';
  else inner = numField('Waist (cm)', 'waist_cm', b.waist_cm, '0.1') + '<p class="small mute">Measure at navel height, relaxed, before breakfast. Once a week is enough.</p>';
  openSheet(sheetHead(title) + '<form id="bodyForm" class="list" style="gap:14px">' + inner + '<button class="btn primary" type="submit">Save</button></form>');
  const form = $('#bodyForm'); const first = $('input', form); if (first) first.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form), fields = {};
    Object.keys(v).forEach((k) => { fields[k] = numOrNull(v[k]); });
    const btn = $('button[type=submit]', form); busy(btn, true, 'Saving…');
    const date = S.date;
    const okay = await write('body.save', { date: date, fields: fields }, (out) => { upsert(D().body, out || Object.assign({}, bodyOn(date) || { date: date }, fields), 'date'); }, true);
    if (okay) { closeSheet(); render(); } else busy(btn, false, 'Save');
  });
}

/* ---------- sleep by hand ---------- */
function sleepForm(sl) {
  if (sl && sl.source === 'watch') { toast('This night came from your watch.'); return; }
  openSheet(sheetHead('Sleep') + '<form id="sleepForm" class="list" style="gap:14px"><p class="small mute">For the night ending ' + esc(nice(S.date)) + '. Use this only when the watch did not record it.</p><div class="grid2">' +
    field('Went to sleep', 'bedtime', sl ? sl.bedtime : '', 'type="time" required') + field('Woke up', 'wake_time', sl ? sl.wake_time : '', 'type="time" required') + '</div>' +
    numField('Minutes awake in the night (optional)', 'awake_min', sl ? sl.awake_min : '', '5') + '<button class="btn primary" type="submit">Save</button></form>');
  $('#sleepForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(e.target); v.date = S.date;
    const btn = $('button[type=submit]', e.target); busy(btn, true, 'Saving…');
    const okay = await write('sleep.save', { sleep: v }, (out) => { if (out) upsert(D().sleep, out, 'date'); }, false);
    if (okay) { closeSheet(); render(); } else busy(btn, false, 'Save');
  });
}

/* ---------- activity by hand ---------- */
function activityForm(a) {
  const isNew = !a; a = a || { type: 'walk', date: S.date };
  const types = [['walk', 'Walk'], ['golf_round', 'Golf round'], ['golf_practice', 'Golf practice'], ['strength', 'Strength'], ['run', 'Run'], ['ride', 'Ride'], ['swim', 'Swim'], ['other', 'Other']];
  openSheet(sheetHead(isNew ? 'Add activity' : 'Activity') + '<form id="actForm" class="list" style="gap:14px">' +
    (isNew ? '<p class="small mute">For days the watch missed something. Entries added by hand are labelled "manual" and never change your calorie budget.</p>' : '') +
    field('Name', 'title', a.title, 'required maxlength="120"') +
    '<div class="grid2"><label class="field">Type<select name="type">' + types.map((t) => '<option value="' + t[0] + '"' + (a.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>').join('') + '</select></label>' +
    numField('Minutes', 'duration_min', a.duration_min, '1') + '</div><div class="grid2">' + field('Start time', 'start_time', a.start_time, 'type="time"') + numField('Calories (optional)', 'calories_burned', a.calories_burned, '1') + '</div>' +
    '<button class="btn primary" type="submit">Save</button>' + (isNew ? '' : '<button class="btn danger" type="button" id="delAct">Delete</button>') + '</form>');
  $('#actForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(e.target); v.date = a.date || S.date; if (!isNew) v.id = a.id;
    const btn = $('button[type=submit]', e.target); busy(btn, true, 'Saving…');
    const okay = await write('activity.save', { activity: v }, (out) => { if (out) upsert(D().activities, out, 'id'); }, false);
    if (okay) { closeSheet(); render(); } else busy(btn, false, 'Save');
  });
  const del = $('#delAct');
  if (del) del.onclick = async () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
    busy(del, true, 'Deleting…');
    const okay = await write('activity.delete', { id: a.id }, () => { S.data.activities = D().activities.filter((x) => x.id !== a.id); }, false);
    if (okay) { closeSheet(); render(); } else busy(del, false, 'Delete');
  };
}

/* ================================================================== */
/* Adding food                                                         */
/* ================================================================== */
function recentMeals() {
  const seen = {}, out = [];
  D().meals.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).forEach((m) => {
    const k = m.title.toLowerCase();
    if (seen[k]) { seen[k].n++; return; }
    seen[k] = { m: m, n: 1 }; out.push(seen[k]);
  });
  return out.slice(0, 60).sort((a, b) => b.n - a.n).slice(0, 10).map((x) => x.m);
}

function addSheet() {
  const rec = recentMeals();
  let h = sheetHead('Add food') + '<div class="choices">' +
    '<label class="choice main"><input type="file" accept="image/*" capture="environment" id="camInput"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Take photo</label>' +
    '<label class="choice"><input type="file" accept="image/*" id="pickInput"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/></svg>Choose photo</label>' +
    '<button class="choice" id="describeBtn"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>Describe it</button>' +
    '<button class="choice" id="manualBtn"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>Enter by hand</button></div>' +
    field('Note for the scan (optional)', 'note', '', 'id="scanNote" placeholder="e.g. ate half, no rice, 2 servings" maxlength="300"') +
    '<p class="small mute">Photos of nutrition labels work too, and are the most accurate.</p>';
  if (rec.length) {
    h += '<h2>Log again</h2><div class="list">' + rec.map((m) => '<button class="item" data-again="' + esc(m.id) + '"><div class="grow"><div class="title">' + esc(m.title) + '</div><div class="small mute">P ' + fmt(m.protein_g) + ' · C ' + fmt(m.carbs_g) + ' · F ' + fmt(m.fat_g) + '</div></div><div class="num kcal">' + fmt(m.calories) + '</div></button>').join('') + '</div>';
  }
  openSheet(h);
  const onFile = (e) => { const f = e.target.files && e.target.files[0]; if (f) runScan({ file: f, text: $('#scanNote').value.trim() }); };
  $('#camInput').onchange = onFile; $('#pickInput').onchange = onFile;
  $('#manualBtn').onclick = () => mealForm({}, true);
  $('#describeBtn').onclick = describeSheet;
  $$('[data-again]').forEach((el) => { el.onclick = () => { const m = D().meals.find((x) => String(x.id) === el.dataset.again); const c = Object.assign({}, m, { source: 'repeat', notes: '' }); delete c.id; delete c.date; delete c.time; mealForm(c, true); }; });
}

function describeSheet() {
  openSheet(sheetHead('Describe it') + '<form id="descForm" class="list" style="gap:14px"><label class="field">What did you eat?<textarea name="text" required maxlength="600" placeholder="e.g. 2 pieces chicken adobo, 1 cup rice, half a mango"></textarea></label><button class="btn primary" type="submit">Estimate</button></form>');
  $('textarea', sheet).focus();
  $('#descForm').addEventListener('submit', (e) => { e.preventDefault(); runScan({ text: formValues(e.target).text }); });
}

/** Shrinks a photo to at most 1280px and returns base64 JPEG, so uploads stay small on mobile data. */
async function photoToBase64(file) {
  const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
    return { data: await toB64(blob), mime: 'image/jpeg' };
  } catch (e) {
    return { data: await toB64(file), mime: file.type || 'image/jpeg' };
  }
}

async function runScan(input) {
  openSheet(sheetHead('Add food') + '<div class="center"><div class="spinner" role="img" aria-label="Working"></div><div><b>' + (input.file ? 'Reading your photo…' : 'Estimating…') + '</b><div class="small mute">Usually 5 to 15 seconds.</div></div></div>');
  try {
    const payload = { text: input.text || '' };
    if (input.file) { const p = await photoToBase64(input.file); payload.image = p.data; payload.mime = p.mime; }
    const r = await api('scan', payload);
    if (!sheet.open) return; // closed while waiting
    mealForm(r, true, r.assumptions);
  } catch (e) {
    openSheet(sheetHead('Add food') + '<div class="callout">' + esc(isOffline(e) ? 'Scanning needs a connection. You can still enter the meal by hand.' : e.message) + '</div><button class="btn primary" id="retryAdd">Back</button><button class="btn" id="byHand">Enter by hand</button>');
    $('#retryAdd').onclick = addSheet; $('#byHand').onclick = () => mealForm({}, true);
  }
}

function mealForm(m, isNew, assumptions) {
  const date = m.date || S.date;
  const time = m.time || (isNew && date === today() ? nowTime() : '');
  const conf = m.confidence ? '<span class="badge' + (m.confidence === 'low' ? ' warn' : '') + '">' + esc(m.confidence) + ' confidence</span>' : '';
  let h = sheetHead(isNew ? 'Review and save' : 'Edit meal') + '<form id="mealForm" class="list" style="gap:14px">';
  if (conf || assumptions) h += '<div class="small mute">' + conf + ' ' + esc(assumptions || '') + '</div>';
  if (m.review_flag) h += '<div class="callout">Worth a check: the calories and macros do not add up (' + esc(m.review_flag) + ').</div>';
  h += field('Name', 'title', m.title, 'required maxlength="200"') +
    '<div class="grid2">' + field('Date', 'date', date, 'type="date" required max="' + today() + '"') + field('Time eaten', 'time', time, 'type="time"') + '</div>' +
    '<div class="grid2">' + numField('Calories', 'calories', m.calories, '1') + numField('Protein (g)', 'protein_g', m.protein_g, '0.1') + '</div>' +
    '<div class="grid2">' + numField('Carbs (g)', 'carbs_g', m.carbs_g, '0.1') + numField('Fat (g)', 'fat_g', m.fat_g, '0.1') + '</div>' +
    '<details' + (m.sat_fat_g !== null && m.sat_fat_g !== undefined ? ' open' : '') + '><summary>More nutrition and tags</summary><div class="list" style="gap:14px;padding-top:8px">' +
    '<div class="grid3">' + numField('Sat fat (g)', 'sat_fat_g', m.sat_fat_g, '0.1') + numField('Trans fat (g)', 'trans_fat_g', m.trans_fat_g, '0.1') + numField('Fibre (g)', 'fiber_g', m.fiber_g, '0.1') + '</div>' +
    '<div class="grid3">' + numField('Added sugar (g)', 'added_sugar_g', m.added_sugar_g, '0.1') + numField('Sodium (mg)', 'sodium_mg', m.sodium_mg, '1') + numField('Alcohol (g)', 'alcohol_g', m.alcohol_g, '0.1') + '</div>' +
    field('Tags (ingredients and food types, comma separated)', 'tags', m.tags, 'maxlength="200" autocapitalize="none"') + field('Notes', 'notes', m.notes, 'maxlength="500"') + '</div></details>' +
    '<button class="btn primary" type="submit">' + (isNew ? 'Save meal' : 'Save changes') + '</button>' + (isNew ? '' : '<button class="btn danger" type="button" id="delMeal">Delete</button>') + '</form>';
  openSheet(h);
  const form = $('#mealForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(form);
    const meal = { title: v.title, date: v.date, time: v.time, tags: v.tags, notes: v.notes, source: m.source || 'manual', confidence: m.confidence || '' };
    ['calories', 'protein_g', 'carbs_g', 'fat_g', 'sat_fat_g', 'trans_fat_g', 'fiber_g', 'added_sugar_g', 'sodium_mg', 'alcohol_g'].forEach((k) => { meal[k] = numOrNull(v[k]); });
    if (!isNew) meal.id = m.id;
    const btn = $('button[type=submit]', form); busy(btn, true, 'Saving…');
    const okay = await write('meal.save', { meal: meal }, (out, queued) => {
      upsert(D().meals, queued ? Object.assign({ id: 'tmp-' + Date.now(), _pending: true }, meal) : out, 'id');
    }, isNew);
    if (okay) { closeSheet(); S.date = meal.date; S.view = 'today'; render(); if (isNew) toast('Saved'); } else busy(btn, false, isNew ? 'Save meal' : 'Save changes');
  });
  const del = $('#delMeal');
  if (del) del.onclick = async () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
    busy(del, true, 'Deleting…');
    const okay = await write('meal.delete', { id: m.id }, () => { S.data.meals = D().meals.filter((x) => x.id !== m.id); }, false);
    if (okay) { closeSheet(); render(); } else busy(del, false, 'Delete');
  };
}

/* ================================================================== */
/* Trends                                                              */
/* ================================================================== */
function barChart(id, pts, opt) {
  // pts: [{label, value, note}], one per day; opt: {ref, refLabel, unit, warnAbove}
  const W = 350, H = 150, top = 14, bottom = 20, n = pts.length;
  const max = Math.max.apply(null, pts.map((p) => p.value || 0).concat([opt.ref || 0, 1])) * 1.08;
  const step = W / n, bw = Math.max(2, Math.min(26, step - (n > 40 ? 1 : 3)));
  const y = (v) => top + (H - top - bottom) * (1 - v / max);
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opt.aria) + '">';
  pts.forEach((p, i) => {
    if (!p.value) return;
    const warn = !!p.warn;
    const h = H - bottom - y(p.value), x = i * step + (step - bw) / 2, r = Math.min(4, bw / 2, h);
    s += '<path d="M' + x + ' ' + (H - bottom) + 'v' + (-(h - r)) + 'q0 ' + (-r) + ' ' + r + ' ' + (-r) + 'h' + (bw - 2 * r) + 'q' + r + ' 0 ' + r + ' ' + r + 'v' + (h - r) + 'z" fill="var(--' + (warn ? 'warn' : 'accent') + ')" stroke="none"/>';
  });
  if (opt.ref) s += '<line x1="0" x2="' + W + '" y1="' + y(opt.ref) + '" y2="' + y(opt.ref) + '" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4"/>';
  s += '<line x1="0" x2="' + W + '" y1="' + (H - bottom) + '" y2="' + (H - bottom) + '" stroke="var(--line)" stroke-width="1"/>';
  s += '<text x="0" y="' + (H - 5) + '">' + esc(pts[0].label) + '</text><text x="' + W + '" y="' + (H - 5) + '" text-anchor="end">' + esc(pts[n - 1].label) + '</text>';
  pts.forEach((p, i) => { s += '<rect class="hit" data-chart="' + id + '" data-tip="' + esc(p.label + ' · ' + (p.value ? fmt(p.value, opt.dp) + ' ' + opt.unit : (opt.empty || 'nothing logged')) + (p.note ? ' · ' + p.note : '')) + '" x="' + (i * step) + '" y="0" width="' + step + '" height="' + H + '"/>'; });
  return s + '</svg><div class="readout" id="ro-' + id + '">' + esc(opt.hint || 'Tap a bar for the day\'s figure.') + '</div>';
}

function lineChart(id, pts, opt) {
  // pts: [{label, value}] with nulls for missing days; draws dots plus a 7-day average line
  const W = 350, H = 150, top = 14, bottom = 20, n = pts.length;
  const vals = pts.map((p) => p.value).filter((v) => v !== null && v !== undefined);
  if (vals.length < 2) return '<div class="small mute">Needs at least two readings in this range.</div>';
  const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), padv = Math.max((hi - lo) * 0.15, opt.minPad || 0.2);
  const y = (v) => top + (H - top - bottom) * (1 - (v - (lo - padv)) / ((hi + padv) - (lo - padv)));
  const x = (i) => n === 1 ? W / 2 : 4 + i * (W - 8) / (n - 1);
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opt.aria) + '">';
  s += '<line x1="0" x2="' + W + '" y1="' + (H - bottom) + '" y2="' + (H - bottom) + '" stroke="var(--line)" stroke-width="1"/>';
  let path = '', started = false;
  const smooth = pts.map((p, i) => { const w = pts.slice(Math.max(0, i - 6), i + 1).map((q) => q.value).filter((v) => v !== null && v !== undefined); return w.length >= (opt.smoothMin || 3) ? avg(w) : null; });
  smooth.forEach((v, i) => { if (v === null) return; path += (started ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); started = true; });
  pts.forEach((p, i) => { if (p.value !== null && p.value !== undefined) s += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.value).toFixed(1) + '" r="2.5" fill="var(--dash)" stroke="none"/>'; });
  if (path) s += '<path d="' + path + '" stroke="var(--accent)" stroke-width="2.5" fill="none"/>';
  s += '<text x="0" y="' + (y(hi) - 5) + '">' + fmt(hi, opt.dp) + '</text><text x="0" y="' + (y(lo) + 13) + '">' + fmt(lo, opt.dp) + '</text>';
  s += '<text x="0" y="' + (H - 5) + '">' + esc(pts[0].label) + '</text><text x="' + W + '" y="' + (H - 5) + '" text-anchor="end">' + esc(pts[n - 1].label) + '</text>';
  const step = W / n;
  pts.forEach((p, i) => { s += '<rect class="hit" data-chart="' + id + '" data-tip="' + esc(p.label + ' · ' + (p.value !== null && p.value !== undefined ? fmt(p.value, opt.dp) + ' ' + opt.unit : 'no reading') + (smooth[i] !== null ? ' · 7-day average ' + fmt(smooth[i], opt.dp) : '')) + '" x="' + (i * step) + '" y="0" width="' + step + '" height="' + H + '"/>'; });
  return s + '</svg><div class="readout" id="ro-' + id + '">Dots are single readings; the line is the 7-day average. Tap for a day.</div>';
}

function viewTrends() {
  const end = today(), n = S.range, days = [];
  for (let i = n - 1; i >= 0; i--) days.push(addDays(end, -i));
  const g = goals(), target = g.calorie_target || 0;
  const per = days.map((d) => { const ms = mealsOn(d); return { d: d, t: goalsOn(d).calorie_target || target, kcal: sum(ms.map((m) => m.calories)), p: sum(ms.map((m) => m.protein_g)), n: ms.length, golf: actsOn(d).some((a) => a.type === 'golf_round') }; });
  const logged = per.filter((x) => x.n);
  const w = days.map((d) => { const b = bodyOn(d); return b && b.weight_kg ? b.weight_kg : null; });
  const wv = w.filter((v) => v !== null);
  const half = Math.floor(wv.length / 2);
  const wChange = wv.length >= 4 ? avg(wv.slice(half)) - avg(wv.slice(0, half)) : null;
  const sl = days.map((d) => sleepOn(d)).filter(Boolean);
  const sn = days.map((d) => { const b = bodyOn(d); return b && b.snore_score !== null && b.snore_score !== undefined ? b.snore_score : null; });
  const waist = days.map((d) => { const b = bodyOn(d); return b && b.waist_cm ? b.waist_cm : null; });
  const onTarget = logged.filter((x) => x.t && x.kcal <= x.t * 1.05).length;
  const golf = logged.filter((x) => x.golf), rest = logged.filter((x) => !x.golf);

  let h = '<div class="head"><div><div class="eyebrow">Last ' + n + ' days</div><h1>Trends</h1></div></div>' +
    '<div class="chips" role="group" aria-label="Range">' + [7, 30, 90].map((r) => '<button class="chip" data-range="' + r + '" aria-pressed="' + (r === n) + '">' + r + ' days</button>').join('') + '</div>';
  h += '<div class="stat-grid">' +
    '<div class="stat"><div class="small mute">Average intake</div><div class="num">' + fmt(avg(logged.map((x) => x.kcal))) + ' <small>kcal</small></div><div class="small mute">target ' + fmt(target) + '</div></div>' +
    '<div class="stat"><div class="small mute">Days on target</div><div class="num">' + onTarget + ' <small>of ' + logged.length + '</small></div><div class="small mute">within 5% of that day\'s target</div></div>' +
    '<div class="stat"><div class="small mute">Average protein</div><div class="num">' + fmt(avg(logged.map((x) => x.p))) + ' <small>g</small></div><div class="small mute">target ' + fmt(g.protein_g) + ' g</div></div>' +
    '<div class="stat"><div class="small mute">Weight change</div><div class="num">' + (wChange === null ? '–' : (wChange > 0 ? '+' : '') + fmt(wChange, 2)) + ' <small>kg</small></div><div class="small mute">second half vs first half</div></div></div>';

  h += '<section class="card"><div><h2>Calories by day</h2><div class="small mute">Dashed line: today\'s target of ' + fmt(target) + '. Orange: over that day\'s target.</div></div>' +
    barChart('kcal', per.map((x) => ({ label: nice(x.d), value: x.kcal, warn: x.t && x.kcal > x.t * 1.05, note: (x.golf ? 'golf day' : '') + (x.t && x.kcal > x.t * 1.05 ? (x.golf ? ', ' : '') + 'over the ' + fmt(x.t) + ' target' : '') })), { ref: target, unit: 'kcal', aria: 'Calories eaten each day against the target' }) + '</section>';
  if (golf.length && rest.length) h += '<div class="callout">Golf days average <b>' + fmt(avg(golf.map((x) => x.kcal))) + ' kcal</b> (' + golf.length + ' days) against <b>' + fmt(avg(rest.map((x) => x.kcal))) + '</b> on other days (' + rest.length + ').</div>';
  h += '<section class="card"><h2>Weight (kg)</h2>' + lineChart('weight', days.map((d, i) => ({ label: nice(d), value: w[i] })), { unit: 'kg', dp: 2, aria: 'Morning weight with 7-day average' }) + '</section>';
  h += '<section class="card"><div><h2>Sleep (hours)</h2><div class="small mute">Dashed line: 7 hours.</div></div>' + (sl.length ? barChart('sleep', days.map((d) => { const s = sleepOn(d); return { label: nice(d), value: s && s.asleep_min ? Math.round(s.asleep_min / 6) / 10 : 0 }; }), { ref: 7, unit: 'h', dp: 1, empty: 'no sleep recorded', aria: 'Hours asleep each night', hint: 'Tap a bar for the night\'s figure.' }) : '<div class="small mute">Fills in once your watch starts syncing.</div>') + '</section>';
  h += '<section class="card"><h2>Snore score</h2>' + (sn.filter((v) => v !== null).length ? lineChart('snore', days.map((d, i) => ({ label: nice(d), value: sn[i] })), { unit: '', dp: 0, minPad: 3, aria: 'Nightly snore score' }) : '<div class="small mute">Add a score in the morning check-in to start this chart.</div>') + '</section>';
  h += '<section class="card"><h2>Waist (cm)</h2>' + (waist.filter((v) => v !== null).length ? lineChart('waist', days.map((d, i) => ({ label: nice(d), value: waist[i] })), { unit: 'cm', dp: 1, minPad: 0.5, smoothMin: 99, aria: 'Waist measurements' }) : '<div class="small mute">One tape reading a week is the best home signal for visceral fat.</div>') + '</section>';
  $('#view').innerHTML = h;
  $$('[data-range]').forEach((el) => { el.onclick = () => { S.range = Number(el.dataset.range); render(); }; });
  $$('.hit').forEach((el) => { const show = () => { const ro = $('#ro-' + el.dataset.chart); if (ro) ro.textContent = el.dataset.tip; }; el.addEventListener('pointerenter', show); el.addEventListener('click', show); });
}

/* ================================================================== */
/* Reports                                                             */
/* ================================================================== */
function viewReports() {
  const reps = D().reports || [];
  let h = '<div class="head"><div><div class="eyebrow">Weekly and quarterly</div><h1>Reports</h1></div></div>';
  if (!reps.length) h += '<div class="dashed">No reports yet. The first weekly report arrives on Monday morning, by email and here. You can also build last week\'s now.</div>';
  h += '<div class="list">' + reps.map((r) => '<button class="item" data-report="' + esc(r.id) + '"><div class="grow"><div class="small mute">' + (r.type === 'quarterly' ? 'Quarterly' : 'Weekly') + ' · ' + esc(nice(r.period_start)) + ' to ' + esc(nice(r.period_end)) + '</div><div class="title">' + esc(r.headline) + '</div></div></button>').join('') + '</div>';
  h += '<button class="btn" id="runWeekly">Build last week\'s report now</button><button class="btn" id="runQuarter">Build last quarter\'s report now</button><p class="small mute">Building a report also emails it to you. It takes up to a minute.</p>';
  $('#view').innerHTML = h;
  $$('[data-report]').forEach((el) => { el.onclick = () => openReport(el.dataset.report); });
  const run = (btn, type, label) => async () => {
    busy(btn, true, 'Building…');
    try { const r = await api('report.run', { type: type }); await sync(true); S.view = 'reports'; render(); openReport(r.id); }
    catch (e) { toast(isOffline(e) ? 'Reports need a connection.' : e.message); busy(btn, false, label); }
  };
  $('#runWeekly').onclick = run($('#runWeekly'), 'weekly', 'Build last week\'s report now');
  $('#runQuarter').onclick = run($('#runQuarter'), 'quarterly', 'Build last quarter\'s report now');
}

async function openReport(id) {
  openSheet(sheetHead('Report') + '<div class="center"><div class="spinner" role="img" aria-label="Loading"></div></div>', true);
  try {
    const r = await api('report.get', { id: id });
    if (!sheet.open) return;
    openSheet(sheetHead(r.type === 'quarterly' ? 'Quarterly report' : 'Weekly report') + '<iframe class="report" title="Report" sandbox=""></iframe>', true);
    $('iframe', sheet).srcdoc = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#F2F5F3">' + r.body_html + '</body>';
  } catch (e) { closeSheet(); toast(isOffline(e) ? 'Reports need a connection.' : e.message); }
}

/* ================================================================== */
/* Settings                                                            */
/* ================================================================== */
function viewSettings() {
  const g = goals(), p = S.prefs, current = document.documentElement.dataset.theme;
  let h = '<div class="head"><div><div class="eyebrow">Fit Tracker ' + APP_VERSION + '</div><h1>Settings</h1></div></div>';
  h += '<section class="card"><h2>Appearance</h2><label class="switch"><span><b>Follow phone setting</b><br><span class="small mute">Use your light pick by day and your dark pick at night</span></span><input type="checkbox" id="follow"' + (p.follow ? ' checked' : '') + '></label><div class="list">' +
    THEMES.map((t) => '<button class="theme" data-theme-id="' + t.id + '" aria-pressed="' + (t.id === current) + '"><span class="swatch" aria-hidden="true" style="background:' + t.bg + ';border-color:' + t.track + '"><b style="color:' + t.accent + '">1,150</b><i style="background:' + t.accent + '"></i></span><span><b>' + t.name + '</b><br><span class="small mute">' + t.note + (p.follow && (p.light === t.id || p.dark === t.id) ? ' · your ' + t.mode + ' pick' : '') + '</span></span></button>').join('') + '</div></section>';
  h += '<section class="card"><h2>Daily targets</h2><p class="small mute">A fixed target: activity is recorded and reported, but never added back to the budget.</p><form id="goalForm" class="list" style="gap:14px"><div class="grid2">' +
    numField('Calories', 'calorie_target', g.calorie_target, '10') + numField('Protein (g)', 'protein_g', g.protein_g, '1') + numField('Carbs (g)', 'carbs_g', g.carbs_g, '1') + numField('Fat (g)', 'fat_g', g.fat_g, '1') + numField('Goal weight (kg)', 'weight_goal_kg', g.weight_goal_kg, '0.1') +
    '</div><div class="small mute" id="goalMath"></div><button class="btn primary" type="submit">Save targets</button></form></section>';
  h += '<section class="card"><h2>Connection</h2><div class="small mute" style="overflow-wrap:anywhere">' + esc(S.conn ? S.conn.url : '') + '</div><div class="small mute" id="syncState"></div>' +
    '<button class="btn" id="syncNow">Sync now</button><button class="btn" id="changeConn2">Change App URL or PIN</button><button class="btn danger" id="disconnect">Disconnect this phone</button>' +
    '<p class="small mute">' + (S.cache ? (S.cache.ok ? 'Saved on this phone at ' + clock(S.cache.at) + ' (' + fmt(S.cache.meals) + ' meals), so the app opens without waiting.' : 'Could not save a copy on this phone (' + esc(S.cache.error) + '). The app will load from the Sheet each time.') : 'No copy saved on this phone yet.') +
    (S.lastSync ? ' Last sync ' + clock(S.lastSync.at) + ', took ' + fmt(S.lastSync.ms / 1000, 1) + ' s.' : '') + '</p>' +
    '<p class="small mute">Your data lives in your Google Sheet. Food scanning: ' + (D().geminiReady ? 'ready' : 'no Gemini key set yet (Sheet menu: Fit Tracker › Set Gemini API key)') + '.</p></section>';
  $('#view').innerHTML = h; paintSync();
  $('#follow').onchange = (e) => { p.follow = e.target.checked; LS.set('prefs', p); applyTheme(); render(); };
  $$('[data-theme-id]').forEach((el) => { el.onclick = () => { const t = THEMES.find((x) => x.id === el.dataset.themeId); p.theme = t.id; p[t.mode] = t.id; LS.set('prefs', p); applyTheme(); render(); }; });
  const form = $('#goalForm');
  const math = () => { const v = formValues(form); const k = 4 * (numOrNull(v.protein_g) || 0) + 4 * (numOrNull(v.carbs_g) || 0) + 9 * (numOrNull(v.fat_g) || 0); $('#goalMath').textContent = 'These macros add up to ' + fmt(k) + ' kcal.'; };
  form.addEventListener('input', math); math();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form); busy(btn, true, 'Saving…');
    const okay = await write('goals.save', { goals: formValues(form) }, (out) => { if (out) { S.data.goals = out; S.data.goalHistory = S.data.goalHistory || []; upsert(S.data.goalHistory, out, 'effective_from'); } }, false);
    busy(btn, false, 'Save targets'); if (okay) { toast('Targets saved'); render(); }
  });
  $('#syncNow').onclick = () => sync(false);
  $('#changeConn2').onclick = () => showSetup();
  const dc = $('#disconnect');
  dc.onclick = () => {
    if (dc.dataset.armed !== '1') { dc.dataset.armed = '1'; dc.textContent = 'Tap again to disconnect'; return; }
    LS.del('conn'); LS.del('data'); LS.del('queue'); LS.del('cache'); LS.del('last'); IDB.del('data').catch(() => {}); IDB.del('conn').catch(() => {}); S.conn = null; S.data = null; S.queue = []; S.cache = null; showSetup();
  };
}

/* ================================================================== */
/* Shell                                                               */
/* ================================================================== */
function viewLoading() {
  $('#view').innerHTML = '<div class="head"><div><div class="eyebrow">' + esc(nice(today())) + '</div><h1>Fit Tracker</h1></div></div>' +
    (S.syncError
      ? '<div class="callout">' + esc(S.syncError) + '</div><p class="small mute" style="overflow-wrap:anywhere">App URL in use: ' + esc(shortUrl(S.conn.url)) + '</p><button class="btn primary" id="retrySync">Try again</button><button class="btn" id="changeConn">Change connection</button>'
      : '<div class="card"><div class="center"><div class="spinner" role="img" aria-label="Loading"></div><div><b>Loading your data</b><div class="small mute">Only the first open takes this long. After that the app opens from the copy on your phone.</div></div></div></div>');
  const r = $('#retrySync'); if (r) r.onclick = () => { S.syncError = ''; render(); sync(false); };
  const c = $('#changeConn'); if (c) c.onclick = () => showSetup();
}

function render() {
  if (!S.conn) return showSetup();
  if (!S.data) { $('#nav').hidden = true; return viewLoading(); }
  LS.set('last', { view: S.view, date: S.date, at: Date.now() });
  $('#nav').hidden = false;
  $$('#nav [data-view]').forEach((b) => { if (b.dataset.view === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  ({ today: viewToday, trends: viewTrends, reports: viewReports, settings: viewSettings }[S.view] || viewToday)();
}
$$('#nav [data-view]').forEach((b) => { b.onclick = () => { S.view = b.dataset.view; if (S.view === 'today') S.date = today(); render(); window.scrollTo(0, 0); }; });
$('#scanBtn').onclick = addSheet;
window.addEventListener('online', () => sync(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.conn) { if (S.view === 'today' && !sheet.open && S.date !== today() && S.lastSeen !== today()) S.date = today(); S.lastSeen = today(); sync(true); } });

async function start() {
  applyTheme();
  S.date = today(); S.lastSeen = today();
  S.cache = LS.get('cache', null); S.lastSync = LS.get('lastSync', null);
  // pick up where you left off if you were here in the last 15 minutes (for example after switching to the camera)
  const last = LS.get('last', null);
  if (last && Date.now() - last.at < 15 * 60000 && last.view) { S.view = last.view; if (last.date && last.date <= today()) S.date = last.date; }
  if (!S.conn) { try { S.conn = await IDB.get('conn'); } catch (e) { /* stay signed out */ } } // second copy of the sign-in, in case the small store was full
  if (S.conn) S.data = await loadCache();
  render();
  if (S.conn) sync(true);
}
start();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./sw.js').catch(() => { /* the app still works without offline support */ });
