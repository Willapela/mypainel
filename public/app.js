const $ = s => document.querySelector(s);
let csrf = '', me = {}, timer, poll, metricPoll, clockTick, view = 'users', onlineSig = '';
// mapa user -> { baseSecs, syncedAt } para o relógio local
const onlineClock = {};
const monitorSamples = [];
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const today = () => new Date().toISOString().slice(0, 10);
// ISO YYYY-MM-DD -> DD/MM/YYYY (pt-BR)
function fmtDateBR(iso) {
  if (!iso) return 'Nunca';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  try { return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR'); } catch { return iso; }
}
// Avatar por nome: masculino / feminino (mesmo nome = mesma imagem)
const FEMALE_NAMES = /^(duda|maria|ana|julia|júlia|sofia|sophia|laura|beatriz|bia|amanda|bruna|camila|carla|carolina|clara|eduarda|fernanda|gabriela|giovanna|helena|isabela|isabella|jessica|jéssica|joana|larissa|leticia|letícia|lisa|luana|luiza|manuela|marcela|mariana|marina|marta|melissa|natalia|natália|nicole|patricia|patrícia|paula|rafaela|renata|sabrina|samara|sara|talita|tatiane|thais|thaís|valentina|vanessa|vitoria|vitória|yasmin|alice|alice|lola|luna|maya|nina|olivia|olívia|rita|rosa|tereza|tereza|girl|woman|mulher|teste)/i;
const MALE_NAMES = /^(karlos|carlos|joao|joão|jose|josé|pedro|lucas|mateus|matheus|gabriel|rafael|bruno|felipe|guilherme|gustavo|henrique|igor|leandro|leonardo|marcelo|marcos|miguel|paulo|ricardo|roberto|rodolfo|rodrigo|samuel|thiago|tiago|victor|vinicius|vinícius|wagner|william|andre|andré|antonio|antônio|diego|eduardo|fabio|fábio|fernando|francisco|julio|júlio|luiz|luis|luís|mauro|nelson|otavio|otávio|renato|sergio|sérgio|vitor|anderson|alex|daniel|david|erik|eric|home|admin|root|user|man|boy|menino)/i;
function avatarGender(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-zà-ú]/g, '');
  // prefixo do login (antes de número/_/-)
  const base = n.replace(/[\d_-]+.*$/, '') || n;
  if (FEMALE_NAMES.test(base) || FEMALE_NAMES.test(n)) return 'f';
  if (MALE_NAMES.test(base) || MALE_NAMES.test(n)) return 'm';
  // fallback estável pelo hash do nome
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return h % 2 === 0 ? 'm' : 'f';
}
function avatarUrl(name) {
  const seed = encodeURIComponent(String(name || 'user').toLowerCase());
  const g = avatarGender(name);
  const bg = 'backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf';
  // lorelei = feminino ilustrado | adventurer = mais neutro/masculino
  if (g === 'f') return 'https://api.dicebear.com/9.x/lorelei/svg?seed=' + seed + '&' + bg;
  return 'https://api.dicebear.com/9.x/adventurer/svg?seed=' + seed + '&' + bg;
}
function makeAvatar(name, className) {
  const wrap = el('div', className || 'user-avatar');
  const img = document.createElement('img');
  img.src = avatarUrl(name);
  img.alt = name || '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.onerror = () => {
    wrap.textContent = String(name || '?').slice(0, 2).toUpperCase();
    img.remove();
  };
  wrap.append(img);
  return wrap;
}

function fmtSecs(secs) {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600), mi = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return h + 'h ' + String(mi).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
  if (mi > 0) return mi + 'm ' + String(s).padStart(2, '0') + 's';
  return s + 's';
}
// converte "1h 05m", "35m 53s", "12s" etc. em segundos
function parseOnline(str) {
  if (!str || str === '—') return 0;
  let secs = 0;
  const h = str.match(/(\d+)\s*h/);
  const m = str.match(/(\d+)\s*m/);
  const s = str.match(/(\d+)\s*s/);
  if (h) secs += parseInt(h[1], 10) * 3600;
  if (m) secs += parseInt(m[1], 10) * 60;
  if (s) secs += parseInt(s[1], 10);
  return secs;
}
function tickOnlineClock() {
  if (view !== 'online') return;
  const now = Date.now();
  $('#onlineCards').querySelectorAll('[data-user]').forEach(tr => {
    const u = tr.dataset.user, c = onlineClock[u], t = tr.querySelector('.online-time');
    if (!c || !t) return;
    t.textContent = fmtSecs(c.baseSecs + Math.floor((now - c.syncedAt) / 1000));
  });
}
function drawMonitor(samples) {
  const line = document.querySelector('.chart-line'), area = document.querySelector('.chart-area-fill');
  if (!line || !area || !samples.length) return;
  const w = 700, h = 260, bottom = 250, step = samples.length === 1 ? w : w / (samples.length - 1);
  const points = samples.map((v, i) => `${(i * step).toFixed(1)},${(bottom - Math.min(100, Math.max(0, v)) / 100 * 220).toFixed(1)}`);
  const d = 'M' + points.join(' L');
  line.setAttribute('d', d);
  area.setAttribute('d', d + ` L${w},${h} L0,${h} Z`);
}
function setText(id, val, cls) {
  const n = $(id);
  if (!n) return;
  n.textContent = val;
  n.className = cls || '';
}
function fmtAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's atrás';
  if (s < 3600) return Math.floor(s / 60) + ' min atrás';
  return Math.floor(s / 3600) + ' h atrás';
}

async function loadMetrics() {
  try {
    const d = await api('/api/metrics');
    $('#metricCpu').textContent = d.cpu.toFixed(1) + '%';
    $('#metricRam').textContent = d.ram.toFixed(1) + '%';
    $('#metricNet').textContent = (d.rxMbps + d.txMbps).toFixed(2) + ' Mb/s';
    monitorSamples.push(d.cpu);
    if (monitorSamples.length > 24) monitorSamples.shift();
    drawMonitor(monitorSamples);
    const status = document.querySelector('.chart-status');
    if (status) status.innerHTML = '<i></i> Monitoramento ativo';

    // Ping contínuo
    const p = d.ping || {};
    if (p.avg != null) {
      setText('#pingAvg', p.avg.toFixed(1) + ' ms', 'ok');
      setText('#pingMin', p.min != null ? p.min.toFixed(1) + ' ms' : '—');
      setText('#pingMax', p.max != null ? p.max.toFixed(1) + ' ms' : '—');
      setText('#pingLoss', (p.loss || 0) + '%', p.loss > 0 ? 'warn' : 'ok');
    } else if (p.error) {
      setText('#pingAvg', 'erro', 'err');
      setText('#pingMin', '—'); setText('#pingMax', '—'); setText('#pingLoss', '—');
    }

    // Speedtest contínuo (Ookla)
    const s = d.speed || {};
    const btn = $('#btnSpeed');
    if (btn) btn.disabled = !!s.running;
    if (s.running && s.download == null) {
      setText('#speedDown', '…', 'warn');
      setText('#speedUp', '…');
      if ($('#speedMeta')) $('#speedMeta').textContent = 'Testando agora…';
    } else if (s.download != null || s.upload != null) {
      setText('#speedDown', s.download != null ? s.download.toFixed(1) + ' Mbps' : '—', 'ok');
      setText('#speedUp', s.upload != null ? s.upload.toFixed(1) + ' Mbps' : '—', 'ok');
      setText('#speedLat', s.latency != null ? s.latency.toFixed(1) + ' ms' : '—');
      setText('#speedJit', s.jitter != null ? s.jitter.toFixed(2) + ' ms' : '—');
      setText('#speedLoss', s.packetLoss != null ? s.packetLoss + '%' : '—', s.packetLoss > 0 ? 'warn' : 'ok');
      const meta = [];
      if (s.server) meta.push(s.server);
      if (s.isp) meta.push(s.isp);
      if (s.at) meta.push(fmtAgo(s.at));
      if ($('#speedServer')) $('#speedServer').textContent = meta.join(' · ') || '—';
      if ($('#speedMeta')) $('#speedMeta').textContent = s.running ? 'Atualizando…' : 'Atualiza a cada 5 min · automático';
    } else if (s.error) {
      setText('#speedDown', 'erro', 'err');
      if ($('#speedServer')) $('#speedServer').textContent = s.error;
    }
  } catch (e) {
    const status = document.querySelector('.chart-status');
    if (status) status.innerHTML = '<i class="metric-error-dot"></i> Monitoramento indisponível';
    ['#metricCpu', '#metricRam', '#metricNet'].forEach(s => { const n = $(s); if (n) n.textContent = 'erro'; });
    console.warn('Falha em /api/metrics:', e.message);
  }
}

async function runSpeed() {
  const btn = $('#btnSpeed');
  if (!btn) return;
  btn.disabled = true;
  if ($('#speedMeta')) $('#speedMeta').textContent = 'Iniciando speedtest…';
  try {
    await api('/api/speedtest', 'POST', {});
    toast('Speedtest iniciado');
    // o resultado chega no próximo loadMetrics
    setTimeout(loadMetrics, 3000);
    setTimeout(loadMetrics, 8000);
    setTimeout(loadMetrics, 15000);
  } catch (e) {
    toast(e.message || 'Erro ao iniciar speedtest');
    btn.disabled = false;
  }
}

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') show(false);
  if (!r.ok) throw new Error(d.error || 'Algo deu errado.');
  return d;
}
function show(ok) {
  $('#login').hidden = ok; $('#app').hidden = !ok;
  if (!ok) {
    clearInterval(poll); clearInterval(metricPoll); clearInterval(clockTick);
    onlineSig = '';
    Object.keys(onlineClock).forEach(k => delete onlineClock[k]);
  }
}
function toast(t) { const n = $('#toast'); n.textContent = t; n.classList.add('on'); setTimeout(() => n.classList.remove('on'), 2200); }

function dateInput(id, val) {
  const i = el('input'); i.type = 'date'; i.value = val || ''; i.setAttribute('aria-label', 'Data de expiração');
  const mark = () => { i.className = i.value && i.value < today() ? 'exp' : ''; }; mark();
  i.onchange = async () => { try { await api('/api/users/' + encodeURIComponent(id), 'PUT', { expira: i.value }); toast('Expiração atualizada'); mark(); } catch (e) { toast(e.message); } };
  return i;
}
function btn(t, fn, c = '', title) {
  const b = el('button', 'btn ' + c, t);
  b.onclick = fn;
  if (title) b.title = title;
  return b;
}

function openDialog(title, fields, save) {
  $('#dlgTitle').textContent = title; $('#formErr').textContent = '';
  $('#fields').replaceChildren(...fields.map(f => {
    const l = el('label', '', f.label);
    let i;
    if (f.type === 'select') {
      i = el('select'); i.name = f.name;
      (f.options || []).forEach(o => {
        const op = el('option', '', o.label); op.value = o.value;
        if (String(o.value) === String(f.value)) op.selected = true;
        i.append(op);
      });
    } else {
      i = el('input'); i.name = f.name; i.type = f.type || 'text'; i.autocomplete = 'off';
      if (f.value != null) i.value = f.value;
    }
    l.append(i); return l;
  }));
  $('#form').onsubmit = async ev => {
    ev.preventDefault();
    try { await save(Object.fromEntries(new FormData(ev.target))); $('#dlg').close(); toast('Salvo'); refresh(); } catch (e) { $('#formErr').textContent = e.message; }
  };
  $('#dlg').showModal();
}

function randStr(n, chars) {
  const a = chars || 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) s += a[buf[i] % a.length];
  return s;
}

function plusDays(n) {
  if (!n || n <= 0) return '';
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}


function copyText(text) {
  return new Promise(async (resolve, reject) => {
    const area = document.getElementById('testCopyArea');
    if (area) {
      area.value = text;
      area.focus();
      area.select();
      area.setSelectionRange(0, area.value.length);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return resolve();
      }
    } catch (e) {}
    try {
      const ok = document.execCommand('copy');
      if (ok) return resolve();
    } catch (e) {}
    // último recurso: texto já está selecionado no textarea visível
    if (area) {
      area.focus();
      area.select();
      return resolve('manual');
    }
    reject(new Error('copy failed'));
  });
}

function openTestDialog() {
  openDialog('Criar usuário de teste', [
    {
      name: 'dias',
      type: 'select',
      label: 'Expira em',
      value: '7',
      options: [
        { value: '1', label: '1 dia' },
        { value: '3', label: '3 dias' },
        { value: '7', label: '7 dias' },
        { value: '15', label: '15 dias' },
        { value: '30', label: '30 dias' },
        { value: '0', label: 'Nunca' }
      ]
    },
    { name: 'limite', type: 'number', label: 'Limite de conexões', value: 1 }
  ], async (b) => {
    const dias = parseInt(b.dias, 10);
    const limite = b.limite || 1;
    const usuario = 'test_' + randStr(6);
    const senha = randStr(10, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789');
    const expira = plusDays(dias);
    await api('/api/users', 'POST', { usuario, senha, expira, limite });
    $('#testUser').textContent = usuario;
    $('#testPass').textContent = senha;
    $('#testExp').textContent = fmtDateBR(expira);
    const full = [
      'Usuário: ' + usuario,
      'Senha: ' + senha,
      'Expira: ' + fmtDateBR(expira),
      'Limite: ' + limite
    ].join('\n');
    $('#testDlg').dataset.copy = full;
    const area = $('#testCopyArea');
    if (area) area.value = full;
    $('#testDlg').showModal();
    setTimeout(() => { if (area) { area.focus(); area.select(); } }, 100);
  });
}

function status(exp) {
  if (!exp) return { c: 'ok', t: 'Sem validade', d: 999 };
  const d = Math.round((new Date(exp + 'T23:59:59') - new Date()) / 864e5);
  if (exp < today()) return { c: 'bad', t: 'Expirado', d };
  if (d <= 7) return { c: 'warn', t: d <= 1 ? 'Vence hoje/amanhã' : 'Vence em ' + d + ' dias', d };
  return { c: 'ok', t: 'Ativo', d };
}
async function loadUsers() {
  const d = await api('/api/users?q=' + encodeURIComponent($('#search').value)), admin = me.role === 'admin';
  const sts = d.rows.map(r => status(r.expira));
  $('#stTotal').textContent = d.rows.length;
  $('#stSoon').textContent = sts.filter(s => s.c === 'warn').length;
  $('#stExp').textContent = sts.filter(s => s.c === 'bad').length;
  $('#profileCount').textContent = d.rows.length + (d.rows.length === 1 ? ' usuário' : ' usuários');
  $('#stats').hidden = false;
  $('#userCards').replaceChildren(...d.rows.map((r, i) => {
    const s = sts[i], card = el('article', 'user-card s-' + s.c), info = el('div', 'user-info');
    const avatar = makeAvatar(r.usuario, 'user-avatar');
    const details = el('div', 'user-details');
    const name = el('h4', '', r.usuario);
    const exp = el('p', '', r.expira ? 'Vence em: ' + new Date(r.expira + 'T12:00:00').toLocaleDateString('pt-BR') : 'Sem validade');
    const meta = el('span', 'user-meta', (r.limite || 1) + ' conexão' + ((r.limite || 1) === 1 ? '' : 'ões') + (admin && r.revenda ? ' · ' + r.revenda : ''));
    details.append(name, exp, meta); info.append(avatar, details);
    const actions = el('div', 'user-actions');
    if (r.blocked) {
      actions.append(btn('▶', () => unblockUser(r), 'icon-btn ok', 'Desbloquear'));
    } else {
      actions.append(btn('⏸', () => blockUser(r), 'icon-btn warn', 'Bloquear'));
    }
    actions.append(btn('↓', () => throttleUser(r), 'icon-btn', r.mbps ? ('Limite: ' + r.mbps + ' Mbps') : 'Limitar tráfego'));
    if (r.mbps) actions.append(btn('∞', () => unthrottleUser(r), 'icon-btn', 'Remover limite'));
    actions.append(btn('↺', () => resetTraffic(r), 'icon-btn', 'Zerar tráfego'));
    actions.append(btn('✎', () => editUser(r), 'icon-btn', 'Editar'), btn('×', () => delUser(r), 'icon-btn delete', 'Excluir'));
    const pills = el('div', 'user-pills');
    pills.append(el('span', 'pill ' + (r.blocked ? 'bad' : s.c), r.blocked ? 'Bloqueado' : s.t));
    if (r.mbps && !r.blocked) pills.append(el('span', 'pill warn', r.mbps + ' Mbps'));
    card.append(info, pills, actions);
    return card;
  }));
  // mantém a tabela antiga preenchida para compatibilidade com instalações que a exibam via CSS.
  const head = el('tr'); ['usuário', 'status', 'expira em', 'conexões'].concat(admin ? ['revenda'] : []).forEach(h => head.append(el('th', '', h))); head.append(el('th'));
  $('#tbl thead')?.replaceChildren(head);
  $('#tbl tbody')?.replaceChildren(...d.rows.map((r, i) => {
    const s = sts[i], tr = el('tr', 's-' + s.c), td = el('td'), nm = el('td', 'nm'), stc = el('td');
    td.append(dateInput(r.usuario, r.expira));
    nm.append(makeAvatar(r.usuario, 'av'), el('span', '', r.usuario));
    stc.append(el('span', 'pill ' + (r.blocked ? 'bad' : s.c), r.blocked ? 'Bloqueado' : s.t));
    tr.append(nm, stc, td, el('td', '', r.limite));
    if (admin) tr.append(el('td', '', r.revenda || '—'));
    [['Usuário', nm], ['Status', stc], ['Expira em', td]].forEach(([l, c]) => c.dataset.l = l);
    tr.children[3].dataset.l = 'Conexões';
    const act = el('td', 'act');
    act.append(btn('Editar', () => editUser(r)), btn('Excluir', () => delUser(r), 'del')); tr.append(act); return tr;
  }));
  $('#empty').hidden = d.rows.length > 0;
  $('#stats').hidden = view !== 'users';
}
function editUser(r) {
  const f = [{ name: 'senha', type: 'password', label: r ? 'Nova senha (deixe vazio para manter)' : 'Senha' },
    { name: 'expira', type: 'date', label: 'Expira em (vazio = nunca)', value: r ? r.expira : '' },
    { name: 'limite', type: 'number', label: 'Limite de conexões', value: r ? r.limite : 1 }];
  if (!r) f.unshift({ name: 'usuario', label: 'Usuário' });
  openDialog(r ? 'Editar ' + r.usuario : 'Novo usuário', f, b => api(r ? '/api/users/' + encodeURIComponent(r.usuario) : '/api/users', r ? 'PUT' : 'POST', b));
}
async function delUser(r) {
  if (!confirm('Excluir ' + r.usuario + '? A conta do Linux será apagada e as conexões derrubadas.')) return;
  try { await api('/api/users/' + encodeURIComponent(r.usuario), 'DELETE'); toast('Usuário excluído'); refresh(); } catch (e) { toast(e.message); }
}
async function blockUser(r) {
  if (!confirm('Bloquear ' + r.usuario + '? As conexões serão derrubadas (usuarios.db + DragonCore se existir).')) return;
  try {
    const d = await api('/api/users/' + encodeURIComponent(r.usuario) + '/block', 'POST', {});
    toast(d.warning || (r.usuario + ' bloqueado'));
    refresh();
  } catch (e) { toast(e.message); }
}
async function unblockUser(r) {
  try {
    const d = await api('/api/users/' + encodeURIComponent(r.usuario) + '/unblock', 'POST', {});
    toast(d.warning || (r.usuario + ' desbloqueado'));
    refresh();
  } catch (e) { toast(e.message); }
}
async function throttleUser(r) {
  const v = prompt('Limite de tráfego em Mbps (ex: 1, 5, 10). 0 = sem limite especial.', String(r.mbps || 1));
  if (v == null) return;
  const mbps = parseInt(v, 10);
  if (!(mbps >= 0)) { toast('Valor inválido'); return; }
  try {
    if (mbps === 0) {
      await api('/api/users/' + encodeURIComponent(r.usuario) + '/unthrottle', 'POST', {});
      toast('Limite removido');
    } else {
      await api('/api/users/' + encodeURIComponent(r.usuario) + '/throttle', 'POST', { mbps });
      toast('Tráfego limitado a ' + mbps + ' Mbps');
    }
    refresh();
  } catch (e) { toast(e.message); }
}
async function unthrottleUser(r) {
  try {
    await api('/api/users/' + encodeURIComponent(r.usuario) + '/unthrottle', 'POST', {});
    toast('Limite de tráfego removido');
    refresh();
  } catch (e) { toast(e.message); }
}
async function resetTraffic(r) {
  if (!confirm('Zerar contadores de tráfego de ' + r.usuario + ' no DragonCore?')) return;
  try {
    await api('/api/users/' + encodeURIComponent(r.usuario) + '/reset-traffic', 'POST', {});
    toast('Tráfego zerado');
  } catch (e) { toast(e.message); }
}

async function loadOnline() {
  const d = await api('/api/online');
  const rows = d.rows || [];
  $('#onCount').textContent = rows.length;
  const onlineTotal = $('#onlineTotal');
  if (onlineTotal) onlineTotal.textContent = rows.length;
  const chartOnline = $('#chartOnline');
  if (chartOnline) chartOnline.textContent = rows.length + (rows.length === 1 ? ' online agora' : ' online agora');
  $('#emptyOn').hidden = rows.length > 0;

  // sincroniza base do relógio com o que a API mandou
  const now = Date.now();
  const seen = {};
  rows.forEach(r => {
    seen[r.usuario] = true;
    onlineClock[r.usuario] = {
      baseSecs: parseOnline(r.online || r.tempo || ''),
      syncedAt: now
    };
  });
  Object.keys(onlineClock).forEach(u => { if (!seen[u]) delete onlineClock[u]; });

  if (view !== 'online') return;

  // estrutura (quem está online + conexões) — só reconstrói se mudou
  const structSig = rows.map(r => r.usuario + '|' + r.conexoes + '|' + r.limite + '|' + (r.expira || '')).join(';');
  if (structSig !== onlineSig) {
    onlineSig = structSig;
    $('#onlineCards').replaceChildren(...rows.map(r => {
      const tr = el('tr');
      tr.dataset.user = r.usuario;
      const td = el('td');
      const secs = onlineClock[r.usuario] ? onlineClock[r.usuario].baseSecs : 0;
      const avatar = makeAvatar(r.usuario, 'online-avatar');
      const identity = el('div', 'online-identity');
      identity.append(el('strong', '', r.usuario), el('span', '', 'Sessão ativa'));
      const time = el('div', 'online-duration');
      time.append(el('small', '', 'ONLINE HÁ'), el('b', 'online-time', fmtSecs(secs)));
      const connections = el('div', 'online-stat');
      connections.append(el('small', '', 'CONEXÕES'), el('b', '', r.conexoes + ' / ' + r.limite));
      const expiry = el('div', 'online-expiry');
      expiry.append(el('small', '', 'EXPIRA EM'), dateInput(r.usuario, r.expira));
      tr.append(avatar, identity, time, connections, expiry);
      return tr;
    }));
  }
  // o tempo sobe sozinho via tickOnlineClock (1s)
}

async function loadRev() {
  const d = await api('/api/revendas'); $('#emptyRev').hidden = d.rows.length > 0;
  $('#bRev').replaceChildren(...d.rows.map(r => {
    const tr = el('tr'), st = el('td'), act = el('td', 'act');
    st.append(el('span', 'pill ' + (r.ativo ? 'ok' : 'off'), r.ativo ? 'Ativa' : 'Bloqueada'));
    act.append(
      btn('Editar', () => openDialog('Editar revenda', [{ name: 'limite', label: 'Limite de usuários', type: 'number', value: r.limite }, { name: 'senha', label: 'Nova senha (deixe vazio para manter)', type: 'password' }], b => api('/api/revendas/' + r.id, 'PUT', b))),
      btn(r.ativo ? 'Bloquear' : 'Ativar', async () => { try { await api('/api/revendas/' + r.id, 'PUT', { ativo: !r.ativo }); refresh(); } catch (e) { toast(e.message); } }),
      btn('Excluir', async () => { if (confirm('Excluir esta revenda? Os usuários dela continuam existindo.')) { try { await api('/api/revendas/' + r.id, 'DELETE'); refresh(); } catch (e) { toast(e.message); } } }, 'del'));
    tr.append(el('td', '', r.nome), el('td', '', r.usados + ' de ' + r.limite), st, act); return tr;
  }));
}

function refresh() { ({ users: loadUsers, online: loadOnline, rev: loadRev })[view]().catch(e => toast(e.message)); loadOnline().catch(() => {}); }
function startOnlinePoll() {
  clearInterval(poll);
  clearInterval(metricPoll);
  clearInterval(clockTick);
  // API: 3s na aba Online (quem entrou/saiu), 5s nas outras (só contador)
  const ms = view === 'online' ? 3000 : 5000;
  poll = setInterval(() => loadOnline().catch(() => {}), ms);
  loadMetrics();
  metricPoll = setInterval(loadMetrics, 5000);
  // relógio local: atualiza o tempo a cada 1 segundo
  if (view === 'online') clockTick = setInterval(tickOnlineClock, 1000);
}
function setView(v) {
  view = v;
  onlineSig = ''; // força re-render ao entrar na aba
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.v === v));
  ['users', 'online', 'rev'].forEach(x => { $('#v-' + x).hidden = x !== v; });
  $('#stats').hidden = v !== 'users';
  $('#search').hidden = v !== 'users';
  $('#newBtn').hidden = v === 'online';
  $('#testBtn').hidden = v !== 'users';
  $('#newBtn').textContent = v === 'rev' ? 'Nova revenda' : 'Novo usuário';
  startOnlinePoll();
  refresh();
}
function start(m) {
  me = m; $('#tabRev').hidden = m.role !== 'admin';
  $('#who').hidden = m.role !== 'rev'; $('#who').textContent = 'Revenda: ' + (m.name || '');
  show(true); setView('users');
}

document.querySelectorAll('.tab').forEach(t => t.onclick = () => setView(t.dataset.v));
$('#newBtn').onclick = () => view === 'rev'
  ? openDialog('Nova revenda', [{ name: 'nome', label: 'Nome de login' }, { name: 'senha', label: 'Senha (8+ caracteres)', type: 'password' }, { name: 'limite', label: 'Limite de usuários', type: 'number', value: 10 }], b => api('/api/revendas', 'POST', b))
  : editUser(null);
$('#testBtn').onclick = openTestDialog;
if ($('#btnSpeed')) $('#btnSpeed').onclick = runSpeed;
$('#testOk').onclick = () => $('#testDlg').close();
$('#testCopy').onclick = async () => {
  const txt = $('#testDlg').dataset.copy || ($('#testCopyArea') && $('#testCopyArea').value) || '';
  try {
    const r = await copyText(txt);
    toast(r === 'manual' ? 'Texto selecionado — segure e toque em Copiar' : 'Copiado');
  } catch {
    const area = $('#testCopyArea');
    if (area) { area.focus(); area.select(); }
    toast('Segure o texto e toque em Copiar');
  }
};
$('#cancel').onclick = () => $('#dlg').close();
$('#search').oninput = () => { clearTimeout(timer); timer = setTimeout(loadUsers, 250); };
$('#logoutBtn').onclick = async () => { await api('/api/logout', 'POST'); csrf = (await (await fetch('/api/me')).json()).csrf; show(false); };
$('#loginForm').onsubmit = async ev => {
  ev.preventDefault(); $('#loginErr').textContent = '';
  try { const d = await api('/api/login', 'POST', Object.fromEntries(new FormData(ev.target))); csrf = d.csrf; ev.target.reset(); start(d); }
  catch (e) { $('#loginErr').textContent = e.message; }
};
(async () => {
  const m = await (await fetch('/api/me')).json();
  csrf = m.csrf;
  m.logged ? start(m) : show(false);
})();
