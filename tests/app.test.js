import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedDatabase, transaction, demoCnpj, runScheduled } from '../server/database.js';
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
      method, headers: { Cookie: cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
  };
  const login = () => request('login', 'POST', { username: 'admin', password: 'test-password' });
  return { db, request, login };
}
const clientBody = (index = 4) => ({
  CNPJ: demoCnpj(index), razao_social: 'Garagem de testes (fictícia)', nome_fantasia: 'Teste',
  email: `cliente-${index}@example.invalid`, rua: 'Rua Teste', numero: '10A', bairro: 'Lindéia', cidade: 'Belo Horizonte', cep: '30000000',
  total_gasto: '7500.50', telefones: [{ numero: '5531999990099', tipo: 'Móvel' }, { numero: '553133330099', tipo: 'Fixo' }],
  interesses: ['Filtros', 'Freios'], preferencias: ['WhatsApp', 'Promoções'],
});
const campaignBody = () => ({
  ID_RESPONSAVEL: 2, titulo_oferta: 'Oferta teste', texto_mensagem: 'Olá, {nome}!',
  envio_mensagens: 'Rascunho', status: 'Ativo', clientes: [demoCnpj(1)], canais: [1],
});

test('autenticação, limite de tentativas, origem e logout', async t => {
  const { request, login } = await fixture(t);
  assert.equal((await request('clients')).status, 401);
  assert.equal((await request('login', 'POST')).status, 401);
  assert.equal((await request('login', 'POST', null)).status, 400);
  assert.equal((await request('login', 'POST', [])).status, 400);
  const result = await login();
  assert.equal(result.status, 200);
  assert.match(result.cookie, /HttpOnly; SameSite=Strict/);
  assert.equal((await request('me')).body.schemaVersion, 2);
  assert.equal((await request('channels', 'POST', { nome: 'Origem local' }, { Origin: 'http://127.0.0.1:5173' })).status, 201);
  assert.equal((await request('channels', 'POST', { nome: 'X' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('logout', 'POST')).status, 200);
  assert.equal((await request('dashboard')).status, 401);
  for (let i = 0; i < 10; i++) assert.equal((await request('login', 'POST', { password: 'wrong' })).status, 401);
  assert.equal((await login()).status, 429);
});

test('CLIENTE: CNPJ, e-mail único, limites, telefones e perfil 1:1', async t => {
  const { db, request, login } = await fixture(t);
  await login();
  const body = clientBody();
  assert.equal((await request('clients', 'POST', body)).status, 201);
  assert.equal((await request('clients', 'POST', body)).status, 409);
  const row = (await request('clients')).body.find(client => client.CNPJ === body.CNPJ);
  assert.equal(row.pais, 'Brasil');
  assert.equal(row.total_gasto, 7500.5);
  assert.equal(row.telefones.length, 2);
  assert.equal(row.interesses.length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM PERFIL_CLIENTE WHERE CNPJ_CLIENTE=?').get(body.CNPJ).n, 1);
  assert.equal((await request('clients', 'POST', { ...clientBody(5), email: body.email.toUpperCase() })).status, 409);
  for (const override of [
    { CNPJ: '12345678901234' }, { CNPJ: '00000000000000' }, { email: 'invalid' }, { cep: '123' },
    { total_gasto: -1 }, { total_gasto: '0.001' }, { total_gasto: '' }, { total_gasto: null },
    { razao_social: 'x'.repeat(151) }, { preferencias: ['WhatsApp', 'whatsapp'] },
    { telefones: [{ numero: '123' }] }, { interesses: 'Filtros' },
    { telefones: [{ numero: '5531999990099', tipo: 'Móvel' }, { numero: '5531999990099', tipo: 'Fixo' }] },
  ]) assert.equal((await request('clients', 'POST', { ...clientBody(6), ...override })).status, 400, JSON.stringify(override));
  assert.equal((await request(`clients/${body.CNPJ}`, 'PUT', { ...body, CNPJ: demoCnpj(7) })).status, 400);
  assert.equal((await request(`clients/${body.CNPJ}`, 'PUT', { ...body, interesses: ['Suspensão'], preferencias: [], telefones: [] })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM CLIENTE_TELEFONE WHERE CNPJ_CLIENTE=?').get(body.CNPJ).n, 0);
  assert.equal((await request(`clients/${body.CNPJ}`, 'DELETE')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM PERFIL_CLIENTE WHERE CNPJ_CLIENTE=?').get(body.CNPJ).n, 0);
  assert.equal((await request(`clients/${demoCnpj(999)}`, 'DELETE')).status, 404);
  assert.throws(() => transaction(db, () => db.prepare('INSERT INTO CLIENTE(CNPJ,razao_social,email) VALUES (?,?,?)').run(demoCnpj(20), 'Sem perfil', 'sem-perfil@example.invalid')), /FOREIGN KEY/);
  assert.throws(() => db.prepare('DELETE FROM PERFIL_CLIENTE WHERE CNPJ_CLIENTE=?').run(demoCnpj(1)), /FOREIGN KEY/);
});

test('segmentação combina interesse, preferência e limites inclusivos de gasto', async t => {
  const { request, login } = await fixture(t);
  await login();
  const result = await request('clients?interesse=filtros&preferencia=whatsapp&gasto_min=5400&gasto_max=12500');
  assert.equal(result.status, 200);
  assert.equal(result.body.length, 2);
  assert.equal((await request('clients?interesse=Filtros&gasto_min=12500&gasto_max=12500')).body[0].CNPJ, demoCnpj(1));
  assert.equal((await request('clients?interesse=Filtros&preferencia=Catálogo')).body.length, 0);
  assert.equal((await request('clients?interesse=suspensão')).body.length, 1);
  assert.equal((await request('clients?gasto_min=10&gasto_max=1')).status, 400);
  assert.equal((await request('clients?gasto_min=abc')).status, 400);
  const campaign = await request('campaigns', 'POST', { ...campaignBody(), clientes: undefined, filtros: { interesse: 'Filtros', preferencia: 'WhatsApp', gasto_min: 10000 } });
  assert.equal(campaign.status, 201);
  const saved = (await request('campaigns')).body.find(row => row.ID_CAMPANHA === campaign.body.ID_CAMPANHA);
  assert.deepEqual(saved.clientes, [demoCnpj(1)]);
  assert.equal((await request('campaigns', 'POST', { ...campaignBody(), filtros: { interesse: 'Inexistente' } })).status, 400);
});

test('FUNCIONARIO: especialização total/disjunta e supervisão sem ciclos', async t => {
  const { db, request, login } = await fixture(t);
  await login();
  const body = { nome: 'Responsável teste', especializacao: 'RESPONSAVEL_DIVULGACAO', ID_SUPERVISOR: 2 };
  const created = await request('employees', 'POST', body);
  assert.equal(created.status, 201);
  const id = created.body.ID_FUNCIONARIO;
  assert.equal(db.prepare('SELECT ID_SUPERVISOR FROM RESPONSAVEL_DIVULGACAO WHERE ID_RESPONSAVEL=?').get(id).ID_SUPERVISOR, 2);
  assert.equal((await request(`employees/${id}`, 'PUT', { ...body, nome: 'Atualizado' })).status, 200);
  assert.equal((await request('employees/1', 'PUT', { ...body, ID_SUPERVISOR: id })).status, 409);
  assert.equal(db.prepare('SELECT ID_SUPERVISOR FROM RESPONSAVEL_DIVULGACAO WHERE ID_RESPONSAVEL=1').get().ID_SUPERVISOR, null);
  assert.equal((await request(`employees/${id}`, 'PUT', { ...body, especializacao: 'ATENDENTE_WHATSAPP' })).status, 400);
  assert.equal((await request('employees', 'POST', { nome: 'Inválido', especializacao: 'ATENDENTE_WHATSAPP', ID_SUPERVISOR: 1 })).status, 400);
  assert.equal((await request('employees', 'POST', { ...body, ID_SUPERVISOR: 0 })).status, 400);
  assert.equal((await request('employees/1', 'DELETE')).status, 409);
  assert.equal((await request(`employees/${id}`, 'DELETE')).status, 200);
  assert.throws(() => transaction(db, () => db.exec("INSERT INTO FUNCIONARIO(ID_FUNCIONARIO,nome,especializacao,ID_RESPONSAVEL) VALUES (20,'Sem subtipo','RESPONSAVEL_DIVULGACAO',20)")), /FOREIGN KEY/);
  assert.throws(() => db.exec('INSERT INTO ATENDENTE_WHATSAPP(ID_ATENDENTE) VALUES (1)'), /Especialização/);
  assert.throws(() => db.exec("UPDATE FUNCIONARIO SET especializacao='ATENDENTE_WHATSAPP' WHERE ID_FUNCIONARIO=1"), /imutáveis/);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal((await request('campaigns/1', 'DELETE')).status, 200);
  for (const employee of [2, 1, 3]) assert.equal((await request(`employees/${employee}`, 'DELETE')).status, 200);
  seedDatabase(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM FUNCIONARIO').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM CLIENTE').get().n, 3);
});

test('CAMPANHA: responsável, clientes/canais obrigatórios, chave fraca, cancelamento e histórico', async t => {
  const { db, request, login } = await fixture(t);
  await login();
  for (const override of [
    { ID_RESPONSAVEL: 3 }, { clientes: [] }, { canais: [] }, { canais: [99] }, { clientes: [demoCnpj(99)] },
    { status: 'scheduled' }, { status: 'Inativo', envio_mensagens: 'Agendada' },
    { clientes: [demoCnpj(1), demoCnpj(1)] }, { canais: [1, 1] },
  ]) assert.equal((await request('campaigns', 'POST', { ...campaignBody(), ...override })).status, 400);
  const created = await request('campaigns', 'POST', campaignBody());
  const id = created.body.ID_CAMPANHA;
  assert.equal(created.status, 201);
  assert.equal((await request(`campaigns/${id}`, 'PUT', { ...campaignBody(), clientes: [demoCnpj(2)], canais: [1, 2] })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM UTILIZA WHERE ID_CAMPANHA=?').get(id).n, 2);
  const piece = { ID_CAMPANHA: id, numero_peca: 1, nome_arquivo: 'teste.pdf', formato: 'PDF', tipo: 'Panfleto' };
  assert.equal((await request('pieces', 'POST', piece)).status, 201);
  assert.equal((await request('pieces', 'POST', piece)).status, 409);
  assert.equal((await request(`pieces/${id}/1`, 'PUT', { ...piece, nome_arquivo: 'editado.pdf' })).status, 200);
  assert.equal((await request(`pieces/${id}/1`, 'PUT', { ...piece, numero_peca: 2 })).status, 400);
  assert.equal((await request('pieces', 'POST', { ...piece, numero_peca: 2, formato: 'JPG' })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM PECA_DIVULGACAO WHERE numero_peca=1').get().n, 2);
  assert.equal((await request(`campaigns/${id}/simulate`, 'POST')).status, 200);
  assert.equal((await request(`campaigns/${id}/simulate`, 'POST')).status, 409);
  assert.equal((await request(`campaigns/${id}`, 'DELETE')).status, 409);
  assert.equal((await request(`campaigns/${id}`, 'PUT', campaignBody())).status, 409);
  assert.equal((await request(`pieces/${id}/1`, 'DELETE')).status, 409);
  assert.equal((await request(`clients/${demoCnpj(2)}`, 'DELETE')).status, 409);
  assert.equal((await request('channels/1', 'DELETE')).status, 409);
  const unused = await request('campaigns', 'POST', campaignBody());
  assert.equal((await request(`campaigns/${unused.body.ID_CAMPANHA}/cancel`, 'POST')).status, 200);
  assert.equal((await request(`campaigns/${unused.body.ID_CAMPANHA}/simulate`, 'POST')).status, 409);
  assert.equal((await request(`campaigns/${unused.body.ID_CAMPANHA}`, 'DELETE')).status, 200);
});

test('RECEBE e INTERACAO: simulação, datas, atendente, múltiplas interações e publicações por canal', async t => {
  const { db, request, login } = await fixture(t);
  await login();
  const interaction = { CNPJ_CLIENTE: demoCnpj(1), ID_CAMPANHA: 1, ID_ATENDENTE: 3, tipo_interacao: 'Resposta fictícia', status: 'Interessado', data_hora: new Date().toISOString() };
  assert.equal((await request('interactions', 'POST', interaction)).status, 400);
  assert.equal((await request(`receives/1/${demoCnpj(1)}`, 'PUT', { data_visualizacao: new Date().toISOString() })).status, 409);
  assert.equal((await request('campaigns/1/simulate', 'POST')).body.destinatarios, 2);
  const records = (await request('receives')).body;
  assert.equal(records.filter(row => row.status_envio === 'Enviado').length, 2);
  assert.equal(records[0].data_visualizacao, null);
  assert.match(records[0].mensagem, /Garagem/);
  assert.equal(records[0].telefones.length, 2);
  assert.equal((await request('publications')).body.length, 1);
  const time = new Date().toISOString();
  assert.equal((await request(`receives/1/${demoCnpj(1)}`, 'PUT', { data_visualizacao: time })).status, 200);
  assert.equal((await request(`receives/1/${demoCnpj(1)}`, 'PUT', { data_visualizacao: '2000-01-01T00:00:00.000Z' })).status, 400);
  assert.equal((await request(`receives/1/${demoCnpj(1)}`, 'PUT', { data_visualizacao: null })).status, 200);
  const first = await request('interactions', 'POST', { ...interaction, data_hora: new Date().toISOString() });
  assert.equal(first.status, 201);
  const second = await request('interactions', 'POST', { ...interaction, data_hora: new Date().toISOString() });
  assert.equal(second.status, 201);
  assert.equal((await request('dashboard')).body.interacoes, 2);
  for (const override of [{ ID_ATENDENTE: 1 }, { ID_ATENDENTE: null }, { CNPJ_CLIENTE: demoCnpj(3) }, { data_hora: '2026-02-30T12:00:00.000Z' }, { data_hora: '2000-01-01T00:00:00.000Z' }]) {
    assert.equal((await request('interactions', 'POST', { ...interaction, ...override })).status, 400);
  }
  assert.equal((await request(`interactions/${first.body.ID_INTERACAO}`, 'PUT', { ...interaction, data_hora: new Date().toISOString(), status: 'Concluído' })).status, 200);
  assert.equal((await request(`interactions/${second.body.ID_INTERACAO}`, 'DELETE')).status, 200);
  assert.throws(() => db.prepare('INSERT INTO RECEBE(CNPJ_CLIENTE,ID_CAMPANHA) VALUES (?,1)').run(demoCnpj(1)), /UNIQUE/);
  const tables = (await request('database')).body;
  assert.equal(tables.length, 15);
  assert.deepEqual(tables.find(table => table.name === 'PECA_DIVULGACAO').columns.filter(column => column.pk).map(column => column.name), ['ID_CAMPANHA', 'numero_peca']);
  assert.equal(tables.find(table => table.name === 'INTERACAO_WHATSAPP').foreignKeys.some(fk => fk.table === 'ATENDENTE_WHATSAPP'), true);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('canais e publicações: CRUD e canal deve estar no relacionamento UTILIZA', async t => {
  const { request, login } = await fixture(t);
  await login();
  const channel = await request('channels', 'POST', { nome: 'Canal teste', tipo: 'Demo' });
  assert.equal(channel.status, 201);
  assert.equal((await request('channels', 'POST', { nome: 'Canal teste' })).status, 409);
  assert.equal((await request(`channels/${channel.body.ID_CANAL}`, 'PUT', { nome: 'Canal atualizado' })).status, 200);
  assert.equal((await request(`channels/${channel.body.ID_CANAL}`, 'DELETE')).status, 200);
  const now = new Date().toISOString();
  const body = { ID_CAMPANHA: 1, ID_CANAL: 1, data_publicacao: now.slice(0, 10), horario: now.slice(11, 19), conteudo: 'Publicação manual demonstrativa' };
  assert.equal((await request('publications', 'POST', { ...body, ID_CANAL: 2 })).status, 400);
  assert.equal((await request('publications', 'POST', { ...body, data_publicacao: '2026-02-30' })).status, 400);
  assert.equal((await request('publications', 'POST', { ...body, horario: '25:00:00' })).status, 400);
  const created = await request('publications', 'POST', body);
  assert.equal(created.status, 201);
  assert.equal((await request(`publications/${created.body.ID_PUBLICACAO}`, 'PUT', { ...body, conteudo: null })).status, 200);
  assert.equal((await request(`publications/${created.body.ID_PUBLICACAO}`, 'DELETE')).status, 200);
  assert.equal((await request('segments')).status, 404);
  assert.equal((await request('materials')).status, 404);
});

test('agendamento usa status Ativo/Inativo, é idempotente e ignora campanhas inativas', async t => {
  const { db, request, login } = await fixture(t);
  await login();
  const body = { ...campaignBody(), envio_mensagens: 'Agendada', data_agendamento: new Date(Date.now() + 60000).toISOString() };
  assert.equal((await request('campaigns', 'POST', { ...body, data_agendamento: new Date(0).toISOString() })).status, 400);
  assert.equal((await request('campaigns', 'POST', { ...body, data_agendamento: 'invalid' })).status, 400);
  const created = await request('campaigns', 'POST', body);
  assert.equal(created.status, 201);
  assert.equal((await request(`campaigns/${created.body.ID_CAMPANHA}`, 'DELETE')).status, 409);
  const inactive = await request('campaigns', 'POST', body);
  db.prepare("UPDATE CAMPANHA SET status='Inativo' WHERE ID_CAMPANHA=?").run(inactive.body.ID_CAMPANHA);
  assert.equal(runScheduled(db), 0);
  assert.equal(runScheduled(db, new Date(Date.now() + 120000).toISOString()), 1);
  assert.equal(runScheduled(db, new Date(Date.now() + 120000).toISOString()), 0);
  assert.equal((await request('dashboard')).body.simulacoes, 1);
});
