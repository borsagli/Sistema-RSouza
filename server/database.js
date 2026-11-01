import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const TABLES = [
  'CLIENTE', 'PERFIL_CLIENTE', 'CLIENTE_TELEFONE', 'CLIENTE_INTERESSE', 'CLIENTE_PREFERENCIA',
  'FUNCIONARIO', 'RESPONSAVEL_DIVULGACAO', 'ATENDENTE_WHATSAPP', 'CAMPANHA', 'RECEBE',
  'CANAL_DIVULGACAO', 'UTILIZA', 'PUBLICACAO_CANAL', 'PECA_DIVULGACAO', 'INTERACAO_WHATSAPP',
];
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function demoCnpj(index) {
  const base = String(index).padStart(8, '0') + '0001';
  const digit = value => {
    const weights = value.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const remainder = [...value].reduce((sum, item, i) => sum + Number(item) * weights[i], 0) % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const partial = base + digit(base);
  return partial + digit(partial);
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE CLIENTE (
      CNPJ VARCHAR(14) PRIMARY KEY NOT NULL CHECK(length(CNPJ)=14 AND CNPJ NOT GLOB '*[^0-9]*'),
      razao_social VARCHAR(150) NOT NULL CHECK(length(razao_social) BETWEEN 1 AND 150),
      nome_fantasia VARCHAR(100) CHECK(nome_fantasia IS NULL OR length(nome_fantasia)<=100),
      email VARCHAR(100) NOT NULL UNIQUE COLLATE NOCASE CHECK(length(email) BETWEEN 3 AND 100),
      rua VARCHAR(100) CHECK(rua IS NULL OR length(rua)<=100),
      numero VARCHAR(10) CHECK(numero IS NULL OR length(numero)<=10),
      bairro VARCHAR(50) CHECK(bairro IS NULL OR length(bairro)<=50),
      cidade VARCHAR(50) CHECK(cidade IS NULL OR length(cidade)<=50),
      pais VARCHAR(50) DEFAULT 'Brasil' CHECK(pais IS NULL OR length(pais)<=50),
      cep VARCHAR(8) CHECK(cep IS NULL OR (length(cep)=8 AND cep NOT GLOB '*[^0-9]*')),
      total_gasto NUMERIC NOT NULL DEFAULT 0 CHECK(total_gasto>=0 AND total_gasto<=999999999.99 AND round(total_gasto,2)=total_gasto),
      FOREIGN KEY(CNPJ) REFERENCES PERFIL_CLIENTE(CNPJ_CLIENTE) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TABLE PERFIL_CLIENTE (
      CNPJ_CLIENTE VARCHAR(14) PRIMARY KEY NOT NULL REFERENCES CLIENTE(CNPJ) ON DELETE CASCADE
    );
    CREATE TABLE CLIENTE_TELEFONE (
      CNPJ_CLIENTE VARCHAR(14) NOT NULL REFERENCES CLIENTE(CNPJ) ON DELETE CASCADE,
      numero VARCHAR(20) NOT NULL CHECK(length(numero) BETWEEN 1 AND 20),
      tipo VARCHAR(30) CHECK(tipo IS NULL OR tipo IN ('Móvel','Fixo')),
      PRIMARY KEY(CNPJ_CLIENTE,numero)
    );
    CREATE TABLE CLIENTE_INTERESSE (
      CNPJ_CLIENTE VARCHAR(14) NOT NULL REFERENCES PERFIL_CLIENTE(CNPJ_CLIENTE) ON DELETE CASCADE,
      interesse VARCHAR(100) NOT NULL COLLATE NOCASE CHECK(length(interesse) BETWEEN 1 AND 100),
      PRIMARY KEY(CNPJ_CLIENTE,interesse)
    );
    CREATE TABLE CLIENTE_PREFERENCIA (
      CNPJ_CLIENTE VARCHAR(14) NOT NULL REFERENCES PERFIL_CLIENTE(CNPJ_CLIENTE) ON DELETE CASCADE,
      preferencia VARCHAR(100) NOT NULL COLLATE NOCASE CHECK(length(preferencia) BETWEEN 1 AND 100),
      PRIMARY KEY(CNPJ_CLIENTE,preferencia)
    );
    CREATE TABLE FUNCIONARIO (
      ID_FUNCIONARIO INTEGER PRIMARY KEY AUTOINCREMENT CHECK(ID_FUNCIONARIO>0),
      nome VARCHAR(100) NOT NULL CHECK(length(nome) BETWEEN 1 AND 100),
      especializacao VARCHAR(30) NOT NULL CHECK(especializacao IN ('RESPONSAVEL_DIVULGACAO','ATENDENTE_WHATSAPP')),
      ID_RESPONSAVEL INTEGER REFERENCES RESPONSAVEL_DIVULGACAO(ID_RESPONSAVEL) DEFERRABLE INITIALLY DEFERRED,
      ID_ATENDENTE INTEGER REFERENCES ATENDENTE_WHATSAPP(ID_ATENDENTE) DEFERRABLE INITIALLY DEFERRED,
      CHECK((especializacao='RESPONSAVEL_DIVULGACAO' AND ID_RESPONSAVEL=ID_FUNCIONARIO AND ID_RESPONSAVEL IS NOT NULL AND ID_ATENDENTE IS NULL)
        OR (especializacao='ATENDENTE_WHATSAPP' AND ID_ATENDENTE=ID_FUNCIONARIO AND ID_ATENDENTE IS NOT NULL AND ID_RESPONSAVEL IS NULL))
    );
    CREATE TABLE RESPONSAVEL_DIVULGACAO (
      ID_RESPONSAVEL INTEGER PRIMARY KEY AUTOINCREMENT REFERENCES FUNCIONARIO(ID_FUNCIONARIO) ON DELETE CASCADE CHECK(ID_RESPONSAVEL>0),
      ID_SUPERVISOR INTEGER REFERENCES RESPONSAVEL_DIVULGACAO(ID_RESPONSAVEL),
      CHECK(ID_SUPERVISOR IS NULL OR ID_SUPERVISOR<>ID_RESPONSAVEL)
    );
    CREATE TABLE ATENDENTE_WHATSAPP (
      ID_ATENDENTE INTEGER PRIMARY KEY AUTOINCREMENT REFERENCES FUNCIONARIO(ID_FUNCIONARIO) ON DELETE CASCADE CHECK(ID_ATENDENTE>0)
    );
    CREATE TRIGGER responsavel_especializacao BEFORE INSERT ON RESPONSAVEL_DIVULGACAO
      WHEN NOT EXISTS(SELECT 1 FROM FUNCIONARIO WHERE ID_FUNCIONARIO=NEW.ID_RESPONSAVEL AND especializacao='RESPONSAVEL_DIVULGACAO')
      BEGIN SELECT RAISE(ABORT,'Especialização incompatível.'); END;
    CREATE TRIGGER atendente_especializacao BEFORE INSERT ON ATENDENTE_WHATSAPP
      WHEN NOT EXISTS(SELECT 1 FROM FUNCIONARIO WHERE ID_FUNCIONARIO=NEW.ID_ATENDENTE AND especializacao='ATENDENTE_WHATSAPP')
      BEGIN SELECT RAISE(ABORT,'Especialização incompatível.'); END;
    CREATE TRIGGER funcionario_especializacao_imutavel BEFORE UPDATE OF especializacao,ID_RESPONSAVEL,ID_ATENDENTE,ID_FUNCIONARIO ON FUNCIONARIO
      BEGIN SELECT RAISE(ABORT,'Especialização e identidade são imutáveis.'); END;
    CREATE TRIGGER supervisor_sem_ciclo BEFORE UPDATE OF ID_SUPERVISOR ON RESPONSAVEL_DIVULGACAO
      WHEN NEW.ID_SUPERVISOR IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT,'Supervisão não pode formar um ciclo.')
        WHERE EXISTS(
          WITH RECURSIVE cadeia(id) AS (
            SELECT NEW.ID_SUPERVISOR UNION
            SELECT r.ID_SUPERVISOR FROM RESPONSAVEL_DIVULGACAO r JOIN cadeia c ON r.ID_RESPONSAVEL=c.id WHERE r.ID_SUPERVISOR IS NOT NULL
          ) SELECT 1 FROM cadeia WHERE id=NEW.ID_RESPONSAVEL
        );
      END;
    CREATE TABLE CAMPANHA (
      ID_CAMPANHA INTEGER PRIMARY KEY AUTOINCREMENT CHECK(ID_CAMPANHA>0),
      ID_RESPONSAVEL INTEGER NOT NULL REFERENCES RESPONSAVEL_DIVULGACAO(ID_RESPONSAVEL),
      titulo_oferta VARCHAR(100) NOT NULL CHECK(length(titulo_oferta) BETWEEN 1 AND 100),
      texto_mensagem TEXT NOT NULL CHECK(length(texto_mensagem) BETWEEN 1 AND 4000),
      envio_mensagens VARCHAR(50) CHECK(envio_mensagens IS NULL OR envio_mensagens IN ('Rascunho','Agendada','Simulada','Cancelada')),
      data_agendamento DATETIME,
      status VARCHAR(30) NOT NULL DEFAULT 'Ativo' CHECK(status IN ('Ativo','Inativo'))
    );
    CREATE TABLE RECEBE (
      CNPJ_CLIENTE VARCHAR(14) NOT NULL REFERENCES CLIENTE(CNPJ),
      ID_CAMPANHA INTEGER NOT NULL REFERENCES CAMPANHA(ID_CAMPANHA),
      data_envio DATETIME,
      status_envio VARCHAR(30) NOT NULL DEFAULT 'Pendente' CHECK(status_envio IN ('Enviado','Pendente')),
      data_visualizacao DATETIME,
      PRIMARY KEY(CNPJ_CLIENTE,ID_CAMPANHA),
      CHECK((status_envio='Pendente' AND data_envio IS NULL AND data_visualizacao IS NULL)
        OR (status_envio='Enviado' AND data_envio IS NOT NULL AND (data_visualizacao IS NULL OR data_visualizacao>=data_envio)))
    );
    CREATE TABLE CANAL_DIVULGACAO (
      ID_CANAL INTEGER PRIMARY KEY AUTOINCREMENT CHECK(ID_CANAL>0),
      nome VARCHAR(50) NOT NULL UNIQUE CHECK(length(nome) BETWEEN 1 AND 50),
      tipo VARCHAR(50) CHECK(tipo IS NULL OR length(tipo)<=50)
    );
    CREATE TABLE UTILIZA (
      ID_CAMPANHA INTEGER NOT NULL REFERENCES CAMPANHA(ID_CAMPANHA),
      ID_CANAL INTEGER NOT NULL REFERENCES CANAL_DIVULGACAO(ID_CANAL),
      PRIMARY KEY(ID_CAMPANHA,ID_CANAL)
    );
    CREATE TABLE PUBLICACAO_CANAL (
      ID_PUBLICACAO INTEGER PRIMARY KEY AUTOINCREMENT CHECK(ID_PUBLICACAO>0),
      ID_CAMPANHA INTEGER NOT NULL,
      ID_CANAL INTEGER NOT NULL,
      data_publicacao DATE NOT NULL,
      horario TIME NOT NULL,
      conteudo TEXT,
      FOREIGN KEY(ID_CAMPANHA,ID_CANAL) REFERENCES UTILIZA(ID_CAMPANHA,ID_CANAL)
    );
    CREATE TABLE PECA_DIVULGACAO (
      ID_CAMPANHA INTEGER NOT NULL REFERENCES CAMPANHA(ID_CAMPANHA) ON DELETE CASCADE,
      numero_peca INTEGER NOT NULL CHECK(numero_peca>0 AND typeof(numero_peca)='integer'),
      tipo VARCHAR(50) CHECK(tipo IS NULL OR length(tipo)<=50),
      nome_arquivo VARCHAR(100) NOT NULL CHECK(length(nome_arquivo) BETWEEN 1 AND 100),
      formato VARCHAR(20) NOT NULL CHECK(formato IN ('PDF','PNG','MP4')),
      PRIMARY KEY(ID_CAMPANHA,numero_peca)
    );
    CREATE TABLE INTERACAO_WHATSAPP (
      ID_INTERACAO INTEGER PRIMARY KEY AUTOINCREMENT CHECK(ID_INTERACAO>0),
      CNPJ_CLIENTE VARCHAR(14) NOT NULL,
      ID_CAMPANHA INTEGER NOT NULL,
      ID_ATENDENTE INTEGER NOT NULL REFERENCES ATENDENTE_WHATSAPP(ID_ATENDENTE),
      data_hora DATETIME NOT NULL,
      tipo_interacao VARCHAR(50) CHECK(tipo_interacao IS NULL OR length(tipo_interacao)<=50),
      status VARCHAR(30) NOT NULL CHECK(length(status) BETWEEN 1 AND 30),
      FOREIGN KEY(CNPJ_CLIENTE,ID_CAMPANHA) REFERENCES RECEBE(CNPJ_CLIENTE,ID_CAMPANHA)
    );
    CREATE INDEX recebe_campanha ON RECEBE(ID_CAMPANHA);
    CREATE INDEX utiliza_canal ON UTILIZA(ID_CANAL);
    CREATE INDEX interacao_atendente ON INTERACAO_WHATSAPP(ID_ATENDENTE);
  `);
}

export function insertEmployee(db, nome, especializacao, supervisor = null) {
  const next = Number(db.prepare("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='FUNCIONARIO'),0)+1 AS id").get().id);
  const responsible = especializacao === 'RESPONSAVEL_DIVULGACAO';
  db.prepare('INSERT INTO FUNCIONARIO(ID_FUNCIONARIO,nome,especializacao,ID_RESPONSAVEL,ID_ATENDENTE) VALUES (?,?,?,?,?)')
    .run(next, nome, especializacao, responsible ? next : null, responsible ? null : next);
  if (responsible) db.prepare('INSERT INTO RESPONSAVEL_DIVULGACAO(ID_RESPONSAVEL,ID_SUPERVISOR) VALUES (?,?)').run(next, supervisor);
  else db.prepare('INSERT INTO ATENDENTE_WHATSAPP(ID_ATENDENTE) VALUES (?)').run(next);
  return next;
}

function migrateLegacy(db, path) {
  const oldTables = ['segments', 'clients', 'materials', 'campaigns', 'deliveries'];
  const old = Object.fromEntries(oldTables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  const stamp = new Date().toISOString().replaceAll(':', '-');
  if (path !== ':memory:') {
    const backup = `${path}.before-mer-${stamp}.sqlite`;
    db.prepare('VACUUM INTO ?').run(backup);
    writeFileSync(`${backup}.json`, JSON.stringify(old, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`Backup integral antes da migração: ${backup}`);
  }
  transaction(db, () => {
    createSchema(db);
    const responsible = insertEmployee(db, 'Responsável da migração (fictício)', 'RESPONSAVEL_DIVULGACAO');
    const attendant = insertEmployee(db, 'Atendente da migração (fictício)', 'ATENDENTE_WHATSAPP');
    db.prepare('INSERT INTO CANAL_DIVULGACAO(nome,tipo) VALUES (?,?)').run('WhatsApp Business', 'Demonstrativo');
    const mapping = new Map();
    for (const client of old.clients) {
      const cnpj = demoCnpj(client.id);
      mapping.set(client.id, cnpj);
      db.prepare('INSERT INTO CLIENTE(CNPJ,razao_social,email,total_gasto) VALUES (?,?,?,0)')
        .run(cnpj, client.name, `cliente-migrado-${client.id}@example.invalid`);
      db.prepare('INSERT INTO PERFIL_CLIENTE(CNPJ_CLIENTE) VALUES (?)').run(cnpj);
      db.prepare('INSERT INTO CLIENTE_TELEFONE(CNPJ_CLIENTE,numero,tipo) VALUES (?,?,?)').run(cnpj, client.phone, 'Móvel');
      const segment = old.segments.find(item => item.id === client.segment_id);
      db.prepare('INSERT INTO CLIENTE_INTERESSE(CNPJ_CLIENTE,interesse) VALUES (?,?)').run(cnpj, segment.name);
    }
    for (const campaign of old.campaigns) {
      if (campaign.name.length > 100) fail(409, `O título da campanha antiga ${campaign.id} excede 100 caracteres. Ajuste antes de migrar; o backup foi preservado.`);
      const material = old.materials.find(item => item.id === campaign.material_id);
      const records = old.deliveries.filter(item => item.campaign_id === campaign.id);
      const selected = records.length ? records.map(record => old.clients.find(client => client.id === record.client_id))
        : old.clients.filter(client => client.segment_id === campaign.segment_id && client.active && client.consent);
      if (!selected.length) fail(409, `A campanha antiga ${campaign.id} não possui destinatários elegíveis. Ajuste o banco antigo antes de migrar; o backup foi preservado.`);
      const state = { draft: 'Rascunho', scheduled: 'Agendada', completed: 'Simulada', cancelled: 'Cancelada' }[campaign.status];
      db.prepare('INSERT INTO CAMPANHA(ID_CAMPANHA,ID_RESPONSAVEL,titulo_oferta,texto_mensagem,envio_mensagens,data_agendamento,status) VALUES (?,?,?,?,?,?,?)')
        .run(campaign.id, responsible, campaign.name, material.message, state, campaign.scheduled_at, state === 'Cancelada' ? 'Inativo' : 'Ativo');
      db.prepare('INSERT INTO UTILIZA(ID_CAMPANHA,ID_CANAL) VALUES (?,1)').run(campaign.id);
      for (const client of selected) {
        const record = records.find(item => item.client_id === client.id);
        db.prepare('INSERT INTO RECEBE(CNPJ_CLIENTE,ID_CAMPANHA,data_envio,status_envio) VALUES (?,?,?,?)')
          .run(mapping.get(client.id), campaign.id, record?.simulated_at || null, record ? 'Enviado' : 'Pendente');
        if (record && record.response !== 'pending') {
          db.prepare('INSERT INTO INTERACAO_WHATSAPP(CNPJ_CLIENTE,ID_CAMPANHA,ID_ATENDENTE,data_hora,tipo_interacao,status) VALUES (?,?,?,?,?,?)')
            .run(mapping.get(client.id), campaign.id, attendant, record.simulated_at, 'Resposta migrada (simulada)', record.response === 'interested' ? 'Interessado' : 'Sem interesse');
        }
      }
      if (records.length) {
        const timestamp = records[0].simulated_at;
        db.prepare('INSERT INTO PUBLICACAO_CANAL(ID_CAMPANHA,ID_CANAL,data_publicacao,horario,conteudo) VALUES (?,1,?,?,?)')
          .run(campaign.id, timestamp.slice(0, 10), timestamp.slice(11, 19), material.message);
      }
    }
    db.exec('DROP TABLE deliveries; DROP TABLE campaigns; DROP TABLE clients; DROP TABLE materials; DROP TABLE segments; PRAGMA user_version=2;');
  });
  console.log('Migração MER concluída. CNPJs/e-mails gerados são fictícios; gastos iniciados em zero. Campos antigos sem correspondência estão no backup JSON.');
}

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='clients'").get();
    const current = db.prepare('PRAGMA user_version').get().user_version;
    if (current > 2) throw new Error('Banco criado por uma versão mais recente do sistema.');
    if (legacy) migrateLegacy(db, path);
    else if (current === 0) transaction(db, () => { createSchema(db); db.exec('PRAGMA user_version=2'); });
    const issues = db.prepare('PRAGMA foreign_key_check').all();
    if (issues.length) throw new Error('O banco possui violações de chave estrangeira.');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function seedDatabase(db) {
  if (TABLES.some(table => db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())) return;
  transaction(db, () => {
    const supervisor = insertEmployee(db, 'Supervisão comercial (fictícia)', 'RESPONSAVEL_DIVULGACAO');
    const responsible = insertEmployee(db, 'Divulgação de ofertas (fictícia)', 'RESPONSAVEL_DIVULGACAO', supervisor);
    insertEmployee(db, 'Atendimento WhatsApp (fictício)', 'ATENDENTE_WHATSAPP');
    db.prepare('INSERT INTO CANAL_DIVULGACAO(nome,tipo) VALUES (?,?)').run('WhatsApp Business', 'Demonstrativo');
    db.prepare('INSERT INTO CANAL_DIVULGACAO(nome,tipo) VALUES (?,?)').run('Catálogo digital', 'Demonstrativo');
    const companies = [
      ['Garagem Horizonte (fictícia)', 12500, ['Filtros', 'Freios'], ['WhatsApp', 'Promoções'], ['5531999990001', '553133330001']],
      ['Garagem Via Sul (fictícia)', 5400, ['Filtros'], ['WhatsApp'], ['5531999990002']],
      ['Transportes Aurora (fictícia)', 21000, ['Suspensão'], ['Catálogo'], ['5531999990003']],
    ];
    companies.forEach(([name, total, interests, preferences, phones], index) => {
      const cnpj = demoCnpj(index + 1);
      db.prepare('INSERT INTO CLIENTE(CNPJ,razao_social,nome_fantasia,email,rua,numero,bairro,cidade,cep,total_gasto) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(cnpj, name, name, `garagem-${index + 1}@example.invalid`, 'Rua Demonstrativa', String(index + 1), 'Lindéia', 'Belo Horizonte', '30000000', total);
      db.prepare('INSERT INTO PERFIL_CLIENTE(CNPJ_CLIENTE) VALUES (?)').run(cnpj);
      phones.forEach((phone, i) => db.prepare('INSERT INTO CLIENTE_TELEFONE(CNPJ_CLIENTE,numero,tipo) VALUES (?,?,?)').run(cnpj, phone, i ? 'Fixo' : 'Móvel'));
      interests.forEach(value => db.prepare('INSERT INTO CLIENTE_INTERESSE(CNPJ_CLIENTE,interesse) VALUES (?,?)').run(cnpj, value));
      preferences.forEach(value => db.prepare('INSERT INTO CLIENTE_PREFERENCIA(CNPJ_CLIENTE,preferencia) VALUES (?,?)').run(cnpj, value));
    });
    db.prepare("INSERT INTO CAMPANHA(ID_RESPONSAVEL,titulo_oferta,texto_mensagem,envio_mensagens) VALUES (?,?,?,'Rascunho')")
      .run(responsible, 'Semana da manutenção — demonstração', 'Olá, {nome}! Consulte filtros e freios para sua frota na A R Souza Auto Peças. Oferta e mensagem exclusivamente demonstrativas.');
    for (const index of [1, 2]) db.prepare('INSERT INTO RECEBE(CNPJ_CLIENTE,ID_CAMPANHA) VALUES (?,1)').run(demoCnpj(index));
    db.exec('INSERT INTO UTILIZA(ID_CAMPANHA,ID_CANAL) VALUES (1,1);');
    db.prepare('INSERT INTO PECA_DIVULGACAO(ID_CAMPANHA,numero_peca,tipo,nome_arquivo,formato) VALUES (1,1,?,?,?)')
      .run('Panfleto demonstrativo', 'oferta-filtros.png', 'PNG');
  });
}

export function listClients(db) {
  return db.prepare('SELECT * FROM CLIENTE ORDER BY razao_social,CNPJ').all().map(client => ({
    ...client,
    telefones: db.prepare('SELECT numero,tipo FROM CLIENTE_TELEFONE WHERE CNPJ_CLIENTE=? ORDER BY numero').all(client.CNPJ),
    interesses: db.prepare('SELECT interesse FROM CLIENTE_INTERESSE WHERE CNPJ_CLIENTE=? ORDER BY interesse').all(client.CNPJ).map(row => row.interesse),
    preferencias: db.prepare('SELECT preferencia FROM CLIENTE_PREFERENCIA WHERE CNPJ_CLIENTE=? ORDER BY preferencia').all(client.CNPJ).map(row => row.preferencia),
  }));
}

export function filterClients(clients, filters) {
  const normalize = value => value.toLocaleLowerCase('pt-BR');
  return clients.filter(client =>
    (!filters.interesse || client.interesses.some(value => normalize(value) === normalize(filters.interesse))) &&
    (!filters.preferencia || client.preferencias.some(value => normalize(value) === normalize(filters.preferencia))) &&
    (filters.gasto_min === null || client.total_gasto >= filters.gasto_min) &&
    (filters.gasto_max === null || client.total_gasto <= filters.gasto_max));
}

export function executeCampaign(db, id) {
  return transaction(db, () => {
    const campaign = db.prepare('SELECT * FROM CAMPANHA WHERE ID_CAMPANHA=?').get(id);
    if (!campaign) fail(404, 'Campanha não encontrada.');
    if (campaign.status !== 'Ativo' || !['Rascunho', 'Agendada'].includes(campaign.envio_mensagens)) fail(409, 'Campanha inativa, cancelada ou já simulada.');
    const audience = db.prepare('SELECT * FROM RECEBE WHERE ID_CAMPANHA=?').all(id);
    const channels = db.prepare('SELECT ID_CANAL FROM UTILIZA WHERE ID_CAMPANHA=?').all(id);
    if (!audience.length || !channels.length) fail(409, 'A campanha exige pelo menos um cliente e um canal.');
    const now = new Date().toISOString();
    db.prepare("UPDATE RECEBE SET data_envio=?,status_envio='Enviado' WHERE ID_CAMPANHA=?").run(now, id);
    for (const channel of channels) {
      db.prepare('INSERT INTO PUBLICACAO_CANAL(ID_CAMPANHA,ID_CANAL,data_publicacao,horario,conteudo) VALUES (?,?,?,?,?)')
        .run(id, channel.ID_CANAL, now.slice(0, 10), now.slice(11, 19), campaign.texto_mensagem);
    }
    db.prepare("UPDATE CAMPANHA SET envio_mensagens='Simulada' WHERE ID_CAMPANHA=?").run(id);
    return audience.length;
  });
}

export function runScheduled(db, now = new Date().toISOString()) {
  const due = db.prepare("SELECT ID_CAMPANHA FROM CAMPANHA WHERE status='Ativo' AND envio_mensagens='Agendada' AND data_agendamento<=?").all(now);
  let completed = 0;
  for (const campaign of due) {
    try { executeCampaign(db, campaign.ID_CAMPANHA); completed++; }
    catch (error) { console.error(`Falha na campanha ${campaign.ID_CAMPANHA}; novo processamento na próxima verificação:`, error); }
  }
  return completed;
}
