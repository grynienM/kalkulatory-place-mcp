#!/usr/bin/env node
// Handshake test against the real server process — the only thing worth testing here.
//
// This package has no dependencies and no business logic beyond URL building, so a unit test
// would test nothing. What can actually break is the protocol contract: a client sends
// `initialize`, expects one framed reply, sends `notifications/initialized` (which must NOT be
// answered — replying to a notification is a protocol error), then `tools/list` and `tools/call`.
//
// The last step compares the returned net amount against a figure published on the website,
// which catches the failure this package exists to prevent: the server drifting away from the
// pages it cites in `zrodlo`.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KATALOG = dirname(fileURLToPath(import.meta.url));
const serwer = spawn(process.execPath, [join(KATALOG, 'index.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
const czytnik = createInterface({ input: serwer.stdout });

const oczekujace = new Map();
czytnik.on('line', (linia) => {
  if (!linia.trim()) return;
  let w;
  try {
    w = JSON.parse(linia);
  } catch {
    throw new Error(`server wrote a non-JSON line: ${linia.slice(0, 120)}`);
  }
  const czeka = oczekujace.get(w.id);
  if (!czeka) throw new Error(`unexpected frame with id ${w.id} — did the server answer a notification?`);
  oczekujace.delete(w.id);
  czeka(w);
});

let licznik = 0;
const wyslij = (method, params) =>
  new Promise((ok, zle) => {
    const id = ++licznik;
    oczekujace.set(id, (w) => (w.error ? zle(new Error(`${method}: ${w.error.message}`)) : ok(w.result)));
    serwer.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => oczekujace.has(id) && zle(new Error(`${method}: no reply within 20 s`)), 20000);
  });

const sprawdz = (warunek, opis) => {
  if (!warunek) throw new Error(opis);
  console.log('  ok  ' + opis);
};

try {
  const init = await wyslij('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  sprawdz(init.serverInfo?.name === 'kalkulatory-place', 'initialize returns serverInfo.name');
  sprawdz(!!init.capabilities?.tools, 'server advertises the tools capability');

  // A notification carries no id and must not be answered. If the server replies, the frame
  // arrives with id undefined and the line handler above throws.
  serwer.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await new Promise((r) => setTimeout(r, 300));
  sprawdz(true, 'notifications/initialized is not answered');

  const lista = await wyslij('tools/list', {});
  const nazwy = lista.tools.map((t) => t.name).sort();
  sprawdz(nazwy.length === 5, `tools/list returns 5 tools (${nazwy.join(', ')})`);
  for (const t of lista.tools) {
    sprawdz(!!t.description && !!t.inputSchema, `${t.name} has a description and an input schema`);
  }

  const wywolanie = await wyslij('tools/call', { name: 'brutto_na_netto', arguments: { brutto: 6000 } });
  const dane = JSON.parse(wywolanie.content[0].text);
  sprawdz(dane.etat?.netto === 4420.43, `6000 gross → ${dane.etat?.netto} net, as published on the site`);
  sprawdz(typeof dane.stanPrawnyNa === 'string', 'response carries stanPrawnyNa');
  sprawdz(String(dane.zrodlo || '').startsWith('https://'), `response carries a source URL (${dane.zrodlo})`);

  const bledne = await wyslij('tools/call', { name: 'brutto_na_netto', arguments: { brutto: 999999 } });
  sprawdz(bledne.isError === true, 'an off-grid amount returns a tool error, not a crash');

  console.log('\nOK');
  process.exit(0);
} catch (e) {
  console.error('\nFAILED: ' + e.message);
  process.exit(1);
} finally {
  serwer.kill();
}
