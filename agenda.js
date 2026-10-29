// Agenda de cada negócio, guardada no Postgres.
import crypto from 'node:crypto';
import { q, pool } from './db.js';
import { agoraSP, DIAS, diaDaSemana, nomeDoDia, paraMin, paraHora } from './tempo.js';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I
const novoId = () => Array.from(crypto.randomBytes(6), (b) => ALFABETO[b % ALFABETO.length]).join('');

export function acharServico(cliente, nome) {
  const alvo = (nome || '').toLowerCase().trim();
  if (!alvo) return null;
  return cliente.servicos.find((s) => s.nome.toLowerCase() === alvo)
    || cliente.servicos.find((s) => s.nome.toLowerCase().includes(alvo));
}

export async function horariosLivres(cliente, data, nomeServico, db = pool) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) return { erro: 'Data inválida, use AAAA-MM-DD.' };
  const servico = acharServico(cliente, nomeServico);
  if (!servico) return { erro: `Serviço não encontrado. Opções: ${cliente.servicos.map((s) => s.nome).join(', ')}.` };

  const hoje = agoraSP();
  if (data < hoje.data) return { erro: 'Essa data já passou.' };

  const expediente = cliente.horarios[DIAS[diaDaSemana(data)]];
  if (!expediente) return { data, dia: nomeDoDia(data), fechado: true, horarios: [] };

  const { rows: ocupados } = await db.query(
    `SELECT hora, duracao_min FROM agendamentos
     WHERE instancia = $1 AND data = $2 AND status = 'confirmado'`,
    [cliente.instancia, data],
  );

  const passo = cliente.intervalo_agenda_min || 30;
  const capacidade = Math.max(1, (cliente.profissionais || []).length);
  const antecedencia = cliente.antecedencia_min_minutos ?? 30;
  const minimo = data === hoje.data ? paraMin(hoje.hora) + antecedencia : 0;
  const fim = paraMin(expediente[1]);

  const livres = [];
  for (let t = paraMin(expediente[0]); t + servico.duracao_min <= fim; t += passo) {
    if (t < minimo) continue;
    const simultaneos = ocupados.filter((a) => {
      const ini = paraMin(a.hora);
      return t < ini + a.duracao_min && ini < t + servico.duracao_min;
    }).length;
    if (simultaneos < capacidade) livres.push(paraHora(t));
  }
  return { data, dia: nomeDoDia(data), servico: servico.nome, horarios: livres };
}

export async function agendar(cliente, { telefone, nome, servico: nomeServico, data, hora }) {
  const servico = acharServico(cliente, nomeServico);
  if (!servico) return { erro: 'Serviço não encontrado.' };
  if (!/^\d{2}:\d{2}$/.test(hora || '')) return { erro: 'Hora inválida, use HH:MM.' };

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    // Trava a agenda daquele dia para dois clientes não pegarem o mesmo horário ao mesmo tempo.
    await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${cliente.instancia}|${data}`]);

    const disp = await horariosLivres(cliente, data, servico.nome, conn);
    if (disp.erro || disp.fechado || !disp.horarios.includes(hora)) {
      await conn.query('ROLLBACK');
      if (disp.erro) return disp;
      if (disp.fechado) return { erro: `Fechado nesse dia (${disp.dia}).` };
      return { erro: 'Horário indisponível.', alternativas: disp.horarios.slice(0, 6) };
    }

    const id = novoId();
    await conn.query(
      `INSERT INTO agendamentos (id, instancia, telefone, nome, servico, preco, duracao_min, data, hora)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, cliente.instancia, telefone, nome, servico.nome, servico.preco, servico.duracao_min, data, hora],
    );
    await conn.query('COMMIT');
    return {
      ok: true,
      agendamento: { id, nome, servico: servico.nome, preco: servico.preco, data, dia: nomeDoDia(data), hora },
    };
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

export async function doContato(instancia, telefone) {
  const { rows } = await q(
    `SELECT id, nome, servico, preco, data, hora FROM agendamentos
     WHERE instancia = $1 AND telefone = $2 AND status = 'confirmado' AND data >= $3
     ORDER BY data, hora`,
    [instancia, telefone, agoraSP().data],
  );
  return rows.map((a) => ({ ...a, dia: nomeDoDia(a.data) }));
}

export async function cancelar(instancia, telefone, id) {
  const { rows } = await q(
    `UPDATE agendamentos SET status = 'cancelado'
     WHERE instancia = $1 AND telefone = $2 AND id = $3 AND status = 'confirmado'
     RETURNING id, nome, servico, data, hora`,
    [instancia, telefone, (id || '').toUpperCase().trim()],
  );
  if (!rows[0]) return { erro: 'Agendamento não encontrado para este número.' };
  return { ok: true, cancelado: { ...rows[0], dia: nomeDoDia(rows[0].data) } };
}

export async function doDia(instancia, data) {
  const { rows } = await q(
    `SELECT id, telefone, nome, servico, hora, duracao_min FROM agendamentos
     WHERE instancia = $1 AND data = $2 AND status = 'confirmado' ORDER BY hora`,
    [instancia, data],
  );
  return rows;
}

export async function proximos(instancia) {
  const { rows } = await q(
    `SELECT id, telefone, nome, servico, data, hora FROM agendamentos
     WHERE ($1::text IS NULL OR instancia = $1) AND status = 'confirmado' AND data >= $2
     ORDER BY data, hora LIMIT 200`,
    [instancia || null, agoraSP().data],
  );
  return rows;
}
