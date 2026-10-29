// O "cérebro": monta o prompt de cada negócio, conversa com o Claude e executa as ferramentas.
import Anthropic from '@anthropic-ai/sdk';
import { q } from './db.js';
import { agoraSP, nomeDoDia } from './tempo.js';
import * as agenda from './agenda.js';
import { pausar } from './pausas.js';

const claude = new Anthropic(); // usa ANTHROPIC_API_KEY
const MODELO = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const MAX_HISTORICO = 20;

function promptDoSistema(cliente, nomeContato) {
  const agora = agoraSP();
  const servicos = cliente.servicos.map((s) => `- ${s.nome}: R$ ${s.preco} (${s.duracao_min} min)`).join('\n');
  const horarios = Object.entries(cliente.horarios)
    .map(([d, h]) => `- ${d}: ${h ? `${h[0]} às ${h[1]}` : 'fechado'}`).join('\n');
  const regras = (cliente.regras_extras || []).map((r) => `- ${r}`).join('\n') || '- (nenhuma)';

  return `Você é o atendente virtual da ${cliente.nome} (${cliente.tipo || 'negócio'}) no WhatsApp.
Hoje é ${nomeDoDia(agora.data)}, ${agora.data}, e agora são ${agora.hora} (horário de Brasília).
${nomeContato ? `O nome do contato no WhatsApp é "${nomeContato}" (confirme o nome antes de agendar).` : ''}

DADOS DO NEGÓCIO
Endereço: ${cliente.endereco || 'não informado'}
Instagram: ${cliente.instagram || 'não informado'}
Pagamento: ${cliente.pagamento || 'não informado'}
Profissionais: ${(cliente.profissionais || []).join(', ') || 'não informado'}

Serviços:
${servicos}

Horário de funcionamento:
${horarios}

Regras:
${regras}
${cliente.instrucoes_extras ? `\nINSTRUÇÕES ESPECÍFICAS DESTE NEGÓCIO\n${cliente.instrucoes_extras}\n` : ''}
COMO ATENDER
- Escreva como uma pessoa simpática da recepção: frases curtas, tom leve, no máximo 1 emoji por mensagem.
- Mensagens de WhatsApp: curtas, sem markdown, sem títulos. Use quebras de linha em vez de listas longas.
- Para agendar, você precisa de: serviço, dia, horário e nome do cliente. Pergunte o que faltar, uma coisa por vez.
- SEMPRE use verificar_horarios antes de oferecer horários. Ofereça no máximo 3 a 4 opções.
- Converta "amanhã", "sábado que vem" etc. em data AAAA-MM-DD com base na data de hoje.
- Antes de chamar agendar, confirme o resumo com o cliente (serviço, dia, hora, valor). Agende só depois do "sim".
- Depois de agendar, mande o resumo com o código do agendamento.
- Nunca invente preços, serviços ou horários que não estejam acima ou nas ferramentas.
- Mensagens marcadas com [atendente humano] foram escritas pela equipe: siga o que foi combinado nelas.
- Use chamar_atendente quando o cliente pedir para falar com uma pessoa, reclamar, negociar preço,
  pedir algo que você não sabe responder, ou quando a conversa travar. Depois avise que a equipe vai responder em breve.`;
}

const ferramentas = [
  {
    name: 'verificar_horarios',
    description: 'Lista horários livres para um serviço numa data.',
    input_schema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'Data no formato AAAA-MM-DD' },
        servico: { type: 'string', description: 'Nome do serviço' },
      },
      required: ['data', 'servico'],
    },
  },
  {
    name: 'agendar',
    description: 'Cria o agendamento. Use só depois do cliente confirmar o resumo.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome do cliente' },
        servico: { type: 'string' },
        data: { type: 'string', description: 'AAAA-MM-DD' },
        hora: { type: 'string', description: 'HH:MM' },
      },
      required: ['nome', 'servico', 'data', 'hora'],
    },
  },
  {
    name: 'meus_agendamentos',
    description: 'Lista os próximos agendamentos deste cliente.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancelar',
    description: 'Cancela um agendamento deste cliente pelo código.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Código do agendamento' } },
      required: ['id'],
    },
  },
  {
    name: 'chamar_atendente',
    description: 'Passa a conversa para a equipe humana. O bot para de responder este cliente por algumas horas e o dono é avisado.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'Resumo curto do que o cliente precisa' } },
      required: ['motivo'],
    },
  },
];

async function executar(cliente, contato, nome, entrada, eventos) {
  switch (nome) {
    case 'verificar_horarios':
      return agenda.horariosLivres(cliente, entrada.data, entrada.servico);
    case 'agendar': {
      const r = await agenda.agendar(cliente, { ...entrada, telefone: contato });
      if (r.ok) eventos.push({ tipo: 'agendado', contato, agendamento: r.agendamento });
      return r;
    }
    case 'meus_agendamentos':
      return { agendamentos: await agenda.doContato(cliente.instancia, contato) };
    case 'cancelar': {
      const r = await agenda.cancelar(cliente.instancia, contato, entrada.id);
      if (r.ok) eventos.push({ tipo: 'cancelado', contato, agendamento: r.cancelado });
      return r;
    }
    case 'chamar_atendente': {
      const horas = cliente.pausa_humano_horas ?? 12;
      await pausar(cliente.instancia, contato, horas, entrada.motivo);
      eventos.push({ tipo: 'humano', contato, motivo: entrada.motivo, horas });
      return { ok: true, aviso: 'Equipe avisada. Diga ao cliente que alguém responde em breve.' };
    }
    default:
      return { erro: 'Ferramenta desconhecida' };
  }
}

export async function salvarMensagem(instancia, contato, papel, texto) {
  await q('INSERT INTO mensagens (instancia, telefone, papel, texto) VALUES ($1, $2, $3, $4)', [instancia, contato, papel, texto]);
}

// Últimas mensagens das últimas 24h, no formato que a API aceita
// (começa com "user" e alterna; mensagens seguidas do mesmo lado são juntadas).
async function historico(instancia, contato) {
  const { rows } = await q(
    `SELECT papel, texto FROM mensagens
     WHERE instancia = $1 AND telefone = $2 AND criado_em > now() - interval '24 hours'
     ORDER BY id DESC LIMIT $3`,
    [instancia, contato, MAX_HISTORICO],
  );
  const msgs = [];
  for (const { papel, texto } of rows.reverse()) {
    const ultimo = msgs[msgs.length - 1];
    if (ultimo && ultimo.role === papel) ultimo.content += `\n${texto}`;
    else msgs.push({ role: papel, content: texto });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

export async function responder(cliente, contato, texto, nomeContato) {
  await salvarMensagem(cliente.instancia, contato, 'user', texto);
  const mensagens = await historico(cliente.instancia, contato);
  const eventos = [];
  let resposta = '';

  for (let volta = 0; volta < 6; volta++) {
    const r = await claude.messages.create({
      model: MODELO,
      max_tokens: 700,
      system: promptDoSistema(cliente, nomeContato),
      tools: ferramentas,
      messages: mensagens,
    });
    mensagens.push({ role: 'assistant', content: r.content });

    const usos = r.content.filter((b) => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || usos.length === 0) {
      resposta = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      break;
    }

    const resultados = [];
    for (const u of usos) {
      let saida;
      try {
        saida = await executar(cliente, contato, u.name, u.input || {}, eventos);
      } catch (e) {
        console.error(`[${cliente.instancia}] erro na ferramenta ${u.name}:`, e.message);
        saida = { erro: 'Falha interna, tente de novo ou chame um atendente.' };
      }
      resultados.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(saida) });
    }
    mensagens.push({ role: 'user', content: resultados });
  }

  if (!resposta) resposta = 'Desculpa, me enrolei aqui 😅 Pode repetir, por favor?';
  await salvarMensagem(cliente.instancia, contato, 'assistant', resposta);
  return { resposta, eventos };
}
