// "Humano assume": conversas em que o bot fica em silêncio por um tempo.
import { q } from './db.js';
import { soDigitos } from './util.js';

export async function pausar(instancia, contato, horas, motivo) {
  await q(
    `INSERT INTO pausas (instancia, telefone, ate, motivo)
     VALUES ($1, $2, now() + make_interval(mins => $3), $4)
     ON CONFLICT (instancia, telefone) DO UPDATE SET ate = EXCLUDED.ate, motivo = EXCLUDED.motivo`,
    [instancia, contato, Math.round(horas * 60), motivo || null],
  );
}

export async function estaPausado(instancia, contato) {
  const { rows } = await q(
    'SELECT 1 FROM pausas WHERE instancia = $1 AND telefone = $2 AND ate > now()',
    [instancia, contato],
  );
  return rows.length > 0;
}

// "retomar 11999998888" funciona com o número inteiro ou só o final.
export async function retomar(instancia, numero) {
  const digitos = soDigitos(numero);
  if (digitos.length < 8) return 0;
  const { rowCount } = await q(
    'DELETE FROM pausas WHERE instancia = $1 AND right(regexp_replace(telefone, \'\\D\', \'\', \'g\'), 8) = $2',
    [instancia, digitos.slice(-8)],
  );
  return rowCount;
}

export async function retomarTodas(instancia) {
  const { rowCount } = await q('DELETE FROM pausas WHERE instancia = $1', [instancia]);
  return rowCount;
}

export async function pausasAtivas(instancia) {
  const { rows } = await q(
    `SELECT telefone, motivo, ate FROM pausas WHERE instancia = $1 AND ate > now() ORDER BY ate`,
    [instancia],
  );
  return rows;
}
