#!/usr/bin/env node
/**
 * Gera keys MyPainel (padrão: 1 instalação / 1 VPS)
 *
 *   node tools/gen-license.js --days 365 --note "Cliente X"
 *   node tools/gen-license.js --days 0 --note "Vitalicio"
 *   node tools/gen-license.js --days 365 --slots 1
 *   node tools/gen-license.js --days 365 --slots 3   # até 3 VPS
 *   node tools/gen-license.js --count 5 --days 30
 */
const { generateLicense } = require('../license');

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  return args[i + 1] != null && !args[i + 1].startsWith('--') ? args[i + 1] : def;
}

const days = parseInt(arg('days', '365'), 10);
const note = arg('note', '');
const slots = parseInt(arg('slots', '1'), 10) || 1;
const count = Math.max(1, Math.min(50, parseInt(arg('count', '1'), 10) || 1));

if (process.env.LICENSE_SECRET) {
  console.log('Usando LICENSE_SECRET do ambiente.\n');
} else {
  console.log('Aviso: LICENSE_SECRET não definido — usando secret embutido do license.js\n');
}

for (let i = 0; i < count; i++) {
  const { key, payload, expiresAt } = generateLicense({ days, note, slots });
  console.log('─'.repeat(60));
  console.log('KEY:       ' + key);
  console.log('ID:        ' + payload.id);
  console.log('Expira:    ' + (expiresAt ? expiresAt.slice(0, 10) : 'nunca'));
  console.log('Instalações: ' + payload.slots + ' VPS');
  console.log('Nota:      ' + (payload.n || '—'));
}
console.log('─'.repeat(60));
console.log('\nNo .env do cliente:');
console.log('LICENSE_REQUIRED=1');
console.log('LICENSE_KEY=cole_a_key_aqui');
console.log('\n1ª vez que o painel subir, a key fica presa a essa VPS (data/license.bind).');
