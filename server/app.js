import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { executeCampaign } from './database.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, field, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${field}: informe de 1 a ${max} caracteres.`);
  return value.trim();
};
const idOf = value => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) fail(400, 'Identificador inválido.');
  return id;
};
const flag = value => {
  if (typeof value !== 'boolean') fail(400, 'Consentimento e situação devem ser booleanos.');
  return Number(value);
};
const reference = (db, table, value) => {
  const id = idOf(value);
  if (!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id)) fail(400, 'Selecione um registro existente.');
  return id;
};

export function createApp(db, config) {
  const app = express();
  const sessions = new Map();
  const attempts = new Map();
  const salt = randomBytes(16);
  const passwordHash = scryptSync(config.password, salt, 64);
  const sign = value => createHmac('sha256', config.secret).update(value).digest('hex');
  const cookie = token => `rsouza_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${config.secure ? '; Secure' : ''}`;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const allowedOrigins = [`${req.protocol}://${req.get('host')}`, ...(config.allowedOrigins || [])];
      if (origin && !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origem não autorizada.' });
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};
    if (Array.isArray(req.body)) return res.status(400).json({ error: 'Envie um objeto JSON, não uma lista.' });
    next();
  });
  app.post('/api/login', (req, res) => {
    const key = req.ip;
    const now = Date.now();
    const previous = attempts.get(key);
    const attempt = previous && previous.until > now ? previous : { count: 0, until: now + 15 * 60_000 };
    if (attempt.count >= 10) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
    attempt.count++;
    attempts.set(key, attempt);
    const password = typeof req.body.password === 'string' && req.body.password.length <= 200 ? req.body.password : '';
    const validPassword = timingSafeEqual(passwordHash, scryptSync(password, salt, 64));
    if (req.body.username !== config.username || !validPassword) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    attempts.delete(key);
    for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
    for (const [ip, item] of attempts) if (item.until <= now) attempts.delete(ip);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, now + 8 * 60 * 60_000);
    res.set('Set-Cookie', cookie(`${token}.${sign(token)}`)).json({ username: config.username });
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
  app.get('/api/me', (req, res) => res.json({ username: config.username, company: config.company, mode: 'demonstration' }));
  app.post('/api/logout', (req, res) => {
    sessions.delete(req.sessionToken);
    res.set('Set-Cookie', 'rsouza_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0').json({ ok: true });
  });
  app.get('/api/dashboard', (req, res) => res.json({
    clients: db.prepare('SELECT COUNT(*) AS total FROM clients').get().total,
    eligible: db.prepare('SELECT COUNT(*) AS total FROM clients WHERE consent=1 AND active=1').get().total,
    campaigns: db.prepare('SELECT COUNT(*) AS total FROM campaigns').get().total,
    scheduled: db.prepare("SELECT COUNT(*) AS total FROM campaigns WHERE status='scheduled'").get().total,
    simulations: db.prepare('SELECT COUNT(*) AS total FROM deliveries').get().total,
    interested: db.prepare("SELECT COUNT(DISTINCT client_id) AS total FROM deliveries WHERE response='interested'").get().total,
    recent: db.prepare(`
      SELECT c.*,s.name AS segment_name,m.title AS material_title,
      (SELECT COUNT(*) FROM deliveries d WHERE d.campaign_id=c.id) AS recipients
      FROM campaigns c JOIN segments s ON s.id=c.segment_id JOIN materials m ON m.id=c.material_id
      ORDER BY c.id DESC LIMIT 5
    `).all(),
  }));
  app.get('/api/database', (req, res) => {
    const tables = ['segments', 'clients', 'materials', 'campaigns', 'deliveries'];
    res.json(tables.map(name => ({
      name,
      columns: db.prepare(`PRAGMA table_info(${name})`).all(),
      foreignKeys: db.prepare(`PRAGMA foreign_key_list(${name})`).all(),
      count: db.prepare(`SELECT COUNT(*) AS total FROM ${name}`).get().total,
      rows: db.prepare(`SELECT * FROM ${name} ORDER BY id DESC LIMIT 20`).all(),
    })));
  });
  const resources = {
    segments: {
      columns: ['name', 'description'],
      values: body => [text(body.name, 'Nome', 80), typeof body.description === 'string' ? body.description.trim().slice(0, 500) : ''],
      query: 'SELECT s.*,(SELECT COUNT(*) FROM clients c WHERE c.segment_id=s.id) AS client_count FROM segments s ORDER BY s.id DESC',
    },
    clients: {
      columns: ['name', 'phone', 'segment_id', 'consent', 'active'],
      values: body => {
        const phone = text(body.phone, 'Telefone', 20).replace(/[+ ()-]/g, '');
        if (!/^55\d{10,11}$/.test(phone)) fail(400, 'Use um telefone brasileiro com 55, DDD e número.');
        return [text(body.name, 'Nome', 100), phone, reference(db, 'segments', body.segment_id), flag(body.consent), flag(body.active)];
      },
      query: 'SELECT c.*,s.name AS segment_name FROM clients c JOIN segments s ON s.id=c.segment_id ORDER BY c.id DESC',
    },
    materials: {
      columns: ['title', 'message', 'image_url'],
      values: body => {
        const url = typeof body.image_url === 'string' ? body.image_url.trim() : '';
        if (url) {
          let parsed;
          try { parsed = new URL(url); } catch { fail(400, 'Informe uma URL válida para o material.'); }
          if (parsed.protocol !== 'https:' || url.length > 2000) fail(400, 'A imagem deve usar uma URL HTTPS de até 2000 caracteres.');
        }
        return [text(body.title, 'Título', 100), text(body.message, 'Mensagem', 4000), url];
      },
      query: 'SELECT * FROM materials ORDER BY id DESC',
    },
    campaigns: {
      columns: ['name', 'segment_id', 'material_id', 'scheduled_at', 'status'],
      values: body => {
        if (!['draft', 'scheduled'].includes(body.status)) fail(400, 'Escolha rascunho ou agendada.');
        let date = null;
        if (body.status === 'scheduled') {
          const timestamp = typeof body.scheduled_at === 'string' ? Date.parse(body.scheduled_at) : NaN;
          if (!Number.isFinite(timestamp) || timestamp <= Date.now()) fail(400, 'O agendamento deve ser uma data futura.');
          date = new Date(timestamp).toISOString();
        }
        return [text(body.name, 'Nome', 120), reference(db, 'segments', body.segment_id), reference(db, 'materials', body.material_id), date, body.status];
      },
      query: `SELECT c.*,s.name AS segment_name,m.title AS material_title,
        (SELECT COUNT(*) FROM deliveries d WHERE d.campaign_id=c.id) AS recipients,
        (SELECT COUNT(*) FROM clients cl WHERE cl.segment_id=c.segment_id AND consent=1 AND active=1) AS eligible
        FROM campaigns c JOIN segments s ON s.id=c.segment_id JOIN materials m ON m.id=c.material_id ORDER BY c.id DESC`,
    },
  };
  for (const [table, resource] of Object.entries(resources)) {
    app.get(`/api/${table}`, (req, res) => res.json(db.prepare(resource.query).all()));
    app.post(`/api/${table}`, (req, res) => {
      const values = resource.values(req.body);
      const columns = [...resource.columns];
      if (['clients', 'campaigns'].includes(table)) { columns.push('created_at'); values.push(new Date().toISOString()); }
      const result = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...values);
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    });
    app.put(`/api/${table}/:id`, (req, res) => {
      const id = idOf(req.params.id);
      const existing = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
      if (!existing) fail(404, 'Registro não encontrado.');
      if (table === 'campaigns' && !['draft', 'scheduled'].includes(existing.status)) fail(409, 'Campanha concluída ou cancelada não pode ser editada.');
      const values = resource.values(req.body);
      db.prepare(`UPDATE ${table} SET ${resource.columns.map(column => `${column}=?`).join(',')} WHERE id=?`).run(...values, id);
      res.json({ ok: true });
    });
    app.delete(`/api/${table}/:id`, (req, res) => {
      const id = idOf(req.params.id);
      if (table === 'campaigns') {
        const campaign = db.prepare('SELECT status FROM campaigns WHERE id=?').get(id);
        if (campaign && !['draft', 'cancelled'].includes(campaign.status)) fail(409, 'Cancele o agendamento antes de excluir. Campanhas concluídas preservam o histórico.');
      }
      const result = db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
      if (!result.changes) fail(404, 'Registro não encontrado.');
      res.json({ ok: true });
    });
  }
  app.post('/api/campaigns/:id/simulate', (req, res) => res.json({ recipients: executeCampaign(db, idOf(req.params.id)), mode: 'demonstration' }));
  app.post('/api/campaigns/:id/cancel', (req, res) => {
    const result = db.prepare("UPDATE campaigns SET status='cancelled' WHERE id=? AND status IN ('draft','scheduled')").run(idOf(req.params.id));
    if (!result.changes) fail(409, 'Campanha inexistente, concluída ou já cancelada.');
    res.json({ ok: true });
  });
  app.get('/api/deliveries', (req, res) => res.json(db.prepare(`
    SELECT d.*,c.name AS campaign_name,cl.consent,cl.active FROM deliveries d
    JOIN campaigns c ON c.id=d.campaign_id JOIN clients cl ON cl.id=d.client_id ORDER BY d.id DESC
  `).all()));
  app.put('/api/deliveries/:id', (req, res) => {
    if (!['pending', 'interested', 'not_interested'].includes(req.body.response)) fail(400, 'Resposta inválida.');
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
    if (notes.length > 1000) fail(400, 'Observação limitada a 1000 caracteres.');
    const result = db.prepare('UPDATE deliveries SET response=?,notes=? WHERE id=?').run(req.body.response, notes, idOf(req.params.id));
    if (!result.changes) fail(404, 'Registro não encontrado.');
    res.json({ ok: true });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use((error, req, res, next) => {
    if (error.code?.startsWith('ERR_SQLITE') && /UNIQUE constraint/.test(error.message)) {
      return res.status(409).json({ error: 'Já existe um cadastro com este nome ou telefone.' });
    }
    if (error.code?.startsWith('ERR_SQLITE') && /FOREIGN KEY constraint/.test(error.message)) {
      return res.status(409).json({ error: 'Registro utilizado em outros cadastros. Preserve o histórico ou remova os vínculos primeiro.' });
    }
    const status = error.status || 500;
    if (status >= 500) console.error('Erro na API:', error);
    res.status(status).json({ error: status >= 500 ? 'Erro interno. Consulte os registros do servidor.' : error.message });
  });
  return app;
}
