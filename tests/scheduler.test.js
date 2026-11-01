import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('servidor executa uma campanha automaticamente no intervalo do agendador', { timeout: 25_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'rsouza-scheduler-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env, NODE_ENV: 'test', PORT: '0',
      DATABASE_PATH: join(directory, 'scheduler.sqlite'),
      ADMIN_USER: 'admin', ADMIN_PASSWORD: 'scheduler-test',
      SESSION_SECRET: 'scheduler-test-only', COOKIE_SECURE: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(directory, { recursive: true });
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Servidor não iniciou: ${output}`)), 8000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Servidor encerrou (${code}): ${output}`)); });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(`${match[0]}/api/`); }
    });
  });
  const login = await fetch(base + 'login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'scheduler-test' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(base + 'campaigns', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ID_RESPONSAVEL: 2, titulo_oferta: 'Teste do relógio real', texto_mensagem: 'Mensagem demonstrativa',
      status: 'Ativo', envio_mensagens: 'Agendada', canais: [1], filtros: { interesse: 'Filtros' },
      data_agendamento: new Date(Date.now() + 1000).toISOString() }),
  });
  assert.equal(response.status, 201);
  const { ID_CAMPANHA: id } = await response.json();
  const deadline = Date.now() + 16_000;
  let campaign;
  do {
    await delay(500);
    const response = await fetch(base + 'campaigns', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    campaign = (await response.json()).find(item => item.ID_CAMPANHA === id);
  } while (campaign.envio_mensagens !== 'Simulada' && Date.now() < deadline);
  assert.equal(campaign.status, 'Ativo');
  assert.equal(campaign.envio_mensagens, 'Simulada');
  assert.equal(campaign.simulados, 2);
  const receives = await fetch(base + 'receives', { headers: { Cookie: cookie } });
  assert.equal((await receives.json()).filter(row => row.status_envio === 'Enviado').length, 2);
});
