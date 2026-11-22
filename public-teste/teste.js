const $ = s => document.querySelector(s);
document.documentElement.classList.add('js');
const NS = 'http://www.w3.org/2000/svg';
let cfg = {}, token = '', timer, poll;
const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtDate = iso => { const m = String(iso || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
const store = {
  get() { try { return localStorage.getItem('pedido') || ''; } catch { return ''; } },
  set(v) { try { v ? localStorage.setItem('pedido', v) : localStorage.removeItem('pedido'); } catch { } }
};
const wa = extra => cfg.whatsapp ? 'https://wa.me/' + cfg.whatsapp + '?text=' + encodeURIComponent((cfg.msg || '') + (extra ? ' (' + extra + ')' : '')) : '';

function icon(name) { const s = document.createElementNS(NS, 'svg'), u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#i-' + name); s.append(u); return s; }

function setLinks() {
  document.querySelectorAll('[data-wa]').forEach(a => { a.hidden = !cfg.whatsapp; if (cfg.whatsapp) a.href = wa(''); });
  document.querySelectorAll('[data-needs="wa"]').forEach(x => { x.hidden = !cfg.whatsapp; });
  document.querySelectorAll('[data-horas]').forEach(x => { if (cfg.horas) x.textContent = cfg.horas + (cfg.horas == 1 ? ' hora' : ' horas'); });
  const url = cfg.appUrl || '', label = cfg.appLabel || 'Baixar aplicativo';
  ['#appDl2', '#appDl3'].forEach(sel => { const a = $(sel); if (!a) return; if (url) { a.href = url; a.textContent = label; a.hidden = false; } else a.hidden = true; });
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
    if (!s) { $('#tempo').textContent = 'Seu teste terminou. Gostou? Escolha um plano abaixo para continuar.'; clearInterval(timer); return; }
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    $('#tempo').textContent = 'Tempo restante: ' + (h ? h + 'h ' : '') + String(m).padStart(2, '0') + 'm ' + String(x).padStart(2, '0') + 's';
  };
  tick(); timer = setInterval(tick, 1000);
}

/* ---------- teste grátis ---------- */
async function gerar() {
  const b = $('#gerar'); $('#err').textContent = ''; b.disabled = true;
  try {
    const r = await fetch('/api/teste', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível gerar o teste agora.');
    const box = $('#dados'); box.replaceChildren(row('Usuário', d.usuario), row('Senha', d.senha)); if (d.uuid) box.append(row('UUID', d.uuid)); if (d.link) box.append(row('Link', d.link));
    countdown(d.ate);
    if (cfg.appUrl) { $('#appDl').href = cfg.appUrl; $('#appDl').textContent = cfg.appLabel || 'Baixar aplicativo'; $('#appDl').hidden = false; }
    $('#pre').hidden = true; $('#res').hidden = false;
    if ($('#planos').childElementCount) $('#planos').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    $('#err').textContent = e.message; b.disabled = false;
    if (window.turnstile) { window.turnstile.reset(); token = ''; }
  }
}

/* ---------- planos / compra ---------- */

function ticket(c, h, pr, per, ul, btns, hint) {
  const top = document.createElement('div'); top.className = 'plan-top'; top.append(h, pr, per);
  const perf = document.createElement('div'); perf.className = 'perf';
  const bot = document.createElement('div'); bot.className = 'plan-bot'; bot.append(ul, ...btns, hint);
  c.append(top, perf, bot); return c;
}
function renderPlans() {
  const list = cfg.planos || [], grid = $('#planGrid');
  $('#planos').hidden = !list.length;
  document.querySelectorAll('[data-needs="plans"]').forEach(x => { x.hidden = !list.length; });
  if (!list.length) return;
  const min = Math.min(...list.map(p => p.preco / p.dias)); $('#fromTxt').textContent = 'Planos a partir de ' + brl(min) + ' por dia'; $('#fromChip').hidden = false;
  grid.replaceChildren(...list.map(p => {
    const c = document.createElement('article'); c.className = 'plan' + (p.destaque ? ' hot' : '');
    const h = document.createElement('h3'); h.textContent = p.nome;
    if (p.destaque) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'Mais escolhido'; h.append(t); }
    const pr = document.createElement('div'); pr.className = 'price';
    const b = document.createElement('b'); b.textContent = brl(p.preco); const sm = document.createElement('small'); sm.textContent = '/ ' + p.dias + (p.dias === 1 ? ' dia' : ' dias'); pr.append(b, sm);
    const per = document.createElement('p'); per.className = 'per'; per.textContent = 'equivale a ' + brl(p.preco / p.dias) + ' por dia';
    const ul = document.createElement('ul');
    [p.dias + (p.dias === 1 ? ' dia' : ' dias') + ' de acesso', p.limite + (p.limite === 1 ? ' conexão simultânea' : ' conexões simultâneas'), 'Liberação automática após o pagamento'].forEach(t => { const li = document.createElement('li'); li.append(icon('check'), document.createTextNode(t)); ul.append(li); });
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn ' + (p.destaque ? 'primary' : ''); btn.textContent = 'Pagar com Pix';
    btn.onclick = () => comprar(p, btn, 'pix');
    const alt = document.createElement('button'); alt.type = 'button'; alt.className = 'btn card-btn'; alt.textContent = 'Pagar com cartão';
    alt.onclick = () => comprar(p, alt, 'mp');
    const hint = document.createElement('p'); hint.className = 'meios'; hint.textContent = 'Cartão de crédito, débito ou boleto';
    return ticket(c, h, pr, per, ul, [btn, alt], hint);
  }));
}
async function comprar(p, btn, metodo) {
  $('#planErr').textContent = '';
  const all = [...document.querySelectorAll('#planGrid .btn')]; all.forEach(x => x.disabled = true);
  const old = btn.textContent; btn.textContent = metodo === 'pix' ? 'Gerando Pix…' : 'Abrindo pagamento…';
  try {
    const r = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plano: p.id, metodo }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !(d.url || d.pix)) throw new Error(d.error || 'Não foi possível abrir o pagamento agora. Tente de novo.');
    store.set(d.id);
    if (d.pix) { renderPix(d.pix, 'Plano ' + p.nome + ' · ' + brl(p.preco)); acompanha(d.id); all.forEach(x => x.disabled = false); btn.textContent = old; return; }
    location.href = d.url;
  } catch (e) { $('#planErr').textContent = e.message; all.forEach(x => x.disabled = false); btn.textContent = old; }
}

/* ---------- acompanhamento do pagamento ---------- */
function showPay(state) {
  $('#pay').hidden = false;
  ['Wait', 'Pix', 'Ok', 'Bad'].forEach(k => { $('#pay' + k).hidden = k !== state; });
  const focus = state === 'Wait' || state === 'Pix' || state === 'Ok';
  const was = $('#landing').hidden; $('#landing').hidden = focus; if (focus && !was) window.scrollTo({ top: 0 });
}
let pixTimer = null, pixCode = '';
function renderPix(pix, label) {
  clearInterval(timer); clearInterval(pixTimer);
  if (label) $('#pixInfo').textContent = label + ' — escaneie o QR Code no app do seu banco ou copie o código.';
  const img = $('#pixQr'); if (pix.qr) { img.src = 'data:image/png;base64,' + pix.qr; img.hidden = false; } else img.hidden = true;
  $('#pixCode').textContent = pix.codigo; pixCode = pix.codigo; $('#pixNew').hidden = true; $('#pixCopy').hidden = false;
  $('#pixCopy').onclick = async () => { const b = $('#pixCopy'); try { await navigator.clipboard.writeText(pixCode); b.textContent = 'Código copiado!'; } catch { b.textContent = 'Selecione e copie o código'; } setTimeout(() => b.textContent = 'Copiar código Pix', 2000); };
  $('#pixNew').onclick = () => { store.set(''); clearInterval(poll); clearInterval(pixTimer); $('#pay').hidden = true; $('#landing').hidden = false; renderPlans(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const tick = () => {
    const s = Math.max(0, Math.round((pix.ate - Date.now()) / 1000));
    if (!s) { clearInterval(pixTimer); $('#pixTimer').textContent = 'Esse Pix expirou. Se você já pagou, aguarde alguns segundos; senão, gere um novo.'; img.hidden = true; $('#pixCopy').hidden = true; $('#pixNew').hidden = false; return; }
    $('#pixTimer').textContent = 'Válido por ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  tick(); pixTimer = setInterval(tick, 1000);
  showPay('Pix'); window.scrollTo({ top: 0, behavior: 'smooth' });
}
function paidView(d) {
  clearInterval(poll); clearInterval(pixTimer);
  $('#payPlano').textContent = 'Plano ' + d.plano + ' · ' + d.dias + (d.dias === 1 ? ' dia' : ' dias') + (d.expira ? ' · válido até ' + fmtDate(d.expira) : '');
  const box = $('#payDados'); box.replaceChildren(row('Usuário', d.usuario));
  if (d.senha) box.append(row('Senha', d.senha));
  if (d.uuid) box.append(row('UUID', d.uuid));
  if (d.link) box.append(row('Link', d.link));
  $('#payNota').textContent = d.senha ? 'Guarde esses dados agora. Por segurança, a senha some desta página depois de 24 horas.' : 'A senha já expirou desta página. Se precisar de ajuda, chame no WhatsApp.';
  showPay('Ok'); window.scrollTo({ top: 0, behavior: 'smooth' });
}
function badView(t, p) { clearInterval(poll); $('#payBadT').textContent = t; $('#payBadP').textContent = p; $('#wa3').hidden = !cfg.whatsapp; if (cfg.whatsapp) $('#wa3').href = wa('pedido ' + (store.get() || '')); showPay('Bad'); }

async function checa(id, first) {
  try {
    const r = await fetch('/api/pedidos/' + encodeURIComponent(id)), d = await r.json().catch(() => ({}));
    if (!r.ok) { if (r.status === 429) return; store.set(''); clearInterval(poll); if (first) { $('#pay').hidden = true; } else badView('Pedido não encontrado', 'Não achamos esse pedido. Se você pagou, fale com a gente no WhatsApp.'); return; }
    if (d.status === 'pago') return paidView(d);
    if (d.status === 'estornado') return badView('Pagamento estornado', 'Esse pagamento foi devolvido. Para voltar a usar, faça uma nova assinatura ou chame no WhatsApp.');
    if (d.status === 'divergente') return badView('Valor do pagamento diferente', 'O valor pago não confere com o plano. Chame no WhatsApp para resolvermos rápido.');
    if (d.pix) { if (pixCode !== d.pix.codigo) renderPix(d.pix, 'Plano ' + d.plano); return; }
    showPay('Wait');
    if (d.url) { $('#payRetry').href = d.url; }
  } catch { /* tenta de novo no próximo ciclo */ }
}
function acompanha(id) {
  if ($('#payPix').hidden) showPay('Wait'); let n = 0; const t0 = Date.now();
  setTimeout(() => { if (!$('#payWait').hidden && $('#payRetry').href) $('#payRetry').hidden = false; }, 20000);
  checa(id, true);
  clearInterval(poll);
  poll = setInterval(() => { n++; if (Date.now() - t0 > 30 * 60e3) { clearInterval(poll); return; } checa(id, false); }, 3000);
}

async function recupera(id) {
  try {
    const r = await fetch('/api/pedidos/' + encodeURIComponent(id)), d = await r.json().catch(() => ({}));
    if (r.ok && d.status === 'pago' && d.senha) paidView(d); else if (r.ok && d.status === 'pendente' && d.pix && !d.expirado) acompanha(id); else store.set('');
  } catch { }
}

(async () => {
  try { cfg = await (await fetch('/api/config')).json(); } catch { }
  if (cfg.horas) $('#intro').textContent = 'Gere seu acesso de teste de ' + cfg.horas + (cfg.horas == 1 ? ' hora' : ' horas') + ' e veja como funciona.';
  setLinks(); renderPlans();
  if (cfg.sitekey) {
    $('#gerar').disabled = true;
    const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = () => window.turnstile.render('#ts', { sitekey: cfg.sitekey, callback: t => { token = t; $('#gerar').disabled = false; }, 'expired-callback': () => { token = ''; $('#gerar').disabled = true; } });
    document.head.append(s);
  }
  $('#gerar').onclick = gerar;
  const nav = $('.nav'), bg = $('#burger');
  const menu = open => { nav.classList.toggle('open', open); bg.setAttribute('aria-expanded', open); bg.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu'); bg.firstElementChild.firstElementChild.setAttribute('href', open ? '#i-close' : '#i-menu'); };
  bg.onclick = () => menu(!nav.classList.contains('open'));
  document.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => menu(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') menu(false); });
  const rv = [...document.querySelectorAll('.rv')];
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px 0px' }); rv.forEach(x => io.observe(x)); }
  else rv.forEach(x => x.classList.add('in'));
  const OK = v => /^[0-9a-f]{24}$/.test(v), fromUrl = new URLSearchParams(location.search).get('pedido') || '';
  if (OK(fromUrl)) { store.set(fromUrl); acompanha(fromUrl); }
  else if (OK(store.get())) recupera(store.get());   // pagou e fechou a aba: recupera o acesso (até 24h)
})();
