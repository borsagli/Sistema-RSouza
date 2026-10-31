import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDatabase, seedDatabase, runScheduled } from './database.js';
import { createApp } from './app.js';
import express from 'express';

if (existsSync('.env')) process.loadEnvFile('.env');
const production = process.env.NODE_ENV === 'production';
if (production && (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET)) {
  throw new Error('Configure ADMIN_PASSWORD e SESSION_SECRET no .env antes de iniciar em produção.');
}
const db = openDatabase(process.env.DATABASE_PATH || './data/rsouza.sqlite');
seedDatabase(db);
const app = createApp(db, {
  username: process.env.ADMIN_USER || 'admin',
  password: process.env.ADMIN_PASSWORD || 'Demo@2026!',
  secret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  company: process.env.COMPANY_NAME || 'A R Souza Auto Peças',
  secure: process.env.COOKIE_SECURE === 'true',
  allowedOrigins: production ? [] : ['http://127.0.0.1:5173', 'http://localhost:5173'],
});
if (production) {
  if (!existsSync('dist/index.html')) throw new Error('Execute npm run build antes de npm start.');
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (req, res) => res.sendFile(resolve('dist/index.html')));
}
const server = app.listen(Number(process.env.PORT || 3001), '127.0.0.1', () => {
  console.log(`API disponível em http://127.0.0.1:${server.address().port} — modo demonstrativo.`);
  if (!production && !process.env.ADMIN_PASSWORD) console.log('Login local demonstrativo: admin / Demo@2026!');
});
const tick = () => {
  try { runScheduled(db); } catch (error) { console.error('Falha no agendador; será tentado novamente:', error); }
};
tick();
const scheduler = setInterval(tick, 10_000);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  clearInterval(scheduler);
  server.close(() => { db.close(); process.exit(0); });
});
