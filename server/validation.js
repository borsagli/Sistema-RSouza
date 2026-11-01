import { fail } from './database.js';

export function text(value, name, max, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${name}: informe de 1 a ${max} caracteres.`);
  return value.trim();
}
export function idOf(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(400, 'Identificador inválido.');
  return Number(value);
}
export function cnpjOf(value) {
  const cnpj = text(value, 'CNPJ', 18).replace(/[./-]/g, '');
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) fail(400, 'Informe um CNPJ numérico válido com 14 dígitos.');
  for (const size of [12, 13]) {
    let weight = size - 7;
    let sum = 0;
    for (const digit of cnpj.slice(0, size)) {
      sum += Number(digit) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const remainder = sum % 11;
    if (Number(cnpj[size]) !== (remainder < 2 ? 0 : 11 - remainder)) fail(400, 'Dígitos verificadores do CNPJ inválidos.');
  }
  return cnpj;
}
export function money(value, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'number' && typeof value !== 'string') fail(400, 'Informe um gasto numérico.');
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) fail(400, 'Gasto deve ser não negativo e ter até duas casas decimais.');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount > 999999999.99) fail(400, 'Gasto fora do intervalo permitido.');
  return amount;
}
export function filtersOf(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Filtros inválidos.');
  const filters = {
    interesse: text(body.interesse, 'Interesse', 100, true),
    preferencia: text(body.preferencia, 'Preferência', 100, true),
    gasto_min: money(body.gasto_min, true),
    gasto_max: money(body.gasto_max, true),
  };
  if (filters.gasto_min !== null && filters.gasto_max !== null && filters.gasto_min > filters.gasto_max) fail(400, 'Gasto mínimo deve ser menor ou igual ao máximo.');
  return filters;
}
export function arrayOf(value, name, convert, max = 100) {
  if (!Array.isArray(value) || value.length > max) fail(400, `${name}: informe uma lista de até ${max} valores.`);
  const result = value.map(convert);
  const key = item => typeof item === 'string' ? item.toLocaleLowerCase('pt-BR') : JSON.stringify(item);
  if (new Set(result.map(key)).size !== result.length) fail(400, `${name}: valores duplicados.`);
  return result;
}
export function enumOf(value, options, name) {
  if (!options.includes(value)) fail(400, `${name}: escolha ${options.join(' ou ')}.`);
  return value;
}
export function timestamp(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail(400, `${name}: informe data e hora em ISO UTC.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(400, `${name}: data inválida.`);
  return value;
}
export function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(400, 'Data de publicação inválida.');
  return value;
}
