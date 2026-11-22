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
async function dcUpsertUser(opts) {
  if (!DC.on) return { ok: false, error: 'DragonCore desativado' };
  if (!(await dcLogin())) return { ok: false, error: 'Falha no login DragonCore' };
  const body = {
    username: opts.usuario,
    max_connections: Math.max(0, parseInt(opts.limite, 10) || 0),
    expires_at: dcExpiresAt(opts.expira || '')
  };
  if (opts.senha) body.password = opts.senha;
  if (opts.limit_mbps_up != null) body.limit_mbps_up = Math.max(0, +opts.limit_mbps_up || 0);
  if (opts.limit_mbps_down != null) body.limit_mbps_down = Math.max(0, +opts.limit_mbps_down || 0);
  if (opts.data_quota_bytes != null) body.data_quota_bytes = Math.max(0, +opts.data_quota_bytes || 0);
  if (opts.quota_action) body.quota_action = opts.quota_action;
  if (opts.quota_throttle_mbps != null) body.quota_throttle_mbps = Math.max(0, +opts.quota_throttle_mbps || 0);
  if (opts.reset_usage) body.reset_usage = true;
  let r = await dcFetch('/api/users/create', { method: 'POST', body });
  if (r.status === 401) {
    if (await dcLogin(true)) r = await dcFetch('/api/users/create', { method: 'POST', body });
  }
  if (!r.ok && r.status !== 201) {
    console.warn('[DragonCore] upsert', opts.usuario, r.status, (r.text || '').slice(0, 200));
    return { ok: false, error: r.text || ('HTTP ' + r.status) };
  }
  return { ok: true };
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
async function dcResetTraffic(usuario) {
  if (!DC.on) return { ok: false, error: 'DragonCore desativado' };
  if (!(await dcLogin())) return { ok: false, error: 'Falha no login DragonCore' };
  let r = await dcFetch('/api/users/reset-traffic', { method: 'POST', body: { username: usuario } });
  if (r.status === 401) {
    if (await dcLogin(true)) r = await dcFetch('/api/users/reset-traffic', { method: 'POST', body: { username: usuario } });
  }
  if (!r.ok) return { ok: false, error: r.text || ('HTTP ' + r.status) };
  return { ok: true };
}
// metadados de tráfego/bloqueio por usuário (persistido em painel.json)
S.meta ||= {};
function userMeta(u) {
  if (!S.meta[u]) S.meta[u] = { blocked: false, mbps: 0 };
  return S.meta[u];
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
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: r => r.setHeader('Cache-Control', 'no-cache') }));
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

// ===== Monitoramento contínuo: ping + speedtest (Ookla / speedtest-go / speedtest-cli / Cloudflare) =====
const netStatus = {
  ping: { avg: null, min: null, max: null, loss: 0, at: 0, error: null },
  speed: { download: null, upload: null, latency: null, jitter: null, packetLoss: null, server: null, isp: null, resultUrl: null, at: 0, running: false, error: null },
  speedIntervalMs: 15 * 60e3 // speedtest automático a cada 15 min (recomendado)
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

// Motores, em ordem (SPEEDTEST_ENGINE=auto): Ookla "speedtest" (speedtest.net) → speedtest-go → speedtest-cli (python) → Cloudflare.
// Se o primeiro falhar ou não existir na VPS, o painel passa sozinho para o próximo. SPEEDTEST_ENGINE=ookla|go|cli|cloudflare fixa um só.
const SPEED_ENGINE = (process.env.SPEEDTEST_ENGINE || 'auto').toLowerCase();
const r2 = v => Math.round(Number(v) * 100) / 100;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const ms = v => { const n = num(v); return n == null ? null : r2(n > 1e5 ? n / 1e6 : n); };   // ns → ms (ou já em ms)
const nsMs = v => { const n = num(v); return n == null ? null : r2(n / 1e6); };   // speedtest-go: sempre nanossegundos
const lastLine = s => String(s || '').trim().split('\n').filter(Boolean).slice(-1)[0] || '';
const mbps = v => { const n = num(v); return n == null ? null : r2(n > 20000 ? n * 8 / 1e6 : n); };  // aceita Mbps ou bytes/s

async function runBin(names, args, timeout) {
  let last;
  for (const c of names) {
    try { return await execF(c, args, { timeout, maxBuffer: 16e6, env: { ...process.env, HOME: process.env.HOME || '/root' } }); }
    catch (e) { last = e; if (e.code !== 'ENOENT') break; }
  }
  const e = last || new Error('não encontrado');
  throw Object.assign(new Error(e.code === 'ENOENT' ? 'não instalado' : (lastLine(e.stderr) || lastLine(e.message) || 'falhou')), { missing: e.code === 'ENOENT' });
}
const jsonOf = out => { const i = out.indexOf('{'), j = out.lastIndexOf('}'); return JSON.parse(out.slice(i, j + 1)); };

function parseSpeed(j) {
  if (j && j.type === 'result' || (j && j.download && typeof j.download === 'object')) {   // Ookla (speedtest.net)
    return { download: mbps((j.download.bandwidth * 8) / 1e6), upload: mbps((j.upload.bandwidth * 8) / 1e6), latency: ms(j.ping && j.ping.latency), jitter: ms(j.ping && j.ping.jitter),
      packetLoss: num(j.packetLoss), server: j.server ? [j.server.name, j.server.location].filter(Boolean).join(' - ') : null, isp: j.isp || null, resultUrl: (j.result && j.result.url) || null };
  }
  if (j && j.servers) {   // speedtest-go
    const s = j.servers[0] || {}, pl = s.packet_loss || {};
    return { download: mbps(s.dl_speed), upload: mbps(s.ul_speed), latency: nsMs(s.latency), jitter: nsMs(s.jitter),
      packetLoss: pl.lost != null && pl.sent > 0 ? r2(pl.lost / pl.sent * 100) : null,
      server: s.name ? s.name + (s.sponsor ? ' - ' + s.sponsor : '') : null, isp: (j.user_info && (j.user_info.isp || j.user_info.Isp)) || null, resultUrl: null };
  }
  if (j && j.download != null && j.server) {   // speedtest-cli (python): bits/s
    return { download: r2(j.download / 1e6), upload: r2(j.upload / 1e6), latency: ms(j.ping), jitter: null, packetLoss: null,
      server: [j.server.name, j.server.sponsor].filter(Boolean).join(' - ') || null, isp: (j.client && j.client.isp) || null, resultUrl: j.share || null };
  }
  throw new Error('saída desconhecida');
}

const SPEED_ENGINES = {
  ookla: async () => {
    try { return parseSpeed(jsonOf(await runBin(['speedtest'], ['--accept-license', '--accept-gdpr', '-f', 'json'], 100000))); }
    catch (e) { if (e.missing) throw e; return parseSpeed(jsonOf(await runBin(['speedtest'], ['--json'], 100000))); }   // "speedtest" do pip (speedtest-cli)
  },
  go: async () => parseSpeed(jsonOf(await runBin(['speedtest-go', (process.env.HOME || '/root') + '/go/bin/speedtest-go', '/usr/local/bin/speedtest-go'], ['--json'], 120000))),
  cli: async () => parseSpeed(jsonOf(await runBin(['speedtest-cli'], ['--json'], 120000))),
  cloudflare: async () => {
    const dl = await runBin(['curl'], ['-o', '/dev/null', '-s', '-S', '-w', '%{speed_download} %{size_download}', '--max-time', '30', 'https://speed.cloudflare.com/__down?bytes=25000000'], 40000);
    const [dBps, dSize] = dl.trim().split(/\s+/).map(Number);
    let ul = null;
    try {
      const f = require('path').join(require('os').tmpdir(), 'painel-up.bin');
      if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(8 * 1024 * 1024));
      const up = await runBin(['curl'], ['-o', '/dev/null', '-s', '-S', '-w', '%{speed_upload} %{size_upload}', '--max-time', '30', '-H', 'Content-Type: application/octet-stream', '--data-binary', '@' + f, 'https://speed.cloudflare.com/__up'], 40000);
      const [uBps, uSize] = up.trim().split(/\s+/).map(Number); if (uSize > 0) ul = r2(uBps * 8 / 1e6);
    } catch { }
    if (!(dSize > 0)) throw new Error('sem resposta da Cloudflare');
    return { download: r2(dBps * 8 / 1e6), upload: ul, latency: netStatus.ping.avg, jitter: null, packetLoss: netStatus.ping.loss, server: 'Cloudflare', isp: null, resultUrl: null };
  }
};

async function doSpeedtest() {
  if (netStatus.speed.running) return;
  netStatus.speed.running = true;
  const order = SPEED_ENGINE !== 'auto' && SPEED_ENGINES[SPEED_ENGINE] ? [SPEED_ENGINE] : ['ookla', 'go', 'cli', 'cloudflare'];
  const fails = [];
  try {
    for (const name of order) {
      try {
        const r = await SPEED_ENGINES[name]();
        if (!(r.download > 0) && !(r.upload > 0)) throw new Error('resultado vazio');
        netStatus.speed = { ...r, engine: name, at: Date.now(), running: false, error: null };
        if (fails.length) console.warn('[speedtest] usando "' + name + '" · antes falhou: ' + fails.join(' | '));
        return;
      } catch (e) { fails.push(name + ': ' + e.message); }
    }
    netStatus.speed = { ...netStatus.speed, at: Date.now(), error: fails.join(' · ') };
    console.error('[speedtest] todos os motores falharam → ' + fails.join(' | '));
  } finally { netStatus.speed.running = false; }
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
  S.meta ||= {};
  const rows = sysUsers().map(u => {
    const m = S.meta[u.usuario] || {};
    return {
      ...u,
      limite: lim.get(u.usuario) ?? 1,
      revenda: own.get(u.usuario) || (S.tst && S.tst.some(t => t.u === u.usuario) ? 'teste grátis' : (S.pedidos && S.pedidos.some(p => p.usuario === u.usuario) ? 'compra online' : null)),
      blocked: !!m.blocked,
      mbps: m.mbps || 0,
      ...xrayInfo(u.usuario)
    };
  });
  return req.session.role === 'rev' ? rows.filter(u => u.revenda === req.session.name) : rows;
}
const mustOwn = (req, name) => { if (!visible(req).some(u => u.usuario === name)) throw fail('Usuário não encontrado.'); };
app.get('/api/users', auth, run(req => {
  const q = String(req.query.q || '').slice(0, 60).toLowerCase();
  return { rows: visible(req).filter(u => u.usuario.toLowerCase().includes(q)), xray: XR.on };
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
  if (String((req.body || {}).xray) !== 'n') xrayEnsure(usuario);   // "Vincular ao Xray?" = Não pula o UUID
  return { ok: true, ...xrayInfo(usuario) };
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
  xrayKick(1500);
  return { ok: true };
}));
app.delete('/api/users/:name', auth, csrf, run(async req => {
  const u = req.params.name; mustOwn(req, u);
  await sys('pkill', ['-KILL', '-u', u]).catch(() => { });
  await sys('userdel', [u]);
  const m = readLimits(); if (m.delete(u)) writeLimits(m);
  if (u in S.map) { delete S.map[u]; }
  if (S.meta && S.meta[u]) delete S.meta[u];
  delete S.xray[u];
  save();
  xrayKick(1500);
  dcDeleteUser(u).catch(e => console.warn('[DragonCore]', e.message));
  return { ok: true };
}));
app.post('/api/users/:name/uuid', auth, csrf, run(async req => {
  if (!XR.on) throw fail('O UUID do V2Ray não está ativado (XRAY_ENABLED=1 no .env).');
  const u = req.params.name; mustOwn(req, u);
  const id = xrayEnsure(u, !!(req.body || {}).novo);
  return { ok: true, uuid: id, link: xrayLink(u, id) };
}));

// ===== Bloquear / limitar tráfego (Linux real + usuarios.db + DragonCore) =====
// usuarios.db sozinho NÃO impede login. Trava de verdade no sistema:
// passwd -l + usermod -L + shell nologin + chage expirado + pkill
function readUserShell(u) {
  try {
    const line = fs.readFileSync('/etc/passwd', 'utf8').split('\n').find(l => l.startsWith(u + ':'));
    return line ? (line.split(':')[6] || '/bin/false') : '/bin/false';
  } catch { return '/bin/false'; }
}
function isAccountLocked(u) {
  try {
    // passwd -S: "user L ..." = locked, "user P ..." = usable password
    const out = require('child_process').execFileSync('passwd', ['-S', u], { encoding: 'utf8', timeout: 5000 });
    return /\sL\s/.test(out) || out.includes(' locked');
  } catch {
    try {
      const line = fs.readFileSync('/etc/shadow', 'utf8').split('\n').find(l => l.startsWith(u + ':'));
      if (!line) return false;
      const hash = line.split(':')[1] || '';
      return hash.startsWith('!') || hash.startsWith('*') || hash === '';
    } catch { return false; }
  }
}

app.post('/api/users/:name/block', auth, csrf, run(async req => {
  const u = req.params.name; mustOwn(req, u);
  const lim = readLimits().get(u) || 1;
  // IMPORTANTE: ler validade ANTES de dar chage -E 1970 (senão perde a data)
  const expRaw = (sysUsers().find(x => x.usuario === u) || {}).expira;
  const exp = (expRaw && DATE.test(String(expRaw)) && String(expRaw) !== '1970-01-01')
    ? String(expRaw)
    : '';
  const meta = userMeta(u);
  if (!meta.blocked) {
    meta.prevLimite = lim > 0 ? lim : (meta.prevLimite || 1);
    // '' = nunca expirou; 'YYYY-MM-DD' = data original
    meta.prevExpira = exp;
    meta.prevShell = readUserShell(u);
  } else if (meta.prevExpira == null || meta.prevExpira === '1970-01-01') {
    // bloqueio antigo sem data salva — guarda se ainda houver uma data válida
    if (exp) meta.prevExpira = exp;
  }
  meta.blocked = true;
  // persiste meta ANTES das mudanças destrutivas no sistema
  const db = readLimits(); db.set(u, 0); writeLimits(db);
  save();
  // trava senha
  await sys('passwd', ['-l', u]).catch(e => console.warn('passwd -l:', e.message));
  await sys('usermod', ['-L', u]).catch(e => console.warn('usermod -L:', e.message));
  // shell nologin/false
  await sys('usermod', ['-s', '/usr/sbin/nologin', u]).catch(() =>
    sys('usermod', ['-s', '/bin/false', u]).catch(e => console.warn('usermod -s:', e.message))
  );
  // expira conta (só depois de salvar prevExpira)
  await sys('chage', ['-E', '1970-01-01', u]).catch(() =>
    sys('chage', ['-E', '0', u]).catch(e => console.warn('chage:', e.message))
  );
  await sys('pkill', ['-KILL', '-u', u]).catch(() => { });
  const locked = isAccountLocked(u);
  if (!locked) {
    throw fail('Não foi possível travar a conta no Linux (passwd/usermod). Rode como root e confira: passwd -S ' + u);
  }
  let warning = null;
  if (DC.on) {
    const r = await dcUpsertUser({
      usuario: u, limite: 0, expira: '1970-01-01',
      limit_mbps_up: 0, limit_mbps_down: 0
    });
    if (!r.ok) {
      const msg = String(r.error || '');
      if (/password|totp|novo usuário|new user/i.test(msg)) {
        warning = 'Travado no Linux (login deve falhar). DragonCore: user não existe lá — se o app usa só o Dragon, sincronize o user.';
      } else {
        warning = 'Travado no Linux. DragonCore: ' + msg;
      }
      console.warn('[DragonCore] block', u, msg);
    }
  }
  xrayKick(1500);
  return { ok: true, blocked: true, locked: true, prevExpira: meta.prevExpira || null, warning };
}));

app.post('/api/users/:name/unblock', auth, csrf, run(async req => {
  const u = req.params.name; mustOwn(req, u);
  const meta = userMeta(u);
  const lim = meta.prevLimite > 0 ? meta.prevLimite : 1;
  // data salva no bloqueio (não reler do sistema — lá está 1970)
  let exp = meta.prevExpira || '';
  if (exp === '1970-01-01') exp = '';
  const shell = meta.prevShell || '/bin/false';
  meta.blocked = false;
  const db = readLimits(); db.set(u, lim); writeLimits(db);
  save();
  // destrava senha
  await sys('passwd', ['-u', u]).catch(e => console.warn('passwd -u:', e.message));
  await sys('usermod', ['-U', u]).catch(e => console.warn('usermod -U:', e.message));
  // restaura shell
  await sys('usermod', ['-s', shell, u]).catch(e => console.warn('usermod -s restore:', e.message));
  // restaura expiração: data original OU -1 (nunca)
  if (exp && DATE.test(exp)) {
    await sys('chage', ['-E', exp, u]).catch(e => console.warn('chage restore date:', e.message));
  } else {
    await sys('chage', ['-E', '-1', u]).catch(e => console.warn('chage restore never:', e.message));
  }
  let warning = null;
  if (DC.on) {
    const r = await dcUpsertUser({
      usuario: u, limite: lim, expira: exp,
      limit_mbps_up: meta.mbps || 0, limit_mbps_down: meta.mbps || 0
    });
    if (!r.ok) {
      const msg = String(r.error || '');
      if (/password|totp|novo usuário|new user/i.test(msg)) {
        warning = 'Liberado no Linux. DragonCore: user não existe lá.';
      } else {
        warning = 'Liberado no Linux. DragonCore: ' + msg;
      }
      console.warn('[DragonCore] unblock', u, msg);
    }
  }
  xrayKick(1500);
  return { ok: true, blocked: false, limite: lim, expira: exp || null, warning };
}));

app.post('/api/users/:name/throttle', auth, csrf, run(async req => {
  const u = req.params.name; mustOwn(req, u);
  if (!DC.on) throw fail('DragonCore não está ativo. Ative no .env (DRAGONCORE_ENABLED=1).');
  const mbps = Math.max(0, Math.min(1000000, parseInt((req.body || {}).mbps, 10) || 1));
  const lim = readLimits().get(u) || 1;
  const exp = (sysUsers().find(x => x.usuario === u) || {}).expira || '';
  const meta = userMeta(u);
  meta.mbps = mbps;
  if (meta.blocked) meta.blocked = false;
  save();
  const r = await dcUpsertUser({
    usuario: u, limite: lim, expira: exp,
    limit_mbps_up: mbps, limit_mbps_down: mbps,
    quota_action: 'throttle', quota_throttle_mbps: mbps
  });
  if (!r.ok) throw fail('DragonCore: ' + (r.error || 'falha ao limitar tráfego'));
  return { ok: true, mbps };
}));

app.post('/api/users/:name/unthrottle', auth, csrf, run(async req => {
  const u = req.params.name; mustOwn(req, u);
  if (!DC.on) throw fail('DragonCore não está ativo.');
  const lim = readLimits().get(u) || 1;
  const exp = (sysUsers().find(x => x.usuario === u) || {}).expira || '';
  const meta = userMeta(u);
  meta.mbps = 0;
  save();
  const r = await dcUpsertUser({
    usuario: u, limite: lim, expira: exp,
    limit_mbps_up: 0, limit_mbps_down: 0
  });
  if (!r.ok) throw fail('DragonCore: ' + (r.error || 'falha ao remover limite'));
  return { ok: true, mbps: 0 };
}));

app.post('/api/users/:name/reset-traffic', auth, csrf, run(async req => {
  const u = req.params.name; mustOwn(req, u);
  if (!DC.on) throw fail('DragonCore não está ativo.');
  const r = await dcResetTraffic(u);
  if (!r.ok) throw fail('DragonCore: ' + (r.error || 'falha ao zerar tráfego'));
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

// ===== V2Ray / Xray (VLESS): o UUID nasce junto com o usuário =====
// .env: XRAY_ENABLED=1  (opcional: XRAY_CONFIG, XRAY_INBOUND_TAG, XRAY_FLOW, XRAY_LINK, XRAY_RESTART_CMD, XRAY_BIN, XRAY_SKIP_TEST)
// O painel guarda o UUID de cada usuário e mantém o config do Xray igual: entra quando o usuário é criado/renovado,
// sai quando é bloqueado, expira ou é excluído. Clientes criados à mão (sem "@painel" no email) nunca são tocados.
const XR = {
  on: process.env.XRAY_ENABLED === '1',
  path: process.env.XRAY_CONFIG || '/usr/local/etc/xray/config.json',
  tag: process.env.XRAY_INBOUND_TAG || '',
  flow: process.env.XRAY_FLOW || '',
  bin: process.env.XRAY_BIN || 'xray',
  restart: process.env.XRAY_RESTART_CMD || 'systemctl restart xray',
  link: process.env.XRAY_LINK || '',
  skipTest: process.env.XRAY_SKIP_TEST === '1'
};
S.xray ||= {};
const XR_MAIL = '@painel';
function xrayLink(usuario, uuid) {
  if (!XR.link || !uuid) return '';
  const host = T.host || process.env.SERVER_HOST || '';
  return XR.link.replace(/\{uuid\}/g, uuid).replace(/\{usuario\}/g, encodeURIComponent(usuario)).replace(/\{host\}/g, host);
}
function xrayInfo(usuario) { const id = XR.on ? S.xray[usuario] : null; return id ? { uuid: id, link: xrayLink(usuario, id) } : {}; }
function xrayEnsure(usuario, novo) {
  if (!XR.on) return null;
  if (!S.xray[usuario] || novo) { S.xray[usuario] = crypto.randomUUID(); save(); }
  xrayKick(); return S.xray[usuario];
}
let xrayTimer = null, xrayBusy = false, xrayAgain = false, xrayWarned = false;
function xrayKick(ms = 4000) {
  if (!XR.on) return;
  clearTimeout(xrayTimer);
  xrayTimer = setTimeout(() => xraySync().catch(e => console.error('[Xray]', e.message)), ms);
}
async function xraySync() {
  if (!XR.on) return;
  if (xrayBusy) { xrayAgain = true; return; }
  xrayBusy = true;
  try { do { xrayAgain = false; await xrayApply(); } while (xrayAgain); } finally { xrayBusy = false; }
}
const execF = (cmd, args, opts = {}) => new Promise((ok, no) => require('child_process').execFile(cmd, args, { timeout: 20000, ...opts }, (e, out, err) => e ? no(Object.assign(e, { stderr: String(err || out || '') })) : ok(out)));
async function xrayApply() {
  const users = new Map(sysUsers().map(u => [u.usuario, u])), hoje = new Date().toISOString().slice(0, 10);
  let reg = false;
  for (const u of Object.keys(S.xray)) if (!users.has(u)) { delete S.xray[u]; reg = true; }   // usuário não existe mais
  if (reg) save();
  const want = new Map();
  for (const [u, id] of Object.entries(S.xray)) {
    const x = users.get(u);
    if ((S.meta[u] || {}).blocked || (x.expira && x.expira < hoje)) continue;               // bloqueado ou vencido: sem acesso
    want.set(u + XR_MAIL, id);
  }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(XR.path, 'utf8')); }
  catch (e) { console.error('[Xray] não consegui ler ' + XR.path + ': ' + e.message + ' (o config precisa ser JSON puro, sem comentários)'); return; }
  const inbs = (cfg.inbounds || []).filter(i => i.protocol === 'vless' && (!XR.tag || i.tag === XR.tag));
  if (!inbs.length) { if (!xrayWarned) { xrayWarned = true; console.warn('[Xray] nenhum inbound VLESS' + (XR.tag ? ' com tag "' + XR.tag + '"' : '') + ' em ' + XR.path); } return; }
  let changed = false, add = 0, del = 0;
  for (const ib of inbs) {
    ib.settings = ib.settings || {};
    const cl = Array.isArray(ib.settings.clients) ? ib.settings.clients : [];
    const out = cl.filter(c => !String(c.email || '').endsWith(XR_MAIL) || want.get(c.email) === c.id);
    del += cl.length - out.length;
    const have = new Set(out.map(c => c.email));
    for (const [email, id] of want) if (!have.has(email)) { out.push({ id, email, level: 0, ...(XR.flow ? { flow: XR.flow } : {}) }); add++; }
    if (out.length !== cl.length || out.some((c, i) => c !== cl[i]) || !Array.isArray(ib.settings.clients)) { ib.settings.clients = out; changed = true; }
  }
  if (!changed) return;
  const st = fs.statSync(XR.path), tmp = XR.path.replace(/\.json$/, '') + '.painel-tmp.json';
  fs.copyFileSync(XR.path, XR.path + '.painel-bak');
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: st.mode & 0o777 });
  try { fs.chownSync(tmp, st.uid, st.gid); } catch { }
  if (!XR.skipTest) {
    try { await execF(XR.bin, ['run', '-test', '-format', 'json', '-config', tmp]); }
    catch (e) {
      if (e.code !== 'ENOENT') { fs.rmSync(tmp, { force: true }); console.error('[Xray] config novo REPROVADO no teste, nada foi alterado: ' + String(e.stderr || e.message).trim().split('\n').slice(-3).join(' | ')); return; }
    }
  }
  fs.renameSync(tmp, XR.path);
  console.log('[Xray] config atualizado (+' + add + ' / -' + del + ' clientes) · reiniciando o Xray');
  try { await execF('sh', ['-c', XR.restart]); } catch (e) { console.error('[Xray] falhou ao reiniciar (' + XR.restart + '): ' + String(e.stderr || e.message).trim()); }
}
if (XR.on) {
  setTimeout(() => xrayKick(0), 8000).unref();
  setInterval(() => xrayKick(0), 5 * 60e3).unref();   // pega vencimentos
  console.log('[Xray] UUID automático ativo → ' + XR.path);
} else if (fs.existsSync(XR.path)) {
  console.log('[Xray] config encontrado em ' + XR.path + ' — para gerar UUID junto com o usuário, ponha XRAY_ENABLED=1 no .env');
}

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
  xrayKick(1000);
}

if (T.on) {
  const tick = () => limpaTestes().catch(e => console.error('limpeza:', e.message));
  tick(); setInterval(tick, (+process.env.TESTE_LIMPEZA_MIN || 5) * 60e3);

  app.use('/teste', (req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'");
    next();
  });
  app.use('/teste', express.static(path.join(__dirname, 'public-teste'), { setHeaders: r => r.setHeader('Cache-Control', 'no-cache') }));
  app.get(['/teste', '/teste/'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public-teste', 'index.html'));
  });

  app.get('/api/config', (req, res) => res.json({
    horas: T.horas, whatsapp: T.wa, msg: T.msg, host: T.host, porta: T.sshPort, sitekey: T.tsKey || null,
    appUrl: T.appUrl || null, appLabel: T.appLabel || 'Baixar aplicativo',
    planos: SALE.on ? SALE.planos.map(({ id, nome, dias, preco, limite, destaque }) => ({ id, nome, dias, preco, limite, destaque })) : []
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
    xrayEnsure(usuario);
    return { usuario, senha, host: T.host, porta: T.sshPort, ate, horas: T.horas, ...xrayInfo(usuario) };
  }));
  console.log('Teste grátis em /teste (mesma porta do painel)');
}

// ===== Vendas online (Mercado Pago · Checkout Pro + webhook) =====
// .env: MP_ACCESS_TOKEN, PUBLIC_URL, PLANOS="Mensal:30:29.90:1;Trimestral*:90:79.90:1"  (opcional: MP_WEBHOOK_SECRET)
const SALE = {
  token: process.env.MP_ACCESS_TOKEN || '', secret: process.env.MP_WEBHOOK_SECRET || '',
  url: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  api: (process.env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/+$/, ''),
  planos: (process.env.PLANOS || '').split(';').map(s => s.trim()).filter(Boolean).map((s, i) => {
    const star = s.includes('*');   // "*" em qualquer lugar do plano = destaque
    const [nome = '', dias, preco, limite] = s.replace(/\*/g, '').split(':').map(x => x.trim());
    return {
      id: 'p' + (i + 1), nome: nome.slice(0, 40), destaque: star,
      dias: parseInt(dias, 10), preco: Math.round(parseFloat(String(preco).replace(',', '.')) * 100) / 100, limite: parseInt(limite, 10) || 1
    };
  }).filter(p => p.nome && p.dias >= 1 && p.dias <= 3650 && p.preco >= 1 && p.limite >= 1 && p.limite <= 1000)
};
SALE.on = !!(SALE.token && /^https?:\/\//.test(SALE.url) && SALE.planos.length);
S.pedidos ||= [];

async function mp(method, p, body, extra) {
  const r = await fetch(SALE.api + p, {
    method, headers: { Authorization: 'Bearer ' + SALE.token, 'Content-Type': 'application/json', ...(extra || {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('MercadoPago ' + r.status + ': ' + (d.message || d.error || 'erro'));
  return d;
}

// Cria a conta paga (só chamada com pagamento aprovado e valor conferido)
// Renovação: soma os dias da compra à validade atual da conta (ou a partir de hoje, se já venceu)
async function renovaConta(o, pay) {
  const u = o.renovacao, su = sysUsers().find(x => x.usuario === u);
  if (!su) throw new Error('usuário da renovação não existe mais: ' + u);
  const hoje = new Date().toISOString().slice(0, 10), meta = userMeta(u);
  const atual = meta.blocked ? (meta.prevExpira || '') : (su.expira || '');
  const base = atual && atual > hoje ? Date.parse(atual + 'T00:00:00Z') : Date.now();
  const dia = new Date(base + o.plano.dias * DIA).toISOString().slice(0, 10);
  if (meta.blocked) { meta.prevExpira = dia; meta.prevLimite = o.plano.limite; }   // bloqueada pelo admin: vale quando desbloquear
  else {
    await setExpiry(u, dia);
    const m = readLimits(); m.set(u, o.plano.limite); writeLimits(m);
    dcUpsertUser({ usuario: u, limite: o.plano.limite, expira: dia }).catch(e => console.warn('[DragonCore]', e.message));
  }
  S.tst = S.tst.filter(t => t.u !== u);   // conta de teste que renova deixa de ser apagada
  Object.assign(o, { status: 'pago', pagoEm: Date.now(), pagamento: String(pay.id), usuario: u, expira: dia });
  save(); xrayEnsure(u); xrayKick(1500);
  console.log('[MP] pedido ' + o.id + ' pago · renovação ' + o.plano.nome + ' · usuário ' + u + ' até ' + dia);
}
async function entregaPedido(o, pay) {
  if (o.renovacao) return renovaConta(o, pay);
  const passwd = () => fs.readFileSync('/etc/passwd', 'utf8').split('\n').map(l => l.split(':')[0]);
  let usuario = '';
  for (let i = 0; i < 5 && !usuario; i++) { const u = 'cli' + crypto.randomBytes(3).toString('hex'); if (!passwd().includes(u)) usuario = u; }
  if (!usuario) throw new Error('não foi possível gerar usuário único');
  let senha = ''; for (const b of crypto.randomBytes(10)) senha += PW[b % PW.length];
  const dia = new Date(Date.now() + o.plano.dias * DIA).toISOString().slice(0, 10);
  await sys('useradd', ['-M', '-s', '/bin/false', '-e', dia, usuario]);
  try { await sys('chpasswd', [], `${usuario}:${senha}\n`); } catch (e) { await sys('userdel', [usuario]).catch(() => { }); throw e; }
  const m = readLimits(); m.set(usuario, o.plano.limite); writeLimits(m);
  Object.assign(o, { status: 'pago', pagoEm: Date.now(), pagamento: String(pay.id), usuario, senha, expira: dia });
  save();
  xrayEnsure(usuario);
  dcUpsertUser({ usuario, senha, limite: o.plano.limite, expira: dia }).catch(e => console.warn('[DragonCore]', e.message));
  console.log('[MP] pedido ' + o.id + ' pago · ' + o.plano.nome + ' · usuário ' + usuario);
}

const trava = new Set();
async function aplicaPagamento(pay) {
  const o = S.pedidos.find(x => x.id === String(pay.external_reference || ''));
  if (!o) return 'ignorado';
  if (trava.has(o.id)) return 'ocupado';
  trava.add(o.id);
  try {
    if (pay.status === 'approved') {
      if (o.status === 'pago') return 'ok';
      if (pay.currency_id !== 'BRL' || Number(pay.transaction_amount) + 0.001 < o.plano.preco) {
        o.status = 'divergente'; o.pagamento = String(pay.id); save();
        console.warn('[MP] valor divergente no pedido ' + o.id + ': pago ' + pay.transaction_amount + ' ' + pay.currency_id + ', esperado ' + o.plano.preco);
        return 'divergente';
      }
      await entregaPedido(o, pay);
      return 'entregue';
    }
    if ((pay.status === 'refunded' || pay.status === 'charged_back') && o.status === 'pago' && o.pagamento === String(pay.id)) {
      o.status = 'estornado'; save();
      console.warn('[MP] pagamento ' + pay.id + ' ' + pay.status + ' — pedido ' + o.id + ' (usuário ' + o.usuario + ' continua ativo; revise no painel)');
      return 'estornado';
    }
    return 'pendente';
  } finally { trava.delete(o.id); }
}
// Plano B: se o webhook atrasar/falhar, consulta o Mercado Pago direto pelo pedido
async function reconcilia(o) {
  const r = await mp('GET', '/v1/payments/search?sort=date_created&criteria=desc&external_reference=' + o.id);
  const ok = (r.results || []).find(p => p.status === 'approved');
  if (ok) await aplicaPagamento(ok);
}
function assinaturaOk(req, pid) {
  const h = String(req.get('x-signature') || ''), ts = (h.match(/ts=(\d+)/) || [])[1], v1 = (h.match(/v1=([0-9a-f]+)/) || [])[1];
  if (!ts || !v1) return false;
  const manifest = `id:${pid.toLowerCase()};request-id:${req.get('x-request-id') || ''};ts:${ts};`;
  return eq(crypto.createHmac('sha256', SALE.secret).update(manifest).digest('hex'), v1);
}

// Cria o pedido (compra nova ou renovação) e devolve Pix ou link de pagamento
async function criaPedido(body, extra = {}) {
    const plano = SALE.planos.find(p => p.id === String(body.plano || ''));
    if (!plano) throw fail('Plano inválido.');
    if (S.pedidos.filter(o => o.status === 'pendente').length > 500) throw fail('Muitos pedidos em aberto. Tente mais tarde.');
    const id = crypto.randomBytes(12).toString('hex'), volta = SALE.url + (extra.renovacao ? '/cliente/' : '/teste') + '?pedido=' + id;
    if (String(body.metodo) === 'pix') {
      // Pix direto na página: QR Code + "copia e cola" (Mercado Pago /v1/payments)
      const ate = Date.now() + 30 * 60e3, exp = new Date(ate - 3 * 3600e3).toISOString().replace('Z', '-03:00');
      const pay = await mp('POST', '/v1/payments', {
        transaction_amount: plano.preco, description: ((extra.renovacao ? 'Renovação ' : 'Acesso ') + plano.nome + ' · ' + plano.dias + ' dias').slice(0, 250), payment_method_id: 'pix',
        payer: { email: 'pedido-' + id.slice(0, 10) + '@' + (new URL(SALE.url).hostname.includes('.') ? new URL(SALE.url).hostname : 'example.com') },
        external_reference: id, notification_url: SALE.url + '/api/mp/webhook', date_of_expiration: exp
      }, { 'X-Idempotency-Key': id });
      const td = (pay.point_of_interaction && pay.point_of_interaction.transaction_data) || {};
      if (!td.qr_code) throw new Error('MercadoPago não devolveu o código Pix');
      S.pedidos.push({ id, plano: { nome: plano.nome, dias: plano.dias, preco: plano.preco, limite: plano.limite }, status: 'pendente', criado: Date.now(), ...extra, metodo: 'pix', pixId: String(pay.id), pix: { codigo: td.qr_code, qr: td.qr_code_base64 || '', ate } });
      save();
      return { id, pix: { codigo: td.qr_code, qr: td.qr_code_base64 || '', ate } };
    }
    const r = await mp('POST', '/checkout/preferences', {
      items: [{ id: plano.id, title: ((extra.renovacao ? 'Renovação ' : 'Acesso ') + plano.nome + ' · ' + plano.dias + ' dias').slice(0, 250), quantity: 1, unit_price: plano.preco, currency_id: 'BRL' }],
      external_reference: id, notification_url: SALE.url + '/api/mp/webhook',
      back_urls: { success: volta, pending: volta, failure: volta }, auto_return: 'approved'
    });
    const url = r.init_point;
    if (!url) throw new Error('MercadoPago não devolveu o link de pagamento');
    S.pedidos.push({ id, plano: { nome: plano.nome, dias: plano.dias, preco: plano.preco, limite: plano.limite }, status: 'pendente', criado: Date.now(), ...extra, pref: r.id, url });
    save();
    return { id, url };
}

if (SALE.on) {
  app.post('/api/pedidos', rateLimit({
    windowMs: 60e3, max: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde um minuto.' }
  }), run(async req => criaPedido(req.body || {})));


  app.get('/api/pedidos/:id', rateLimit({
    windowMs: 60e3, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas consultas. Aguarde um instante.' }
  }), run(async req => {
    const id = String(req.params.id || ''), o = /^[0-9a-f]{24}$/.test(id) && S.pedidos.find(x => x.id === id);
    if (!o) throw fail('Pedido não encontrado.');
    if (o.status === 'pendente' && Date.now() - (o.ck || 0) > 8000) { o.ck = Date.now(); await reconcilia(o).catch(e => console.warn('[MP] consulta:', e.message)); }
    const out = { status: o.status, plano: o.plano.nome, dias: o.plano.dias };
    if (o.status === 'pendente') { if (o.pix) { out.pix = o.pix; out.expirado = Date.now() > o.pix.ate + 60e3; } else out.url = o.url; }
    if (o.status === 'pago') { if (o.renovacao) out.renovacao = true; out.usuario = o.usuario; out.expira = o.expira; out.limite = o.plano.limite; if (o.senha) out.senha = o.senha; Object.assign(out, xrayInfo(o.usuario)); }
    return out;
  }));

  app.post('/api/mp/webhook', rateLimit({ windowMs: 60e3, max: 120, standardHeaders: false, legacyHeaders: false }), async (req, res) => {
    try {
      const q = req.query || {}, b = req.body || {};
      const type = String(b.type || q.type || q.topic || ''), pid = String((b.data && b.data.id) || q['data.id'] || (q.topic === 'payment' ? q.id : '') || '');
      if (type !== 'payment' || !/^\d{1,20}$/.test(pid)) return res.sendStatus(200);
      if (SALE.secret && !assinaturaOk(req, pid)) { console.warn('[MP] webhook com assinatura inválida (confira MP_WEBHOOK_SECRET)'); return res.sendStatus(401); }
      const pay = await mp('GET', '/v1/payments/' + pid);
      await aplicaPagamento(pay);
      res.sendStatus(200);
    } catch (e) { console.error('[MP] webhook:', e.message); res.sendStatus(500); }
  });

  setInterval(() => {
    const now = Date.now(), n = S.pedidos.length; let ch = false;
    for (const o of S.pedidos) if (o.senha && o.pagoEm && now - o.pagoEm > DIA) { delete o.senha; ch = true; }
    S.pedidos = S.pedidos.filter(o => !(o.status === 'pendente' && now - o.criado > 3 * DIA));
    if (ch || n !== S.pedidos.length) save();
  }, 10 * 60e3).unref();
  console.log('Vendas online (Mercado Pago) ativas · ' + SALE.planos.length + ' plano(s) · webhook em ' + SALE.url + '/api/mp/webhook');
} else if (process.env.MP_ACCESS_TOKEN || process.env.PLANOS) {
  console.warn('[MP] vendas desativadas: confira MP_ACCESS_TOKEN, PUBLIC_URL e PLANOS no .env');
}

// ===== Área do cliente: /cliente (entra com o usuário e a senha do próprio acesso) =====
// ===== Avisos de vencimento por notificação push (3 dias, 1 dia e no dia) =====
let WP = null; try { WP = require('web-push'); } catch { }
const PUSH = {
  on: !!WP && process.env.PUSH_AVISOS !== '0',
  dias: (process.env.PUSH_DIAS || '3,1,0').split(',').map(x => parseInt(x, 10)).filter(n => n >= 0),
  tz: Number.isFinite(parseFloat(process.env.PUSH_TZ)) ? parseFloat(process.env.PUSH_TZ) : -3,   // fuso do servidor em horas (Brasília = -3)
  de: Number.isFinite(parseInt(process.env.PUSH_HORA_DE, 10)) ? parseInt(process.env.PUSH_HORA_DE, 10) : 9, ate: Number.isFinite(parseInt(process.env.PUSH_HORA_ATE, 10)) ? parseInt(process.env.PUSH_HORA_ATE, 10) : 20,
  contato: process.env.PUSH_CONTATO || (/^https:/.test(process.env.PUBLIC_URL || '') ? process.env.PUBLIC_URL : 'mailto:admin@example.com'),
  hosts: /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|push\.apple\.com|notify\.windows\.com|windows\.com)\//i
};
if (PUSH.on) {
  S.push = S.push || {}; S.push.subs = S.push.subs || {}; S.push.sent = S.push.sent || {};
  if (!S.push.vapid) { S.push.vapid = WP.generateVAPIDKeys(); save(); }
  try { WP.setVapidDetails(PUSH.contato, S.push.vapid.publicKey, S.push.vapid.privateKey); } catch (e) { console.error('push desativado:', e.message); PUSH.on = false; }
}
async function pushTo(u, payload) {
  const list = ((S.push.subs[u]) || []).slice(); let ok = 0, mudou = false;
  for (const s of list) {
    try { await WP.sendNotification(s, JSON.stringify(payload), { TTL: 86400 }); ok++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { S.push.subs[u] = (S.push.subs[u] || []).filter(x => x.endpoint !== s.endpoint); mudou = true; }
      else console.error('push:', e.statusCode || e.message);
    }
  }
  if (S.push.subs[u] && !S.push.subs[u].length) delete S.push.subs[u];
  if (mudou) save();
  return ok;
}
const pushTexto = d => d <= 0 ? ['Seu acesso vence hoje', 'Renove agora para não ficar sem conexão.'] : d === 1 ? ['Seu acesso vence amanhã', 'Falta 1 dia. Renove com Pix ou cartão e continue conectado.'] : ['Seu acesso vence em ' + d + ' dias', 'Renove com Pix ou cartão e os dias são somados à sua validade.'];
async function avisaVencimentos() {
  if (!PUSH.on) return;
  const agora = new Date(Date.now() + PUSH.tz * 3600e3), hora = agora.getUTCHours(), hoje = agora.toISOString().slice(0, 10);
  if (hora < PUSH.de || hora >= PUSH.ate) return;
  const users = new Map(sysUsers().map(x => [x.usuario, x]));
  for (const u of Object.keys(S.push.subs)) {
    const su = users.get(u);
    if (!su) { delete S.push.subs[u]; delete S.push.sent[u]; save(); continue; }
    if ((S.meta[u] || {}).blocked || S.tst.some(t => t.u === u) || !su.expira) continue;
    const dias = Math.round((Date.parse(su.expira + 'T00:00:00Z') - Date.parse(hoje + 'T00:00:00Z')) / DIA);
    if (!PUSH.dias.includes(dias)) continue;
    const key = su.expira + ':' + dias; if (S.push.sent[u] === key) continue;
    const [title, body] = pushTexto(dias);
    if (await pushTo(u, { title, body, url: '/cliente/' })) { S.push.sent[u] = key; save(); }
  }
}
if (PUSH.on) { setTimeout(() => avisaVencimentos().catch(e => console.error('avisos:', e.message)), 20e3).unref(); setInterval(() => avisaVencimentos().catch(e => console.error('avisos:', e.message)), 30 * 60e3).unref(); }

const CLI = { on: process.env.CLIENTE_AREA !== '0', sess: new Map(), falhas: new Map() };
if (CLI.on) {
  app.use('/cliente', (req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'");
    next();
  });
  app.use('/cliente', express.static(path.join(__dirname, 'public-cliente'), { setHeaders: r => r.setHeader('Cache-Control', 'no-cache') }));
  app.get(['/cliente', '/cliente/'], (req, res) => res.sendFile(path.join(__dirname, 'public-cliente', 'index.html')));

  const hashDe = u => { const l = fs.readFileSync('/etc/shadow', 'utf8').split('\n').find(x => x.startsWith(u + ':')); return l ? l.split(':')[1].replace(/^!+/, '') : ''; };
  // confere a senha com o próprio crypt do sistema (perl usa a libcrypt: sha512, yescrypt…); a senha vai por stdin, nunca na linha de comando
  async function senhaConfere(u, senha) {
    const real = /^[a-z_][a-z0-9_.-]{0,39}$/i.test(u) && sysUsers().some(x => x.usuario === u) ? hashDe(u) : '';
    const h = real || '$6$painel$invalido';
    if (h[0] !== '$') return false;
    try { const out = await sys('perl', ['-e', 'my $p=<STDIN>; chomp $p; print crypt($p,$ARGV[0]);', h], senha + '\n', 8000); return !!real && eq(out, h); } catch { return false; }
  }
  const cli = (req, res, next) => {
    const t = String(req.get('x-cliente') || ''), x = CLI.sess.get(t);
    if (!x || x.exp < Date.now()) { CLI.sess.delete(t); return res.status(401).json({ error: 'Sessão expirada. Entre de novo.' }); }
    req.cu = x.u; next();
  };
  const lim = (max, ms = 60e3, msg = 'Muitas tentativas. Aguarde um instante.') => rateLimit({ windowMs: ms, max, standardHeaders: true, legacyHeaders: false, message: { error: msg } });

  app.get('/api/cliente/config', (req, res) => res.json({ whatsapp: T.wa, msg: T.msg, appUrl: T.appUrl || null, appLabel: T.appLabel || 'Baixar aplicativo', teste: T.on }));

  app.post('/api/cliente/login', lim(12, 10 * 60e3, 'Muitas tentativas. Aguarde alguns minutos.'), run(async req => {
    const u = String((req.body || {}).usuario || '').trim().slice(0, 40), p = String((req.body || {}).senha || '');
    if (!u || !p || p.length > 64 || /[\r\n\0]/.test(p)) throw fail('Usuário ou senha incorretos.');
    const f = CLI.falhas.get(u) || { n: 0, t: 0 };
    if (f.n >= 6 && Date.now() - f.t < 15 * 60e3) throw fail('Muitas tentativas para esse usuário. Aguarde 15 minutos.');
    if (!(await senhaConfere(u, p))) {
      if (Date.now() - f.t > 15 * 60e3) f.n = 0;
      f.n++; f.t = Date.now(); CLI.falhas.set(u, f); if (CLI.falhas.size > 5000) CLI.falhas.clear();
      throw fail('Usuário ou senha incorretos.');
    }
    CLI.falhas.delete(u);
    const token = crypto.randomBytes(24).toString('hex'); CLI.sess.set(token, { u, exp: Date.now() + 2 * 3600e3 });
    return { token };
  }));
  app.post('/api/cliente/logout', (req, res) => { CLI.sess.delete(String(req.get('x-cliente') || '')); res.json({ ok: true }); });

  app.get('/api/cliente/me', lim(60), cli, run(async req => {
    const u = req.cu, su = sysUsers().find(x => x.usuario === u);
    if (!su) throw fail('Conta não encontrada.');
    const meta = S.meta[u] || {}, hoje = new Date().toISOString().slice(0, 10);
    const expira = meta.blocked ? (meta.prevExpira || null) : su.expira;
    const status = meta.blocked ? 'bloqueado' : (expira && expira < hoje ? 'vencido' : 'ativo');
    const dias = expira ? Math.round((Date.parse(expira + 'T00:00:00Z') - Date.parse(hoje + 'T00:00:00Z')) / DIA) : null;
    return {
      usuario: u, expira, dias, status, limite: meta.blocked ? (meta.prevLimite || 1) : (readLimits().get(u) || 1),
      teste: S.tst.some(t => t.u === u), xray: XR.on, ...xrayInfo(u), host: T.host || '', porta: T.sshPort,
      vendas: SALE.on, planos: SALE.on ? SALE.planos.map(({ id, nome, dias, preco, limite, destaque }) => ({ id, nome, dias, preco, limite, destaque })) : []
    };
  }));
  app.post('/api/cliente/uuid', lim(10), cli, run(async req => {
    if (!XR.on) throw fail('V2Ray não está ativo neste servidor.');
    xrayEnsure(req.cu); return xrayInfo(req.cu);
  }));
  app.post('/api/cliente/renovar', lim(6), cli, run(async req => {
    if (!SALE.on) throw fail('Renovação online indisponível no momento. Fale com o suporte.');
    if ((S.meta[req.cu] || {}).blocked) throw fail('Conta bloqueada. Fale com o suporte.');
    return criaPedido(req.body || {}, { renovacao: req.cu });
  }));
  // --- avisos de vencimento (push) ---
  app.get('/api/cliente/push/config', lim(60), (req, res) => res.json(PUSH.on ? { on: true, key: S.push.vapid.publicKey, dias: PUSH.dias } : { on: false }));
  app.post('/api/cliente/push/sub', lim(12), cli, run(async req => {
    if (!PUSH.on) throw fail('Avisos por notificação não estão ativos.');
    const s = (req.body || {}).sub || {}, k = s.keys || {};
    if (typeof s.endpoint !== 'string' || s.endpoint.length > 1000 || !PUSH.hosts.test(s.endpoint) || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) throw fail('Este aparelho não aceita notificações.');
    const u = req.cu, lista = (S.push.subs[u] || []).filter(x => x.endpoint !== s.endpoint);
    lista.push({ endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth }, criado: Date.now() });
    S.push.subs[u] = lista.slice(-5); delete S.push.sent[u]; save();
    const ok = await pushTo(u, { title: 'Avisos ativados', body: 'Você vai receber um aviso quando seu acesso estiver perto de vencer.', url: '/cliente/' }).catch(() => 0);
    return { ok: true, enviado: ok > 0 };
  }));
  app.post('/api/cliente/push/unsub', lim(12), cli, run(async req => {
    const ep = String((req.body || {}).endpoint || ''), u = req.cu;
    if (S.push && S.push.subs[u]) { S.push.subs[u] = S.push.subs[u].filter(x => x.endpoint !== ep); if (!S.push.subs[u].length) delete S.push.subs[u]; save(); }
    return { ok: true };
  }));
  setInterval(() => { const n = Date.now(); for (const [k, v] of CLI.sess) if (v.exp < n) CLI.sess.delete(k); }, 10 * 60e3).unref();
  console.log('Área do cliente em /cliente');
}

// Lista de vendas para o painel (somente admin)
// ===== CheckUser (check-final): status, link, reiniciar e remover pelo painel =====
const CU = {
  svc: (process.env.CHECKUSER_SERVICE || 'check-dt-voidpro.service').replace(/[^A-Za-z0-9_.@-]/g, ''),
  tun: (process.env.CHECKUSER_TUNNEL_SERVICE || 'check-dt-voidpro-tunnel.service').replace(/[^A-Za-z0-9_.@-]/g, ''),
  dir: process.env.CHECKUSER_DIR || '/usr/local/lib/check-dt-voidpro',
  log: process.env.CHECKUSER_TUNNEL_LOG || '/var/log/check-dt-voidpro-tunnel.log',
  menu: process.env.CHECKUSER_MENU || '/usr/local/bin/check',
  unitDir: process.env.CHECKUSER_UNIT_DIR || '/etc/systemd/system',
  port: parseInt(process.env.CHECKUSER_PORT, 10) || 2052
};
const LINK_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g;
const sysq = (c, a, t) => sys(c, a, undefined, t || 8000).then(o => String(o), e => { throw e; });
const unitState = async u => { try { return (await sysq('systemctl', ['is-active', u])).trim(); } catch (e) { const m = /(inactive|failed|activating|deactivating|unknown)/.exec(String(e.message)); return m ? m[1] : 'inactive'; } };
async function cuInstalled() {
  try { await sysq('systemctl', ['cat', CU.svc]); return true; } catch { return false; }
}
async function cuPort() {
  try { const m = /--port[ =](\d{2,5})/.exec(await sysq('systemctl', ['cat', CU.svc])); if (m) return +m[1]; } catch { }
  return CU.port;
}
function cuLinkFromLog() {
  try {
    const st = fs.statSync(CU.log), n = Math.min(st.size, 262144), fd = fs.openSync(CU.log, 'r'), b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd);
    const all = b.toString('utf8').match(LINK_RE); return all && all.length ? all[all.length - 1] : '';
  } catch { return ''; }
}
async function cuLink() {
  const l = cuLinkFromLog(); if (l) return l;
  try { const all = (await sysq('journalctl', ['-u', CU.tun, '-n', '200', '--no-pager', '-o', 'cat'], 8000)).match(LINK_RE); return all && all.length ? all[all.length - 1] : ''; } catch { return ''; }
}
function cuHealth(port) {
  return new Promise(ok => {
    const t0 = Date.now(), r = require('http').get({ host: '127.0.0.1', port, path: '/check?user=__healthcheck__&uuid=&hwid=', timeout: 3000 }, s => { s.resume(); ok({ ok: s.statusCode < 500, ms: Date.now() - t0 }); });
    r.on('timeout', () => { r.destroy(); ok({ ok: false }); }); r.on('error', () => ok({ ok: false }));
  });
}
async function cuStatus() {
  if (!(await cuInstalled())) return { installed: false };
  const port = await cuPort(), [svc, tun, link, health] = await Promise.all([unitState(CU.svc), unitState(CU.tun), cuLink(), cuHealth(port)]);
  return { installed: true, service: svc, tunnel: tun, port, health, link, appUrl: link ? link + '/check?user={username}&uuid={uuid}&hwid={hwid}' : '', localUrl: 'http://127.0.0.1:' + port + '/check?user={username}&uuid={uuid}&hwid={hwid}' };
}
app.get('/api/checkuser', auth, adminOnly, run(() => cuStatus()));
app.get('/api/checkuser/log', auth, adminOnly, run(async () => {
  let t = ''; try { t = await sysq('journalctl', ['-u', CU.svc, '-u', CU.tun, '-n', '60', '--no-pager', '-o', 'short'], 8000); } catch { }
  if (!t) { try { const b = fs.readFileSync(CU.log, 'utf8'); t = b.split('\n').slice(-60).join('\n'); } catch { } }
  return { log: t.slice(-8000) };
}));
app.post('/api/checkuser/restart', auth, adminOnly, csrf, run(async req => {
  if (!(await cuInstalled())) throw fail('CheckUser não está instalado neste servidor.');
  const w = String(req.body.alvo || 'service');
  if (w === 'service' || w === 'both') await sysq('systemctl', ['restart', CU.svc], 20000);
  if (w === 'tunnel' || w === 'both' || w === 'newlink') await sysq('systemctl', ['restart', CU.tun], 20000);
  if (w === 'newlink') { for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 1000)); if (cuLinkFromLog() !== (req.body.antigo || '\0')) break; } }
  await new Promise(r => setTimeout(r, 800));
  return cuStatus();
}));
app.post('/api/checkuser/remove', auth, adminOnly, csrf, run(async req => {
  if (String(req.body.confirma || '') !== 'REMOVER') throw fail('Digite REMOVER para confirmar.');
  if (!(await cuInstalled())) throw fail('CheckUser não está instalado neste servidor.');
  for (const u of [CU.tun, CU.svc]) { try { await sysq('systemctl', ['disable', '--now', u], 20000); } catch { } }
  for (const u of [CU.tun, CU.svc]) { try { fs.rmSync(path.join(CU.unitDir, u), { force: true }); } catch { } }
  try { if (CU.dir && CU.dir.length > 8 && CU.dir !== '/') fs.rmSync(CU.dir, { recursive: true, force: true }); } catch { }
  for (const f of [CU.menu, CU.log]) { try { fs.rmSync(f, { force: true }); } catch { } }
  try { await sysq('systemctl', ['daemon-reload']); } catch { }
  return { ok: true, installed: false };
}));

app.get('/api/vendas', auth, adminOnly, (req, res) => {
  const now = Date.now(), rows = S.pedidos.slice().sort((a, b) => b.criado - a.criado).slice(0, 300).map(o => ({
    id: o.id, plano: o.plano.nome + (o.renovacao ? ' · renovação' : ''), dias: o.plano.dias, preco: o.plano.preco, status: o.status, criado: o.criado, pagoEm: o.pagoEm || null, usuario: o.usuario || null
  }));
  const pagos = S.pedidos.filter(o => o.status === 'pago'), mes = pagos.filter(o => o.pagoEm > now - 30 * DIA);
  res.json({
    ativo: SALE.on, rows,
    totais: { vendas30: mes.length, valor30: Math.round(mes.reduce((a, o) => a + o.plano.preco, 0) * 100) / 100, pendentes: S.pedidos.filter(o => o.status === 'pendente').length, vendasTotal: pagos.length }
  });
});

app.listen(PORT, HOST, () => console.log(`Painel em http://${HOST}:${PORT}`));
