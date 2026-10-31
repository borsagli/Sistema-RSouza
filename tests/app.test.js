import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, seedDatabase, executeCampaign, runScheduled } from '../server/database.js';
import { createApp } from '../server/app.js';

async function fixture(t) {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  const app = createApp(db, { username: 'admin', password: 'test-password', secret: 'test-only-secret', company: 'Teste', secure: false, allowedOrigins: ['http://127.0.0.1:5173'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  let cookie = '';
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(base + path, {
      method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
  };
  const login = () => request('login', 'POST', { username: 'admin', password: 'test-password' });
  return { db, request, login };
}

test('autenticação, cookie protegido, origem e logout', async t => {
  const { request, login } = await fixture(t);
  assert.equal((await request('clients')).status, 401);
  assert.equal((await request('login', 'POST')).status, 401);
  assert.equal((await request('login', 'POST', { username: 'admin', password: 'wrong' })).status, 401);
  const result = await login();
  assert.equal(result.status, 200);
  assert.match(result.cookie, /HttpOnly; SameSite=Strict/);
  assert.equal((await request('me')).body.mode, 'demonstration');
  assert.equal((await request('segments', 'POST', { name: 'Origem de desenvolvimento' }, { Origin: 'http://127.0.0.1:5173' })).status, 201);
  assert.equal((await request('segments', 'POST', { name: 'X' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('logout', 'POST')).status, 200);
  assert.equal((await request('dashboard')).status, 401);
});

test('limite de tentativas de login', async t => {
  const { request } = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await request('login', 'POST', { password: 'wrong' })).status, 401);
  assert.equal((await request('login', 'POST', { password: 'wrong' })).status, 429);
});

test('CRUD, validação e integridade relacional', async t => {
  const { request, login } = await fixture(t);
  await login();
  assert.equal((await request('segments', 'POST')).status, 400);
  assert.equal((await request('segments', 'POST', [])).status, 400);
  const segment = await request('segments', 'POST', { name: 'Teste', description: 'Segmento temporário' });
  assert.equal(segment.status, 201);
  assert.equal((await request('segments', 'POST', { name: 'Teste' })).status, 409);
  assert.equal((await request(`segments/${segment.body.id}`, 'PUT', { name: 'Atualizado', description: 'Nova descrição' })).status, 200);
  const clientBody = { name: 'Contato teste', phone: '55 (31) 99999-0011', segment_id: segment.body.id, consent: true, active: true };
  const client = await request('clients', 'POST', clientBody);
  assert.equal(client.status, 201);
  assert.equal((await request('clients', 'POST', clientBody)).status, 409);
  assert.equal((await request('clients', 'POST', { ...clientBody, phone: '123' })).status, 400);
  assert.equal((await request('clients', 'POST', { ...clientBody, segment_id: 999 })).status, 400);
  assert.equal((await request(`clients/${client.body.id}`, 'PUT', { ...clientBody, active: false })).status, 200);
  assert.equal((await request(`segments/${segment.body.id}`, 'DELETE')).status, 409);
  assert.equal((await request(`clients/${client.body.id}`, 'DELETE')).status, 200);
  assert.equal((await request(`segments/${segment.body.id}`, 'DELETE')).status, 200);
  assert.equal((await request('clients/999', 'DELETE')).status, 404);
  assert.equal((await request('clients/nope', 'DELETE')).status, 400);
  assert.equal((await request('materials', 'POST', { title: 'X', message: 'Oi', image_url: 'javascript:alert(1)' })).status, 400);
  const material = await request('materials', 'POST', { title: 'Teste', message: 'Olá, {nome}!', image_url: 'https://example.com/image.png' });
  assert.equal(material.status, 201);
  assert.equal((await request(`materials/${material.body.id}`, 'PUT', { title: 'Atualizado', message: 'Nova mensagem' })).status, 200);
  assert.equal((await request(`materials/${material.body.id}`, 'DELETE')).status, 200);
});

test('simulação segmentada, consentimento, histórico e respostas', async t => {
  const { db, request, login } = await fixture(t);
  await login();
  db.prepare('UPDATE clients SET active=0 WHERE id=2').run();
  const result = await request('campaigns/1/simulate', 'POST');
  assert.equal(result.status, 200);
  assert.equal(result.body.recipients, 1);
  assert.equal(result.body.mode, 'demonstration');
  assert.equal((await request('campaigns/1/simulate', 'POST')).status, 409);
  const deliveries = (await request('deliveries')).body;
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0].message, /Oficina Horizonte/);
  assert.equal((await request('campaigns/1', 'DELETE')).status, 409);
  assert.equal((await request('clients/1', 'DELETE')).status, 409);
  assert.equal((await request(`deliveries/${deliveries[0].id}`, 'PUT', { response: 'interested', notes: 'Solicitou orçamento.' })).status, 200);
  assert.equal((await request('dashboard')).body.interested, 1);
  const repeated = await request('campaigns', 'POST', { name: 'Outra campanha', segment_id: 1, material_id: 1, status: 'draft' });
  assert.equal((await request(`campaigns/${repeated.body.id}/simulate`, 'POST')).status, 200);
  const secondDelivery = (await request('deliveries')).body.find(item => item.campaign_id === repeated.body.id);
  assert.equal((await request(`deliveries/${secondDelivery.id}`, 'PUT', { response: 'interested' })).status, 200);
  assert.equal((await request('dashboard')).body.interested, 1);
  assert.equal((await request(`deliveries/${deliveries[0].id}`, 'PUT', { response: 'read' })).status, 400);
  assert.equal((await request('deliveries/999', 'PUT', { response: 'pending' })).status, 404);
  const tables = (await request('database')).body;
  assert.equal(tables.find(table => table.name === 'deliveries').count, 2);
  assert.equal(tables.find(table => table.name === 'clients').foreignKeys[0].table, 'segments');
});

test('agendamento, cancelamento e execução idempotente após retomada', async t => {
  const { db, request, login } = await fixture(t);
  await login();
  const body = { name: 'Agendada', segment_id: 1, material_id: 1, status: 'scheduled', scheduled_at: new Date(Date.now() + 60_000).toISOString() };
  assert.equal((await request('campaigns', 'POST', { ...body, scheduled_at: 'invalid' })).status, 400);
  assert.equal((await request('campaigns', 'POST', { ...body, scheduled_at: new Date(0).toISOString() })).status, 400);
  const created = await request('campaigns', 'POST', body);
  assert.equal(created.status, 201);
  assert.equal(runScheduled(db), 0);
  const future = new Date(Date.now() + 120_000).toISOString();
  assert.equal(runScheduled(db, future), 1);
  assert.equal(runScheduled(db, future), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n, 2);
  const cancelled = await request('campaigns', 'POST', { ...body, name: 'Cancelada' });
  assert.equal((await request(`campaigns/${cancelled.body.id}`, 'DELETE')).status, 409);
  assert.equal((await request(`campaigns/${cancelled.body.id}/cancel`, 'POST')).status, 200);
  assert.equal(runScheduled(db, future), 0);
  assert.equal((await request(`campaigns/${cancelled.body.id}`, 'DELETE')).status, 200);
  assert.equal((await request(`campaigns/${created.body.id}`, 'PUT', body)).status, 409);
});

test('campanha sem destinatários e persistência após reabrir o banco', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rsouza-test-'));
  let db;
  try {
    const path = join(directory, 'test.sqlite');
    db = openDatabase(path);
    seedDatabase(db);
    db.prepare('UPDATE clients SET consent=0').run();
    assert.equal(executeCampaign(db, 1), 0);
    assert.equal(db.prepare('SELECT status FROM campaigns WHERE id=1').get().status, 'completed');
    db.close();
    db = openDatabase(path);
    seedDatabase(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 4);
    assert.equal(db.prepare('SELECT status FROM campaigns WHERE id=1').get().status, 'completed');
    assert.throws(() => executeCampaign(db, 999), /não encontrada/);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true });
  }
});
