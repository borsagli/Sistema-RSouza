import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { TABLES, executeCampaign, transaction, insertEmployee, listClients, filterClients, fail } from './database.js';
import { text, idOf, cnpjOf, money, filtersOf, arrayOf, enumOf, timestamp, dateOnly } from './validation.js';

function exists(db, table, column, value) {
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(value)) fail(400, 'Selecione um registro existente e compatível.');
  return value;
}
function requireRow(db, table, column, value) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE ${column}=?`).get(value);
  if (!row) fail(404, 'Registro não encontrado.');
  return row;
}
function supervisorOf(db, value) {
  if (value === undefined || value === null || value === '') return null;
  return exists(db, 'RESPONSAVEL_DIVULGACAO', 'ID_RESPONSAVEL', idOf(value));
}
const campaignQuery = `
  SELECT c.*,f.nome AS responsavel_nome,
    (SELECT COUNT(*) FROM RECEBE r WHERE r.ID_CAMPANHA=c.ID_CAMPANHA) AS destinatarios,
    (SELECT COUNT(*) FROM RECEBE r WHERE r.ID_CAMPANHA=c.ID_CAMPANHA AND r.status_envio='Enviado') AS simulados
  FROM CAMPANHA c JOIN FUNCIONARIO f ON f.ID_FUNCIONARIO=c.ID_RESPONSAVEL ORDER BY c.ID_CAMPANHA DESC
`;
function listCampaigns(db) {
  return db.prepare(campaignQuery).all().map(c => ({
    ...c,
    clientes: db.prepare('SELECT CNPJ_CLIENTE FROM RECEBE WHERE ID_CAMPANHA=? ORDER BY CNPJ_CLIENTE').all(c.ID_CAMPANHA).map(row => row.CNPJ_CLIENTE),
    canais: db.prepare('SELECT ID_CANAL FROM UTILIZA WHERE ID_CAMPANHA=? ORDER BY ID_CANAL').all(c.ID_CAMPANHA).map(row => row.ID_CANAL),
  }));
}
function editableCampaign(db, id) {
  const campaign = requireRow(db, 'CAMPANHA', 'ID_CAMPANHA', id);
  if (campaign.envio_mensagens === 'Simulada') fail(409, 'Campanha simulada é imutável para preservar o histórico.');
  return campaign;
}

export function createApp(db, config) {
  const app = express();
  const sessions = new Map();
  const attempts = new Map();
  const salt = randomBytes(16);
  const passwordHash = scryptSync(config.password, salt, 64);
  const sign = value => createHmac('sha256', config.secret).update(value).digest('hex');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const allowed = [`${req.protocol}://${req.get('host')}`, ...(config.allowedOrigins || [])];
      if (origin && !allowed.includes(origin)) return res.status(403).json({ error: 'Origem não autorizada.' });
    }
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Envie um objeto JSON.' });
    next();
  });
  app.post('/api/login', (req, res) => {
    const now = Date.now();
    for (const [ip, item] of attempts) if (item.until <= now) attempts.delete(ip);
    const attempt = attempts.get(req.ip) || { count: 0, until: now + 15 * 60_000 };
    if (attempt.count >= 10) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
    attempt.count++;
    attempts.set(req.ip, attempt);
    const password = typeof req.body.password === 'string' && req.body.password.length <= 200 ? req.body.password : '';
    if (!timingSafeEqual(passwordHash, scryptSync(password, salt, 64)) || req.body.username !== config.username) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    attempts.delete(req.ip);
    for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, now + 8 * 60 * 60_000);
    res.set('Set-Cookie', `rsouza_session=${token}.${sign(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${config.secure ? '; Secure' : ''}`).json({ username: config.username });
  });
  app.use('/api', (req, res, next) => {
    const raw = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('rsouza_session='))?.slice(15);
    const [token, signature] = (raw || '').split('.');
    if (!token || signature !== sign(token) || !sessions.has(token) || sessions.get(token) <= Date.now()) {
      if (token) sessions.delete(token);
      return res.status(401).json({ error: 'Entre para acessar o sistema.' });
    }
    req.sessionToken = token;
    next();
  });
  app.get('/api/me', (req, res) => res.json({ username: config.username, company: config.company, mode: 'demonstration', schemaVersion: 2 }));
  app.post('/api/logout', (req, res) => {
    sessions.delete(req.sessionToken);
    res.set('Set-Cookie', 'rsouza_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0').json({ ok: true });
  });
  app.get('/api/dashboard', (req, res) => res.json({
    clientes: db.prepare('SELECT COUNT(*) AS n FROM CLIENTE').get().n,
    campanhas: db.prepare('SELECT COUNT(*) AS n FROM CAMPANHA').get().n,
    agendadas: db.prepare("SELECT COUNT(*) AS n FROM CAMPANHA WHERE status='Ativo' AND envio_mensagens='Agendada'").get().n,
    simulacoes: db.prepare("SELECT COUNT(*) AS n FROM RECEBE WHERE status_envio='Enviado'").get().n,
    interacoes: db.prepare('SELECT COUNT(*) AS n FROM INTERACAO_WHATSAPP').get().n,
    recentes: listCampaigns(db).slice(0, 5),
  }));
  app.get('/api/database', (req, res) => res.json(TABLES.map(name => ({
    name,
    columns: db.prepare(`PRAGMA table_info(${name})`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${name})`).all(),
    count: db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,
    rows: db.prepare(`SELECT * FROM ${name} ORDER BY rowid DESC LIMIT 20`).all(),
  }))));
  app.get('/api/clients', (req, res) => res.json(filterClients(listClients(db), filtersOf(req.query))));
  function clientInput(body) {
    const email = text(body.email, 'E-mail', 100).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'E-mail inválido.');
    const cep = text(body.cep, 'CEP', 9, true)?.replace('-', '') || null;
    if (cep && !/^\d{8}$/.test(cep)) fail(400, 'CEP deve ter oito dígitos.');
    const phones = arrayOf(body.telefones, 'Telefones', phone => {
      if (!phone || typeof phone !== 'object') fail(400, 'Telefone inválido.');
      const numero = text(phone.numero, 'Telefone', 20).replace(/[+ ()-]/g, '');
      if (!/^55\d{10,11}$/.test(numero)) fail(400, 'Telefone deve conter 55 + DDD + número.');
      const tipo = text(phone.tipo, 'Tipo do telefone', 30, true);
      if (tipo) enumOf(tipo, ['Móvel', 'Fixo'], 'Tipo do telefone');
      return { numero, tipo };
    });
    if (new Set(phones.map(phone => phone.numero)).size !== phones.length) fail(400, 'Números de telefone duplicados.');
    return {
      values: [
        text(body.razao_social, 'Razão social', 150), text(body.nome_fantasia, 'Nome fantasia', 100, true), email,
        text(body.rua, 'Rua', 100, true), text(body.numero, 'Número', 10, true), text(body.bairro, 'Bairro', 50, true),
        text(body.cidade, 'Cidade', 50, true), body.pais === undefined ? 'Brasil' : text(body.pais, 'País', 50, true), cep,
        money(body.total_gasto === undefined ? 0 : body.total_gasto),
      ],
      phones,
      interests: arrayOf(body.interesses, 'Interesses', item => text(item, 'Interesse', 100)),
      preferences: arrayOf(body.preferencias, 'Preferências', item => text(item, 'Preferência', 100)),
    };
  }
  const clientColumns = 'razao_social,nome_fantasia,email,rua,numero,bairro,cidade,pais,cep,total_gasto'.split(',');
  function saveProfile(cnpj, input) {
    for (const table of ['CLIENTE_TELEFONE', 'CLIENTE_INTERESSE', 'CLIENTE_PREFERENCIA']) db.prepare(`DELETE FROM ${table} WHERE CNPJ_CLIENTE=?`).run(cnpj);
    for (const phone of input.phones) db.prepare('INSERT INTO CLIENTE_TELEFONE(CNPJ_CLIENTE,numero,tipo) VALUES (?,?,?)').run(cnpj, phone.numero, phone.tipo);
    for (const item of input.interests) db.prepare('INSERT INTO CLIENTE_INTERESSE(CNPJ_CLIENTE,interesse) VALUES (?,?)').run(cnpj, item);
    for (const item of input.preferences) db.prepare('INSERT INTO CLIENTE_PREFERENCIA(CNPJ_CLIENTE,preferencia) VALUES (?,?)').run(cnpj, item);
  }
  app.post('/api/clients', (req, res) => {
    const cnpj = cnpjOf(req.body.CNPJ);
    const input = clientInput(req.body);
    transaction(db, () => {
      db.prepare(`INSERT INTO CLIENTE(CNPJ,${clientColumns.join(',')}) VALUES (${Array(11).fill('?').join(',')})`).run(cnpj, ...input.values);
      db.prepare('INSERT INTO PERFIL_CLIENTE(CNPJ_CLIENTE) VALUES (?)').run(cnpj);
      saveProfile(cnpj, input);
    });
    res.status(201).json({ CNPJ: cnpj });
  });
  app.put('/api/clients/:cnpj', (req, res) => {
    const cnpj = cnpjOf(req.params.cnpj);
    requireRow(db, 'CLIENTE', 'CNPJ', cnpj);
    if (req.body.CNPJ !== undefined && cnpjOf(req.body.CNPJ) !== cnpj) fail(400, 'CNPJ é imutável.');
    const input = clientInput(req.body);
    transaction(db, () => {
      db.prepare(`UPDATE CLIENTE SET ${clientColumns.map(column => `${column}=?`).join(',')} WHERE CNPJ=?`).run(...input.values, cnpj);
      saveProfile(cnpj, input);
    });
    res.json({ ok: true });
  });
  app.delete('/api/clients/:cnpj', (req, res) => {
    const cnpj = cnpjOf(req.params.cnpj);
    requireRow(db, 'CLIENTE', 'CNPJ', cnpj);
    transaction(db, () => db.prepare('DELETE FROM CLIENTE WHERE CNPJ=?').run(cnpj));
    res.json({ ok: true });
  });
  const employeeQuery = `SELECT f.*,r.ID_SUPERVISOR,s.nome AS supervisor_nome FROM FUNCIONARIO f
    LEFT JOIN RESPONSAVEL_DIVULGACAO r ON r.ID_RESPONSAVEL=f.ID_FUNCIONARIO
    LEFT JOIN FUNCIONARIO s ON s.ID_FUNCIONARIO=r.ID_SUPERVISOR ORDER BY f.ID_FUNCIONARIO`;
  app.get('/api/employees', (req, res) => res.json(db.prepare(employeeQuery).all()));
  app.post('/api/employees', (req, res) => {
    const name = text(req.body.nome, 'Nome', 100);
    const role = enumOf(req.body.especializacao, ['RESPONSAVEL_DIVULGACAO', 'ATENDENTE_WHATSAPP'], 'Especialização');
    const supervisor = supervisorOf(db, req.body.ID_SUPERVISOR);
    if (role === 'ATENDENTE_WHATSAPP' && supervisor) fail(400, 'Somente responsáveis possuem supervisor.');
    const id = transaction(db, () => insertEmployee(db, name, role, supervisor));
    res.status(201).json({ ID_FUNCIONARIO: id });
  });
  app.put('/api/employees/:id', (req, res) => {
    const id = idOf(req.params.id);
    const row = requireRow(db, 'FUNCIONARIO', 'ID_FUNCIONARIO', id);
    if (req.body.especializacao !== row.especializacao) fail(400, 'A especialização é imutável e disjunta.');
    const name = text(req.body.nome, 'Nome', 100);
    const supervisor = supervisorOf(db, req.body.ID_SUPERVISOR);
    if (row.especializacao === 'ATENDENTE_WHATSAPP' && supervisor) fail(400, 'Atendente não possui supervisor.');
    transaction(db, () => {
      db.prepare('UPDATE FUNCIONARIO SET nome=? WHERE ID_FUNCIONARIO=?').run(name, id);
      if (row.especializacao === 'RESPONSAVEL_DIVULGACAO') db.prepare('UPDATE RESPONSAVEL_DIVULGACAO SET ID_SUPERVISOR=? WHERE ID_RESPONSAVEL=?').run(supervisor, id);
    });
    res.json({ ok: true });
  });
  app.delete('/api/employees/:id', (req, res) => {
    const id = idOf(req.params.id);
    requireRow(db, 'FUNCIONARIO', 'ID_FUNCIONARIO', id);
    transaction(db, () => db.prepare('DELETE FROM FUNCIONARIO WHERE ID_FUNCIONARIO=?').run(id));
    res.json({ ok: true });
  });
  app.get('/api/campaigns', (req, res) => res.json(listCampaigns(db)));
  function campaignInput(body) {
    const responsible = exists(db, 'RESPONSAVEL_DIVULGACAO', 'ID_RESPONSAVEL', idOf(body.ID_RESPONSAVEL));
    const state = enumOf(body.envio_mensagens === undefined ? 'Rascunho' : body.envio_mensagens, ['Rascunho', 'Agendada', 'Cancelada'], 'Execução');
    const status = enumOf(body.status === undefined ? 'Ativo' : body.status, ['Ativo', 'Inativo'], 'Status');
    if (state === 'Agendada' && status !== 'Ativo') fail(400, 'Uma campanha agendada deve estar ativa.');
    if (state === 'Cancelada' && status !== 'Inativo') fail(400, 'Uma campanha cancelada deve estar inativa.');
    let schedule = null;
    if (state === 'Agendada') {
      schedule = timestamp(body.data_agendamento, 'Agendamento');
      if (Date.parse(schedule) <= Date.now()) fail(400, 'Agendamento deve ser futuro.');
    }
    const clients = body.filtros !== undefined && body.filtros !== null
      ? filterClients(listClients(db), filtersOf(body.filtros)).map(client => client.CNPJ)
      : arrayOf(body.clientes, 'Clientes', value => exists(db, 'CLIENTE', 'CNPJ', cnpjOf(value)), 10000);
    const channels = arrayOf(body.canais, 'Canais', value => exists(db, 'CANAL_DIVULGACAO', 'ID_CANAL', idOf(value)));
    if (!clients.length || !channels.length) fail(400, 'A campanha deve possuir pelo menos um cliente e um canal.');
    return { values: [responsible, text(body.titulo_oferta, 'Título da oferta', 100), text(body.texto_mensagem, 'Mensagem', 4000), state, schedule, status], clients, channels };
  }
  function saveAudience(id, input) {
    db.prepare('DELETE FROM RECEBE WHERE ID_CAMPANHA=?').run(id);
    db.prepare('DELETE FROM UTILIZA WHERE ID_CAMPANHA=?').run(id);
    for (const cnpj of input.clients) db.prepare('INSERT INTO RECEBE(CNPJ_CLIENTE,ID_CAMPANHA) VALUES (?,?)').run(cnpj, id);
    for (const channel of input.channels) db.prepare('INSERT INTO UTILIZA(ID_CAMPANHA,ID_CANAL) VALUES (?,?)').run(id, channel);
  }
  app.post('/api/campaigns', (req, res) => {
    const input = campaignInput(req.body);
    const id = transaction(db, () => {
      const result = db.prepare('INSERT INTO CAMPANHA(ID_RESPONSAVEL,titulo_oferta,texto_mensagem,envio_mensagens,data_agendamento,status) VALUES (?,?,?,?,?,?)').run(...input.values);
      const id = Number(result.lastInsertRowid);
      saveAudience(id, input);
      return id;
    });
    res.status(201).json({ ID_CAMPANHA: id });
  });
  app.put('/api/campaigns/:id', (req, res) => {
    const id = idOf(req.params.id);
    editableCampaign(db, id);
    const input = campaignInput(req.body);
    transaction(db, () => {
      db.prepare('UPDATE CAMPANHA SET ID_RESPONSAVEL=?,titulo_oferta=?,texto_mensagem=?,envio_mensagens=?,data_agendamento=?,status=? WHERE ID_CAMPANHA=?').run(...input.values, id);
      saveAudience(id, input);
    });
    res.json({ ok: true });
  });
  app.post('/api/campaigns/:id/simulate', (req, res) => res.json({ destinatarios: executeCampaign(db, idOf(req.params.id)), mode: 'demonstration' }));
  app.post('/api/campaigns/:id/cancel', (req, res) => {
    const id = idOf(req.params.id);
    const campaign = editableCampaign(db, id);
    if (campaign.envio_mensagens === 'Cancelada') fail(409, 'Campanha já cancelada.');
    db.prepare("UPDATE CAMPANHA SET envio_mensagens='Cancelada',status='Inativo' WHERE ID_CAMPANHA=?").run(id);
    res.json({ ok: true });
  });
  app.delete('/api/campaigns/:id', (req, res) => {
    const id = idOf(req.params.id);
    const campaign = editableCampaign(db, id);
    if (campaign.envio_mensagens === 'Agendada') fail(409, 'Cancele o agendamento antes de excluir.');
    transaction(db, () => {
      db.prepare('DELETE FROM RECEBE WHERE ID_CAMPANHA=?').run(id);
      db.prepare('DELETE FROM UTILIZA WHERE ID_CAMPANHA=?').run(id);
      db.prepare('DELETE FROM CAMPANHA WHERE ID_CAMPANHA=?').run(id);
    });
    res.json({ ok: true });
  });
  app.get('/api/receives', (req, res) => {
    const clients = new Map(listClients(db).map(client => [client.CNPJ, client]));
    res.json(db.prepare(`SELECT r.*,c.titulo_oferta,c.texto_mensagem FROM RECEBE r JOIN CAMPANHA c ON c.ID_CAMPANHA=r.ID_CAMPANHA ORDER BY r.ID_CAMPANHA DESC,r.CNPJ_CLIENTE`).all().map(row => ({
      ...row, cliente_nome: clients.get(row.CNPJ_CLIENTE).razao_social,
      telefones: clients.get(row.CNPJ_CLIENTE).telefones,
      mensagem: row.texto_mensagem.replaceAll('{nome}', clients.get(row.CNPJ_CLIENTE).nome_fantasia || clients.get(row.CNPJ_CLIENTE).razao_social),
    })));
  });
  app.put('/api/receives/:campaign/:cnpj', (req, res) => {
    const id = idOf(req.params.campaign), cnpj = cnpjOf(req.params.cnpj);
    const row = db.prepare('SELECT * FROM RECEBE WHERE ID_CAMPANHA=? AND CNPJ_CLIENTE=?').get(id, cnpj);
    if (!row) fail(404, 'Destinatário não encontrado.');
    if (row.status_envio !== 'Enviado') fail(409, 'Registre visualização somente após a simulação.');
    const time = req.body.data_visualizacao === null ? null : timestamp(req.body.data_visualizacao, 'Visualização');
    if (time && (time < row.data_envio || Date.parse(time) > Date.now())) fail(400, 'Visualização deve estar entre o envio simulado e o momento atual.');
    db.prepare('UPDATE RECEBE SET data_visualizacao=? WHERE ID_CAMPANHA=? AND CNPJ_CLIENTE=?').run(time, id, cnpj);
    res.json({ ok: true });
  });
  const resources = {
    channels: {
      table: 'CANAL_DIVULGACAO', pk: 'ID_CANAL', columns: ['nome', 'tipo'],
      query: 'SELECT * FROM CANAL_DIVULGACAO ORDER BY ID_CANAL',
      input: body => [text(body.nome, 'Nome do canal', 50), text(body.tipo, 'Tipo do canal', 50, true)],
    },
    publications: {
      table: 'PUBLICACAO_CANAL', pk: 'ID_PUBLICACAO', columns: ['ID_CAMPANHA', 'ID_CANAL', 'data_publicacao', 'horario', 'conteudo'],
      query: `SELECT p.*,c.titulo_oferta,ca.nome AS canal_nome FROM PUBLICACAO_CANAL p JOIN CAMPANHA c ON c.ID_CAMPANHA=p.ID_CAMPANHA JOIN CANAL_DIVULGACAO ca ON ca.ID_CANAL=p.ID_CANAL ORDER BY p.ID_PUBLICACAO DESC`,
      input: body => {
        const id = idOf(body.ID_CAMPANHA), channel = idOf(body.ID_CANAL);
        if (!db.prepare('SELECT 1 FROM UTILIZA WHERE ID_CAMPANHA=? AND ID_CANAL=?').get(id, channel)) fail(400, 'O canal deve estar vinculado à campanha pelo relacionamento UTILIZA.');
        const date = dateOnly(body.data_publicacao);
        const time = text(body.horario, 'Horário UTC', 8);
        if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time) || Date.parse(`${date}T${time}.000Z`) > Date.now()) fail(400, 'Informe data e horário UTC válidos, não futuros.');
        return [id, channel, date, time, text(body.conteudo, 'Conteúdo', 10000, true)];
      },
    },
    interactions: {
      table: 'INTERACAO_WHATSAPP', pk: 'ID_INTERACAO', columns: ['CNPJ_CLIENTE', 'ID_CAMPANHA', 'ID_ATENDENTE', 'data_hora', 'tipo_interacao', 'status'],
      query: `SELECT i.*,cl.razao_social AS cliente_nome,c.titulo_oferta,f.nome AS atendente_nome FROM INTERACAO_WHATSAPP i
        JOIN CLIENTE cl ON cl.CNPJ=i.CNPJ_CLIENTE JOIN CAMPANHA c ON c.ID_CAMPANHA=i.ID_CAMPANHA JOIN FUNCIONARIO f ON f.ID_FUNCIONARIO=i.ID_ATENDENTE ORDER BY i.ID_INTERACAO DESC`,
      input: body => {
        const cnpj = cnpjOf(body.CNPJ_CLIENTE), id = idOf(body.ID_CAMPANHA);
        const receives = db.prepare('SELECT * FROM RECEBE WHERE ID_CAMPANHA=? AND CNPJ_CLIENTE=?').get(id, cnpj);
        if (!receives || receives.status_envio !== 'Enviado') fail(400, 'A interação deve pertencer a um cliente que recebeu esta campanha simulada.');
        const attendant = exists(db, 'ATENDENTE_WHATSAPP', 'ID_ATENDENTE', idOf(body.ID_ATENDENTE));
        const time = timestamp(body.data_hora, 'Interação');
        if (time < receives.data_envio || Date.parse(time) > Date.now()) fail(400, 'Interação deve ocorrer após o envio simulado e não pode ser futura.');
        return [cnpj, id, attendant, time, text(body.tipo_interacao, 'Tipo de interação', 50, true), text(body.status, 'Status da interação', 30)];
      },
    },
  };
  for (const [route, resource] of Object.entries(resources)) {
    app.get(`/api/${route}`, (req, res) => res.json(db.prepare(resource.query).all()));
    app.post(`/api/${route}`, (req, res) => {
      const values = resource.input(req.body);
      const result = db.prepare(`INSERT INTO ${resource.table}(${resource.columns.join(',')}) VALUES (${values.map(() => '?').join(',')})`).run(...values);
      res.status(201).json({ [resource.pk]: Number(result.lastInsertRowid) });
    });
    app.put(`/api/${route}/:id`, (req, res) => {
      const id = idOf(req.params.id);
      requireRow(db, resource.table, resource.pk, id);
      const values = resource.input(req.body);
      db.prepare(`UPDATE ${resource.table} SET ${resource.columns.map(column => `${column}=?`).join(',')} WHERE ${resource.pk}=?`).run(...values, id);
      res.json({ ok: true });
    });
    app.delete(`/api/${route}/:id`, (req, res) => {
      const id = idOf(req.params.id);
      requireRow(db, resource.table, resource.pk, id);
      db.prepare(`DELETE FROM ${resource.table} WHERE ${resource.pk}=?`).run(id);
      res.json({ ok: true });
    });
  }
  app.get('/api/pieces', (req, res) => res.json(db.prepare('SELECT p.*,c.titulo_oferta FROM PECA_DIVULGACAO p JOIN CAMPANHA c ON c.ID_CAMPANHA=p.ID_CAMPANHA ORDER BY p.ID_CAMPANHA DESC,p.numero_peca').all()));
  function pieceInput(body) {
    return [text(body.tipo, 'Tipo da peça', 50, true), text(body.nome_arquivo, 'Nome do arquivo', 100), enumOf(body.formato, ['PDF', 'PNG', 'MP4'], 'Formato')];
  }
  app.post('/api/pieces', (req, res) => {
    const id = idOf(req.body.ID_CAMPANHA), number = idOf(req.body.numero_peca);
    editableCampaign(db, id);
    db.prepare('INSERT INTO PECA_DIVULGACAO(ID_CAMPANHA,numero_peca,tipo,nome_arquivo,formato) VALUES (?,?,?,?,?)').run(id, number, ...pieceInput(req.body));
    res.status(201).json({ ID_CAMPANHA: id, numero_peca: number });
  });
  for (const method of ['put', 'delete']) app[method]('/api/pieces/:campaign/:number', (req, res) => {
    const id = idOf(req.params.campaign), number = idOf(req.params.number);
    editableCampaign(db, id);
    if (!db.prepare('SELECT 1 FROM PECA_DIVULGACAO WHERE ID_CAMPANHA=? AND numero_peca=?').get(id, number)) fail(404, 'Peça não encontrada.');
    if (method === 'put') {
      if (idOf(req.body.ID_CAMPANHA) !== id || idOf(req.body.numero_peca) !== number) fail(400, 'A chave composta da peça é imutável.');
      db.prepare('UPDATE PECA_DIVULGACAO SET tipo=?,nome_arquivo=?,formato=? WHERE ID_CAMPANHA=? AND numero_peca=?').run(...pieceInput(req.body), id, number);
    } else db.prepare('DELETE FROM PECA_DIVULGACAO WHERE ID_CAMPANHA=? AND numero_peca=?').run(id, number);
    res.json({ ok: true });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use((error, req, res, next) => {
    if (/UNIQUE constraint/.test(error.message)) return res.status(409).json({ error: 'Chave, e-mail, nome do canal ou valor multivalorado duplicado.' });
    if (/FOREIGN KEY constraint/.test(error.message)) return res.status(409).json({ error: 'Operação bloqueada por vínculos obrigatórios ou histórico. Remova os vínculos permitidos primeiro.' });
    if (/Supervisão|Especialização/.test(error.message)) return res.status(409).json({ error: error.message });
    if (/CHECK constraint/.test(error.message)) return res.status(400).json({ error: 'Valor incompatível com o dicionário de dados.' });
    const status = error.status || 500;
    if (status >= 500) console.error('Erro na API:', error);
    res.status(status).json({ error: status >= 500 ? 'Erro interno. Consulte os registros do servidor.' : error.message });
  });
  return app;
}
