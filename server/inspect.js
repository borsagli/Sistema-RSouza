import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { TABLES } from './database.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const path = process.env.DATABASE_PATH || './data/rsouza.sqlite';
if (!existsSync(path)) throw new Error('Banco não encontrado. Inicie o servidor primeiro.');
const db = new DatabaseSync(path, { readOnly: true });
const result = {};
for (const table of TABLES) {
  result[table] = db.prepare(`SELECT * FROM ${table}`).all();
}
console.log(JSON.stringify(result, null, 2));
db.close();
