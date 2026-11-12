/* Painel v4 — front-end */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';

const S = {
  csrf: '', me: {}, view: 'home',
  users: [], on: {}, onRows: [], onSig: '',
  filter: 'all', sort: 'name', q: '',
  clock: {},
  metric: 'cpu',
  ser: { cpu: [], ram: [], rx: [], tx: [], ping: [] },
  last: null
};
const N_POINTS = 60;
const VIEWS = {
  home: ['Visão geral', 'Resumo da sua operação em tempo real.'],
  users: ['Usuários', 'Gerencie contas, validade, limites e bloqueios.'],
  online: ['Conectados', 'Quem está usando o servidor agora.'],
  rev: ['Revendas', 'Controle de revendedores e limites de usuários.'],
  sales: ['Vendas', 'Pedidos pagos pelo Mercado Pago na página de teste.']
};

/* ---------- helpers de DOM ---------- */
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
function icon(name, cls) {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
  const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#i-' + name); s.append(u); return s;
}
function ibtn(name, title, fn, cls = '') {
  const b = el('button', 'icon-btn ' + cls); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
  b.append(icon(name)); b.onclick = fn; return b;
}
function tbtn(label, fn, cls = '', ic) {
  const b = el('button', 'btn ' + cls); b.type = 'button';
  if (ic) b.append(icon(ic));
  b.append(el('span', '', label)); b.onclick = fn; return b;
}
const setText = (id, v, cls) => { const n = $(id); if (!n) return; n.textContent = v; if (cls !== undefined) n.className = cls; };

/* ---------- datas ---------- */
const pad = n => String(n).padStart(2, '0');
const isoLocal = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => isoLocal(new Date());
const parseISO = s => new Date(s + 'T00:00:00');
const daysUntil = exp => Math.round((parseISO(exp) - parseISO(today())) / 864e5);
function fmtDateBR(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : 'Nunca';
}
function addDays(exp, n) {
  const base = exp && exp >= today() ? exp : today();
  const d = parseISO(base); d.setDate(d.getDate() + n); return isoLocal(d);
}
function status(exp) {
  if (!exp) return { c: 'ok', t: 'Sem validade', d: Infinity };
  const d = daysUntil(exp);
  if (d < 0) return { c: 'bad', t: 'Expirado', d };
  if (d <= 7) return { c: 'warn', t: d === 0 ? 'Vence hoje' : d === 1 ? 'Vence amanhã' : 'Vence em ' + d + ' dias', d };
  return { c: 'ok', t: 'Ativo', d };
}
function rel(exp) {
  if (!exp) return 'sem prazo';
  const d = daysUntil(exp);
  if (d < 0) return 'há ' + (-d) + (d === -1 ? ' dia' : ' dias');
  if (d === 0) return 'hoje';
  if (d === 1) return 'amanhã';
  return 'em ' + d + ' dias';
}
const stateOf = (r, st) => r.blocked ? 'blocked' : (st || status(r.expira)).c === 'ok' ? 'active' : (st || status(r.expira)).c === 'warn' ? 'soon' : 'expired';

function fmtSecs(secs) {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600), mi = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return h + 'h ' + pad(mi) + 'm ' + pad(s) + 's';
  if (mi > 0) return mi + 'm ' + pad(s) + 's';
  return s + 's';
}
function parseOnline(str) {
  if (!str || str === '—') return 0;
  const g = re => { const m = str.match(re); return m ? parseInt(m[1], 10) : 0; };
  return g(/(\d+)\s*h/) * 3600 + g(/(\d+)\s*m/) * 60 + g(/(\d+)\s*s/);
}
function fmtUp(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
function fmtAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  return s < 60 ? s + 's atrás' : s < 3600 ? Math.floor(s / 60) + ' min atrás' : Math.floor(s / 3600) + ' h atrás';
}
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);

/* ---------- avatar ---------- */
const FEMALE = /^(duda|maria|ana|julia|júlia|sofia|sophia|laura|beatriz|bia|amanda|bruna|camila|carla|carolina|clara|eduarda|fernanda|gabriela|giovanna|helena|isabela|isabella|jessica|jéssica|joana|larissa|leticia|letícia|lisa|luana|luiza|manuela|marcela|mariana|marina|marta|melissa|natalia|natália|nicole|patricia|patrícia|paula|rafaela|renata|sabrina|samara|sara|talita|tatiane|thais|thaís|valentina|vanessa|vitoria|vitória|yasmin|alice|lola|luna|maya|nina|olivia|olívia|rita|rosa|tereza|girl|woman|mulher|teste)/i;
const MALE = /^(karlos|carlos|joao|joão|jose|josé|pedro|lucas|mateus|matheus|gabriel|rafael|bruno|felipe|guilherme|gustavo|henrique|igor|leandro|leonardo|marcelo|marcos|miguel|paulo|ricardo|roberto|rodolfo|rodrigo|samuel|thiago|tiago|victor|vinicius|vinícius|wagner|william|andre|andré|antonio|antônio|diego|eduardo|fabio|fábio|fernando|francisco|julio|júlio|luiz|luis|luís|mauro|nelson|otavio|otávio|renato|sergio|sérgio|vitor|anderson|alex|daniel|david|erik|eric|home|admin|root|user|man|boy|menino)/i;
function hashOf(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function gender(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-zà-ú]/g, '');
  const base = n.replace(/[\d_-]+.*$/, '') || n;
  if (FEMALE.test(base) || FEMALE.test(n)) return 'f';
  if (MALE.test(base) || MALE.test(n)) return 'm';
  return hashOf(n) % 2 === 0 ? 'm' : 'f';
}
function avatarUrl(name) {
  const seed = encodeURIComponent(String(name || 'user').toLowerCase());
  const bg = 'backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf';
  return 'https://api.dicebear.com/9.x/' + (gender(name) === 'f' ? 'lorelei' : 'adventurer') + '/svg?seed=' + seed + '&' + bg;
}
function makeAvatar(name, size) {
  const a = el('div', 'avatar' + (size ? ' ' + size : ''), String(name || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?');
  a.dataset.u = name; a.style.setProperty('--av', 'hsl(' + (hashOf(String(name)) % 360) + ' 55% 38%)');
  if (S.on[name]) a.classList.add('is-on');
  const img = document.createElement('img');
  img.src = avatarUrl(name); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
  img.onerror = () => img.remove();
  a.append(img); return a;
}

/* ---------- api / ui base ---------- */
async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF': S.csrf }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') show(false);
  if (!r.ok) throw new Error(d.error || 'Algo deu errado.');
  return d;
}
let toastT;
function toast(t) { const n = $('#toast'); n.textContent = t; n.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => n.classList.remove('on'), 2600); }

function ask(title, text, ok = 'Confirmar', danger = false) {
  return new Promise(res => {
    const d = $('#cfDlg'); $('#cfTitle').textContent = title; $('#cfText').textContent = text;
    const y = $('#cfYes'); y.textContent = ok; y.className = 'btn ' + (danger ? 'danger solid' : 'primary');
    let done = false; const fin = v => { if (done) return; done = true; d.close(); res(v); };
    y.onclick = () => fin(true); $('#cfNo').onclick = () => fin(false);
    d.oncancel = e => { e.preventDefault(); fin(false); };
    d.showModal();
  });
}

function openDialog(title, fields, save) {
  $('#dlgTitle').textContent = title; $('#formErr').textContent = '';
  $('#fields').replaceChildren(...fields.map(f => {
    const l = el('label', '', f.label); let i;
    if (f.type === 'select') {
      i = el('select'); i.name = f.name;
      (f.options || []).forEach(o => { const op = el('option', '', o.label); op.value = o.value; if (String(o.value) === String(f.value)) op.selected = true; i.append(op); });
    } else {
      i = el('input'); i.name = f.name; i.type = f.type || 'text'; i.autocomplete = 'off';
      if (f.min != null) i.min = f.min;
      if (f.placeholder) i.placeholder = f.placeholder;
      if (f.value != null) i.value = f.value;
    }
    l.append(i); return l;
  }));
  $('#form').onsubmit = async ev => {
    ev.preventDefault();
    try {
      const out = await save(Object.fromEntries(new FormData(ev.target)));
      $('#dlg').close(); if (out !== 'silent') toast('Salvo'); refreshAll();
    } catch (e) { $('#formErr').textContent = e.message; }
  };
  $('#dlg').showModal();
}

/* ---------- menu flutuante ---------- */
function closeMenu() { const m = $('#menu'); m.hidden = true; m.replaceChildren(); }
function openMenu(anchor, items) {
  const m = $('#menu'); m.replaceChildren();
  items.forEach(it => {
    if (it === '-') { m.append(el('hr')); return; }
    const b = el('button', it.danger ? 'danger' : ''); b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.append(icon(it.icon), el('span', '', it.label));
    b.onclick = () => { closeMenu(); it.fn(); }; m.append(b);
  });
  m.hidden = false;
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  let x = Math.min(window.innerWidth - mw - 10, Math.max(10, r.right - mw));
  let y = r.bottom + 6; if (y + mh > window.innerHeight - 10) y = Math.max(10, r.top - mh - 6);
  m.style.left = x + 'px'; m.style.top = y + 'px';
}
document.addEventListener('click', e => { if (!e.target.closest('#menu') && !e.target.closest('[data-menu]')) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);

/* ---------- sessão / navegação ---------- */
function show(ok) {
  $('#login').hidden = ok; $('#app').hidden = !ok;
  if (!ok) { stopPolls(); S.onSig = ''; S.clock = {}; S.users = []; S.on = {}; S.onRows = []; closeMenu(); }
}
function setView(v, keepHash) {
  if (!VIEWS[v] || ((v === 'rev' || v === 'sales') && S.me.role !== 'admin')) v = 'home';
  S.view = v; S.onSig = '';
  $$('.nav-item').forEach(t => { const on = t.dataset.v === v; t.classList.toggle('on', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  Object.keys(VIEWS).forEach(x => { $('#v-' + x).hidden = x !== v; });
  $('#pageTitle').textContent = VIEWS[v][0]; $('#pageSub').textContent = VIEWS[v][1];
  $('#newBtn').hidden = v === 'online' || v === 'sales';
  $('#testBtn').hidden = !(v === 'home' || v === 'users');
  $('#newLbl').textContent = v === 'rev' ? 'Nova revenda' : 'Novo usuário';
  if (!keepHash) { try { history.replaceState(null, '', v === 'home' ? location.pathname : '#' + v); } catch { } }
  window.scrollTo(0, 0);
  renderAll(); refreshView();
}
function goUsers(filter) { if (filter) setFilter(filter); setView('users'); }

/* ============================================================
   MONITORAMENTO
   ============================================================ */
function push(arr, v) { arr.push(v); if (arr.length > N_POINTS) arr.shift(); }
function niceMax(v) {
  const m = Math.max(1, v * 1.15), p = Math.pow(10, Math.floor(Math.log10(m))), n = m / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function pathFor(arr, max, w = 600, h = 200, total = N_POINTS) {
  if (!arr.length) return { line: '', area: '', last: null };
  const pts = arr.map((v, i) => [w * (i + total - arr.length) / (total - 1), h - Math.min(1, Math.max(0, v / max)) * h]);
  const line = 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
  const area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + h + ' L' + pts[0][0].toFixed(1) + ',' + h + ' Z';
  return { line, area, last: pts[pts.length - 1] };
}
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

function drawChart() {
  const m = S.metric, A = $('#lineA'), B = $('#lineB'), aA = $('#areaA'), aB = $('#areaB'), dot = $('#chartDot');
  let max = 100, a, b = [], labels, legend;
  if (m === 'net') {
    a = S.ser.tx; b = S.ser.rx;
    max = niceMax(Math.max(0, ...a, ...b));
  } else a = S.ser[m];
  const tot = Math.max(2, a.length), pa = pathFor(a, max, 600, 200, tot), pb = pathFor(b, max, 600, 200, tot);
  const span = (a.length - 1) * 3;
  $$('.chart-x span').forEach((x, i) => { const sec = Math.round(span * (3 - i) / 3); x.textContent = i === 3 ? 'agora' : span < 6 ? '' : '−' + (sec < 90 ? sec + 's' : (Math.round(sec / 6) / 10) + ' min'); });
  A.setAttribute('d', pa.line); aA.setAttribute('d', pa.area);
  B.setAttribute('d', pb.line); aB.setAttribute('d', pb.area);
  B.style.display = aB.style.display = m === 'net' ? '' : 'none';
  const fmt = v => m === 'net' ? (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + '' : Math.round(v) + '%';
  labels = [1, .75, .5, .25, 0].map(f => fmt(max * f));
  $$('#chartY span').forEach((s, i) => s.textContent = labels[i]);
  if (pa.last) { dot.hidden = false; dot.style.left = '100%'; dot.style.top = (pa.last[1] / 200 * 100) + '%'; } else dot.hidden = true;

  const lg = $('#chartLegend'); lg.replaceChildren();
  const item = (color, txt, val) => { const s = el('span'); const i = el('i'); i.style.background = color; s.append(i, document.createTextNode(txt + ' '), el('b', '', val)); lg.append(s); };
  if (m === 'net') {
    item('#22d3ee', 'Download', S.last ? S.last.rxMbps.toFixed(2) + ' Mb/s' : '—');
    item('#b88cff', 'Upload', S.last ? S.last.txMbps.toFixed(2) + ' Mb/s' : '—');
    item('#8f86ad', 'Pico', a.length ? Math.max(...a, ...b).toFixed(2) + ' Mb/s' : '—');
  } else {
    item('#b88cff', m === 'cpu' ? 'Uso de CPU' : 'Uso de memória', a.length ? f1(a[a.length - 1]) + '%' : '—');
    item('#8f86ad', 'Média', a.length ? f1(avg(a)) + '%' : '—');
    item('#8f86ad', 'Pico', a.length ? f1(Math.max(...a)) + '%' : '—');
    if (S.last && m === 'cpu') item('#8f86ad', 'Carga', S.last.load.toFixed(2) + (S.last.cores ? ' · ' + S.last.cores + ' vCPU' : ''));
  }
}
function drawSpark() {
  const arr = S.ser.ping, svg = $('#pingSpark'); if (!svg) return;
  if (arr.length < 2) { $$('path', svg).forEach(p => p.setAttribute('d', '')); return; }
  const max = Math.max(...arr) * 1.2 || 1, min = Math.min(...arr) * .8;
  const pts = arr.map((v, i) => [120 * i / (arr.length - 1), 38 - ((v - min) / ((max - min) || 1)) * 34]);
  const line = 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
  $('.line', svg).setAttribute('d', line); $('.area', svg).setAttribute('d', line + ' L120,40 L0,40 Z');
}

async function loadMetrics() {
  if (document.hidden) return;
  try {
    const d = await api('/api/metrics');
    S.last = d;
    push(S.ser.cpu, d.cpu); push(S.ser.ram, d.ram); push(S.ser.rx, d.rxMbps); push(S.ser.tx, d.txMbps);
    setText('#mCpu', Math.round(d.cpu)); setText('#mRam', Math.round(d.ram));
    setText('#mNet', (d.rxMbps + d.txMbps).toFixed(2));
    setText('#mRx', d.rxMbps.toFixed(2)); setText('#mTx', d.txMbps.toFixed(2));
    [['#mCpuBar', d.cpu], ['#mRamBar', d.ram]].forEach(([id, v]) => { const b = $(id); b.style.width = Math.min(100, v) + '%'; b.classList.toggle('hot', v >= 85); });
    const hot = d.cpu >= 90 || d.ram >= 92;
    $('#stripDot').className = 'strip-dot' + (hot ? ' wait' : '');
    setText('#stripState', hot ? 'Carga alta no servidor' : 'Servidor estável');
    setText('#stripInfo', 'No ar há ' + fmtUp(d.uptime) + (d.cores ? ' · ' + d.cores + ' vCPU' : '') + ' · carga ' + d.load.toFixed(2));
    drawChart(); renderPing(d.ping || {}); renderSpeed(d.speed || {});
  } catch (e) {
    $('#stripDot').className = 'strip-dot bad'; setText('#stripState', 'Monitoramento indisponível'); setText('#stripInfo', e.message);
  }
}
function renderPing(p) {
  const badge = $('#pingBadge');
  if (p.avg != null) {
    const q = p.avg < 50 ? ['Excelente', 'ok'] : p.avg < 100 ? ['Boa', 'ok'] : p.avg < 200 ? ['Regular', 'warn'] : ['Alta', 'bad'];
    if (p.loss > 0 && q[1] === 'ok') { q[0] = 'Com perda'; q[1] = 'warn'; }
    badge.textContent = q[0]; badge.className = 'pill ' + q[1];
    setText('#pingAvg', p.avg.toFixed(1));
    setText('#pingMin', p.min != null ? p.min.toFixed(1) + ' ms' : '—');
    setText('#pingMax', p.max != null ? p.max.toFixed(1) + ' ms' : '—');
    setText('#pingLoss', (p.loss || 0) + '%', p.loss > 0 ? 'warn' : 'ok');
    setText('#pingTarget', p.target || p.host || '1.1.1.1');
    if (p.at !== S.pingAt) { S.pingAt = p.at; push(S.ser.ping, p.avg); drawSpark(); }
  } else if (p.error) { badge.textContent = 'erro'; badge.className = 'pill bad'; setText('#pingAvg', '—'); }
}
function renderSpeed(s) {
  const btn = $('#btnSpeed'); btn.disabled = !!s.running; btn.classList.toggle('spin', !!s.running);
  btn.lastChild.textContent = s.running ? 'Testando…' : 'Testar';
  if (s.download != null || s.upload != null) {
    setText('#speedDown', s.download != null ? s.download.toFixed(1) : '—');
    setText('#speedUp', s.upload != null ? s.upload.toFixed(1) : '—');
    setText('#speedLat', s.latency != null ? s.latency.toFixed(1) + ' ms' : '—');
    setText('#speedJit', s.jitter != null ? s.jitter.toFixed(2) + ' ms' : '—');
    setText('#speedLoss', s.packetLoss != null ? s.packetLoss + '%' : '—', s.packetLoss > 0 ? 'warn' : 'ok');
    const meta = [s.server, s.isp, s.at ? fmtAgo(s.at) : ''].filter(Boolean);
    $('#speedServer').textContent = (s.running ? 'Atualizando… ' : '') + (meta.join(' · ') || '—');
  } else if (s.running) $('#speedServer').textContent = 'Testando agora, aguarde alguns segundos…';
  else if (s.error) $('#speedServer').textContent = 'Falha no teste: ' + s.error;
}
async function runSpeed() {
  const b = $('#btnSpeed'); b.disabled = true;
  try {
    await api('/api/speedtest', 'POST', {}); toast('Speedtest iniciado');
    [2500, 8000, 16000, 30000].forEach(ms => setTimeout(loadMetrics, ms));
  } catch (e) { toast(e.message || 'Erro ao iniciar speedtest'); b.disabled = false; }
}

/* ============================================================
   USUÁRIOS
   ============================================================ */
function counts() {
  const c = { all: S.users.length, active: 0, soon: 0, expired: 0, blocked: 0 };
  S.users.forEach(r => { c[stateOf(r)]++; });
  return c;
}
async function loadUsers() {
  const d = await api('/api/users'); S.users = d.rows || [];
  renderAll();
}
function renderKpis() {
  const c = counts();
  setText('#kTotal', c.all); setText('#kSoon', c.soon); setText('#kExp', c.expired);
  $('#kSoon').classList.toggle('has', c.soon > 0); $('#kExp').classList.toggle('has', c.expired > 0);
  setText('#kTotalH', c.blocked ? c.blocked + (c.blocked === 1 ? ' bloqueado' : ' bloqueados') : 'contas cadastradas');
  setText('#navUsers', c.all);
  setText('#cAll', c.all); setText('#cActive', c.active); setText('#cSoon', c.soon); setText('#cExp', c.expired); setText('#cBlk', c.blocked);
}
function renew(r, days = 30) {
  const nd = addDays(r.expira, days);
  return api('/api/users/' + encodeURIComponent(r.usuario), 'PUT', { expira: nd })
    .then(() => { toast(r.usuario + ' renovado até ' + fmtDateBR(nd)); return loadUsers(); })
    .catch(e => toast(e.message));
}
function renderAttention() {
  const list = S.users.map(r => ({ r, st: status(r.expira) })).filter(x => !x.r.blocked && (x.st.c === 'warn' || x.st.c === 'bad'))
    .sort((a, b) => a.st.d - b.st.d);
  $('#attEmpty').hidden = list.length > 0; $('#attList').hidden = list.length === 0;
  $('#attList').replaceChildren(...list.slice(0, 6).map(({ r, st }) => {
    const li = el('li', 'row-i'), who = el('div', 'who');
    who.append(el('strong', '', r.usuario), el('span', '', (st.c === 'bad' ? 'Expirou ' : 'Vence ') + rel(r.expira) + ' · ' + fmtDateBR(r.expira)));
    li.append(makeAvatar(r.usuario, 'sm'), who, el('span', 'pill ' + st.c, st.c === 'bad' ? 'Expirado' : st.d <= 1 ? (st.d === 0 ? 'Hoje' : 'Amanhã') : st.d + ' dias'),
      tbtn('+30 dias', () => renew(r), 'sm', 'calplus'));
    return li;
  }));
  if (list.length > 6) { const li = el('li', 'row-i'); li.append(el('span', 'muted', '+ ' + (list.length - 6) + ' contas — veja em Usuários')); $('#attList').append(li); }
}
function filtered() {
  const q = S.q;
  const rows = S.users.filter(r => (S.filter === 'all' || stateOf(r) === S.filter) && (!q || r.usuario.toLowerCase().includes(q)));
  const by = {
    name: (a, b) => a.usuario.localeCompare(b.usuario),
    exp: (a, b) => (a.expira || '9999').localeCompare(b.expira || '9999') || a.usuario.localeCompare(b.usuario),
    conn: (a, b) => ((S.on[b.usuario] || {}).conexoes || 0) - ((S.on[a.usuario] || {}).conexoes || 0) || a.usuario.localeCompare(b.usuario)
  };
  return rows.sort(by[S.sort]);
}
function userMenu(r) {
  const items = [
    { icon: 'edit', label: 'Editar usuário', fn: () => editUser(r) },
    { icon: 'calplus', label: 'Renovar +30 dias', fn: () => renew(r) },
    '-',
    r.blocked ? { icon: 'play', label: 'Desbloquear', fn: () => unblockUser(r) } : { icon: 'pause', label: 'Bloquear acesso', fn: () => blockUser(r) },
    { icon: 'gauge', label: r.mbps ? 'Alterar limite (' + r.mbps + ' Mbps)' : 'Limitar tráfego', fn: () => throttleUser(r) }
  ];
  if (r.mbps) items.push({ icon: 'gauge', label: 'Remover limite de tráfego', fn: () => unthrottleUser(r) });
  items.push({ icon: 'reset', label: 'Zerar contador de tráfego', fn: () => resetTraffic(r) }, '-', { icon: 'trash', label: 'Excluir usuário', danger: true, fn: () => delUser(r) });
  return items;
}
function renderUsers() {
  const admin = S.me.role === 'admin', rows = filtered();
  $('#userRows').replaceChildren(...rows.map(r => {
    const st = status(r.expira), tr = el('tr'); tr.dataset.user = r.usuario;
    const c1 = el('td', 'c-name'), nm = el('div', 'nm'), who = el('div', 'who');
    who.append(el('strong', '', r.usuario));
    const sub = admin && r.revenda ? 'Revenda · ' + r.revenda : (!admin && r.revenda ? r.revenda : '');
    if (sub) who.append(el('span', '', sub));
    nm.append(makeAvatar(r.usuario), who); c1.append(nm);

    const c2 = el('td'); c2.dataset.l = 'Situação'; const pills = el('div', 'pills');
    pills.append(el('span', 'pill ' + (r.blocked ? 'bad' : st.c), r.blocked ? 'Bloqueado' : st.t));
    if (r.mbps && !r.blocked) pills.append(el('span', 'pill warn plain', r.mbps + ' Mbps'));
    c2.append(pills);

    const c3 = el('td'); c3.dataset.l = 'Expira em'; const dt = el('div', 'dt ' + (r.blocked ? '' : st.c));
    dt.append(el('b', '', fmtDateBR(r.expira)), el('span', '', r.expira ? (st.c === 'bad' ? 'expirou ' : 'vence ') + rel(r.expira) : 'sem prazo')); c3.append(dt);

    const c4 = el('td'); c4.dataset.l = 'Conexões'; const cn = el('div', 'conn');
    const n = el('span', '', String((S.on[r.usuario] || {}).conexoes || 0)); n.dataset.conn = r.usuario;
    cn.append(n, el('small', '', '/ ' + (r.limite || 1) + ' em uso')); c4.append(cn);

    const c5 = el('td', 'r c-act'), ac = el('div', 'acts');
    const more = ibtn('more', 'Mais ações', e => { e.stopPropagation(); openMenu(more, userMenu(r)); }); more.dataset.menu = '1';
    ac.append(ibtn('edit', 'Editar', () => editUser(r)), ibtn('calplus', 'Renovar +30 dias', () => renew(r)), more); c5.append(ac);
    tr.append(c1, c2, c3, c4, c5); return tr;
  }));
  const none = rows.length === 0;
  $('#empty').hidden = !none; $('#tbl').hidden = none;
  if (none) {
    const any = S.users.length > 0;
    setText('#emptyT', any ? 'Nada encontrado com esse filtro' : 'Nenhum usuário ainda');
    setText('#emptyS', any ? 'Tente outra busca ou escolha “Todos”.' : 'Use “Novo usuário” para começar.');
  }
}
function setFilter(f) {
  S.filter = f;
  $$('#chips .chip').forEach(c => c.classList.toggle('on', c.dataset.f === f));
  if (S.view === 'users') renderUsers();
}

function editUser(r) {
  const f = [
    { name: 'senha', type: 'password', label: r ? 'Nova senha (deixe vazio para manter)' : 'Senha' },
    { name: 'expira', type: 'date', label: 'Expira em (vazio = nunca)', value: r ? r.expira : '' },
    { name: 'limite', type: 'number', min: 1, label: 'Limite de conexões', value: r ? r.limite : 1 }];
  if (!r) f.unshift({ name: 'usuario', label: 'Usuário', placeholder: 'ex: joao123' });
  openDialog(r ? 'Editar ' + r.usuario : 'Novo usuário', f, b => api(r ? '/api/users/' + encodeURIComponent(r.usuario) : '/api/users', r ? 'PUT' : 'POST', b));
}
async function delUser(r) {
  if (!await ask('Excluir ' + r.usuario + '?', 'A conta do Linux será apagada e as conexões derrubadas. Isso não pode ser desfeito.', 'Excluir', true)) return;
  try { await api('/api/users/' + encodeURIComponent(r.usuario), 'DELETE'); toast('Usuário excluído'); refreshAll(); } catch (e) { toast(e.message); }
}
async function blockUser(r) {
  if (!await ask('Bloquear ' + r.usuario + '?', 'As conexões atuais serão derrubadas e ele não conseguirá entrar até ser desbloqueado.', 'Bloquear', true)) return;
  try { const d = await api('/api/users/' + encodeURIComponent(r.usuario) + '/block', 'POST', {}); toast(d.warning || r.usuario + ' bloqueado'); refreshAll(); } catch (e) { toast(e.message); }
}
async function unblockUser(r) {
  try { const d = await api('/api/users/' + encodeURIComponent(r.usuario) + '/unblock', 'POST', {}); toast(d.warning || r.usuario + ' desbloqueado'); refreshAll(); } catch (e) { toast(e.message); }
}
function throttleUser(r) {
  openDialog('Limitar tráfego de ' + r.usuario, [
    { name: 'mbps', type: 'number', min: 0, label: 'Velocidade máxima em Mbps (0 = sem limite)', value: r.mbps || 1 }
  ], async b => {
    const mbps = parseInt(b.mbps, 10);
    if (!(mbps >= 0)) throw new Error('Valor inválido.');
    if (mbps === 0) await api('/api/users/' + encodeURIComponent(r.usuario) + '/unthrottle', 'POST', {});
    else await api('/api/users/' + encodeURIComponent(r.usuario) + '/throttle', 'POST', { mbps });
    toast(mbps === 0 ? 'Limite removido' : 'Tráfego limitado a ' + mbps + ' Mbps'); return 'silent';
  });
}
async function unthrottleUser(r) {
  try { await api('/api/users/' + encodeURIComponent(r.usuario) + '/unthrottle', 'POST', {}); toast('Limite de tráfego removido'); refreshAll(); } catch (e) { toast(e.message); }
}
async function resetTraffic(r) {
  if (!await ask('Zerar tráfego de ' + r.usuario + '?', 'Os contadores de consumo dele serão zerados no DragonCore.', 'Zerar')) return;
  try { await api('/api/users/' + encodeURIComponent(r.usuario) + '/reset-traffic', 'POST', {}); toast('Tráfego zerado'); } catch (e) { toast(e.message); }
}

/* ---------- teste rápido ---------- */
function randStr(n, chars) {
  const a = chars || 'abcdefghijklmnopqrstuvwxyz0123456789', buf = new Uint8Array(n); crypto.getRandomValues(buf);
  return [...buf].map(b => a[b % a.length]).join('');
}
function copyText(text) {
  return new Promise(async (resolve, reject) => {
    const area = $('#testCopyArea');
    if (area) { area.value = text; area.focus(); area.select(); area.setSelectionRange(0, area.value.length); }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return resolve(); } } catch { }
    try { if (document.execCommand('copy')) return resolve(); } catch { }
    if (area) return resolve('manual');
    reject(new Error('copy failed'));
  });
}
function openTestDialog() {
  openDialog('Criar usuário de teste', [
    { name: 'dias', type: 'select', label: 'Expira em', value: '7', options: [['1', '1 dia'], ['3', '3 dias'], ['7', '7 dias'], ['15', '15 dias'], ['30', '30 dias'], ['0', 'Nunca']].map(([value, label]) => ({ value, label })) },
    { name: 'limite', type: 'number', min: 1, label: 'Limite de conexões', value: 1 }
  ], async b => {
    const dias = parseInt(b.dias, 10), limite = parseInt(b.limite, 10) || 1;
    const usuario = 'test_' + randStr(6), senha = randStr(10, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789');
    const expira = dias > 0 ? addDays(null, dias) : '';
    await api('/api/users', 'POST', { usuario, senha, expira, limite });
    setText('#testUser', usuario); setText('#testPass', senha); setText('#testExp', fmtDateBR(expira));
    const full = ['Usuário: ' + usuario, 'Senha: ' + senha, 'Expira: ' + fmtDateBR(expira), 'Limite: ' + limite].join('\n');
    $('#testDlg').dataset.copy = full; $('#testCopyArea').value = full;
    setTimeout(() => $('#testDlg').showModal(), 0);
    return 'silent';
  });
}

/* ============================================================
   ONLINE
   ============================================================ */
async function loadOnline() {
  if (document.hidden && S.onRows.length) return;
  const d = await api('/api/online'), rows = d.rows || [], now = Date.now();
  S.onRows = rows; S.on = {};
  rows.forEach(r => { S.on[r.usuario] = r; S.clock[r.usuario] = { base: parseOnline(r.online || r.tempo || ''), at: now }; });
  Object.keys(S.clock).forEach(u => { if (!S.on[u]) delete S.clock[u]; });
  setText('#onCount', rows.length); setText('#onlineTotal', rows.length);
  setText('#kOnline', rows.length); setText('#kOnlineH', rows.length === 1 ? 'conexão ativa' : 'usuários conectados');
  $$('.avatar[data-u]').forEach(a => a.classList.toggle('is-on', !!S.on[a.dataset.u]));
  $$('[data-conn]').forEach(n => { n.textContent = (S.on[n.dataset.conn] || {}).conexoes || 0; });
  const sig = rows.map(r => [r.usuario, r.conexoes, r.limite, r.expira || ''].join('|')).join(';');
  if (sig !== S.onSig) { S.onSig = sig; renderMiniOnline(); if (S.view === 'online') renderOnlineCards(); if (S.view === 'users' && S.sort === 'conn') renderUsers(); }
  tickClock();
}
function renderMiniOnline() {
  const rows = S.onRows;
  $('#miniEmpty').hidden = rows.length > 0; $('#miniOnline').hidden = rows.length === 0;
  $('#miniOnline').replaceChildren(...rows.slice(0, 6).map(r => {
    const li = el('li', 'row-i'), who = el('div', 'who'), t = el('span', 'timer'); t.dataset.clock = r.usuario;
    who.append(el('strong', '', r.usuario), el('span', '', r.conexoes + ' de ' + r.limite + (r.limite === 1 ? ' conexão' : ' conexões')));
    li.append(makeAvatar(r.usuario, 'sm'), who, t); return li;
  }));
  if (rows.length > 6) { const li = el('li', 'row-i'); li.append(el('span', 'muted', '+ ' + (rows.length - 6) + ' conectados')); $('#miniOnline').append(li); }
}
function dateInput(user, val) {
  const i = el('input'); i.type = 'date'; i.value = val || ''; i.setAttribute('aria-label', 'Data de expiração de ' + user);
  const mark = () => i.classList.toggle('exp', !!i.value && i.value < today()); mark();
  i.onchange = async () => {
    try { await api('/api/users/' + encodeURIComponent(user), 'PUT', { expira: i.value }); toast('Expiração atualizada'); mark(); loadUsers(); } catch (e) { toast(e.message); }
  };
  return i;
}
function renderOnlineCards() {
  const rows = S.onRows;
  $('#emptyOn').hidden = rows.length > 0;
  $('#onlineCards').replaceChildren(...rows.map(r => {
    const card = el('article', 'ocard'); card.dataset.user = r.usuario;
    const top = el('div', 'oc-top'), who = el('div', 'who'), tm = el('div', 'oc-time'), t = el('b'); t.dataset.clock = r.usuario;
    who.append(el('strong', '', r.usuario), el('span', '', 'Sessão ativa')); tm.append(el('small', '', 'Online há'), t);
    top.append(makeAvatar(r.usuario, 'lg'), who, tm);
    const meta = el('div', 'oc-meta'), m1 = el('div'), m2 = el('div'), pct = Math.min(100, Math.round(r.conexoes / (r.limite || 1) * 100));
    const bar = el('div', 'bar'), fill = el('i'); fill.style.width = pct + '%'; bar.append(fill);
    m1.append(el('small', '', 'Conexões'), el('b', '', r.conexoes + ' / ' + r.limite), bar);
    m2.append(el('small', '', 'Expira em'), dateInput(r.usuario, r.expira)); meta.append(m1, m2);
    card.append(top, meta); return card;
  }));
}
function tickClock() {
  const now = Date.now();
  $$('[data-clock]').forEach(n => { const c = S.clock[n.dataset.clock]; if (c) n.textContent = fmtSecs(c.base + Math.floor((now - c.at) / 1000)); });
}

/* ============================================================
   REVENDAS
   ============================================================ */
async function loadRev() {
  const d = await api('/api/revendas'); $('#emptyRev').hidden = d.rows.length > 0; $('#tblRev').hidden = d.rows.length === 0;
  $('#bRev').replaceChildren(...d.rows.map(r => {
    const tr = el('tr'), c1 = el('td', 'c-name'), nm = el('div', 'nm'), who = el('div', 'who');
    who.append(el('strong', '', r.nome), el('span', '', 'Limite de ' + r.limite + (r.limite === 1 ? ' usuário' : ' usuários')));
    nm.append(makeAvatar(r.nome), who); c1.append(nm);
    const c2 = el('td', 'c-use'); c2.dataset.l = 'Uso do limite'; const u = el('div', 'usage'), pct = Math.min(100, Math.round(r.usados / (r.limite || 1) * 100));
    const bar = el('div', 'bar' + (pct >= 90 ? ' hot' : '')), fill = el('i'); fill.style.width = pct + '%'; bar.append(fill);
    u.append(el('span', '', r.usados + ' de ' + r.limite + ' usuários'), bar); c2.append(u);
    const c3 = el('td'); c3.dataset.l = 'Situação'; c3.append(el('span', 'pill ' + (r.ativo ? 'ok' : 'off'), r.ativo ? 'Ativa' : 'Bloqueada'));
    const c4 = el('td', 'r c-act'), ac = el('div', 'acts');
    ac.append(
      ibtn('edit', 'Editar revenda', () => openDialog('Editar ' + r.nome, [{ name: 'limite', label: 'Limite de usuários', type: 'number', min: 1, value: r.limite }, { name: 'senha', label: 'Nova senha (deixe vazio para manter)', type: 'password' }], b => api('/api/revendas/' + r.id, 'PUT', b))),
      ibtn(r.ativo ? 'pause' : 'play', r.ativo ? 'Bloquear revenda' : 'Ativar revenda', async () => { try { await api('/api/revendas/' + r.id, 'PUT', { ativo: !r.ativo }); refreshAll(); } catch (e) { toast(e.message); } }, r.ativo ? '' : 'ok'),
      ibtn('trash', 'Excluir revenda', async () => {
        if (!await ask('Excluir ' + r.nome + '?', 'Os usuários dela continuam existindo, só perdem o vínculo com a revenda.', 'Excluir', true)) return;
        try { await api('/api/revendas/' + r.id, 'DELETE'); refreshAll(); } catch (e) { toast(e.message); }
      }, 'danger'));
    c4.append(ac); tr.append(c1, c2, c3, c4); return tr;
  }));
}

/* ============================================================
   VENDAS (Mercado Pago)
   ============================================================ */
const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const SALE_ST = { pago: ['ok', 'Pago'], pendente: ['warn', 'Aguardando'], estornado: ['bad', 'Estornado'], divergente: ['bad', 'Valor diferente'] };
async function loadSales() {
  const d = await api('/api/vendas');
  $('#salesOff').hidden = !!d.ativo;
  setText('#sVal', brl(d.totais.valor30)); setText('#sQtd', d.totais.vendas30); setText('#sPend', d.totais.pendentes);
  setText('#sTotalH', 'no total: ' + d.totais.vendasTotal);
  $('#emptySales').hidden = d.rows.length > 0; $('#tblSales').hidden = d.rows.length === 0;
  $('#bSales').replaceChildren(...d.rows.map(r => {
    const tr = el('tr'), t = new Date(r.pagoEm || r.criado), st = SALE_ST[r.status] || ['off', r.status];
    const c1 = el('td'); c1.dataset.l = 'Quando'; const dt = el('div', 'dt'); dt.append(el('b', '', pad(t.getDate()) + '/' + pad(t.getMonth() + 1) + '/' + t.getFullYear()), el('span', '', pad(t.getHours()) + ':' + pad(t.getMinutes()))); c1.append(dt);
    const c2 = el('td'); c2.dataset.l = 'Plano'; const pl = el('div', 'dt'); pl.append(el('b', '', r.plano), el('span', '', r.dias + (r.dias === 1 ? ' dia' : ' dias'))); c2.append(pl);
    const c3 = el('td'); c3.dataset.l = 'Valor'; c3.append(el('b', '', brl(r.preco)));
    const c4 = el('td'); c4.dataset.l = 'Situação'; c4.append(el('span', 'pill ' + st[0], st[1]));
    const c5 = el('td'); c5.dataset.l = 'Usuário'; c5.append(el('span', r.usuario ? '' : 'muted', r.usuario || '—'));
    tr.append(c1, c2, c3, c4, c5); return tr;
  }));
}

/* ============================================================
   ORQUESTRAÇÃO
   ============================================================ */
function renderAll() {
  renderKpis(); renderAttention();
  if (S.view === 'users') renderUsers();
}
function refreshView() {
  loadUsers().catch(e => toast(e.message));
  loadOnline().catch(() => { });
  if (S.view === 'rev') loadRev().catch(e => toast(e.message));
  if (S.view === 'sales') loadSales().catch(e => toast(e.message));
}
function refreshAll() { refreshView(); }

let timers = [];
function stopPolls() { timers.forEach(clearInterval); timers = []; }
function startPolls() {
  stopPolls();
  timers.push(setInterval(() => loadOnline().catch(() => { }), 3000));
  timers.push(setInterval(loadMetrics, 3000));
  timers.push(setInterval(() => loadUsers().catch(() => { }), 30000));
  timers.push(setInterval(tickClock, 1000));
  loadMetrics();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#app').hidden) { loadMetrics(); loadOnline().catch(() => { }); loadUsers().catch(() => { }); } });

function start(m) {
  S.me = m; const admin = m.role === 'admin';
  $('#tabRev').hidden = !admin; $('#tabSales').hidden = !admin;
  setText('#meName', m.name || 'admin'); setText('#meRole', admin ? 'Administrador' : 'Revenda');
  setText('#meAv', String(m.name || 'A').slice(0, 1).toUpperCase());
  show(true); startPolls();
  const h = (location.hash || '').slice(1);
  setView(VIEWS[h] ? h : 'home', true);
}

/* ---------- eventos ---------- */
$$('.nav-item').forEach(t => t.onclick = () => setView(t.dataset.v));
$$('[data-go]').forEach(b => b.onclick = () => { if (b.dataset.filter) setFilter(b.dataset.filter); setView(b.dataset.go); });
$$('#chips .chip').forEach(c => c.onclick = () => setFilter(c.dataset.f));
$$('.metric').forEach(b => b.onclick = () => {
  S.metric = b.dataset.m;
  $$('.metric').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
  drawChart();
});
$('#sort').onchange = e => { S.sort = e.target.value; renderUsers(); };
let searchT;
$('#search').oninput = e => { clearTimeout(searchT); searchT = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); renderUsers(); }, 120); };
$('#newBtn').onclick = () => S.view === 'rev'
  ? openDialog('Nova revenda', [{ name: 'nome', label: 'Nome de login' }, { name: 'senha', label: 'Senha (8+ caracteres)', type: 'password' }, { name: 'limite', label: 'Limite de usuários', type: 'number', min: 1, value: 10 }], b => api('/api/revendas', 'POST', b))
  : editUser(null);
$('#testBtn').onclick = openTestDialog;
$('#btnSpeed').onclick = runSpeed;
$('#testOk').onclick = () => $('#testDlg').close();
$('#testCopy').onclick = async () => {
  const txt = $('#testDlg').dataset.copy || $('#testCopyArea').value || '';
  try { const r = await copyText(txt); toast(r === 'manual' ? 'Texto selecionado — toque em Copiar' : 'Copiado'); }
  catch { $('#testCopyArea').select(); toast('Segure o texto e toque em Copiar'); }
};
$('#cancel').onclick = () => $('#dlg').close();
async function logout() { try { await api('/api/logout', 'POST'); } catch { } S.csrf = (await (await fetch('/api/me')).json()).csrf; show(false); }
$('#logoutBtn').onclick = logout; $('#logoutTop').onclick = logout;
$('#loginForm').onsubmit = async ev => {
  ev.preventDefault(); $('#loginErr').textContent = '';
  try { const d = await api('/api/login', 'POST', Object.fromEntries(new FormData(ev.target))); S.csrf = d.csrf; ev.target.reset(); start(d); }
  catch (e) { $('#loginErr').textContent = e.message; }
};
window.addEventListener('hashchange', () => { if ($('#app').hidden) return; const h = (location.hash || '').slice(1); if (VIEWS[h] && h !== S.view) setView(h, true); });

(async () => {
  const m = await (await fetch('/api/me')).json();
  S.csrf = m.csrf;
  m.logged ? start(m) : show(false);
})();
