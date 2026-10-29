import pg from 'pg';

pg.types.setTypeParser(1082, (v) => v); // colunas DATE voltam como 'AAAA-MM-DD'

if (!process.env.DATABASE_URL) {
  throw new Error('Defina a variável DATABASE_URL (Postgres do Railway).');
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export const q = (texto, params) => pool.query(texto, params);

// Cria as tabelas na primeira vez (seguro rodar sempre).
export async function migrar() {
  await q(`
    CREATE TABLE IF NOT EXISTS clientes (
      instancia     TEXT PRIMARY KEY,
      config        JSONB NOT NULL,
      ativo         BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agendamentos (
      id          TEXT PRIMARY KEY,
      instancia   TEXT NOT NULL,
      telefone    TEXT NOT NULL,
      nome        TEXT,
      servico     TEXT NOT NULL,
      preco       NUMERIC,
      duracao_min INT NOT NULL,
      data        DATE NOT NULL,
      hora        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'confirmado',
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS agendamentos_dia ON agendamentos (instancia, data);

    CREATE TABLE IF NOT EXISTS mensagens (
      id        BIGSERIAL PRIMARY KEY,
      instancia TEXT NOT NULL,
      telefone  TEXT NOT NULL,
      papel     TEXT NOT NULL,
      texto     TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS mensagens_conversa ON mensagens (instancia, telefone, id DESC);

    CREATE TABLE IF NOT EXISTS pausas (
      instancia TEXT NOT NULL,
      telefone  TEXT NOT NULL,
      ate       TIMESTAMPTZ NOT NULL,
      motivo    TEXT,
      PRIMARY KEY (instancia, telefone)
    );
  `);
}
