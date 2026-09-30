/* AutoKnerd v3 front end.
 * A phone-first rebuild of the classic app (index.html) on the same server API.
 * Plain JS, no build step: hash routes render into #app, one delegated listener per event type.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const TRAITS = [
    ['empathy', 'Empathy'],
    ['listening', 'Listening'],
    ['trust', 'Trust'],
    ['followUp', 'Follow-Up'],
    ['closing', 'Closing'],
    ['relationship', 'Relationship Building'],
  ];
  const TRAIT_LABEL = Object.fromEntries(TRAITS);
  // Older data uses a few retired names; show everything under the six current skills.
  const LEGACY_TRAIT = { pacing: 'followUp', confidence: 'relationship', trustbuilding: 'trust', activelistening: 'listening', followup: 'followUp', relationshipbuilding: 'relationship' };

  const ROLES = ['Sales Consultant', 'BDC', 'Service Writer', 'Parts Consultant', 'Parts Advisor', 'Finance Manager', 'Sales Manager', 'Service Manager', 'Parts Manager', 'General Manager', 'Owner', 'Trainer', 'Demo Specialist'];
  const TUNE_ROLES = ['manager', 'Sales Manager', 'Service Manager', 'Parts Manager', 'Finance Manager', 'General Manager', 'Owner', 'Trainer', 'Admin', 'Developer'];
  const AVATARS = ['Blue', 'Dark Red', 'NeonBlue', 'Pink', 'Purple', 'Red', 'Teal', 'Yellow'].map((n) => `/Avatars/${n}.png`);
  const TOOLS = Array.isArray(window.AK_TOOLS) ? window.AK_TOOLS : [];
  const TOOL_CATEGORIES = ['All', ...Array.from(new Set(TOOLS.map((t) => t.category)))];
  const LOGO = '/logo-icon1.png';
  const MEETING_URL = 'https://calendar.app.google/JEqSARn8hvjPtvUy9';
  // Points at the live NEW marketing site. Using the Vercel alias for now because the
  // autoknerd.com custom domain still serves the old deployment — switch back to
  // 'https://autoknerd.com' once that domain is rebound to the new project.
  const SITE_URL = 'https://autoknerd.vercel.app';
  const DEMO_PERSONAS = [
    { role: 'Owner', eyebrow: 'Across your stores', summary: 'See every rooftop at a glance: which store needs you today, how they compare, and how one weekly focus steers coaching across the group.', questions: ['Which store needs me today?', 'What should we coach this week?', 'Who is ready to level up?'] },
    { role: 'General Manager', eyebrow: 'Your store, day to day', summary: 'Run the store from one screen: who is practicing, where CX is trending, your biggest opportunity, and a drill-down into any teammate.', questions: ['Where is my team stuck today?', 'How do I steer the week?', 'Who needs a one-on-one?'] },
    { role: 'Sales Manager', eyebrow: 'Coach your department', summary: 'Guide the week without building a lesson plan. See who needs a nudge and let the app handle each rep’s coaching.', questions: ['Who needs a nudge?', 'Which skill is slipping?', 'How light can I keep it?'] },
    { role: 'Sales Consultant', eyebrow: 'A rep’s day', summary: 'What your salespeople see: a daily lesson aimed at their weakest skill, XP that keeps them coming back, and practice that feels like the floor.', questions: ['What is my lesson today?', 'How do I earn XP?', 'What does practice feel like?'] },
    { role: 'Service Writer', eyebrow: 'On the service drive', summary: 'The same coaching engine tuned for the service lane: the write-up, the MPI walk-through, and the pickup conversation.', questions: ['How does service coaching work?', 'Where is trust leaking?', 'What will my writers practice?'] },
  ];
  const personaSlug = (role) => String(role || '').toLowerCase().replace(/[^a-z]/g, '');
  // Local machine or a private LAN address (e.g. testing from a phone on the same Wi-Fi).
  const IS_LOCAL = ['localhost', '127.0.0.1', '::1'].includes(location.hostname)
    || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);

  const LS = {
    token: 'autoknerd:authToken',
    userId: 'autoknerd:userId',
    reminders: 'autoknerd:sessionReminders',
    share: 'autoknerd:shareAnonymousData',
    store: (id) => `autoknerd:managerStoreSelection:${id || 'default'}`,
    tools: (id) => `autoknerd:v3:tools:${id || 'default'}`,
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const S = {
    token: read(LS.token),
    bundle: null,
    // Sample-data mode for the public demo (and all roles when running locally).
    preview: sessionStorage.getItem('ak:preview') || '',
    resetEmail: '',
    resetDone: false,
    authMode: 'signin',
    authError: '',
    authNotice: '',
    busy: false,
    session: null,
    pending: false,
    selectedChoice: null,
    draft: '',
    result: null,
    practiceTab: 'lessons',
    toolSearch: '',
    toolCat: 'All',
    insight: {},
    plan: null,
    planLoading: false,
    sheet: null,
  };

  function read(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
  function write(key, value) { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* storage blocked */ } }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, Number(n) || 0));
  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '?';
  const roleOf = (b = S.bundle) => String(b?.user?.roleLabel || b?.user?.role || '').trim();
  const isLeader = () => Boolean(S.bundle?.managerDashboard);
  const canTune = () => TUNE_ROLES.includes(roleOf());
  const isAdmin = () => ['Admin', 'Developer'].includes(roleOf());
  const stripTune = (text) => String(text || '').split(/\s*Weekly tune:/i)[0].trim();
  const traitKey = (v) => {
    const raw = String(v || '').trim();
    if (TRAIT_LABEL[raw]) return raw;
    const flat = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (LEGACY_TRAIT[flat]) return LEGACY_TRAIT[flat];
    return TRAITS.find(([k, l]) => k.toLowerCase() === flat || l.toLowerCase().replace(/[^a-z]/g, '') === flat)?.[0] || '';
  };
  const traitName = (v) => TRAIT_LABEL[traitKey(v)] || String(v || '');
  const score = (stats, key) => clamp(typeof stats?.[key] === 'object' ? stats[key]?.score : stats?.[key]);

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }
  function fmtDate(value) {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function daysUntil(value) {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return null;
    return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
  }

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    chart: '<path d="M5 20V11"/><path d="M11 20V5"/><path d="M17 20v-6"/><path d="M3 20.5h18"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.3c2.1.7 3.5 2.8 3.5 5.7"/>',
    play: '<path d="M7.5 5v14l11-7z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    send: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    bookmark: '<path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z"/>',
    flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.7 2-4.7.2 1.7 1 2.7 2 3.2 0-3.5-.5-6 1-8.5z"/>',
    chevR: '<path d="m9 6 6 6-6 6"/>',
    chevL: '<path d="m15 6-6 6 6 6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
    trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H4.5a3 3 0 0 0 3.5 4"/><path d="M16 6h3.5a3 3 0 0 1-3.5 4"/><path d="M12 14v4"/><path d="M8.5 21h7"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    up: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
    down: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
    store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5h16v1a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 13.5a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 10.5z"/><path d="M5.5 13v7.5h13V13"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v6H4V6h6"/>',
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
    logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };
  function icon(name, size = 22, sw = 1.9) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  function avatar(user, cls = '') {
    const url = String(user?.avatarUrl || '').trim();
    const inner = url ? `<img src="${esc(url)}" alt="">` : esc(initials(user?.name));
    return `<span class="avatar ${cls}">${inner}</span>`;
  }
  const bar = (pct, cls = '') => `<div class="bar ${cls}"><span style="width:${clamp(pct)}%"></span></div>`;

  let toastTimer;
  function toast(message, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  function identity() {
    // Fields the server expects on authenticated POSTs; preview mode uses the server's mock bundles.
    const base = { userId: S.bundle?.user?.userId };
    return S.preview ? { ...base, mockMode: true, mockRoleOverride: S.preview } : base;
  }

  async function api(path, { method = 'GET', body, raw = false } = {}) {
    const headers = {};
    if (S.token) headers['x-autoknerd-token'] = S.token;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (raw) {
      if (!res.ok) throw new Error((await res.text()) || 'Request failed.');
      return res;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.authRequired && !S.preview) {
      signOutLocal();
      throw new Error('Please sign in again.');
    }
    if (!res.ok || data.ok === false) throw new Error(data.message || 'Something went wrong. Please try again.');
    return data;
  }

  async function loadBundle() {
    const q = new URLSearchParams();
    if (S.preview) { q.set('mockMode', '1'); q.set('mockRoleOverride', S.preview); }
    const data = await api(`/api/bootstrap?${q}`);
    S.bundle = data;
    S.session = data.activeSession || null;
    if (!S.preview && data.user?.userId) write(LS.userId, data.user.userId);
    return data;
  }

  function signOutLocal() {
    S.token = '';
    S.bundle = null;
    S.session = null;
    write(LS.token, null);
    S.authMode = 'signin';
  }

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
    return { name: parts[0] || '', params: parts.slice(1) };
  }
  function go(path) {
    if (location.hash === `#/${path}`) render();
    else location.hash = `#/${path}`;
  }
  const homeRoute = () => (isLeader() ? 'team' : 'home');

  // ---------------------------------------------------------------------------
  // Shared chrome
  // ---------------------------------------------------------------------------
  function tabbar(active) {
    const first = isLeader() ? ['team', 'Team', 'users'] : ['home', 'Home', 'home'];
    const tabs = [first, ['practice', 'Practice', 'target'], ['tools', 'Tools', 'grid'], ['progress', 'Progress', 'chart']];
    return `<nav class="tabbar" aria-label="Main">${tabs.map(([r, label, ic]) => `
      <a class="tab" href="#/${r}" ${r === active ? 'aria-current="page"' : ''}><span class="pill">${icon(ic)}</span>${label}</a>`).join('')}</nav>`;
  }
  function topbar(title, { eyebrow = '', right = null } = {}) {
    const r = right ?? `<a class="avatar" href="#/progress" aria-label="Your progress and settings">${S.bundle?.user?.avatarUrl ? `<img src="${esc(S.bundle.user.avatarUrl)}" alt="">` : esc(initials(S.bundle?.user?.name))}</a>`;
    return `<header class="topbar"><div class="titles">${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}<h1>${esc(title)}</h1></div>${r}</header>`;
  }
  function backbar(title, to) {
    return `<header class="backbar"><a class="icon-btn plain" href="#/${to}" aria-label="Back">${icon('chevL', 24)}</a><h1>${esc(title)}</h1></header>`;
  }
  function previewBanner() {
    if (!S.preview) return '';
    const roles = IS_LOCAL ? ROLES.concat(['Admin']) : DEMO_PERSONAS.map((p) => p.role);
    if (!roles.includes(S.preview)) roles.unshift(S.preview);
    return `<div class="preview-banner"><span>Demo</span>
      <label><span class="sr-only">Viewing as</span><select data-change="preview">${roles.map((r) => `<option ${r === S.preview ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <a href="${MEETING_URL}" target="_blank" rel="noopener" style="font-weight:800">Book a call</a>
      <button class="link" style="color:inherit;padding:0;font-weight:800" data-action="exit-preview">Exit demo</button></div>`;
  }
  function screen(active, body) {
    return `${previewBanner()}<main class="page">${body}</main>${tabbar(active)}`;
  }

  // ---------------------------------------------------------------------------
  // Auth screens
  // ---------------------------------------------------------------------------
  function authScreen() {
    const join = S.authMode === 'join';
    const enrollCode = new URLSearchParams(location.search).get('enroll') || '';
    const fields = join ? `
      <div class="grid2">
        <label class="field"><span>First name</span><input class="input" name="firstName" autocomplete="given-name" required></label>
        <label class="field"><span>Last name</span><input class="input" name="lastName" autocomplete="family-name"></label>
      </div>
      <label class="field"><span>Work email</span><input class="input" name="identifier" type="email" autocomplete="email" placeholder="name@store.com" required></label>
      <label class="field"><span>Create a password</span><span class="pw-wrap"><input class="input" name="password" type="password" autocomplete="new-password" required minlength="6"><button type="button" data-action="toggle-pw">Show</button></span></label>
      <label class="field"><span>Dealer code</span><input class="input" name="code" autocomplete="off" value="${esc(enrollCode)}" placeholder="From your manager" required></label>
      <label class="field"><span>Your role</span><select class="select" name="role">${ROLES.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="agree" required><span>I agree to the <a href="#/privacy">Privacy Policy</a> and <a href="#/terms">Terms of Use</a>.</span></label>`
      : `
      <label class="field"><span>Email or staff ID</span><input class="input" name="identifier" autocomplete="username" placeholder="name@store.com" required></label>
      <label class="field"><span>Password</span><span class="pw-wrap"><input class="input" name="password" type="password" autocomplete="current-password" required><button type="button" data-action="toggle-pw">Show</button></span></label>
      <button type="button" class="link" style="align-self:flex-end" data-action="forgot">Forgot password?</button>`;
    return `<main class="auth">
      <div class="brand"><img src="${LOGO}" alt="" width="72" height="72"><h1>${join ? 'Create your account' : 'Welcome back'}</h1>
        <p class="muted small" style="margin:0">${join ? 'Your dealer code connects you to your store.' : 'Practice real conversations. Get better every day.'}</p></div>
      <div class="segmented" role="tablist">
        <button role="tab" aria-selected="${!join}" data-action="auth-mode" data-mode="signin">Sign in</button>
        <button role="tab" aria-selected="${join}" data-action="auth-mode" data-mode="join">Join</button>
      </div>
      <form class="form" data-form="${join ? 'join' : 'signin'}" novalidate>
        ${fields}
        ${S.authError ? `<p class="error" role="alert">${esc(S.authError)}</p>` : ''}
        ${S.authNotice ? `<p class="notice" role="status">${esc(S.authNotice)}</p>` : ''}
        <button class="btn primary block" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'One moment…' : join ? 'Create account' : 'Sign in'}</button>
      </form>
      <a class="card tight" href="/demo" style="text-decoration:none;flex-direction:row;align-items:center">
        <span class="tile-icon accent">${icon('play', 20)}</span><span class="stack grow"><b>New to AutoKnerd?</b><span class="muted small">Try the interactive demo. No account needed.</span></span><span class="muted">${icon('chevR', 20)}</span></a>
    </main>`;
  }

  function resetScreen() {
    if (S.resetDone) {
      return `<main class="auth"><div class="brand"><img src="${LOGO}" alt="" width="72" height="72"><h1>Password updated</h1>
        <p class="muted" style="margin:0">You can sign in with your new password now.</p></div>
        <a class="btn primary block" href="/">Sign in</a></main>`;
    }
    if (S.authError && !S.resetEmail) {
      return `<main class="auth"><div class="brand"><img src="${LOGO}" alt="" width="72" height="72"><h1>Link not valid</h1>
        <p class="muted" style="margin:0">${esc(S.authError)}</p></div>
        <a class="btn primary block" href="/">Back to sign in</a></main>`;
    }
    return `<main class="auth">
      <div class="brand"><img src="${LOGO}" alt="" width="72" height="72"><h1>Set a new password</h1>
        ${S.resetEmail ? `<p class="muted" style="margin:0">For ${esc(S.resetEmail)}</p>` : ''}</div>
      <form class="form" data-form="reset">
        <label class="field"><span>New password</span><input class="input" name="pw" type="password" autocomplete="new-password" minlength="6" required></label>
        <label class="field"><span>Confirm password</span><input class="input" name="pw2" type="password" autocomplete="new-password" minlength="6" required></label>
        ${S.authError ? `<p class="error" role="alert">${esc(S.authError)}</p>` : ''}
        ${S.authNotice ? `<p class="notice" role="status">${esc(S.authNotice)}</p>` : ''}
        <button class="btn primary block" type="submit" ${S.busy ? 'disabled' : ''}>Update password</button>
        <a class="btn ghost block" href="/">Back to sign in</a>
      </form></main>`;
  }

  // ---------------------------------------------------------------------------
  // Home (frontline) and the shared "today" card
  // ---------------------------------------------------------------------------
  function todayCard() {
    const b = S.bundle;
    const focus = b.focus || {};
    const target = b.roleProfile?.exchangeTarget;
    const turns = target ? (target.min === target.max ? `${target.min} turns` : `${target.min}–${target.max} turns`) : '';
    const teamLean = b.focus?.weeklyTune?.strength === 'strong' && b.focus.weeklyTune.focusTrait;
    const traitLabel = traitName(teamLean || b.user?.sessionFocusTrait || b.user?.focusTrait);
    return `<section class="card hero">
      <div class="row between"><span class="label">Today’s session</span>${traitLabel ? `<span class="chip accent">${teamLean ? 'Team focus' : 'Builds'}: ${esc(traitLabel)}</span>` : ''}</div>
      <h2>${esc(focus.lessonTitle || focus.title || 'Your next lesson')}</h2>
      ${focus.description ? `<p class="muted">${esc(stripTune(focus.description))}</p>` : ''}
      ${focus.microFocus ? `<p class="small"><b>${esc(stripTune(focus.microFocus).replace(/->/g, '→'))}</b></p>` : ''}
      ${turns ? `<div class="chips"><span class="chip">${icon('clock', 15)} About 5 min</span><span class="chip">${esc(turns)}</span></div>` : ''}
      <button class="btn primary block" data-action="start" data-lesson="${esc(b.lessonCategory || '')}" ${S.busy ? 'disabled' : ''}>${icon('play', 20, 2.2)} ${S.busy ? 'Starting…' : 'Start session'}</button>
      <a class="link" style="align-self:center" href="#/practice">Pick a different lesson</a>
    </section>`;
  }

  function resumeCard() {
    const s = S.session;
    if (!s) return '';
    return `<button class="resume" data-action="resume"><span class="muted">${icon('pause')}</span>
      <span class="stack grow"><b>Resume: ${esc(s.lessonTitle || s.title || 'your session')}</b><span class="muted small">Paused at turn ${Number(s.currentUserTurns || 0) + 1} of ${esc(s.targetUserTurns || '')}</span></span>
      <span class="muted">${icon('chevR', 20)}</span></button>`;
  }

  function bossCard({ detailed = false } = {}) {
    const b = S.bundle;
    const u = b.user || {};
    const label = b.freshUpExperience?.bossLabel || b.freshUpBossLabel || 'Boss challenge';
    const core = clamp(u.freshUpCoreSessionsSinceLast, 0, 3);
    if (u.freshUpAvailable) {
      return `<section class="card"><div class="row"><span class="tile-icon accent">${icon('trophy')}</span>
        <div class="stack grow"><h3>${esc(label)} is ready</h3><span class="muted small">A tougher conversation worth up to 150 XP.</span></div></div>
        ${detailed ? `<p class="muted small">${esc(b.freshUpExperience?.scenarioSummary || '')}</p>` : ''}
        <button class="btn primary block" data-action="start-boss" ${S.busy ? 'disabled' : ''}>Take the challenge</button></section>`;
    }
    const left = 3 - core;
    const status = left > 0
      ? `${left} more session${left === 1 ? '' : 's'} to become eligible`
      : `Eligible. Keep practicing — it unlocks as your meter fills (${clamp(u.freshUpMeter)}%).`;
    return `<section class="card"><div class="row"><span class="tile-icon">${icon('lock')}</span>
      <div class="stack grow"><h3>${esc(label)}</h3><span class="muted small">${esc(status)}</span></div></div>
      ${left > 0 ? `<div class="boss-dots" aria-label="${core} of 3 sessions done">${[0, 1, 2].map((i) => `<span class="${i < core ? 'on' : ''}"></span>`).join('')}</div>` : bar(u.freshUpMeter)}
      ${detailed ? `<p class="muted small">Finish 3 regular sessions to become eligible. After that, each session fills the meter until the boss appears.</p>` : ''}
    </section>`;
  }

  function levelStats() {
    const u = S.bundle.user || {};
    const lvl = u.level || {};
    return `<div class="grid3">
      <div class="card tight stat"><div class="value">Lvl ${esc(lvl.level || 1)}</div><div class="caption num">${esc(lvl.levelXp ?? 0)} / ${esc(lvl.nextLevelXp ?? 0)} XP</div></div>
      <div class="card tight stat"><div class="value">${esc(u.streak || 0)} <small>day${u.streak === 1 ? '' : 's'}</small></div><div class="caption">Streak</div></div>
      <div class="card tight stat"><div class="value">${esc(clamp(u.momentumScore))}</div><div class="caption">Momentum</div></div>
    </div>`;
  }

  function sprocketTip(text, title = 'Sprocket’s tip') {
    if (!text) return '';
    return `<section class="card"><div class="tip"><img src="${LOGO}" alt="Sprocket">
      <div class="stack"><span class="label accent">${esc(title)}</span><p>${esc(text)}</p></div></div></section>`;
  }

  function weeklyFocusNote() {
    const tune = S.bundle.focus?.weeklyTune;
    if (!tune?.title && !tune?.focusTrait) return '';
    const skill = traitName(tune.focusTrait);
    const strong = tune.strength === 'strong';
    const headline = skill ? (strong ? `This week’s sessions focus on ${skill}` : `Extra practice on ${skill} this week`) : tune.title;
    return `<section class="card tight"><div class="row between"><span class="label">Your team’s focus this week</span>${strong ? '<span class="chip accent">Strong</span>' : ''}</div>
      <p><b>${esc(headline)}</b></p>
      ${tune.note ? `<p class="muted small">“${esc(tune.note)}”${tune.updatedByName ? ` — ${esc(tune.updatedByName)}` : ''}</p>` : tune.updatedByName ? `<p class="muted small">Set by ${esc(tune.updatedByName)}</p>` : ''}</section>`;
  }

  function homeScreen() {
    const u = S.bundle.user || {};
    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    return screen('home', `
      ${topbar(`${greeting()}, ${firstName(u.name)}`, { eyebrow: date })}
      ${resumeCard()}
      ${todayCard()}
      ${levelStats()}
      ${bossCard()}
      ${weeklyFocusNote()}
      ${sprocketTip(S.bundle.insight)}`);
  }

  // ---------------------------------------------------------------------------
  // Practice
  // ---------------------------------------------------------------------------
  function practiceScreen() {
    const b = S.bundle;
    const tab = S.practiceTab;
    let body = '';
    if (tab === 'lessons') {
      const lessons = Array.isArray(b.lessonLibrary) ? b.lessonLibrary : [];
      const recentTitles = (b.recentSessions || []).map((s) => String(s.title || '').toLowerCase());
      body = lessons.length ? `<section class="card flush"><div class="list">${lessons.map((l, i) => {
        const done = recentTitles.some((t) => t.includes(String(l.title || '').toLowerCase()));
        const status = l.recommended ? 'Recommended for you' : l.current ? 'Up next' : done ? 'Practiced recently' : 'Ready';
        return `<button class="list-item" data-action="lesson" data-index="${i}">
          <span class="step ${done ? 'done' : l.recommended ? 'rec' : ''}">${done ? icon('check', 16, 2.6) : i + 1}</span>
          <span class="stack grow"><span class="title">${esc(l.title)}</span><span class="sub" ${l.recommended ? 'style="color:var(--accent)"' : ''}>${esc(status)}</span></span>
          <span class="chev">${icon('chevR', 20)}</span></button>`;
      }).join('')}</div></section>` : `<p class="empty">No lessons for your role yet.</p>`;
    } else if (tab === 'boss') {
      body = bossCard({ detailed: true });
    } else {
      body = historyList(b.recentSessions, 'No sessions yet. Your first one takes about five minutes.');
    }
    return screen('practice', `
      ${topbar('Practice')}
      ${resumeCard()}
      ${todayCard()}
      <div class="segmented" role="tablist" aria-label="Practice sections">
        ${[['lessons', 'Lessons'], ['boss', 'Boss'], ['history', 'History']].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-action="practice-tab" data-tab="${k}">${l}</button>`).join('')}
      </div>
      ${body}`);
  }

  function historyList(sessions, emptyText) {
    const list = Array.isArray(sessions) ? sessions : [];
    if (!list.length) return `<p class="empty">${esc(emptyText)}</p>`;
    return `<section class="card flush"><div class="list">${list.map((s) => `
      <div class="list-item"><span class="stack grow"><span class="title">${esc(s.title || 'Session')}</span>
        <span class="sub">${esc([fmtDate(s.timestamp), s.duration ? `${s.duration} min` : ''].filter(Boolean).join(' · '))}</span></span>
        ${s.score != null ? `<span class="num" style="font-weight:700;color:${Number(s.score) >= 70 ? 'var(--accent)' : 'var(--warn)'}">${esc(s.score)}%</span>` : ''}</div>`).join('')}</div></section>`;
  }

  function lessonSheet(lesson) {
    return `<h2>${esc(lesson.title)}</h2>
      ${lesson.recommended ? '<span class="chip accent" style="align-self:flex-start">Recommended for you</span>' : ''}
      ${lesson.description ? `<p class="muted">${esc(stripTune(lesson.description))}</p>` : ''}
      ${lesson.microFocus ? `<p><b>${esc(stripTune(lesson.microFocus).replace(/->/g, '→'))}</b></p>` : ''}
      <button class="btn primary block" data-action="start" data-lesson="${esc(lesson.category || '')}">${icon('play', 20, 2.2)} Start this lesson</button>
      <button class="btn ghost block" data-action="close-sheet">Not now</button>`;
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------
  function sessionScreen() {
    const s = S.session;
    if (!s) return '';
    const done = Number(s.currentUserTurns || 0);
    const total = Number(s.targetUserTurns || 1);
    const trust = clamp(s.trustScore);
    const started = done > 0;
    const trustLabel = !started ? 'Not rated yet' : s.trustLabel || (trust >= 75 ? 'Strong' : trust >= 55 ? 'Good' : 'Needs Work');
    const segs = !started ? 0 : trustLabel === 'Strong' ? 3 : trustLabel === 'Good' ? 2 : 1;
    const messages = (s.messages || []).map((m) => {
      if (m.sender === 'user') return `<div class="msg you"><span class="who">You</span><div class="bubble">${esc(m.text)}</div></div>`;
      if (String(m.speaker || '').toLowerCase() === 'sprocket') return `<div class="coach"><img src="${LOGO}" alt="Sprocket"><span>${esc(m.text)}</span></div>`;
      return `<div class="msg"><span class="who">${esc(m.speaker || s.customerName || 'Customer')}</span><div class="bubble">${esc(m.text)}</div></div>`;
    }).join('');
    const choices = Array.isArray(s.choices) ? s.choices : [];
    return `<main class="session">
      <div class="session-top">
        <button class="icon-btn" data-action="pause" aria-label="Pause and save">${icon('pause', 20)}</button>
        <div class="meta"><div class="row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.lessonTitle || s.title || 'Session')}</span><span class="muted num">Turn ${Math.min(done + 1, total)} of ${total}</span></div>${bar((done / total) * 100, 'thin')}</div>
        <button class="icon-btn plain" data-action="pause" aria-label="Leave session">${icon('x', 22)}</button>
      </div>
      <div class="trust" aria-label="Customer trust: ${esc(trustLabel)}"><span class="label">Customer trust</span>
        <div class="segs ${segs === 1 ? 'low' : ''}">${[0, 1, 2].map((i) => `<span class="${i < segs ? 'on' : ''}"></span>`).join('')}</div>
        <span class="small" style="font-weight:800;color:${!started ? 'var(--muted)' : segs === 1 ? 'var(--warn)' : 'var(--accent)'}">${esc(trustLabel)}</span></div>
      <div class="convo" id="convo">${messages}${S.pending ? '<div class="typing" aria-label="Customer is replying"><span></span><span></span><span></span></div>' : ''}</div>
      <form class="composer" data-form="reply">
        ${choices.length ? `<span class="label">Pick a reply</span>${choices.map((c) => `
          <button type="button" class="choice" data-action="choose" data-letter="${esc(c.letter)}" aria-pressed="${S.selectedChoice === c.letter}" ${S.pending ? 'disabled' : ''}><b>${esc(c.letter)}</b><span>${esc(c.text)}</span></button>`).join('')}` : ''}
        <div class="send-row">
          <label class="grow"><span class="sr-only">Your reply</span><textarea class="textarea" id="draft" rows="1" data-input="draft" placeholder="${choices.length ? 'Or write your own — earns 2× XP' : 'Write your reply'}" ${S.pending ? 'disabled' : ''}>${esc(S.draft)}</textarea></label>
          <button class="send-btn" type="submit" aria-label="Send reply" ${S.pending || (!S.draft.trim() && !S.selectedChoice) ? 'disabled' : ''}>${icon('send', 22, 2.4)}</button>
        </div>
      </form>
    </main>`;
  }

  async function startSession({ lessonCategory, freshUp = false } = {}) {
    if (S.busy) return;
    S.busy = true;
    S.sheet = null;
    render();
    try {
      const data = await api('/api/session/start', {
        method: 'POST',
        body: { ...identity(), lessonCategory: freshUp ? undefined : lessonCategory || undefined, freshUp: freshUp || undefined },
      });
      S.session = data.session || data.mission;
      S.selectedChoice = null;
      S.draft = '';
      S.busy = false;
      go('session');
    } catch (err) {
      S.busy = false;
      render();
      toast(err.message, true);
    }
  }

  async function sendReply() {
    const s = S.session;
    if (!s || S.pending) return;
    const typed = S.draft.trim();
    const choice = (s.choices || []).find((c) => c.letter === S.selectedChoice);
    const answer = typed || choice?.text || '';
    if (!answer) return;
    const responseMode = typed ? 'verbatim' : 'multiple_choice';
    const prevUser = S.bundle.user;
    s.messages = [...(s.messages || []), { sender: 'user', text: answer }];
    S.pending = true;
    S.draft = '';
    render();
    try {
      const data = await api('/api/session/complete', {
        method: 'POST',
        body: { ...identity(), sessionId: s.sessionId, answer, selectedChoice: choice?.letter || null, selectedChoiceText: choice?.text || '', responseMode },
      });
      S.pending = false;
      S.selectedChoice = null;
      if (data.stage === 'continue') {
        S.session = data.session;
        render();
        return;
      }
      S.result = { ...data, prevUser, afterUser: data.updatedUser || prevUser, lesson: s.lessonTitle || s.title, boss: s.activitySource === 'fresh-up' };
      S.session = null;
      if (data.updatedUser) S.bundle.user = { ...S.bundle.user, ...data.updatedUser };
      if (Array.isArray(data.recentSessions) && data.recentSessions.length) S.bundle.recentSessions = data.recentSessions;
      if (Array.isArray(data.badges)) S.bundle.badges = data.badges;
      if (data.insight) S.bundle.insight = data.insight;
      go('result');
      loadBundle().catch(() => {});
    } catch (err) {
      S.pending = false;
      s.messages = s.messages.slice(0, -1);
      S.draft = typed;
      render();
      toast(err.message, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Result
  // ---------------------------------------------------------------------------
  function resultScreen() {
    const r = S.result;
    if (!r) return '';
    const res = r.result || {};
    const xp = Math.round(Number(res.xpAwarded || 0));
    const violation = res.severity === 'behavior_violation';
    const before = r.prevUser?.stats || {};
    const after = r.afterUser?.stats || {};
    const deltas = TRAITS.map(([k, l]) => ({ l, d: score(after, k) - score(before, k) })).filter((x) => x.d !== 0).sort((a, b) => b.d - a.d);
    const lvl = r.afterUser?.level || S.bundle.user?.level || {};
    const nextFocus = traitName(res.recommendedNextFocus);
    return `${previewBanner()}<main class="page no-tabs">
      <div class="result-head">
        <span class="ring ${violation || xp < 0 ? 'warn' : ''}">${icon(violation || xp < 0 ? 'alert' : 'check', 32, 2.6)}</span>
        <span class="muted small" style="font-weight:700;margin-top:10px">${esc(r.boss ? 'Boss challenge complete' : 'Session complete')}${r.lesson ? ` · ${esc(r.lesson)}` : ''}</span>
        <span class="xp ${xp < 0 ? 'warn' : ''}">${xp >= 0 ? '+' : '−'}${Math.abs(xp)} XP</span>
        ${res.trustLabel ? `<span class="muted">Customer trust ended <b style="color:var(--text)">${esc(res.trustLabel)}</b></span>` : ''}
      </div>
      ${violation ? `<section class="card" style="border-color:rgba(255,154,107,.4)"><span class="label warn">This session was flagged</span><p>Some replies crossed the line for a customer conversation, so XP was reduced. Keep it professional and try again.</p></section>` : ''}
      <section class="card"><div class="row between small" style="font-weight:700"><span>Level ${esc(lvl.level || 1)}</span><span class="muted num">${esc(lvl.levelXp ?? 0)} / ${esc(lvl.nextLevelXp ?? 0)} XP</span></div>${bar(lvl.progress)}</section>
      <section class="card">
        ${res.resultTitle ? `<h3>${esc(res.resultTitle)}</h3>` : ''}
        ${res.resultBody ? `<p>${esc(res.resultBody)}</p>` : ''}
        ${res.coachSummary ? `<div class="divider"></div><div class="tip"><img src="${LOGO}" alt="Sprocket"><div class="stack"><span class="label accent">Sprocket’s take</span><p>${esc(res.coachSummary)}</p></div></div>` : ''}
        ${nextFocus ? `<div class="divider"></div><div class="stack"><span class="label warn">Work on next</span><p><b>${esc(nextFocus)}</b></p></div>` : ''}
      </section>
      ${deltas.length ? `<section class="card" style="gap:4px"><span class="label">Skill changes</span>${deltas.map(({ l, d }) => `
        <div class="delta"><span style="font-weight:700">${esc(l)}</span><span class="v ${d > 0 ? 'up' : 'down'}">${icon(d > 0 ? 'up' : 'down', 16, 2.4)}${d > 0 ? '+' : '−'}${Math.abs(d)}</span></div>`).join('')}</section>` : ''}
      <button class="btn primary block" data-action="done-result">Done</button>
      <button class="btn block" data-action="again">Practice again</button>
    </main>`;
  }

  // ---------------------------------------------------------------------------
  // Progress (profile)
  // ---------------------------------------------------------------------------
  function skillBars(stats) {
    const rows = TRAITS.map(([k, l]) => ({ k, l, v: score(stats, k) })).sort((a, b) => b.v - a.v);
    return rows.map((r, i) => {
      const tag = i === 0 ? '<span class="chip accent">Strongest</span>' : i === rows.length - 1 ? '<span class="chip warn">Focus</span>' : '';
      return `<div class="skill"><div class="row"><span class="row" style="gap:8px">${esc(r.l)} ${tag}</span><span class="num">${r.v}%</span></div>${bar(r.v, i === rows.length - 1 ? 'warn' : '')}</div>`;
    }).join('');
  }
  function weekChart(series) {
    const list = Array.isArray(series) ? series : [];
    if (!list.length) return '';
    const max = Math.max(1, ...list.map((p) => Number(p.value) || 0));
    return `<div class="week" role="img" aria-label="Activity by day: ${list.map((p) => `${p.label} ${p.value}`).join(', ')}">${list.map((p) => `
      <div class="col"><span class="${Number(p.value) === max ? 'hi' : ''}" style="height:${Math.max(4, (Number(p.value) / max) * 100)}%"></span><small>${esc(p.label)}</small></div>`).join('')}</div>`;
  }
  function badgeName(b) {
    const raw = b.name || b.title || b.label || b.id || 'Badge';
    return String(raw).replace(/^mock-/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function progressScreen() {
    const b = S.bundle;
    const u = b.user || {};
    const lvl = u.level || {};
    const store = u.dealershipName || b.managerDashboard?.scopeLabel || '';
    const badges = Array.isArray(b.badges) ? b.badges : [];
    return screen('progress', `
      ${topbar('Progress', { right: `<a class="icon-btn" href="#/settings" aria-label="Settings">${icon('settings', 20)}</a>` })}
      <section class="card">
        <div class="row">${avatar(u, 'lg')}<div class="stack"><b style="font-size:20px">${esc(u.name || 'You')}</b><span class="muted small">${esc([roleOf(), store].filter(Boolean).join(' · '))}</span></div></div>
        <div class="row between small" style="font-weight:700"><span>Level ${esc(lvl.level || 1)}</span><span class="muted num">${esc(lvl.levelXp ?? 0)} / ${esc(lvl.nextLevelXp ?? 0)} XP</span></div>${bar(lvl.progress)}
        <div class="grid3" style="margin-top:4px">
          <div class="stat"><div class="value">${esc(u.streak || 0)}</div><div class="caption">Day streak</div></div>
          <div class="stat"><div class="value">${esc(clamp(u.momentumScore))}</div><div class="caption">Momentum</div></div>
          <div class="stat"><div class="value">${esc(Number(u.xp || 0).toLocaleString())}</div><div class="caption">Total XP</div></div>
        </div>
      </section>
      <section class="card"><span class="label">Skills</span>${skillBars(u.stats)}</section>
      ${u.momentumSeries?.length || b.momentumSeries?.length ? `<section class="card"><span class="label">This week</span>${weekChart(u.momentumSeries || b.momentumSeries)}</section>` : ''}
      ${badges.length ? `<section class="card"><span class="label">Badges</span><div class="badges">${badges.slice(0, 8).map((x) => `<div class="badge"><span>${icon('trophy', 26)}</span>${esc(badgeName(x))}</div>`).join('')}</div></section>` : ''}
      <div class="section-title"><h2>Recent sessions</h2><a class="link accent" href="#/practice" data-action="practice-tab" data-tab="history">See all</a></div>
      ${historyList((b.recentSessions || []).slice(0, 3), 'No sessions yet.')}`);
  }

  // ---------------------------------------------------------------------------
  // Settings and static pages
  // ---------------------------------------------------------------------------
  function settingsScreen() {
    const u = S.bundle.user || {};
    const [fn, ...rest] = String(u.name || '').split(' ');
    return `${previewBanner()}<main class="page no-tabs">
      ${backbar('Settings', 'progress')}
      <form class="card form" data-form="profile">
        <span class="label">Profile</span>
        <div class="grid2">
          <label class="field"><span>First name</span><input class="input" name="firstName" value="${esc(u.firstName || fn)}" autocomplete="given-name"></label>
          <label class="field"><span>Last name</span><input class="input" name="lastName" value="${esc(u.lastName || rest.join(' '))}" autocomplete="family-name"></label>
        </div>
        <fieldset style="border:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px"><legend class="label" style="padding:0;margin-bottom:10px">Picture</legend>
          <div class="row" style="flex-wrap:wrap;gap:10px">${['', ...AVATARS].map((src) => `
            <label style="position:relative;cursor:pointer"><input class="sr-only" type="radio" name="avatarUrl" value="${esc(src)}" ${String(u.avatarUrl || '') === src ? 'checked' : ''}>
              <span class="avatar" data-avatar-option style="width:48px;height:48px;flex-basis:48px">${src ? `<img src="${esc(src)}" alt="${esc(src.split('/').pop().replace('.png', ''))} avatar">` : esc(initials(u.name))}</span></label>`).join('')}</div>
        </fieldset>
        <button class="btn primary" type="submit" ${S.busy ? 'disabled' : ''}>Save profile</button>
      </form>
      <section class="card flush">
        <div class="toggle-row"><span class="stack"><b>Session reminders</b><span class="muted small">A nudge when you haven’t practiced today</span></span><label class="switch"><input type="checkbox" data-change="pref" data-key="${LS.reminders}" ${read(LS.reminders) === '1' ? 'checked' : ''}><span></span><span class="sr-only">Session reminders</span></label></div>
        <div class="toggle-row"><span class="stack"><b>Share anonymous coaching data</b><span class="muted small">Helps improve lessons. Never includes your name.</span></span><label class="switch"><input type="checkbox" data-change="pref" data-key="${LS.share}" ${read(LS.share) === '1' ? 'checked' : ''}><span></span><span class="sr-only">Share anonymous coaching data</span></label></div>
      </section>
      <section class="card flush"><div class="list">
        ${isLeader() ? `<a class="list-item" href="#/store-request">${icon('store')}<span class="title grow">Add another store</span><span class="chev">${icon('chevR', 20)}</span></a>` : ''}
        <a class="list-item" href="mailto:support@autoknerd.app?subject=AutoKnerd%20Support">${icon('mail')}<span class="title grow">Contact support</span><span class="chev">${icon('external', 18)}</span></a>
        <a class="list-item" href="#/privacy">${icon('doc')}<span class="title grow">Privacy Policy</span><span class="chev">${icon('chevR', 20)}</span></a>
        <a class="list-item" href="#/terms">${icon('doc')}<span class="title grow">Terms of Use</span><span class="chev">${icon('chevR', 20)}</span></a>
        ${isAdmin() ? `<a class="list-item" href="/classic">${icon('settings')}<span class="title grow">Admin console (classic app)</span><span class="chev">${icon('external', 18)}</span></a>` : ''}
      </div></section>
      <button class="btn block danger" data-action="sign-out">${icon('logout', 20)} Sign out</button>
    </main>`;
  }

  function staticScreen(kind) {
    const back = S.bundle ? 'settings' : '';
    const pages = {
      privacy: ['Privacy Policy', [
        ['How we handle your coaching data', 'AutoKnerd stores your profile, lessons, scores, and progress so the app can coach you over time. We use this data to power your dashboard, session history, profile, and role-specific lesson library.'],
        ['Sharing', 'We may use anonymous coaching data to improve the product if you turn on sharing in Settings.'],
        ['What we collect', 'Profile info, role, XP, lesson results, skill trends, and app preferences.'],
        ['What we do not do', 'We do not sell your personal coaching data.'],
      ]],
      terms: ['Terms of Use', [
        ['Use the app responsibly', 'AutoKnerd is a coaching and training app for dealership teams. Use it for legitimate practice, coaching, and workflow support only.'],
        ['Not professional advice', 'Session content, scores, and generated lesson plans support coaching. Do not rely on them as legal, financial, or employment advice.'],
        ['Account access', 'Keep your login secure and do not share access with anyone else.'],
        ['Content ownership', 'The app, coaching prompts, and generated lessons are part of the AutoKnerd service and may change over time.'],
      ]],
    };
    const [title, sections] = pages[kind];
    return `<main class="page no-tabs">${S.bundle ? backbar(title, back) : `<header class="backbar"><a class="icon-btn plain" href="#/" aria-label="Back">${icon('chevL', 24)}</a><h1>${title}</h1></header>`}
      ${sections.map(([h, p]) => `<section class="card"><h3>${esc(h)}</h3><p class="muted">${esc(p)}</p></section>`).join('')}</main>`;
  }

  function storeRequestScreen() {
    return `${previewBanner()}<main class="page no-tabs">${backbar('Add another store', 'team')}
      <p class="muted" style="margin:0 4px">We review new stores before they show up on your Team tab. Send the details and we’ll follow up by email.</p>
      <form class="card form" data-form="store-request">
        <label class="field"><span>Dealership name</span><input class="input" name="name" required></label>
        <label class="field"><span>Why add this store?</span><textarea class="textarea" name="reason" placeholder="e.g. I’m the GM for both rooftops"></textarea></label>
        <button class="btn primary" type="submit">Send request</button>
      </form></main>`;
  }

  // ---------------------------------------------------------------------------
  // Team (leaders)
  // ---------------------------------------------------------------------------
  function teamView() {
    const md = S.bundle.managerDashboard;
    if (!md) return null;
    const sel = read(LS.store(S.bundle.user?.userId)) || 'all';
    const stores = Array.isArray(md.stores) ? md.stores : [];
    const view = sel !== 'all' && stores.find((s) => s.dealershipId === sel);
    return { md, stores, sel: view ? sel : 'all', view: view || md };
  }
  function unwrapTune(t) {
    if (!t) return null;
    return t.tune && typeof t.tune === 'object' ? { ...t.tune, scopeLabel: t.scopeLabel, dealershipId: t.dealershipId } : (t.title || t.normalizedTheme ? t : null);
  }
  function memberScore(m) {
    const vals = TRAITS.map(([k]) => score(m.stats, k));
    return Math.round(vals.reduce((a, v) => a + v, 0) / vals.length);
  }

  function teamScreen() {
    const tv = teamView();
    const { stores, sel, view } = tv;
    const trend = String(view.trendLabel || '').match(/[-+]?\d+/)?.[0];
    const trendNum = Number(trend || 0);
    const members = (Array.isArray(view.teamMembers) ? view.teamMembers : []).slice().sort((a, b) => memberScore(a) - memberScore(b));
    const avgs = view.departmentAverageScores || {};
    const storePicker = stores.length ? `<label class="field" style="margin-top:-4px"><span class="sr-only">Store</span>
      <select class="select" data-change="store">${[['all', `All stores (${stores.length})`], ...stores.map((s) => [s.dealershipId, s.dealershipName || s.scopeLabel])].map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : '';
    const active = view.activeUsers ?? null;
    const size = view.candidateCount ?? members.length;
    return screen('team', `
      ${topbar('Team', { eyebrow: [roleOf(), stores.length ? '' : (S.bundle.user?.dealershipName || view.scopeLabel || '')].filter(Boolean).join(' · ') })}
      ${storePicker}
      <div class="grid2">
        <section class="card tight stat"><span class="label">Avg CX score</span>
          <div class="row" style="gap:8px;align-items:baseline"><span class="value" style="font-size:32px">${view.storePerformance != null ? `${esc(view.storePerformance)}%` : '—'}</span>
          ${trend ? `<span class="small row" style="gap:2px;font-weight:800;color:${trendNum >= 0 ? 'var(--accent)' : 'var(--warn)'}">${icon(trendNum >= 0 ? 'up' : 'down', 14, 2.6)}${Math.abs(trendNum)}%</span>` : ''}</div>
          <span class="caption">vs. last week</span></section>
        <section class="card tight stat"><span class="label">${active != null ? 'Active recently' : 'Team momentum'}</span>
          ${active != null ? `<div class="row" style="gap:6px;align-items:baseline"><span class="value" style="font-size:32px">${esc(active)}</span><span class="muted" style="font-weight:700">of ${esc(size)}</span></div>${bar(size ? (active / size) * 100 : 0, 'thin')}`
            : `<span class="value" style="font-size:32px">${esc(clamp(view.departmentMomentum))}</span>${bar(view.departmentMomentum, 'thin')}`}</section>
      </div>
      ${view.biggestOpportunity ? `<section class="card">
        <div class="row" style="gap:8px;color:var(--warn)">${icon('alert', 20)}<span class="small" style="font-weight:800">Biggest opportunity</span></div>
        <h2 style="font-size:20px">${esc(view.biggestOpportunity.title)}</h2>
        ${view.biggestOpportunity.body ? `<p class="muted">${esc(view.biggestOpportunity.body)}</p>` : ''}
        <a class="btn primary block" href="#/plan">${icon('spark', 20, 2.2)} Build coaching plan</a></section>` : ''}
      ${tuneCard(tv)}
      <section class="card"><span class="label">Team skills</span>${skillBars(avgs)}</section>
      <div class="section-title"><h2>Your team</h2><span class="muted small" style="font-weight:700">Needs help first</span></div>
      ${members.length ? `<section class="card flush"><div class="list">${members.slice(0, S.showAllTeam ? members.length : 8).map((m) => {
        const sc = memberScore(m);
        return `<a class="list-item" href="#/member/${encodeURIComponent(m.id || m.userId)}">${avatar(m, 'neutral')}
          <span class="stack grow"><span class="title">${esc(m.name)}</span><span class="sub">${esc([m.roleLabel || m.role, m.watchArea ? `Watch: ${traitName(m.watchArea)}` : ''].filter(Boolean).join(' · '))}</span></span>
          <span class="stack" style="align-items:flex-end"><span class="num" style="font-weight:700;font-size:17px;color:${sc < 60 ? 'var(--warn)' : 'var(--text)'}">${sc}%</span><span class="sub" style="font-size:12px;color:var(--muted);font-weight:700">${esc(m.lastActive || '')}</span></span></a>`;
      }).join('')}</div></section>${members.length > 8 && !S.showAllTeam ? `<button class="btn block" data-action="show-all-team">Show all ${members.length}</button>` : ''}` : '<p class="empty">No one on this team yet. Share your dealer code so people can join.</p>'}
      ${stores.length || ['Owner', 'General Manager'].includes(roleOf()) ? `<a class="btn ghost block" href="#/store-request">${icon('plus', 20)} Add another store</a>` : ''}`);
  }

  function memberScreen(id) {
    const tv = teamView();
    const all = [tv.md, ...tv.stores].flatMap((v) => v.teamMembers || []);
    const m = all.find((x) => String(x.id || x.userId) === id);
    if (!m) return `<main class="page no-tabs">${backbar('Team member', 'team')}<p class="empty">We couldn’t find that person.</p></main>`;
    const lvl = m.level || {};
    return `${previewBanner()}<main class="page no-tabs">${backbar(m.name, 'team')}
      <section class="card">
        <div class="row">${avatar(m, 'lg neutral')}<div class="stack"><b style="font-size:20px">${esc(m.name)}</b><span class="muted small">${esc([m.roleLabel || m.role, m.dealershipName].filter(Boolean).join(' · '))}</span>${m.lastActive ? `<span class="muted small">Active ${esc(m.lastActive)}</span>` : ''}</div></div>
        <div class="row between small" style="font-weight:700"><span>Level ${esc(lvl.level || 1)}</span><span class="muted num">${esc(lvl.levelXp ?? 0)} / ${esc(lvl.nextLevelXp ?? 0)} XP</span></div>${bar(lvl.progress)}
        <div class="grid3"><div class="stat"><div class="value">${esc(m.streak || 0)}</div><div class="caption">Day streak</div></div>
          <div class="stat"><div class="value">${esc(clamp(m.momentumScore))}</div><div class="caption">Momentum</div></div>
          <div class="stat"><div class="value">${memberScore(m)}%</div><div class="caption">Avg skill</div></div></div>
      </section>
      <div class="grid2">
        <section class="card tight"><span class="label accent">Top skill</span><b>${esc(traitName(m.topSkill || m.strongTrait) || '—')}</b></section>
        <section class="card tight"><span class="label warn">Watch area</span><b>${esc(traitName(m.watchArea || m.focusTrait) || '—')}</b></section>
      </div>
      <section class="card"><span class="label">Skills</span>${skillBars(m.stats)}</section>
      <div class="section-title"><h2>Recent sessions</h2></div>
      ${historyList(m.recentSessions, 'No sessions yet.')}
    </main>`;
  }

  // Weekly training focus. Department managers set it for their department; owners/GMs set it
  // storewide, per store or for all their stores at once.
  function tuneStatus(tv) {
    const { md, stores, sel, view } = tv;
    if (!stores.length) return { tune: unwrapTune(md.weeklyTrainingTune), where: md.weeklyTrainingTune?.scopeLabel || S.bundle.weeklyTrainingTuneScope?.scopeLabel || 'your team' };
    if (sel !== 'all') return { tune: unwrapTune(view.weeklyTrainingTune), where: view.dealershipName || view.scopeLabel || 'this store' };
    const tunes = stores.map((st) => ({ store: st, tune: unwrapTune(st.weeklyTrainingTune) }));
    const set = tunes.filter((x) => x.tune);
    const key = (t) => `${t.focusTrait}|${t.strength}|${t.sourceText || ''}`;
    const shared = set.length === stores.length && set.every((x) => key(x.tune) === key(set[0].tune));
    return { tune: shared ? set[0].tune : null, where: `all ${stores.length} stores`, partial: shared ? null : { set, total: stores.length } };
  }

  function tuneCard(tv) {
    const { tune, where, partial } = tuneStatus(tv);
    const days = daysUntil(tune?.expiresAt);
    const skill = traitName(tune?.focusTrait);
    const strong = tune?.strength === 'strong';
    let body;
    if (tune) {
      body = `<div class="chips">${skill ? `<span class="chip accent">${esc(skill)}</span>` : ''}<span class="chip">${strong ? 'Strong lean' : 'Light touch'}</span></div>
        <p style="font-weight:700">${esc(tune.sourceText || tune.normalizedTheme || tune.title)}</p>
        <span class="muted small">${esc(strong && skill ? `Most sessions this week target ${skill}.` : 'Blended into each person’s own lesson.')}</span>
        <span class="muted small">${esc([tune.updatedByName ? `Set by ${tune.updatedByName}` : '', `for ${where}`, days != null ? `resets in ${days} day${days === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))}</span>`;
    } else if (partial?.set.length) {
      body = `<p style="font-weight:700">${partial.set.length === partial.total ? 'Each store has its own focus' : `Set in ${partial.set.length} of ${partial.total} stores`}</p>
        <div class="list">${partial.set.map(({ store, tune: t }) => `<div class="list-item" style="min-height:44px"><span class="grow small" style="font-weight:700">${esc(store.dealershipName || store.scopeLabel)}</span><span class="chip">${esc(traitName(t.focusTrait) || t.title)}${t.strength === 'strong' ? ' · Strong' : ''}</span></div>`).join('')}</div>
        <span class="muted small">Saving here sets the same focus for all ${partial.total} stores.</span>`;
    } else {
      body = `<p class="muted">Not set. Pick a skill and every session this week leans toward it.</p>`;
    }
    return `<section class="card">
      <div class="row between"><span class="label">This week’s training focus</span>
        ${canTune() && tune ? `<button class="icon-btn" data-action="edit-tune" aria-label="Edit weekly focus">${icon('edit', 20)}</button>` : ''}</div>
      ${body}
      ${canTune() && !tune ? `<button class="btn primary block" data-action="edit-tune">${icon('target', 20, 2.2)} Set this week’s focus</button>` : ''}
    </section>`;
  }

  function tuneSheet() {
    const tv = teamView();
    const { tune, where } = tuneStatus(tv);
    const avgs = tv.view.departmentAverageScores || {};
    const lowest = TRAITS.map(([k]) => [k, score(avgs, k)]).sort((a, b) => a[1] - b[1])[0]?.[0];
    const picked = traitKey(tune?.focusTrait) || lowest || 'followUp';
    const strength = tune?.strength === 'strong' ? 'strong' : 'light';
    return `<h2>This week’s training focus</h2>
      <p class="muted small">For ${esc(where)} · lasts 7 days</p>
      <form class="form" data-form="tune">
        <fieldset class="fieldset"><legend class="label">Which skill?</legend>
          <div class="opt-grid">${TRAITS.map(([k, l]) => `<label class="opt"><input class="sr-only" type="radio" name="trait" value="${k}" ${k === picked ? 'checked' : ''}>
            <span><b>${esc(l)}</b>${k === lowest ? '<small>Team’s lowest</small>' : `<small class="num">${score(avgs, k)}% team avg</small>`}</span></label>`).join('')}</div>
        </fieldset>
        <fieldset class="fieldset"><legend class="label">How hard should it lean?</legend>
          <div class="opt-grid one">
            <label class="opt"><input class="sr-only" type="radio" name="strength" value="light" ${strength === 'light' ? 'checked' : ''}>
              <span><b>Light touch</b><small>Everyone still works on their own weakest skill. This one gets woven into the scenarios.</small></span></label>
            <label class="opt"><input class="sr-only" type="radio" name="strength" value="strong" ${strength === 'strong' ? 'checked' : ''}>
              <span><b>Strong lean</b><small>Most sessions this week are built to test this skill, and it’s the skill that grows.</small></span></label>
          </div>
        </fieldset>
        <label class="field"><span>Anything specific? (optional)</span><textarea class="textarea" name="text" placeholder="e.g. Ask for the appointment before they leave the lot">${esc(tune?.sourceText || '')}</textarea></label>
        <button class="btn primary block" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Saving…' : 'Save for this week'}</button>
        ${tune ? `<button class="btn ghost block danger" type="button" data-action="clear-tune">Clear focus</button>` : ''}
      </form>`;
  }

  // ---------------------------------------------------------------------------
  // Coaching plan (AutoForge)
  // ---------------------------------------------------------------------------
  function mdToHtml(md) {
    const lines = esc(md).split(/\r?\n/);
    let html = '';
    let list = null;
    const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*(\S.*?)\*(?=\W|$)/g, '$1<em>$2</em>');
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    lines.forEach((raw) => {
      const line = raw.trim();
      let m;
      if (!line) { close(); return; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { close(); const lvl = Math.min(4, m[1].length + 1); html += `<h${lvl}>${inline(m[2])}</h${lvl}>`; return; }
      if ((m = line.match(/^[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; return; }
      if ((m = line.match(/^\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; return; }
      close();
      html += `<p>${inline(line)}</p>`;
    });
    close();
    return html;
  }

  function planScreen() {
    const p = S.plan;
    let body;
    if (S.planLoading) body = `<section class="card"><div class="row"><img src="${LOGO}" alt="" width="40" height="40" style="animation:spin 2.4s linear infinite"><div class="stack"><b>Building your coaching plan…</b><span class="muted small">Sprocket is reading your team’s latest sessions. This takes about 20 seconds.</span></div></div></section>`;
    else if (p?.error) body = `<section class="card"><span class="label warn">Couldn’t build the plan</span><p>${esc(p.error)}</p><button class="btn primary" data-action="plan-refresh">Try again</button></section>`;
    else if (p?.report) body = `
      <section class="card"><span class="label">${esc(p.generatedAt ? `Generated ${fmtDate(p.generatedAt)}` : 'Coaching plan')}</span><h2>${esc(p.title || 'Coaching plan')}</h2><div class="report">${mdToHtml(String(p.report).replace(/^\s*#{1,4}\s+(.+)\n/, (m, h) => (h.trim() === String(p.title || '').trim() ? '' : m)))}</div></section>
      <div class="grid2"><button class="btn" data-action="plan-refresh">${icon('refresh', 20)} Regenerate</button><button class="btn primary" data-action="plan-pdf">${icon('download', 20)} Download PDF</button></div>`;
    else body = '';
    return `${previewBanner()}<main class="page no-tabs">${backbar('Coaching plan', 'team')}${body}</main>`;
  }

  async function loadPlan() {
    const tv = teamView();
    S.planLoading = true;
    S.plan = null;
    render();
    try {
      const data = await api('/api/autoforge/lesson-plan', { method: 'POST', body: { ...identity(), storeSelection: tv?.sel || 'all' } });
      S.plan = { ...data, generatedAt: data.generatedAt || new Date().toISOString() };
    } catch (err) {
      S.plan = { error: err.message };
    }
    S.planLoading = false;
    if (parseRoute().name === 'plan') render();
  }

  async function downloadPlanPdf() {
    const p = S.plan;
    if (!p?.report) return;
    try {
      const res = await api('/api/autoforge/export-pdf', {
        method: 'POST', raw: true,
        body: { report: p.report, department: p.department || '', dealershipName: p.dealershipName || S.bundle.user?.dealershipName || S.bundle.user?.name || 'Dealership' },
      });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(p.title || 'coaching-plan').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      toast(err.message || 'Could not export the PDF.', true);
    }
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------
  function toolState() {
    try { return { saved: [], recent: [], notes: {}, ...JSON.parse(read(LS.tools(S.bundle?.user?.userId)) || '{}') }; } catch { return { saved: [], recent: [], notes: {} }; }
  }
  function saveToolState(next) { write(LS.tools(S.bundle?.user?.userId), JSON.stringify(next)); }
  const toolFits = (t) => (t.roles || []).includes(roleOf());

  function toolRow(t, saved) {
    const on = saved.includes(t.id);
    return `<div class="tool-row"><a href="#/tool/${encodeURIComponent(t.id)}"><b>${esc(t.name)}</b><span>${esc(t.summary)}</span><small>${esc(t.category)} · ${esc(t.estimatedTime || '')}</small></a>
      <button class="icon-btn ${on ? 'on' : ''}" data-action="save-tool" data-id="${esc(t.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from saved' : 'Save'}: ${esc(t.name)}">${icon('bookmark', 18)}</button></div>`;
  }

  function toolResults() {
    const st = toolState();
    const q = S.toolSearch.trim().toLowerCase();
    const cat = S.toolCat;
    const filtered = TOOLS.filter((t) => (cat === 'All' || t.category === cat) && (!q || [t.name, t.summary, ...(t.tags || []), ...(t.needTags || [])].join(' ').toLowerCase().includes(q)));
    if (q || cat !== 'All') {
      return filtered.length ? `<section class="card flush">${filtered.map((t) => toolRow(t, st.saved)).join('')}</section>` : '<p class="empty">No tools match that. Try a simpler word like “price” or “follow-up”.</p>';
    }
    const saved = st.saved.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean);
    const forYou = TOOLS.filter(toolFits).sort((a, b) => Number(b.featured) - Number(a.featured));
    const rest = TOOLS.filter((t) => !toolFits(t));
    return `
      ${saved.length ? `<div class="section-title"><h2>Saved</h2></div><div class="grid2">${saved.map((t) => `<a class="saved-card" href="#/tool/${encodeURIComponent(t.id)}"><span class="icon">${icon('bookmark', 20)}</span><b>${esc(t.name)}</b><span class="muted small">${esc(t.category)} · ${esc(t.estimatedTime || '')}</span></a>`).join('')}</div>` : ''}
      ${forYou.length ? `<div class="section-title"><h2>For your role</h2></div><section class="card flush">${forYou.map((t) => toolRow(t, st.saved)).join('')}</section>` : ''}
      ${rest.length ? `<div class="section-title"><h2>More tools</h2></div><section class="card flush">${rest.map((t) => toolRow(t, st.saved)).join('')}</section>` : ''}`;
  }

  function toolsScreen() {
    return screen('tools', `
      ${topbar('Tools')}
      <label class="search">${icon('search', 20)}<span class="sr-only">Search tools</span><input type="search" data-input="tool-search" placeholder="What do you need help with?" value="${esc(S.toolSearch)}" autocomplete="off"></label>
      <div class="cats" role="group" aria-label="Category">${TOOL_CATEGORIES.map((c) => `<button class="cat" data-action="tool-cat" data-cat="${esc(c)}" aria-pressed="${S.toolCat === c}">${esc(c)}</button>`).join('')}</div>
      <div id="toolResults" style="display:flex;flex-direction:column;gap:16px">${toolResults()}</div>`);
  }

  function toolLegacyUrl(id) {
    return `${location.protocol}//${location.hostname}:3000/autoshop/${encodeURIComponent(id)}`;
  }

  function toolScreen(id) {
    const t = TOOLS.find((x) => x.id === id);
    if (!t) return `<main class="page no-tabs">${backbar('Tool', 'tools')}<p class="empty">That tool isn’t available.</p></main>`;
    const st = toolState();
    const on = st.saved.includes(t.id);
    const insight = S.insight[t.id];
    const related = TOOLS.filter((x) => x.id !== t.id && (x.needTags || []).some((n) => (t.needTags || []).includes(n))).slice(0, 3);
    return `${previewBanner()}<main class="page no-tabs">
      <header class="backbar"><a class="icon-btn plain" href="#/tools" aria-label="Back">${icon('chevL', 24)}</a><h1 class="grow">${esc(t.name)}</h1>
        <button class="icon-btn ${on ? 'on' : ''}" data-action="save-tool" data-id="${esc(t.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from saved' : 'Save tool'}">${icon('bookmark', 18)}</button></header>
      <section class="card">
        <div class="chips"><span class="chip">${esc(t.category)}</span><span class="chip">${icon('clock', 14)} ${esc(t.estimatedTime || '')}</span>${toolFits(t) ? '<span class="chip accent">Fits your role</span>' : ''}</div>
        <p style="font-size:17px">${esc(t.summary)}</p>
        <a class="btn primary block" href="${esc(toolLegacyUrl(t.id))}" target="_blank" rel="noopener">${esc(t.actionLabel || 'Open tool')} ${icon('external', 18)}</a>
      </section>
      <section class="card">
        <div class="row between"><span class="label accent">Ask Sprocket</span></div>
        ${insight?.text ? `<div class="tip"><img src="${LOGO}" alt="Sprocket"><div class="report">${mdToHtml(insight.text.replace(/\s+(\*\*[^*]+\*\*)/g, '\n\n$1'))}</div></div>` : `<p class="muted small">Get a quick tip on when and how to use this tool in your role.</p>`}
        <button class="btn block" data-action="tool-insight" data-id="${esc(t.id)}" ${insight?.loading ? 'disabled' : ''}>${insight?.loading ? 'Thinking…' : insight?.text ? 'Ask again' : 'How should I use this?'}</button>
      </section>
      <section class="card"><label class="field"><span class="label">My notes</span><textarea class="textarea" data-input="tool-note" data-id="${esc(t.id)}" placeholder="Phrases that worked, customer names, reminders…">${esc(st.notes[t.id] || '')}</textarea></label><span class="muted small">Saved on this device.</span></section>
      ${related.length ? `<div class="section-title"><h2>Related</h2></div><section class="card flush">${related.map((x) => toolRow(x, st.saved)).join('')}</section>` : ''}
    </main>`;
  }

  // ---------------------------------------------------------------------------
  // Demo (public, sample data only)
  // ---------------------------------------------------------------------------
  function demoScreen() {
    const back = S.token ? `<a class="btn ghost block" href="/">Back to your account</a>` : `<a class="btn ghost block" href="/">Sign in instead</a>`;
    return `<main class="page no-tabs">
      <div class="brand" style="display:flex;flex-direction:column;gap:10px;padding-top:28px">
        <img src="${LOGO}" alt="" width="56" height="56">
        <span class="label accent">Interactive demo</span>
        <h1 style="margin:0;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.02em">See AutoKnerd from your seat.</h1>
        <p class="muted" style="margin:0">Pick the role you play at the store. Everything runs on sample data, so tap anything and run a full practice session. Nothing touches a real store.</p>
      </div>
      ${DEMO_PERSONAS.map((p) => `<button class="card persona" data-action="demo-persona" data-role="${esc(p.role)}">
        <div class="row between"><span class="label">${esc(p.eyebrow)}</span><span class="muted">${icon('chevR', 20)}</span></div>
        <h3>${esc(p.role)}</h3>
        <p class="muted small">${esc(p.summary)}</p>
        <div class="chips">${p.questions.map((q) => `<span class="chip">${esc(q)}</span>`).join('')}</div>
      </button>`).join('')}
      ${IS_LOCAL ? `<section class="card tight"><span class="label">Any role (only on your network)</span>
        <div class="row"><label class="grow"><span class="sr-only">Role</span><select class="select" id="previewRole">${ROLES.concat(['Admin']).map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
        <button class="btn small" data-action="start-preview">Open</button></div></section>` : ''}
      <section class="card"><h3>Like what you see?</h3><p class="muted">Book a walkthrough and we’ll set AutoKnerd up around your team.</p>
        <a class="btn primary block" href="${MEETING_URL}" target="_blank" rel="noopener">Book a meeting ${icon('external', 18)}</a>
        <a class="btn block" href="mailto:Sprocket@autoknerd.com">${icon('mail', 20)} Sprocket@autoknerd.com</a></section>
      ${back}
    </main>`;
  }

  async function enterDemo(role) {
    S.preview = role;
    sessionStorage.setItem('ak:preview', role);
    S.session = null;
    S.result = null;
    S.plan = null;
    history.replaceState(null, '', `/demo?persona=${personaSlug(role)}#/`);
    await boot();
  }

  function friendlyResetError(message) {
    return /EXPIRED|INVALID_OOB/i.test(message) ? 'This reset link has expired or was already used. Request a new one from the sign-in screen.' : message;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    const app = document.getElementById('app');
    const { name, params } = parseRoute();
    const url = new URL(location.href);
    const resetCode = url.searchParams.get('oobCode') || (url.pathname.endsWith('/reset-password') ? url.searchParams.get('code') : '');

    let html;
    if (resetCode || url.searchParams.get('mode') === 'resetPassword') html = resetScreen();
    else if (name === 'privacy' || name === 'terms') html = staticScreen(name);
    else if (name === 'demo') html = demoScreen();
    else if (!S.bundle) html = authScreen();
    else {
      switch (name) {
        case 'home': html = isLeader() ? teamScreen() : homeScreen(); break;
        case 'team': html = isLeader() ? teamScreen() : homeScreen(); break;
        case 'member': html = isLeader() ? memberScreen(params[0]) : homeScreen(); break;
        case 'plan': html = isLeader() ? planScreen() : homeScreen(); break;
        case 'practice': html = practiceScreen(); break;
        case 'session': html = S.session ? sessionScreen() : practiceScreen(); break;
        case 'result': html = S.result ? resultScreen() : homeScreen(); break;
        case 'progress': html = progressScreen(); break;
        case 'settings': html = settingsScreen(); break;
        case 'store-request': html = storeRequestScreen(); break;
        case 'tools': html = toolsScreen(); break;
        case 'tool': html = toolScreen(params[0]); break;
        default: html = isLeader() ? teamScreen() : homeScreen();
      }
    }
    if (S.sheet) html += `<div class="sheet-backdrop" data-action="backdrop"><div class="sheet" role="dialog" aria-modal="true"><span class="grab"></span>${S.sheet.html()}</div></div>`;
    app.innerHTML = html;

    const convo = document.getElementById('convo');
    if (convo) convo.scrollTop = convo.scrollHeight;
    const draft = document.getElementById('draft');
    if (draft) autosize(draft);
    const sheet = app.querySelector('.sheet');
    if (sheet) (sheet.querySelector('textarea, input, .btn') || sheet).focus();
  }

  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight + 2)}px`;
  }

  function openSheet(fn) { S.sheet = { html: fn }; render(); }
  function closeSheet() { S.sheet = null; render(); }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const actions = {
    'auth-mode': (el) => { S.authMode = el.dataset.mode; S.authError = ''; S.authNotice = ''; render(); },
    'toggle-pw': (el) => { const input = el.previousElementSibling; const show = input.type === 'password'; input.type = show ? 'text' : 'password'; el.textContent = show ? 'Hide' : 'Show'; },
    forgot: async () => {
      const id = document.querySelector('[name="identifier"]')?.value.trim();
      if (!id) { S.authError = 'Enter your email above, then tap “Forgot password?” again.'; S.authNotice = ''; render(); return; }
      try {
        const data = await api('/api/auth/forgot-password', { method: 'POST', body: { identifier: id } });
        S.authError = ''; S.authNotice = data.message || 'Check your email for a reset link.';
      } catch (err) { S.authError = err.message; S.authNotice = ''; }
      render();
    },
    'start-preview': () => enterDemo(document.getElementById('previewRole').value),
    'demo-persona': (el) => enterDemo(el.dataset.role),
    'exit-preview': async () => {
      S.preview = '';
      sessionStorage.removeItem('ak:preview');
      // Public demo visitors leave the app entirely and go back to the marketing site.
      if (!S.token) { window.location.href = SITE_URL; return; }
      // Signed-in preview (admin/dev): drop back to the persona picker, not the site.
      S.bundle = null;
      S.session = null;
      S.result = null;
      S.plan = null;
      history.replaceState(null, '', '/demo#/demo');
      await boot();
    },
    start: (el) => startSession({ lessonCategory: el.dataset.lesson }),
    'start-boss': () => startSession({ freshUp: true }),
    resume: () => go('session'),
    pause: () => { toast('Session saved. Pick it up any time from Practice.'); go(homeRoute()); },
    choose: (el) => {
      S.selectedChoice = S.selectedChoice === el.dataset.letter ? null : el.dataset.letter;
      if (S.selectedChoice) S.draft = '';
      render();
    },
    'done-result': () => { S.result = null; go(homeRoute()); },
    again: () => { S.result = null; startSession({ lessonCategory: S.bundle.lessonCategory }); },
    'practice-tab': (el) => { S.practiceTab = el.dataset.tab; if (parseRoute().name === 'practice') render(); },
    lesson: (el) => { const l = S.bundle.lessonLibrary[Number(el.dataset.index)]; if (l) openSheet(() => lessonSheet(l)); },
    'close-sheet': closeSheet,
    backdrop: (el, e) => { if (e.target === el) closeSheet(); },
    'edit-tune': () => openSheet(tuneSheet),
    'show-all-team': () => { S.showAllTeam = true; render(); },
    'clear-tune': () => saveTune({ clear: true }),
    'plan-refresh': loadPlan,
    'plan-pdf': downloadPlanPdf,
    'tool-cat': (el) => { S.toolCat = el.dataset.cat; render(); },
    'save-tool': (el) => {
      const st = toolState();
      const id = el.dataset.id;
      st.saved = st.saved.includes(id) ? st.saved.filter((x) => x !== id) : [id, ...st.saved];
      saveToolState(st);
      render();
    },
    'tool-insight': async (el) => {
      const id = el.dataset.id;
      const tool = TOOLS.find((t) => t.id === id);
      S.insight[id] = { loading: true, text: S.insight[id]?.text };
      render();
      try {
        const st = toolState();
        const data = await api('/api/tools/insight', { method: 'POST', body: { ...identity(), selectedTool: tool, savedToolIds: st.saved, recentToolIds: st.recent } });
        S.insight[id] = { text: data.insight };
      } catch (err) {
        S.insight[id] = {};
        toast(err.message, true);
      }
      render();
    },
    'sign-out': async () => {
      if (!S.preview) api('/api/auth/sign-out', { method: 'POST', body: {} }).catch(() => {});
      if (S.preview) { sessionStorage.removeItem('ak:preview'); S.preview = ''; }
      signOutLocal();
      go('');
    },
  };

  // Demo data is regenerated on every request, so keep earlier demo edits and only take the stores just saved.
  function mergeDemoTunes(next, ids) {
    const md = S.bundle.managerDashboard;
    const nextMd = next.managerDashboard;
    if (!md || !nextMd) return;
    if (!ids) { md.weeklyTrainingTune = nextMd.weeklyTrainingTune; return; }
    (md.stores || []).forEach((store) => {
      const updated = (nextMd.stores || []).find((x) => x.dealershipId === store.dealershipId);
      if (ids.includes(store.dealershipId) && updated) store.weeklyTrainingTune = updated.weeklyTrainingTune;
    });
  }

  async function saveTune({ text = '', trait = '', strength = 'light', clear = false } = {}) {
    const tv = teamView();
    const store = tv.sel !== 'all' ? tv.stores.find((s) => s.dealershipId === tv.sel) : null;
    const dealershipIds = tv.stores.length ? (store ? [store.dealershipId] : tv.stores.map((s) => s.dealershipId)) : undefined;
    S.busy = true;
    render();
    try {
      const data = await api('/api/weekly-tune/update', {
        method: 'POST',
        body: { ...identity(), sourceText: text, focusTrait: trait || undefined, strength, clear: clear || undefined, dealershipIds, dealershipName: store?.dealershipName },
      });
      if (data.bundle && S.preview) mergeDemoTunes(data.bundle, dealershipIds);
      else if (data.bundle) S.bundle = { ...S.bundle, ...data.bundle };
      S.sheet = null;
      toast(clear ? 'Weekly focus cleared.' : data.updatedStores > 1 ? `Focus saved for ${data.updatedStores} stores.` : 'Weekly focus saved.');
    } catch (err) {
      toast(err.message, true);
    }
    S.busy = false;
    render();
  }

  const forms = {
    signin: async (f) => {
      const identifier = f.identifier.value.trim();
      const password = f.password.value;
      if (!identifier || !password) { S.authError = 'Enter your email and password.'; render(); return; }
      S.busy = true; S.authError = ''; S.authNotice = ''; render();
      try {
        const data = await api('/api/auth/sign-in', { method: 'POST', body: { identifier, password } });
        finishAuth(data);
      } catch (err) {
        S.busy = false;
        S.authError = /no matching/i.test(err.message) ? 'We couldn’t find an account with that email or staff ID.' : err.message;
        render();
      }
    },
    join: async (f) => {
      if (!f.reportValidity()) return;
      const firstName = f.firstName.value.trim();
      const lastName = f.lastName.value.trim();
      const code = f.code.value.trim();
      S.busy = true; S.authError = ''; S.authNotice = ''; render();
      try {
        const data = await api('/api/auth/enroll', {
          method: 'POST',
          body: { firstName, lastName, name: `${firstName} ${lastName}`.trim(), email: f.identifier.value.trim(), password: f.password.value, dealerCode: code, enrollmentCode: code, code, role: f.role.value, enrollmentType: 'dealer_code' },
        });
        finishAuth(data);
      } catch (err) { S.busy = false; S.authError = err.message; render(); }
    },
    reset: async (f) => {
      if (f.pw.value !== f.pw2.value) { S.authError = 'The passwords don’t match.'; render(); return; }
      const url = new URL(location.href);
      S.busy = true; S.authError = ''; render();
      try {
        await api('/api/auth/reset-password/confirm', { method: 'POST', body: { oobCode: url.searchParams.get('oobCode') || url.searchParams.get('code'), newPassword: f.pw.value } });
        S.resetDone = true;
      } catch (err) { S.authError = friendlyResetError(err.message); }
      S.busy = false;
      render();
    },
    reply: () => sendReply(),
    profile: async (f) => {
      const firstName = f.firstName.value.trim();
      const lastName = f.lastName.value.trim();
      const avatarUrl = f.querySelector('[name="avatarUrl"]:checked')?.value || '';
      S.busy = true; render();
      try {
        const data = await api('/api/user/update', { method: 'POST', body: { ...identity(), firstName, lastName, name: `${firstName} ${lastName}`.trim(), avatarUrl } });
        const next = data.bundle || data;
        if (next.user) S.bundle = { ...S.bundle, ...next };
        else S.bundle.user = { ...S.bundle.user, name: `${firstName} ${lastName}`.trim(), avatarUrl };
        toast('Profile saved.');
      } catch (err) { toast(err.message, true); }
      S.busy = false;
      render();
    },
    tune: (f) => saveTune({ text: f.text.value.trim(), trait: f.querySelector('[name="trait"]:checked')?.value, strength: f.querySelector('[name="strength"]:checked')?.value }),
    'store-request': (f) => {
      if (!f.reportValidity()) return;
      const u = S.bundle.user || {};
      const subject = encodeURIComponent(`Store access request: ${f.name.value.trim()}`);
      const body = encodeURIComponent(`Name: ${u.name || ''}\nRole: ${roleOf()}\nCurrent store: ${u.dealershipName || ''}\n\nStore to add: ${f.name.value.trim()}\nReason: ${f.reason.value.trim()}`);
      location.href = `mailto:andrew@autoknerd.com?subject=${subject}&body=${body}`;
    },
  };

  function finishAuth(data) {
    S.token = data.token || '';
    write(LS.token, S.token);
    S.bundle = data.bundle;
    S.session = data.bundle?.activeSession || null;
    if (data.bundle?.user?.userId) write(LS.userId, data.bundle.user.userId);
    S.busy = false;
    history.replaceState(null, '', `${location.pathname}#/${homeRoute()}`);
    loadBundle().then(render).catch(() => {});
    render();
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    if (el.tagName === 'A' && el.dataset.action !== 'practice-tab') e.preventDefault();
    actions[el.dataset.action](el, e);
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form]');
    if (!f || !forms[f.dataset.form]) return;
    e.preventDefault();
    forms[f.dataset.form](f);
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    switch (el.dataset.input) {
      case 'draft': {
        S.draft = el.value;
        if (S.draft.trim() && S.selectedChoice) {
          S.selectedChoice = null;
          document.querySelectorAll('.choice').forEach((c) => c.setAttribute('aria-pressed', 'false'));
        }
        autosize(el);
        const btn = document.querySelector('.send-btn');
        if (btn) btn.disabled = S.pending || (!S.draft.trim() && !S.selectedChoice);
        break;
      }
      case 'tool-search':
        S.toolSearch = el.value;
        document.getElementById('toolResults').innerHTML = toolResults();
        break;
      case 'tool-note': {
        const st = toolState();
        st.notes[el.dataset.id] = el.value;
        saveToolState(st);
        break;
      }
      default:
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.change === 'store') { write(LS.store(S.bundle.user?.userId), el.value); S.plan = null; S.showAllTeam = false; render(); }
    if (el.dataset.change === 'pref') write(el.dataset.key, el.checked ? '1' : null);
    if (el.dataset.change === 'preview') enterDemo(el.value);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.sheet) closeSheet();
    if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'draft') { e.preventDefault(); sendReply(); }
  });
  window.addEventListener('hashchange', () => {
    S.sheet = null;
    const { name } = parseRoute();
    if (name === 'plan' && !S.plan && !S.planLoading && S.bundle) { loadPlan(); return; }
    if (name === 'tool') {
      const id = parseRoute().params[0];
      const st = toolState();
      st.recent = [id, ...st.recent.filter((x) => x !== id)].slice(0, 8);
      saveToolState(st);
    }
    render();
    window.scrollTo(0, 0);
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  async function boot() {
    const url = new URL(location.href);
    if (url.searchParams.get('enroll')) S.authMode = 'join';
    const resetCode = url.searchParams.get('oobCode') || (url.pathname.endsWith('/reset-password') ? url.searchParams.get('code') : '');
    if (resetCode && !S.resetEmail && !S.resetDone) {
      render();
      try { S.resetEmail = (await api('/api/auth/reset-password/verify', { method: 'POST', body: { oobCode: resetCode } })).email || ''; }
      catch (err) { S.authError = friendlyResetError(err.message); }
      render();
      return;
    }
    // Sample data only ever runs under /demo; anywhere else is the real app.
    if (url.pathname !== '/demo' && S.preview) { S.preview = ''; sessionStorage.removeItem('ak:preview'); }
    if (url.pathname === '/demo') {
      const persona = DEMO_PERSONAS.find((p) => personaSlug(p.role) === personaSlug(url.searchParams.get('persona')));
      if (persona && !S.preview) { S.preview = persona.role; sessionStorage.setItem('ak:preview', persona.role); }
      if (!S.preview && !location.hash) history.replaceState(null, '', '/demo#/demo');
    }
    if (S.token || S.preview) {
      try {
        await loadBundle();
        if (!location.hash || location.hash === '#/' || location.hash === '#' || (S.preview && location.hash === '#/demo')) history.replaceState(null, '', `${location.pathname}${location.search}#/${homeRoute()}`);
      } catch (err) {
        if (S.preview) { toast(err.message, true); S.preview = ''; sessionStorage.removeItem('ak:preview'); }
        S.bundle = null;
      }
    }
    render();
    if (parseRoute().name === 'plan' && S.bundle && isLeader()) loadPlan();
  }

  boot();
})();
