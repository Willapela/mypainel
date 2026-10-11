const $ = s => document.querySelector(s);
let cfg = {}, token = '', timer;
const wa = extra => cfg.whatsapp ? 'https://wa.me/' + cfg.whatsapp + '?text=' + encodeURIComponent((cfg.msg || '') + (extra ? ' (meu teste: ' + extra + ')' : '')) : '';

function setWa() {
  const has = !!cfg.whatsapp;
  $('#wa2').hidden = !has; if (has) $('#wa2').href = wa('');
}

function setAppDl() {
  const url = cfg.appUrl || '';
  const label = cfg.appLabel || 'Baixar aplicativo';
  ['#appDl', '#appDl2'].forEach(sel => {
    const a = $(sel);
    if (!a) return;
    if (url) {
      a.href = url;
      a.textContent = label;
      a.hidden = false;
    } else {
      a.hidden = true;
    }
  });
}

function row(label, value) {
  const d = document.createElement('div'); d.className = 'row';
  const dt = document.createElement('dt'); dt.textContent = label;
  const dd = document.createElement('dd'); dd.textContent = value;
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Copiar';
  b.onclick = async () => { try { await navigator.clipboard.writeText(value); b.textContent = 'Copiado'; setTimeout(() => b.textContent = 'Copiar', 1500); } catch { b.textContent = 'Selecione'; } };
  d.append(dt, dd, b); return d;
}

function countdown(ate) {
  clearInterval(timer);
  const tick = () => {
    const s = Math.max(0, Math.round((ate - Date.now()) / 1000));
    if (!s) { $('#tempo').textContent = 'Seu teste terminou. Gostou? Chame no WhatsApp para contratar.'; clearInterval(timer); return; }
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    $('#tempo').textContent = 'Tempo restante: ' + (h ? h + 'h ' : '') + String(m).padStart(2, '0') + 'm ' + String(x).padStart(2, '0') + 's';
  };
  tick(); timer = setInterval(tick, 1000);
}

async function gerar() {
  const b = $('#gerar'); $('#err').textContent = ''; b.disabled = true;
  try {
    const r = await fetch('/api/teste', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível gerar o teste agora.');
    const box = $('#dados'); box.replaceChildren();
    box.append(row('Usuário', d.usuario), row('Senha', d.senha));
    countdown(d.ate);
    if (cfg.whatsapp) { $('#wa').href = wa(d.usuario); } else { $('#wa').hidden = true; }
    // depois de gerar, esconde o botão de download de baixo (fica só o de dentro do resultado)
    if ($('#appDl2')) $('#appDl2').hidden = true;
    if ($('#appDl') && cfg.appUrl) {
      $('#appDl').href = cfg.appUrl;
      $('#appDl').textContent = cfg.appLabel || 'Baixar aplicativo';
      $('#appDl').hidden = false;
    }
    $('#pre').hidden = true; $('#res').hidden = false;
  } catch (e) {
    $('#err').textContent = e.message; b.disabled = false;
    if (window.turnstile) { window.turnstile.reset(); token = ''; }
  }
}

(async () => {
  try { cfg = await (await fetch('/api/config')).json(); } catch { }
  if (cfg.horas) $('#intro').textContent = 'Gere seu acesso de teste de ' + cfg.horas + (cfg.horas == 1 ? ' hora' : ' horas') + ', sem cartão e sem compromisso.';
  setWa();
  setAppDl();
  if (cfg.sitekey) {
    $('#gerar').disabled = true;
    const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = () => window.turnstile.render('#ts', { sitekey: cfg.sitekey, callback: t => { token = t; $('#gerar').disabled = false; }, 'expired-callback': () => { token = ''; $('#gerar').disabled = true; } });
    document.head.append(s);
  }
  $('#gerar').onclick = gerar;
})();
