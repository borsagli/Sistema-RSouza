import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, seedDatabase, demoCnpj } from '../server/database.js';

function legacyDatabase(path, emptyAudience = false) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE segments(id INTEGER PRIMARY KEY,name TEXT,description TEXT);
    CREATE TABLE clients(id INTEGER PRIMARY KEY,name TEXT,phone TEXT,segment_id INTEGER REFERENCES segments(id),consent INTEGER,active INTEGER,created_at TEXT);
    CREATE TABLE materials(id INTEGER PRIMARY KEY,title TEXT,message TEXT,image_url TEXT);
    CREATE TABLE campaigns(id INTEGER PRIMARY KEY,name TEXT,segment_id INTEGER REFERENCES segments(id),material_id INTEGER REFERENCES materials(id),scheduled_at TEXT,status TEXT,created_at TEXT,executed_at TEXT);
    CREATE TABLE deliveries(id INTEGER PRIMARY KEY,campaign_id INTEGER REFERENCES campaigns(id),client_id INTEGER REFERENCES clients(id),recipient_name TEXT,recipient_phone TEXT,message TEXT,simulated_at TEXT,response TEXT,notes TEXT);
    INSERT INTO segments VALUES (1,'Oficinas','Descrição legada');
    INSERT INTO clients VALUES (1,'Empresa antiga fictícia','5531999990001',1,1,1,'2026-10-31T00:00:00.000Z');
    INSERT INTO materials VALUES (1,'Material antigo','Olá, {nome}!','https://example.invalid/oferta.png');
    INSERT INTO campaigns VALUES (1,'Campanha antiga',1,1,NULL,'completed','2026-10-31T00:00:00.000Z','2026-10-31T01:00:00.000Z');
    INSERT INTO deliveries VALUES (1,1,1,'Empresa antiga fictícia','5531999990001','Mensagem antiga personalizada','2026-10-31T01:00:00.000Z','interested','Observação antiga preservada no backup');
    INSERT INTO campaigns VALUES (2,'Agendada antiga',1,1,'2099-01-01T12:00:00.000Z','scheduled','2026-10-31T00:00:00.000Z',NULL);
  `);
  if (emptyAudience) db.exec('UPDATE clients SET consent=0');
  db.close();
}

test('migração transacional com backup integral, CNPJ fictício, histórico e reabertura idempotente', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rsouza-migration-'));
  let db;
  try {
    const path = join(directory, 'legacy.sqlite');
    legacyDatabase(path);
    db = openDatabase(path);
    seedDatabase(db);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('clients','segments','materials','campaigns','deliveries')").get().n, 0);
    assert.equal(db.prepare('SELECT CNPJ,total_gasto FROM CLIENTE').get().CNPJ, demoCnpj(1));
    assert.equal(db.prepare('SELECT total_gasto FROM CLIENTE').get().total_gasto, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM PERFIL_CLIENTE').get().n, 1);
    assert.equal(db.prepare('SELECT interesse FROM CLIENTE_INTERESSE').get().interesse, 'Oficinas');
    assert.equal(db.prepare('SELECT status FROM INTERACAO_WHATSAPP').get().status, 'Interessado');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM PUBLICACAO_CANAL').get().n, 1);
    assert.equal(db.prepare('SELECT envio_mensagens FROM CAMPANHA WHERE ID_CAMPANHA=2').get().envio_mensagens, 'Agendada');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    const backup = readdirSync(directory).find(file => file.includes('before-mer') && file.endsWith('.sqlite'));
    assert.ok(backup);
    const original = new DatabaseSync(join(directory, backup), { readOnly: true });
    assert.equal(original.prepare('SELECT notes FROM deliveries').get().notes, 'Observação antiga preservada no backup');
    original.close();
    const snapshot = JSON.parse(readFileSync(join(directory, `${backup}.json`), 'utf8'));
    assert.equal(snapshot.materials[0].image_url, 'https://example.invalid/oferta.png');
    assert.equal(snapshot.deliveries[0].message, 'Mensagem antiga personalizada');
    db.close();
    db = openDatabase(path);
    seedDatabase(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM CAMPANHA').get().n, 2);
    assert.equal(readdirSync(directory).filter(file => file.includes('before-mer') && file.endsWith('.sqlite')).length, 1);
  } finally { db?.close(); rmSync(directory, { recursive: true }); }
});

test('migração incompatível preserva banco antigo e não cria esquema parcial', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rsouza-rollback-'));
  try {
    const path = join(directory, 'legacy.sqlite');
    legacyDatabase(path, true);
    assert.throws(() => openDatabase(path), /não possui destinatários elegíveis/);
    const db = new DatabaseSync(path);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='CLIENTE'").get().n, 0);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
    db.close();
    assert.ok(readdirSync(directory).some(file => file.endsWith('.sqlite.json')));
  } finally { rmSync(directory, { recursive: true }); }
});
