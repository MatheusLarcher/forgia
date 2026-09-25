// Refaz a conferência das medidas de uma rodada salva (estadoFinal do JSON), com as regras atuais de
// tests/agente-pedidos.mjs, e grava de volta. Uso: node tests/agente-reconferir.mjs antes p2
import fs from 'node:fs';
import path from 'node:path';
import { SCENARIOS } from './agente-pedidos.mjs';
import { ROOT } from './forgia-exe.mjs';

const [label, pedido] = process.argv.slice(2);
const file = path.join(ROOT, 'docs', 'fase-c-evidence', 'agente', label, `${pedido}.json`);
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
if (pedido === 'p4') throw new Error('p4 depende do estado de antes da montagem; rode de novo');
const check = SCENARIOS[pedido].check(r.estadoFinal, null);
r.conferencia = check;
r.medidasCertas = check.ok;
r.reconferido = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(r, null, 2));
console.log(JSON.stringify({ pedido, rotulo: label, medidasCertas: check.ok, motivo: check.motivo, argola: check.argola }, null, 1));
