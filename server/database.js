import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
      segment_id INTEGER NOT NULL REFERENCES segments(id), consent INTEGER NOT NULL CHECK(consent IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, segment_id INTEGER NOT NULL REFERENCES segments(id),
      material_id INTEGER NOT NULL REFERENCES materials(id), scheduled_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('draft','scheduled','completed','cancelled')),
      created_at TEXT NOT NULL, executed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
      client_id INTEGER NOT NULL REFERENCES clients(id), recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL, message TEXT NOT NULL, simulated_at TEXT NOT NULL,
      response TEXT NOT NULL DEFAULT 'pending' CHECK(response IN ('pending','interested','not_interested')),
      notes TEXT NOT NULL DEFAULT '', UNIQUE(campaign_id,client_id)
    );
  `);
  return db;
}

export function seedDatabase(db) {
  if (db.prepare('SELECT COUNT(*) AS count FROM segments').get().count) return;
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const segment = db.prepare('INSERT INTO segments (name,description) VALUES (?,?)');
    segment.run('Oficinas de ônibus', 'Manutenção de frotas e reparadores especializados.');
    segment.run('Transportadoras', 'Empresas de transporte de passageiros.');
    segment.run('Clientes avulsos', 'Compradores ocasionais de peças.');
    const client = db.prepare('INSERT INTO clients (name,phone,segment_id,consent,active,created_at) VALUES (?,?,?,?,?,?)');
    client.run('Oficina Horizonte (fictícia)', '5531999990001', 1, 1, 1, now);
    client.run('Garagem Via Sul (fictícia)', '5531999990002', 1, 1, 1, now);
    client.run('Transportes Aurora (fictícia)', '5531999990003', 2, 1, 1, now);
    client.run('Cliente sem consentimento (fictício)', '5531999990004', 1, 0, 1, now);
    db.prepare('INSERT INTO materials (title,message,image_url) VALUES (?,?,?)').run(
      'Semana da manutenção',
      'Olá, {nome}! A R Souza Auto Peças tem condições especiais em filtros, pastilhas e peças para ônibus. Responda para consultar disponibilidade e solicitar um orçamento. Material acadêmico demonstrativo, sem oferta comercial real.',
      '',
    );
    db.prepare('INSERT INTO materials (title,message,image_url) VALUES (?,?,?)').run(
      'Revisão da frota',
      'Olá, {nome}! Planeje a revisão da sua frota com a A R Souza Auto Peças. Consulte nossa equipe sobre peças para ônibus. Mensagem demonstrativa.',
      '',
    );
    db.prepare("INSERT INTO campaigns (name,segment_id,material_id,status,created_at) VALUES (?,?,?,'draft',?)")
      .run('Promoção para oficinas — demonstração', 1, 1, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function executeCampaign(db, id) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const campaign = db.prepare(`
      SELECT c.*, m.message, m.image_url FROM campaigns c
      JOIN materials m ON m.id=c.material_id WHERE c.id=?
    `).get(id);
    if (!campaign) throw Object.assign(new Error('Campanha não encontrada.'), { status: 404 });
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      throw Object.assign(new Error('Esta campanha já foi concluída ou cancelada.'), { status: 409 });
    }
    const clients = db.prepare('SELECT * FROM clients WHERE segment_id=? AND consent=1 AND active=1').all(campaign.segment_id);
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO deliveries (campaign_id,client_id,recipient_name,recipient_phone,message,simulated_at)
      VALUES (?,?,?,?,?,?)
    `);
    for (const client of clients) {
      const message = campaign.message.replaceAll('{nome}', client.name) + (campaign.image_url ? `\n${campaign.image_url}` : '');
      insert.run(id, client.id, client.name, client.phone, message, now);
    }
    db.prepare("UPDATE campaigns SET status='completed',executed_at=? WHERE id=?").run(now, id);
    db.exec('COMMIT');
    return clients.length;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function runScheduled(db, now = new Date().toISOString()) {
  const due = db.prepare("SELECT id FROM campaigns WHERE status='scheduled' AND scheduled_at<=?").all(now);
  for (const campaign of due) executeCampaign(db, campaign.id);
  return due.length;
}
