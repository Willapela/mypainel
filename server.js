require('dotenv').config();
const express = require('express'), session = require('express-session'), helmet = require('helmet');
const rateLimit = require('express-rate-limit'), bcrypt = require('bcryptjs'), crypto = require('crypto');
const { execFile } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const { USERS_FILE = '/root/usuarios.db', PANEL_DB = path.join(__dirname, 'data', 'painel.json'), MIN_UID = '1000', ADMIN_USER, ADMIN_HASH, SESSION_SECRET, PORT = 3100, HOST = '127.0.0.1' } = process.env;
if (!ADMIN_USER || !ADMIN_HASH || !SESSION_SECRET || SESSION_SECRET.length < 24) { console.error('Configure o .env corretamente (veja .env.example).'); process.exit(1); }
fs.mkdirSync(path.dirname(PANEL_DB), { recursive: true });
let S = { revs: [], map: {}, seq: 1 };
try { S = JSON.parse(fs.readFileSync(PANEL_DB, 'utf8')); } catch { }
const save = () => { const t = PANEL_DB + '.tmp'; fs.writeFileSync(t, JSON.stringify(S), { mode: 0o600 }); fs.renameSync(t, PANEL_DB); };
const DUMMY = bcrypt.hashSync('x', 12), NAME = /^[A-Za-z_][A-Za-z0-9_-]{2,31}$/, DATE = /^\d{4}-\d\d-\d\d$/;
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const fail = m => Object.assign(new Error(m), { show: true });
const sys = (cmd, args, input, timeoutMs = 15000) => new Promise((ok, no) => {
  const p = execFile(cmd, args, { timeout: timeoutMs }, (e, out, err) => e ? no(new Error(cmd + ': ' + (err || e.message))) : ok(out));
  if (input !== undefined) p.stdin.end(input);
});

// ===== Integração DragonCoreSSH (API HTTP) =====
// Quando ativado, cria/edita/apaga usuários também no DragonCore.
const DC = {
  on: process.env.DRAGONCORE_ENABLED === '1',
  base: (process.env.DRAGONCORE_URL || 'http://127.0.0.1:9090').replace(/\/+$/, ''),
  user: process.env.DRAGONCORE_USER || '',
  pass: process.env.DRAGONCORE_PASS || '',
  token: null,
  tokenAt: 0
};
async function dcFetch(path, opts = {}) {
  const url = DC.base + path;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (DC.token) headers['X-Session-Token'] = DC.token;
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: r.ok, status: r.status, text, json };
}
async function dcLogin(force) {
  if (!DC.on) return false;
  if (!force && DC.token && Date.now() - DC.tokenAt < 50 * 60e3) return true;
  if (!DC.user || !DC.pass) {
    console.warn('[DragonCore] DRAGONCORE_USER/PASS não configurados');
    return false;
  }
  try {
    const r = await fetch(DC.base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: DC.user, password: DC.pass })
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { }
    // token pode vir como session_token, token ou no body
    const tok = (data && (data.session_token || data.token || data.sessionToken)) || (r.headers.get('x-session-token') || '');
    if (!r.ok || !tok) {
      console.warn('[DragonCore] login falhou:', r.status, text.slice(0, 200));
      DC.token = null;
      return false;
    }
    DC.token = tok;
    DC.tokenAt = Date.now();
    return true;
  } catch (e) {
    console.warn('[DragonCore] login erro:', e.message);
    return false;
  }
}
function dcExpiresAt(isoDate) {
  // YYYY-MM-DD -> fim do dia UTC em RFC3339; vazio = null (sem expiração)
  if (!isoDate) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate + 'T23:59:59Z';
  return isoDate;
}
async function dcUpsertUser({ usuario, senha, limite, expira }) {
  if (!DC.on) return;
  if (!(await dcLogin())) return;
  const body = {
    username: usuario,
    max_connections: Math.max(0, parseInt(limite, 10) || 1),
    expires_at: dcExpiresAt(expira || '')
  };
  if (senha) body.password = senha;
  let r = await dcFetch('/api/users/create', { method: 'POST', body });
  if (r.status === 401) {
    if (await dcLogin(true)) r = await dcFetch('/api/users/create', { method: 'POST', body });
  }
  if (!r.ok && r.status !== 201) {
    console.warn('[DragonCore] upsert', usuario, r.status, (r.text || '').slice(0, 200));
  }
}
async function dcDeleteUser(usuario) {
  if (!DC.on) return;
  if (!(await dcLogin())) return;
  let r = await dcFetch('/api/users/delete?username=' + encodeURIComponent(usuario), { method: 'DELETE' });
  if (r.status === 401) {
    if (await dcLogin(true)) r = await dcFetch('/api/users/delete?username=' + encodeURIComponent(usuario), { method: 'DELETE' });
  }
  if (!r.ok && r.status !== 204) {
    console.warn('[DragonCore] delete', usuario, r.status, (r.text || '').slice(0, 200));
  }
}
if (DC.on) console.log('[DragonCore] integração ativa →', DC.base);

function sysUsers() {
  const exp = {};
  for (const l of fs.readFileSync('/etc/shadow', 'utf8').split('\n')) { const a = l.split(':'); if (a.length > 7) exp[a[0]] = a[7]; }
  return fs.readFileSync('/etc/passwd', 'utf8').split('\n').map(l => l.split(':'))
    .filter(a => a.length > 6 && +a[2] >= +MIN_UID && +a[2] < 65534)
    .map(a => ({ usuario: a[0], expira: /^\d+$/.test(exp[a[0]] || '') ? new Date(exp[a[0]] * 864e5).toISOString().slice(0, 10) : null }));
}
function readLimits() {
  const m = new Map();
  try { for (const l of fs.readFileSync(USERS_FILE, 'utf8').split('\n')) { const [u, n] = l.trim().split(/\s+/); if (u && /^\d+$/.test(n || '')) m.set(u, +n); } } catch { }
  return m;
}
function writeLimits(m) {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, [...m].map(([u, n]) => `${u} ${n}`).join('\n') + (m.size ? '\n' : ''), { mode: 0o644 });
  fs.renameSync(tmp, USERS_FILE);
}
const setExpiry = (u, d) => sys('chage', ['-E', d || '-1', u]);
const chkLimit = v => { const n = v === undefined || v === '' ? 1 : parseInt(v, 10); if (!(n >= 1 && n <= 1000)) throw fail('Limite de conexões: de 1 a 1000.'); return n; };
const chkDate = d => { if (d && !DATE.test(d)) throw fail('Data de expiração inválida.'); return d || ''; };
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '1');
// Atrás do Worker/Cloudflare: só aceita quem manda a chave secreta e usa o IP real enviado por ele
const PROXY_KEY = process.env.PROXY_KEY || '';
app.use((req, res, next) => {
  if (!PROXY_KEY) return next();
  if (!eq(req.get('x-proxy-key') || '', PROXY_KEY)) return res.status(403).end();
  const ip = req.get('x-real-ip') || '';
  if (/^[0-9a-fA-F:.]{3,45}$/.test(ip)) Object.defineProperty(req, 'ip', { value: ip });
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'upgrade-insecure-requests': null,
      'img-src': ["'self'", 'data:', 'blob:', 'https://api.dicebear.com']
    }
  },
  hsts: false
}));
app.use(express.json({ limit: '50kb' }));
app.use(session({
  name: 'sid', secret: SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 2 * 3600e3 }
}));
app.use(express.static(path.join(__dirname, 'public')));
const auth = (req, res, next) => {
  const s = req.session;
  if (s.role === 'rev' && !S.revs.some(r => r.id === s.revId && r.ativo)) s.role = null;
  s.role ? next() : res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
};
const adminOnly = (req, res, next) => req.session.role === 'admin' ? next() : res.status(403).json({ error: 'Acesso negado.' });
const csrf = (req, res, next) => req.session.csrf && eq(req.get('X-CSRF') || '', req.session.csrf) ? next() : res.status(403).json({ error: 'Requisição inválida.' });
const run = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { console.error(e.message); res.status(400).json({ error: e.show ? e.message : 'Não foi possível concluir. Confira os campos e tente de novo.' }); } };
let netSample = { at: Date.now(), rx: 0, tx: 0 };
function networkBytes() {
  try {
    return fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2).reduce((sum, line) => {
      const [iface, data] = line.trim().split(':');
      if (!data || iface.trim() === 'lo') return sum;
      const p = data.trim().split(/\s+/);
      return { rx: sum.rx + (+p[0] || 0), tx: sum.tx + (+p[8] || 0) };
    }, { rx: 0, tx: 0 });
  } catch { return { rx: 0, tx: 0 }; }
}

// CPU real via /proc/stat (diferença entre duas amostras)
let cpuSample = null;
function readCpuTimes() {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    // cpu user nice system idle iowait irq softirq steal guest guest_nice
    const p = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (p[3] || 0) + (p[4] || 0); // idle + iowait
    const total = p.reduce((a, b) => a + (b || 0), 0);
    return { idle, total };
  } catch {
    return null;
  }
}
function cpuUsagePercent() {
  const cur = readCpuTimes();
  if (!cur) {
    // fallback antigo
    const cores = Math.max(1, os.cpus().length);
    return Math.min(100, Math.max(0, os.loadavg()[0] / cores * 100));
  }
  if (!cpuSample) {
    cpuSample = cur;
    // primeira chamada: ainda não tem delta; usa loadavg só desta vez
    const cores = Math.max(1, os.cpus().length);
    return Math.min(100, Math.max(0, os.loadavg()[0] / cores * 100));
  }
  const dIdle = cur.idle - cpuSample.idle;
  const dTotal = cur.total - cpuSample.total;
  cpuSample = cur;
  if (dTotal <= 0) return 0;
  const used = 1 - dIdle / dTotal;
  return Math.min(100, Math.max(0, used * 100));
}

// RAM real: MemAvailable de /proc/meminfo (o que o Linux considera disponível)
function ramUsagePercent() {
  try {
    const txt = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => {
      const m = txt.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm'));
      return m ? parseInt(m[1], 10) * 1024 : null; // kB -> bytes
    };
    const total = get('MemTotal');
    const available = get('MemAvailable');
    if (total && available != null) {
      return Math.min(100, Math.max(0, (total - available) / total * 100));
    }
  } catch { }
  // fallback
  const total = os.totalmem(), free = os.freemem();
  return (total - free) / total * 100;
}

// ===== Monitoramento contínuo: ping + speedtest (Ookla) =====
const netStatus = {
  ping: { avg: null, min: null, max: null, loss: 0, at: 0, error: null },
  speed: { download: null, upload: null, latency: null, jitter: null, packetLoss: null, server: null, isp: null, resultUrl: null, at: 0, running: false, error: null },
  speedIntervalMs: 5 * 60e3 // speedtest automático a cada 5 min
};

async function doPing() {
  try {
    const out = await sys('ping', ['-c', '3', '-W', '2', '1.1.1.1'], undefined, 12000);
    const mdev = out.match(/=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/);
    const loss = out.match(/(\d+)%\s*packet loss/);
    netStatus.ping = {
      avg: mdev ? parseFloat(mdev[2]) : null,
      min: mdev ? parseFloat(mdev[1]) : null,
      max: mdev ? parseFloat(mdev[3]) : null,
      loss: loss ? parseInt(loss[1], 10) : 0,
      at: Date.now(),
      error: null
    };
  } catch (e) {
    netStatus.ping.error = e.message;
    netStatus.ping.at = Date.now();
  }
}

async function doSpeedtest() {
  if (netStatus.speed.running) return;
  netStatus.speed.running = true;
  try {
    // Preferência: Ookla CLI (speedtest). Aceita licença automaticamente.
    const out = await sys('speedtest', [
      '--accept-license', '--accept-gdpr',
      '--format=json',
      '--progress=no'
    ], undefined, 120000);
    const j = JSON.parse(out);
    const dl = j.download && j.download.bandwidth != null ? (j.download.bandwidth * 8) / 1e6 : null;
    const ul = j.upload && j.upload.bandwidth != null ? (j.upload.bandwidth * 8) / 1e6 : null;
    const lat = j.ping && j.ping.latency != null ? j.ping.latency : null;
    const jit = j.ping && j.ping.jitter != null ? j.ping.jitter : null;
    const pl = j.packetLoss != null ? j.packetLoss : null;
    netStatus.speed = {
      download: dl != null ? Math.round(dl * 100) / 100 : null,
      upload: ul != null ? Math.round(ul * 100) / 100 : null,
      latency: lat != null ? Math.round(lat * 100) / 100 : null,
      jitter: jit != null ? Math.round(jit * 100) / 100 : null,
      packetLoss: pl,
      server: j.server ? (j.server.name + (j.server.location ? ' - ' + j.server.location : '')) : null,
      isp: j.isp || null,
      resultUrl: j.result && j.result.url ? j.result.url : null,
      at: Date.now(),
      running: false,
      error: null
    };
  } catch (e) {
    // Fallback: download simples via Cloudflare se Ookla não estiver instalado
    try {
      const bytes = 15 * 1024 * 1024;
      const url = `https://speed.cloudflare.com/__down?bytes=${bytes}`;
      const out = await sys('curl', [
        '-o', '/dev/null', '-s', '-S',
        '-w', '%{size_download} %{speed_download} %{time_total}',
        '--max-time', '45',
        url
      ], undefined, 50000);
      const parts = out.trim().split(/\s+/);
      const size = parseFloat(parts[0]) || 0;
      const speedBps = parseFloat(parts[1]) || 0;
      const mbps = (speedBps * 8) / 1e6;
      netStatus.speed = {
        download: size > 0 ? Math.round(mbps * 100) / 100 : null,
        upload: null,
        latency: netStatus.ping.avg,
        jitter: null,
        packetLoss: netStatus.ping.loss,
        server: 'Cloudflare (fallback)',
        isp: null,
        resultUrl: null,
        at: Date.now(),
        running: false,
        error: size > 0 ? null : (e.message || 'Falha no speedtest')
      };
    } catch (e2) {
      netStatus.speed.running = false;
      netStatus.speed.error = e.message || e2.message;
      netStatus.speed.at = Date.now();
    }
  }
}

// loop em background
setInterval(() => { doPing().catch(() => {}); }, 12e3);
setInterval(() => { doSpeedtest().catch(() => {}); }, netStatus.speedIntervalMs);
// semente inicial da CPU (o % real aparece a partir da 2ª leitura /api/metrics)
cpuSample = readCpuTimes();
// primeira execução
setTimeout(() => { doPing().catch(() => {}); }, 1500);
setTimeout(() => { doSpeedtest().catch(() => {}); }, 4000);

app.get('/api/me', (req, res) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.json({ logged: !!req.session.role, role: req.session.role, name: req.session.name, csrf: req.session.csrf });
});
app.get('/api/metrics', auth, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const now = Date.now(), net = networkBytes(), elapsed = Math.max(1, now - netSample.at) / 1000;
  const rxMbps = Math.max(0, (net.rx - netSample.rx) * 8 / elapsed / 1e6);
  const txMbps = Math.max(0, (net.tx - netSample.tx) * 8 / elapsed / 1e6);
  netSample = { at: now, rx: net.rx, tx: net.tx };
  const cpu = cpuUsagePercent();
  const ram = ramUsagePercent();
  res.json({
    cpu, ram, load: os.loadavg()[0], rxMbps, txMbps, uptime: os.uptime(),
    cores: os.cpus().length,
    ping: netStatus.ping,
    speed: netStatus.speed
  });
});

// Força um speedtest agora (manual)
app.post('/api/speedtest', auth, csrf, rateLimit({ windowMs: 60e3, max: 2 }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (netStatus.speed.running) return res.json({ ok: true, running: true, speed: netStatus.speed });
  doSpeedtest().catch(() => {});
  res.json({ ok: true, running: true, message: 'Speedtest iniciado. Atualiza em alguns segundos.' });
});

app.post('/api/login', rateLimit({ windowMs: 15 * 60e3, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde 15 minutos.' } }), csrf, async (req, res) => {
  const user = String((req.body || {}).user || ''), pass = String((req.body || {}).pass || '');
  let role = null, revId = null;
  const okAdmin = await bcrypt.compare(pass, ADMIN_HASH);
  if (eq(user, ADMIN_USER) && okAdmin) role = 'admin';
  else {
    const r = S.revs.find(x => x.nome === user && x.ativo);
    const okRev = await bcrypt.compare(pass, r ? r.hash : DUMMY);
    if (r && okRev) { role = 'rev'; revId = r.id; }
  }
  if (!role) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  req.session.regenerate(() => {
    Object.assign(req.session, { role, revId, name: user, csrf: crypto.randomBytes(24).toString('hex') });
    res.json({ csrf: req.session.csrf, role, name: user });
  });
});
app.post('/api/logout', auth, csrf, (req, res) => req.session.destroy(() => res.json({ ok: true })));
function visible(req) {
  const lim = readLimits(), own = new Map(Object.entries(S.map).map(([u, id]) => [u, (S.revs.find(r => r.id === id) || {}).nome]));
  const rows = sysUsers().map(u => ({ ...u, limite: lim.get(u.usuario) ?? 1, revenda: own.get(u.usuario) || (S.tst && S.tst.some(t => t.u === u.usuario) ? 'teste grátis' : null) }));
  return req.session.role === 'rev' ? rows.filter(u => u.revenda === req.session.name) : rows;
}
const mustOwn = (req, name) => { if (!visible(req).some(u => u.usuario === name)) throw fail('Usuário não encontrado.'); };
app.get('/api/users', auth, run(req => {
  const q = String(req.query.q || '').slice(0, 60).toLowerCase();
  return { rows: visible(req).filter(u => u.usuario.toLowerCase().includes(q)) };
}));
app.get('/api/online', auth, (req, res) => {
  execFile('ps', ['-eo', 'etime=,args=', '--no-headers'], { maxBuffer: 4e6 }, (err, out) => {
    if (err) return res.status(500).json({ error: 'Não foi possível ler as conexões.' });
    const n = {}, tempo = {};
    for (const l of out.split('\n')) {
      const line = l.trim();
      if (!line) continue;
      const m = /^(\S+)\s+sshd: ([\w.@-]+) \[priv\]\s*$/.exec(line);
      if (!m) continue;
      const user = m[2], et = m[1];
      n[user] = (n[user] || 0) + 1;
      if (!tempo[user] || et.length > String(tempo[user]).length || et > tempo[user]) tempo[user] = et;
    }
    const fmt = (et) => {
      if (!et) return '—';
      const p = et.split('-');
      let days = 0, rest = p[0];
      if (p.length === 2) { days = parseInt(p[0], 10) || 0; rest = p[1]; }
      const t = rest.split(':').map(x => parseInt(x, 10) || 0);
      let h = 0, mi = 0, s = 0;
      if (t.length === 3) [h, mi, s] = t;
      else if (t.length === 2) [mi, s] = t;
      h += days * 24;
      if (h > 0) return h + 'h ' + String(mi).padStart(2, '0') + 'm';
      if (mi > 0) return mi + 'm ' + String(s).padStart(2, '0') + 's';
      return s + 's';
    };
    res.json({
      rows: visible(req).filter(u => n[u.usuario]).map(u => ({
        usuario: u.usuario,
        expira: u.expira,
        limite: u.limite,
        conexoes: n[u.usuario],
        online: fmt(tempo[u.usuario])
      }))
    });
  });
});
app.post('/api/users', auth, csrf, run(async req => {
  const { usuario = '', senha = '', expira = '', limite } = req.body || {}, rev = req.session.role === 'rev';
  if (!NAME.test(usuario)) throw fail('Usuário: 3 a 32 caracteres (letras, números, _ ou -), começando por letra.');
  if (senha.length < 4 || senha.length > 64 || /[\r\n\0]/.test(senha)) throw fail('Senha: de 4 a 64 caracteres.');
  const d = chkDate(expira), n = chkLimit(limite);
  if (fs.readFileSync('/etc/passwd', 'utf8').split('\n').some(l => l.split(':')[0] === usuario)) throw fail('Esse usuário já existe.');
  if (rev) {
    const max = S.revs.find(r => r.id === req.session.revId).limite;
    if (Object.values(S.map).filter(x => x === req.session.revId).length >= max) throw fail('Limite de usuários da revenda atingido.');
  }
  await sys('useradd', ['-M', '-s', '/bin/false', ...(d ? ['-e', d] : []), usuario]);
  try { await sys('chpasswd', [], `${usuario}:${senha}\n`); }
  catch (e) { await sys('userdel', [usuario]).catch(() => { }); throw e; }
  const m = readLimits(); m.set(usuario, n); writeLimits(m);
  if (rev) { S.map[usuario] = req.session.revId; save(); }
  // sincroniza no DragonCore (não bloqueia se falhar)
  dcUpsertUser({ usuario, senha, limite: n, expira: d }).catch(e => console.warn('[DragonCore]', e.message));
  return { ok: true };
}));
app.put('/api/users/:name', auth, csrf, run(async req => {
  const u = req.params.name, b = req.body || {};
  mustOwn(req, u);
  if ('senha' in b && b.senha) {
    if (b.senha.length < 4 || b.senha.length > 64 || /[\r\n\0]/.test(b.senha)) throw fail('Senha: de 4 a 64 caracteres.');
    await sys('chpasswd', [], `${u}:${b.senha}\n`);
  }
  if ('expira' in b) await setExpiry(u, chkDate(b.expira));
  if ('limite' in b) { const m = readLimits(); m.set(u, chkLimit(b.limite)); writeLimits(m); }
  // lê valores atuais para mandar um upsert completo
  const lim = readLimits().get(u) || 1;
  const exp = ('expira' in b) ? chkDate(b.expira) : (sysUsers().find(x => x.usuario === u) || {}).expira;
  dcUpsertUser({ usuario: u, senha: b.senha || undefined, limite: ('limite' in b) ? chkLimit(b.limite) : lim, expira: exp || '' }).catch(e => console.warn('[DragonCore]', e.message));
  return { ok: true };
}));
app.delete('/api/users/:name', auth, csrf, run(async req => {
  const u = req.params.name; mustOwn(req, u);
  await sys('pkill', ['-KILL', '-u', u]).catch(() => { });
  await sys('userdel', [u]);
  const m = readLimits(); if (m.delete(u)) writeLimits(m);
  if (u in S.map) { delete S.map[u]; save(); }
  dcDeleteUser(u).catch(e => console.warn('[DragonCore]', e.message));
  return { ok: true };
}));
const revBody = (b, isNew) => {
  const o = {};
  if (isNew) { o.nome = String(b.nome || ''); if (!/^[\w.-]{3,32}$/.test(o.nome)) throw fail('Nome: 3 a 32 caracteres (letras, números, ponto, hífen ou _).'); }
  if (isNew || b.senha) { if (String(b.senha || '').length < 8) throw fail('A senha precisa ter 8 caracteres ou mais.'); o.hash = bcrypt.hashSync(String(b.senha), 12); }
  if ('limite' in b) { o.limite = parseInt(b.limite, 10); if (!(o.limite >= 0 && o.limite <= 100000)) throw fail('Limite inválido.'); }
  if ('ativo' in b) o.ativo = b.ativo ? 1 : 0;
  return o;
};
app.get('/api/revendas', auth, adminOnly, (req, res) => res.json({ rows: [...S.revs].sort((a, b) => a.nome.localeCompare(b.nome)).map(r => ({ id: r.id, nome: r.nome, limite: r.limite, ativo: r.ativo, usados: Object.values(S.map).filter(x => x === r.id).length })) }));
app.post('/api/revendas', auth, adminOnly, csrf, run(req => {
  const d = revBody(req.body, true);
  if (S.revs.some(r => r.nome === d.nome)) throw fail('Já existe uma revenda com esse nome.');
  S.revs.push({ id: S.seq++, ativo: 1, limite: 10, ...d }); save(); return { ok: true };
}));
app.put('/api/revendas/:id', auth, adminOnly, csrf, run(req => {
  const d = revBody(req.body, false), r = S.revs.find(x => x.id === Number(req.params.id));
  if (!Object.keys(d).length) throw fail('Nada para salvar.');
  if (!r) throw fail('Revenda não encontrada.');
  Object.assign(r, d); save(); return { ok: true };
}));
app.delete('/api/revendas/:id', auth, adminOnly, csrf, run(req => {
  const id = Number(req.params.id); S.revs = S.revs.filter(r => r.id !== id);
  for (const u in S.map) if (S.map[u] === id) delete S.map[u];
  save(); return { ok: true };
}));
// ===== Teste grátis: mesma porta do painel em /teste =====
const T = {
  on: process.env.TESTE_ENABLED === '1',
  horas: +process.env.TESTE_HORAS || 2, max: +process.env.TESTE_MAX_DIA || 30, limite: +process.env.TESTE_LIMITE || 1,
  wa: (process.env.WHATSAPP || '').replace(/\D/g, ''), msg: process.env.TESTE_MSG || 'Olá! Fiz o teste grátis e quero contratar.',
  host: process.env.SERVER_HOST || '', sshPort: process.env.SSH_PORT || '22',
  tsKey: process.env.TURNSTILE_SITEKEY || '', tsSecret: process.env.TURNSTILE_SECRET || '',
  appUrl: process.env.APP_DOWNLOAD_URL || '',
  appLabel: process.env.APP_DOWNLOAD_LABEL || 'Baixar aplicativo'
};
S.tst ||= []; S.ips ||= {}; S.tlog ||= [];
const PW = 'abcdefghjkmnpqrstuvwxyz23456789', DIA = 864e5;

async function limpaTestes() {
  const now = Date.now();
  for (const k in S.ips) if (S.ips[k] < now - DIA) delete S.ips[k];
  S.tlog = S.tlog.filter(x => x > now - DIA);
  for (const t of S.tst.filter(x => x.ate <= now)) {
    await sys('pkill', ['-KILL', '-u', t.u]).catch(() => { });
    await sys('userdel', [t.u]).catch(() => { });
    if (fs.readFileSync('/etc/passwd', 'utf8').split('\n').some(l => l.split(':')[0] === t.u)) continue;
    const m = readLimits(); if (m.delete(t.u)) writeLimits(m);
    S.tst = S.tst.filter(x => x.u !== t.u);
    dcDeleteUser(t.u).catch(() => { });
  }
  save();
}

if (T.on) {
  const tick = () => limpaTestes().catch(e => console.error('limpeza:', e.message));
  tick(); setInterval(tick, (+process.env.TESTE_LIMPEZA_MIN || 5) * 60e3);

  app.use('/teste', (req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
    next();
  });
  app.use('/teste', express.static(path.join(__dirname, 'public-teste')));
  app.get(['/teste', '/teste/'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public-teste', 'index.html'));
  });

  app.get('/api/config', (req, res) => res.json({
    horas: T.horas, whatsapp: T.wa, msg: T.msg, host: T.host, porta: T.sshPort, sitekey: T.tsKey || null,
    appUrl: T.appUrl || null, appLabel: T.appLabel || 'Baixar aplicativo'
  }));
  app.post('/api/teste', rateLimit({
    windowMs: 60e3, max: 5, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde um minuto.' }
  }), run(async req => {
    const now = Date.now(), ip = crypto.createHmac('sha256', SESSION_SECRET).update(String(req.ip)).digest('hex').slice(0, 32);
    if (S.ips[ip] > now - DIA) throw fail('Você já gerou um teste hoje. Para continuar, fale com a gente no WhatsApp.');
    if (S.tlog.filter(x => x > now - DIA).length >= T.max) throw fail('Os testes de hoje acabaram. Chame no WhatsApp que liberamos o seu.');
    if (T.tsSecret) {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: T.tsSecret, response: String((req.body || {}).token || ''), remoteip: String(req.ip) })
      }).then(x => x.json()).catch(() => ({}));
      if (!r.success) throw fail('Não foi possível confirmar que você é humano. Atualize a página e tente de novo.');
    }
    S.ips[ip] = now; S.tlog.push(now);
    const usuario = 'teste' + crypto.randomBytes(3).toString('hex'); let senha = '';
    for (const b of crypto.randomBytes(8)) senha += PW[b % PW.length];
    const ate = now + T.horas * 3600e3, dia = new Date(ate + DIA).toISOString().slice(0, 10);
    try {
      await sys('useradd', ['-M', '-s', '/bin/false', '-e', dia, usuario]);
      try { await sys('chpasswd', [], `${usuario}:${senha}\n`); } catch (e) { await sys('userdel', [usuario]).catch(() => { }); throw e; }
    } catch (e) { delete S.ips[ip]; S.tlog.pop(); throw e; }
    const m = readLimits(); m.set(usuario, T.limite); writeLimits(m);
    S.tst.push({ u: usuario, ate }); save();
    dcUpsertUser({ usuario, senha, limite: T.limite, expira: dia }).catch(e => console.warn('[DragonCore]', e.message));
    return { usuario, senha, host: T.host, porta: T.sshPort, ate, horas: T.horas };
  }));
  console.log('Teste grátis em /teste (mesma porta do painel)');
}

app.listen(PORT, HOST, () => console.log(`Painel em http://${HOST}:${PORT}`));
