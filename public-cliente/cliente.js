const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
let cfg = {}, token = '', me = null, poll = null, pixTimer = null, pixCode = '';
const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtDate = iso => { const m = String(iso || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; };
const ss = {
  get(k) { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch { } }
};
const wa = extra => cfg.whatsapp ? 'https://wa.me/' + cfg.whatsapp + '?text=' + encodeURIComponent('Olá! Preciso de ajuda com a minha conta' + (me ? ' (' + me.usuario + ')' : '') + (extra ? ' — ' + extra : '')) : '';
const OK_ID = v => /^[0-9a-f]{24}$/.test(v);

function icon(name) { const s = document.createElementNS(NS, 'svg'), u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#i-' + name); s.append(u); return s; }
function row(label, value) {
  const d = document.createElement('div'); d.className = 'row';
  const dt = document.createElement('dt'); dt.textContent = label;
  const dd = document.createElement('dd'); dd.textContent = value;
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Copiar';
  b.onclick = async () => { try { await navigator.clipboard.writeText(value); b.textContent = 'Copiado'; setTimeout(() => b.textContent = 'Copiar', 1500); } catch { b.textContent = 'Selecione'; } };
  d.append(dt, dd, b); return d;
}

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Cliente': token, ...(opts.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { sair(true); }
  return { r, d };
}

/* ---------- telas ---------- */
function view(name) {
  $('#vLogin').hidden = name !== 'login'; $('#vConta').hidden = name !== 'conta'; $('#pay').hidden = name !== 'pay';
  $('#sair').hidden = name === 'login'; $('#toTeste').hidden = name !== 'login' || !cfg.teste;
  window.scrollTo({ top: 0 });
}
function showLogin(msg) { view('login'); $('#lerr').textContent = msg || ''; $('#lbtn').disabled = false; $('#lu').focus(); }
function sair(expirou) {
  fetch('/api/cliente/logout', { method: 'POST', headers: { 'X-Cliente': token } }).catch(() => { });
  token = ''; me = null; ss.set('tk', ''); ss.set('pd', ''); clearInterval(poll); clearInterval(pixTimer);
  showLogin(expirou === true ? 'Sua sessão expirou. Entre de novo.' : '');
}

/* ---------- entrar ---------- */
async function entrar(ev) {
  ev.preventDefault();
  const b = $('#lbtn'); $('#lerr').textContent = ''; b.disabled = true; b.textContent = 'Entrando…';
  try {
    const r = await fetch('/api/cliente/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: $('#lu').value.trim(), senha: $('#lp').value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) throw new Error(d.error || 'Não foi possível entrar agora.');
    token = d.token; ss.set('tk', token); $('#lp').value = '';
    await carrega();
    const pend = ss.get('pd'); if (OK_ID(pend)) acompanha(pend);
  } catch (e) { $('#lerr').textContent = e.message; }
  b.disabled = false; b.textContent = 'Entrar';
}

/* ---------- minha conta ---------- */
async function carrega() {
  const { r, d } = await api('/api/cliente/me');
  if (!r.ok) { if (r.status !== 401) showLogin(d.error || 'Não foi possível carregar sua conta.'); return false; }
  me = d; renderConta(); view('conta'); return true;
}
function renderConta() {
  const m = me;
  $('#aUser').textContent = m.usuario;
  const st = { ativo: ['ok', 'Ativo'], vencido: ['bad', 'Vencido'], bloqueado: ['bad', 'Bloqueado'] }[m.status] || ['warn', m.status];
  const bd = $('#aBadge'); bd.className = 'badge ' + (m.status === 'ativo' && m.dias != null && m.dias <= 3 ? 'warn' : st[0]); bd.textContent = m.status === 'ativo' && m.dias != null && m.dias <= 3 ? 'Vence em breve' : st[1];
  $('#aExp').textContent = fmtDate(m.expira);
  $('#aDias').textContent = m.dias == null ? 'sem vencimento' : m.status === 'vencido' ? 'venceu há ' + Math.abs(m.dias) + (Math.abs(m.dias) === 1 ? ' dia' : ' dias') : m.dias === 0 ? 'vence hoje' : m.dias === 1 ? 'resta 1 dia' : 'restam ' + m.dias + ' dias';
  $('#aLim').textContent = m.limite;
  $('#aTipo').textContent = m.teste ? 'Teste' : 'Plano'; $('#aTipoS').textContent = m.teste ? 'acesso de teste grátis' : 'acesso contratado';

  const warn = $('#aWarn');
  if (m.status === 'bloqueado') { warn.textContent = 'Sua conta está bloqueada. Fale com o suporte para liberar.'; warn.hidden = false; }
  else if (m.status === 'vencido') { warn.textContent = 'Seu acesso venceu. Renove abaixo e ele volta a funcionar na hora.'; warn.hidden = false; }
  else if (m.teste) { warn.textContent = 'Esta é uma conta de teste e será apagada quando o tempo acabar. Assine um plano para continuar com o mesmo usuário e senha.'; warn.hidden = false; }
  else warn.hidden = true;

  const box = $('#aDados'); box.replaceChildren(row('Usuário', m.usuario));
  if (m.host) box.append(row('Servidor', m.host), row('Porta', m.porta));
  if (m.uuid) box.append(row('UUID', m.uuid));
  if (m.link) box.append(row('Link', m.link));
  $('#aUuid').hidden = !(m.xray && !m.uuid && m.status === 'ativo');
  const app = $('#aApp'); if (cfg.appUrl) { app.href = cfg.appUrl; app.textContent = cfg.appLabel || 'Baixar aplicativo'; app.hidden = false; } else app.hidden = true;

  const pode = m.vendas && m.planos.length && m.status !== 'bloqueado';
  $('#aPlanos').hidden = !pode;
  if (pode) {
    $('#aPlanosT').textContent = m.teste ? 'Assinar um plano' : 'Renovar acesso';
    $('#aPlanosP').textContent = m.teste ? 'Escolha o plano e continue com o mesmo usuário e senha.' : 'Os dias do plano são somados à sua validade atual — não perde nada.';
    renderPlans(m);
  }
  const sup = $('#aSuporte'); sup.hidden = !cfg.whatsapp; if (cfg.whatsapp) $('#aWa').href = wa('');
}

async function gerarUuid() {
  const b = $('#aUuid'); b.disabled = true;
  const { r, d } = await api('/api/cliente/uuid', { method: 'POST', body: '{}' });
  b.disabled = false;
  if (r.ok && d.uuid) { me.uuid = d.uuid; me.link = d.link; renderConta(); } else alert(d.error || 'Não foi possível gerar agora.');
}

/* ---------- planos / renovação ---------- */
function renderPlans(m) {
  const grid = $('#planGrid'), verbo = m.teste ? 'Assinar' : 'Renovar';
  grid.replaceChildren(...m.planos.map(p => {
    const c = document.createElement('article'); c.className = 'plan' + (p.destaque ? ' hot' : '');
    if (p.destaque) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'Mais escolhido'; c.append(t); }
    const h = document.createElement('h3'); h.textContent = p.nome;
    const pr = document.createElement('div'); pr.className = 'price';
    const b = document.createElement('b'); b.textContent = brl(p.preco); const sm = document.createElement('small'); sm.textContent = '/ ' + p.dias + (p.dias === 1 ? ' dia' : ' dias'); pr.append(b, sm);
    const per = document.createElement('p'); per.className = 'per'; per.textContent = 'equivale a ' + brl(p.preco / p.dias) + ' por dia';
    const ul = document.createElement('ul');
    ['+' + p.dias + (p.dias === 1 ? ' dia' : ' dias') + ' de acesso', p.limite + (p.limite === 1 ? ' conexão simultânea' : ' conexões simultâneas'), 'Liberação automática após o pagamento'].forEach(t => { const li = document.createElement('li'); li.append(icon('check'), document.createTextNode(t)); ul.append(li); });
    const pix = document.createElement('button'); pix.type = 'button'; pix.className = 'btn ' + (p.destaque ? 'primary' : ''); pix.textContent = verbo + ' com Pix'; pix.onclick = () => comprar(p, pix, 'pix');
    const card = document.createElement('button'); card.type = 'button'; card.className = 'btn card-btn'; card.textContent = verbo + ' com cartão'; card.onclick = () => comprar(p, card, 'mp');
    const hint = document.createElement('p'); hint.className = 'meios'; hint.textContent = 'Cartão de crédito, débito ou boleto';
    c.append(h, pr, per, ul, pix, card, hint); return c;
  }));
}
async function comprar(p, btn, metodo) {
  $('#planErr').textContent = '';
  const all = [...document.querySelectorAll('#planGrid .btn')]; all.forEach(x => x.disabled = true);
  const old = btn.textContent; btn.textContent = metodo === 'pix' ? 'Gerando Pix…' : 'Abrindo pagamento…';
  const back = () => { all.forEach(x => x.disabled = false); btn.textContent = old; };
  try {
    const { r, d } = await api('/api/cliente/renovar', { method: 'POST', body: JSON.stringify({ plano: p.id, metodo }) });
    if (!r.ok || !(d.url || d.pix)) throw new Error(d.error || 'Não foi possível abrir o pagamento agora. Tente de novo.');
    ss.set('pd', d.id);
    if (d.pix) { renderPix(d.pix, 'Plano ' + p.nome + ' · ' + brl(p.preco)); acompanha(d.id); back(); return; }
    location.href = d.url;
  } catch (e) { $('#planErr').textContent = e.message; back(); }
}

/* ---------- acompanhamento do pagamento ---------- */
function showPay(state) {
  ['Wait', 'Pix', 'Ok', 'Bad'].forEach(k => { $('#pay' + k).hidden = k !== state; });
  if ($('#pay').hidden) view('pay');
}
function renderPix(pix, label) {
  clearInterval(pixTimer);
  if (label) $('#pixInfo').textContent = label + ' — escaneie o QR Code no app do seu banco ou copie o código.';
  const img = $('#pixQr'); if (pix.qr) { img.src = 'data:image/png;base64,' + pix.qr; img.hidden = false; } else img.hidden = true;
  $('#pixCode').textContent = pix.codigo; pixCode = pix.codigo; $('#pixNew').hidden = true; $('#pixCopy').hidden = false;
  $('#pixCopy').onclick = async () => { const b = $('#pixCopy'); try { await navigator.clipboard.writeText(pixCode); b.textContent = 'Código copiado!'; } catch { b.textContent = 'Selecione e copie o código'; } setTimeout(() => b.textContent = 'Copiar código Pix', 2000); };
  $('#pixNew').onclick = voltaConta;
  const tick = () => {
    const s = Math.max(0, Math.round((pix.ate - Date.now()) / 1000));
    if (!s) { clearInterval(pixTimer); $('#pixTimer').textContent = 'Esse Pix expirou. Se você já pagou, aguarde alguns segundos; senão, volte e gere um novo.'; img.hidden = true; $('#pixCopy').hidden = true; $('#pixNew').hidden = false; return; }
    $('#pixTimer').textContent = 'Válido por ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  tick(); pixTimer = setInterval(tick, 1000);
  showPay('Pix');
}
function voltaConta() { clearInterval(poll); clearInterval(pixTimer); ss.set('pd', ''); pixCode = ''; carrega(); }
function paidView(d) {
  clearInterval(poll); clearInterval(pixTimer); ss.set('pd', '');
  $('#okT').textContent = d.renovacao ? 'Renovação confirmada!' : 'Pagamento aprovado!';
  $('#payPlano').textContent = 'Plano ' + d.plano + ' · +' + d.dias + (d.dias === 1 ? ' dia' : ' dias');
  $('#payDados').replaceChildren(row('Usuário', d.usuario), row('Válido até', fmtDate(d.expira)));
  showPay('Ok');
}
function badView(t, p) { clearInterval(poll); clearInterval(pixTimer); $('#payBadT').textContent = t; $('#payBadP').textContent = p; $('#wa3').hidden = !cfg.whatsapp; if (cfg.whatsapp) $('#wa3').href = wa('pedido ' + ss.get('pd')); showPay('Bad'); }
async function checa(id, first) {
  try {
    const r = await fetch('/api/pedidos/' + encodeURIComponent(id)), d = await r.json().catch(() => ({}));
    if (!r.ok) { if (r.status === 429) return; ss.set('pd', ''); clearInterval(poll); if (!first) badView('Pedido não encontrado', 'Não achamos esse pedido. Se você pagou, fale com a gente no WhatsApp.'); else carrega(); return; }
    if (d.status === 'pago') return paidView(d);
    if (d.status === 'estornado') return badView('Pagamento estornado', 'Esse pagamento foi devolvido.');
    if (d.status === 'divergente') return badView('Valor do pagamento diferente', 'O valor pago não confere com o plano. Chame no WhatsApp para resolvermos rápido.');
    if (d.pix) { if (pixCode !== d.pix.codigo) renderPix(d.pix, 'Plano ' + d.plano); return; }
    showPay('Wait'); if (d.url) $('#payRetry').href = d.url;
  } catch { /* tenta de novo no próximo ciclo */ }
}
function acompanha(id) {
  if ($('#payPix').hidden) showPay('Wait'); const t0 = Date.now();
  setTimeout(() => { if (!$('#payWait').hidden && $('#payRetry').href) $('#payRetry').hidden = false; }, 20000);
  checa(id, true); clearInterval(poll);
  poll = setInterval(() => { if (Date.now() - t0 > 30 * 60e3) { clearInterval(poll); return; } checa(id, false); }, 3000);
}

/* olhinho: mostra/esconde a senha digitada, para conferir e corrigir */
function pwEye(input) {
  const w = document.createElement('div'), b = document.createElement('button');
  w.className = 'pw'; b.type = 'button'; b.className = 'eye';
  const set = on => { input.type = on ? 'text' : 'password'; b.replaceChildren(icon(on ? 'eyeoff' : 'eye')); b.title = b.ariaLabel = on ? 'Esconder senha' : 'Mostrar senha'; };
  b.onclick = () => { set(input.type === 'password'); input.focus(); };
  input.replaceWith(w); w.append(input, b); set(false);
}

/* ---------- início ---------- */
(async () => {
  try { cfg = await (await fetch('/api/cliente/config')).json(); } catch { }
  $('#lhelp').hidden = !cfg.teste;
  pwEye($('#lp'));
  $('#fLogin').addEventListener('submit', entrar);
  $('#sair').onclick = () => sair(false);
  $('#aUuid').onclick = gerarUuid;
  $('#payBack').onclick = voltaConta; $('#badBack').onclick = voltaConta;
  const fromUrl = new URLSearchParams(location.search).get('pedido') || '';
  if (OK_ID(fromUrl)) { ss.set('pd', fromUrl); history.replaceState(null, '', location.pathname); }
  token = ss.get('tk');
  if (token && await carrega()) { const pend = ss.get('pd'); if (OK_ID(pend)) acompanha(pend); }
  else showLogin(token ? '' : (OK_ID(ss.get('pd')) ? 'Entre para ver o resultado do seu pagamento.' : ''));
})();
