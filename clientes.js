// Cadastro dos negócios. A fonte é a pasta clientes/ (um JSON por instância da Evolution),
// copiada para o banco a cada deploy. O campo "ativo" fica só no banco (controlado pelo dono).
import fs from 'node:fs';
import path from 'node:path';
import { q } from './db.js';

const cache = new Map();
const TTL_MS = 30_000;

function problemas(cfg) {
  const faltando = [];
  if (!cfg.instancia) faltando.push('instancia');
  if (!cfg.nome) faltando.push('nome');
  if (!Array.isArray(cfg.servicos) || cfg.servicos.length === 0) faltando.push('servicos');
  if (!cfg.horarios) faltando.push('horarios');
  return faltando;
}

export async function sincronizarArquivos(pasta) {
  if (!fs.existsSync(pasta)) return [];
  const carregados = [];
  const arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith('.json') && !f.startsWith('_'));

  for (const arquivo of arquivos) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(pasta, arquivo), 'utf8'));
      const faltando = problemas(cfg);
      if (faltando.length) throw new Error(`campos faltando: ${faltando.join(', ')}`);
      await q(
        `INSERT INTO clientes (instancia, config) VALUES ($1, $2)
         ON CONFLICT (instancia) DO UPDATE SET config = EXCLUDED.config, atualizado_em = now()`,
        [cfg.instancia, cfg],
      );
      carregados.push(cfg.instancia);
    } catch (e) {
      console.error(`⚠️  clientes/${arquivo} ignorado: ${e.message}`);
    }
  }
  cache.clear();
  return carregados;
}

export async function obterCliente(instancia) {
  const c = cache.get(instancia);
  if (c && Date.now() - c.t < TTL_MS) return c.v;
  const { rows } = await q('SELECT instancia, config, ativo FROM clientes WHERE instancia = $1', [instancia]);
  const v = rows[0] ? { ...rows[0].config, instancia: rows[0].instancia, ativo: rows[0].ativo } : null;
  cache.set(instancia, { v, t: Date.now() });
  return v;
}

export async function definirAtivo(instancia, ativo) {
  await q('UPDATE clientes SET ativo = $2, atualizado_em = now() WHERE instancia = $1', [instancia, ativo]);
  cache.delete(instancia);
}

export async function listarClientes() {
  const { rows } = await q(
    `SELECT instancia, config->>'nome' AS nome, config->>'dono_whatsapp' AS dono, ativo, atualizado_em
     FROM clientes ORDER BY instancia`,
  );
  return rows;
}
