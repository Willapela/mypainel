/**
 * Licença MyPainel — modo online (recomendado) ou offline (legado MP1)
 *
 * Online (1 key = 1 VPS, validado no SEU servidor):
 *   LICENSE_REQUIRED=1
 *   LICENSE_SERVER_URL=https://licencas.seudominio.com
 *   LICENSE_KEY=MP2-...
 *
 * Offline legado (assinatura local MP1):
 *   LICENSE_KEY=MP1....
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EMBEDDED_SECRET = process.env.LICENSE_SECRET || 'mypainel-change-me-license-secret-2026!';
const BIND_FILE = process.env.LICENSE_BIND_FILE || path.join(__dirname, 'data', 'license.bind');
const SERVER_URL = (process.env.LICENSE_SERVER_URL || '').replace(/\/+$/, '');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function signPayload(payloadStr, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(payloadStr).digest());
}
function safeEq(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; }
}

function machineFingerprint() {
  const parts = [
    readFileSafe('/etc/machine-id') || readFileSafe('/var/lib/dbus/machine-id'),
    readFileSafe('/sys/class/dmi/id/product_uuid'),
    os.hostname(),
    String(os.cpus()[0] && os.cpus()[0].model || ''),
    String(os.totalmem())
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/* ===== Offline MP1 (legado) ===== */
function generateLicense({ days = 365, note = '', slots = 1, secret = EMBEDDED_SECRET } = {}) {
  const exp = days > 0 ? Math.floor(Date.now() / 1000) + days * 86400 : 0;
  const payload = {
    v: 1,
    id: crypto.randomBytes(8).toString('hex'),
    exp,
    n: String(note || '').slice(0, 64),
    slots: Math.max(1, Math.min(10, parseInt(slots, 10) || 1))
  };
  const payloadStr = JSON.stringify(payload);
  const key = 'MP1.' + b64url(payloadStr) + '.' + signPayload(payloadStr, secret);
  return { key, payload, expiresAt: exp ? new Date(exp * 1000).toISOString() : null, slots: payload.slots };
}

function validateLicenseOffline(key, secret = EMBEDDED_SECRET) {
  if (!key || typeof key !== 'string') return { ok: false, error: 'LICENSE_KEY não configurada no .env' };
  const parts = key.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'MP1') return { ok: false, error: 'Formato de key inválido' };
  let payloadStr;
  try { payloadStr = fromB64url(parts[1]).toString('utf8'); } catch { return { ok: false, error: 'Key corrompida' }; }
  if (!safeEq(signPayload(payloadStr, secret), parts[2])) return { ok: false, error: 'Key inválida (assinatura)' };
  let payload;
  try { payload = JSON.parse(payloadStr); } catch { return { ok: false, error: 'Key corrompida' }; }
  if (payload.v !== 1 || !payload.id) return { ok: false, error: 'Versão não suportada' };
  if (payload.exp && payload.exp > 0 && Math.floor(Date.now() / 1000) > payload.exp) {
    return { ok: false, error: 'Key expirada em ' + new Date(payload.exp * 1000).toISOString().slice(0, 10), payload };
  }
  if (payload.slots == null) payload.slots = 1;
  return { ok: true, payload, expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null };
}

function readBind() {
  try {
    const data = JSON.parse(fs.readFileSync(BIND_FILE, 'utf8'));
    const body = JSON.stringify({ id: data.id, fps: data.fps, at: data.at });
    if (!safeEq(signPayload(body, EMBEDDED_SECRET), data.sig)) return null;
    return data;
  } catch { return null; }
}
function writeBind(id, fps) {
  const at = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id, fps, at });
  const data = { id, fps, at, sig: signPayload(body, EMBEDDED_SECRET) };
  fs.mkdirSync(path.dirname(BIND_FILE), { recursive: true });
  const tmp = BIND_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, BIND_FILE);
  return data;
}
function enforceMachineBindOffline(payload) {
  const fp = machineFingerprint();
  const slots = Math.max(1, parseInt(payload.slots, 10) || 1);
  let bind = readBind();
  if (!bind) {
    writeBind(payload.id, [fp]);
    return { ok: true, activated: true, message: 'Key ativada nesta VPS (offline 1/' + slots + ')' };
  }
  if (bind.id !== payload.id) {
    return { ok: false, error: 'Painel já ativado com outra key (offline).' };
  }
  if (bind.fps.includes(fp)) {
    return { ok: true, activated: false, message: 'Key já ativa nesta VPS (offline)' };
  }
  if (bind.fps.length < slots) {
    writeBind(payload.id, bind.fps.concat([fp]));
    return { ok: true, activated: true, message: 'Key ativada (offline)' };
  }
  return { ok: false, error: 'Key já usada em outra VPS (modo offline).' };
}

/* ===== Online MP2 ===== */
async function activateOnline(key) {
  if (!SERVER_URL) return { ok: false, error: 'LICENSE_SERVER_URL não configurada' };
  const fp = machineFingerprint();
  const url = SERVER_URL + '/api/activate';
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, fingerprint: fp, hostname: os.hostname() })
    });
  } catch (e) {
    return { ok: false, error: 'Não foi possível contactar o servidor de licenças: ' + e.message };
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) {
    return { ok: false, error: data.error || ('HTTP ' + r.status) };
  }
  // cache local opcional
  try {
    writeBind(data.id || key, [fp]);
  } catch { /* ignore */ }
  return {
    ok: true,
    payload: { id: data.id, slots: data.slots },
    expiresAt: data.expiresAt || null,
    bind: {
      activated: !!data.activated,
      message: data.message || 'Licença online OK',
      slots: data.slots,
      used: data.used
    }
  };
}

/**
 * Checagem no startup (sync wrapper com deasync-free approach:
 * usamos child_process style — na verdade Node precisa async.
 * server.js chamará a versão async.
 */
async function checkStartupLicenseAsync() {
  const required = process.env.LICENSE_REQUIRED !== '0';
  if (!required) {
    return { ok: true, skipped: true, message: 'Licença desativada (LICENSE_REQUIRED=0)' };
  }
  const key = (process.env.LICENSE_KEY || '').trim();
  if (!key) return { ok: false, error: 'LICENSE_KEY não configurada no .env' };

  // Online: keys MP2-... ou qualquer key se LICENSE_SERVER_URL estiver setado
  if (SERVER_URL) {
    return activateOnline(key);
  }

  // Offline legado MP1
  if (key.startsWith('MP1.')) {
    const result = validateLicenseOffline(key);
    if (!result.ok) return result;
    const bind = enforceMachineBindOffline(result.payload);
    if (!bind.ok) return { ok: false, error: bind.error, payload: result.payload };
    return { ok: true, payload: result.payload, expiresAt: result.expiresAt, bind };
  }

  return {
    ok: false,
    error: 'Key online requer LICENSE_SERVER_URL no .env (ex: https://licencas.seudominio.com)'
  };
}

/** Compat: se alguém chamar sync antigo */
function checkStartupLicense() {
  throw new Error('Use checkStartupLicenseAsync() — validação pode ser online');
}

module.exports = {
  generateLicense,
  validateLicense: validateLicenseOffline,
  checkStartupLicense,
  checkStartupLicenseAsync,
  machineFingerprint,
  activateOnline,
  EMBEDDED_SECRET,
  BIND_FILE,
  SERVER_URL
};
