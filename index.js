import 'dotenv/config';
import fs from 'node:fs';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { Agenda, agoraSP, nomeDoDia } from './agenda.js';

const negocio = JSON.parse(fs.readFileSync(new URL('./negocio.json', import.meta.url), 'utf8'));
const agenda = new Agenda(negocio);
const claude = new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente
const MODELO = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const { EVOLUTION_URL, EVOLUTION_APIKEY, EVOLUTION_INSTANCE } = process.env;

// ---------- Prompt do atendente (montado a partir do negocio.json) ----------
function promptDoSistema() {
  const agora = agoraSP();
  const servicos = negocio.servicos
    .map((s) => `- ${s.nome}: R$ ${s.preco} (${s.duracao_min} min)`).join('\n');
  const horarios = Object.entries(negocio.horarios)
    .map(([d, h]) => `- ${d}: ${h ? `${h[0]} às ${h[1]}` : 'fechado'}`).join('\n');
  const regras = (negocio.regras_extras || []).map((r) => `- ${r}`).join('\n');

  return `Você é o atendente virtual da ${negocio.nome} (${negocio.tipo}) no WhatsApp.
Hoje é ${nomeDoDia(agora.data)}, ${agora.data}, e agora são ${agora.hora} (horário de Brasília).

DADOS DO NEGÓCIO
Endereço: ${negocio.endereco}
Instagram: ${negocio.instagram}
Pagamento: ${negocio.pagamento}
Profissionais: ${(negocio.profissionais || []).join(', ')}

Serviços:
${servicos}

Horário de funcionamento:
${horarios}

Regras:
${regras}

COMO ATENDER
- Escreva como uma pessoa simpática da recepção: frases curtas, tom leve, no máximo 1 emoji por mensagem.
- Mensagens de WhatsApp: curtas, sem markdown, sem títulos. Use quebras de linha em vez de listas longas.
- Para agendar, você precisa de: serviço, dia, horário e nome do cliente. Pergunte o que faltar, uma coisa por vez.
- SEMPRE use a ferramenta verificar_horarios antes de oferecer horários. Ofereça no máximo 3 a 4 opções.
- Converta "amanhã", "sábado que vem" etc. em data AAAA-MM-DD com base na data de hoje.
- Antes de chamar agendar, confirme o resumo com o cliente (serviço, dia, hora, valor). Agende só depois do "sim".
- Depois de agendar, mande o resumo com o código do agendamento.
- Nunca invente preços, serviços ou horários que não estejam acima ou nas ferramentas.
- Se pedirem algo fora do seu alcance (reclamação, assunto pessoal, negociação de preço), diga que vai passar para a equipe.`;
}

// ---------- Ferramentas que a IA pode usar ----------
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
];

function executarFerramenta(nome, entrada, telefone) {
  switch (nome) {
    case 'verificar_horarios': return agenda.horariosLivres(entrada.data, entrada.servico);
    case 'agendar': return agenda.agendar({ ...entrada, telefone });
    case 'meus_agendamentos': return { agendamentos: agenda.doCliente(telefone) };
    case 'cancelar': return agenda.cancelar(telefone, (entrada.id || '').toUpperCase());
    default: return { erro: 'Ferramenta desconhecida' };
  }
}

// ---------- Conversa ----------
const historicos = new Map(); // telefone -> [{role, content}] só com texto
const MAX_MSGS = 20;

async function responder(telefone, texto) {
  const historico = historicos.get(telefone) || [];
  historico.push({ role: 'user', content: texto });

  const mensagens = [...historico];
  let resposta = '';

  for (let volta = 0; volta < 6; volta++) {
    const r = await claude.messages.create({
      model: MODELO,
      max_tokens: 600,
      system: promptDoSistema(),
      tools: ferramentas,
      messages: mensagens,
    });

    mensagens.push({ role: 'assistant', content: r.content });
    const usos = r.content.filter((b) => b.type === 'tool_use');

    if (r.stop_reason !== 'tool_use' || usos.length === 0) {
      resposta = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      break;
    }

    mensagens.push({
      role: 'user',
      content: usos.map((u) => ({
        type: 'tool_result',
        tool_use_id: u.id,
        content: JSON.stringify(executarFerramenta(u.name, u.input, telefone)),
      })),
    });
  }

  if (!resposta) resposta = 'Desculpa, me enrolei aqui 😅 Pode repetir, por favor?';

  historico.push({ role: 'assistant', content: resposta });
  while (historico.length > MAX_MSGS) historico.splice(0, 2); // remove pares antigos
  historicos.set(telefone, historico);
  return resposta;
}

// Uma fila por cliente, para mensagens seguidas não se atropelarem
const filas = new Map();
function enfileirar(telefone, tarefa) {
  const anterior = filas.get(telefone) || Promise.resolve();
  const proxima = anterior.then(tarefa).catch((e) => console.error('Erro:', e.message));
  filas.set(telefone, proxima);
  return proxima;
}

// ---------- Evolution API ----------
async function enviarWhatsApp(numero, texto) {
  const r = await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_APIKEY },
    body: JSON.stringify({ number: numero, text: texto, delay: 1200 }),
  });
  if (!r.ok) console.error('Falha ao enviar:', r.status, await r.text());
}

function extrairTexto(msg = {}) {
  return msg.conversation
    || msg.extendedTextMessage?.text
    || msg.imageMessage?.caption
    || msg.videoMessage?.caption
    || null;
}

const vistos = new Set();
const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/', (_req, res) => res.send(`Bot ${negocio.nome} no ar ✅`));

// Webhook da Evolution (configure com o evento MESSAGES_UPSERT)
app.post('/webhook', (req, res) => {
  res.sendStatus(200); // responde rápido; o processamento segue em segundo plano

  const { event, data } = req.body || {};
  if (event && !String(event).toLowerCase().includes('messages.upsert') && event !== 'MESSAGES_UPSERT') return;
  const itens = Array.isArray(data) ? data : [data];

  for (const d of itens) {
    const jid = d?.key?.remoteJid;
    if (!jid || d.key.fromMe || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
    if (vistos.has(d.key.id)) continue;
    vistos.add(d.key.id);
    if (vistos.size > 5000) vistos.clear();

    const numero = jid.split('@')[0];
    const texto = extrairTexto(d.message);

    enfileirar(numero, async () => {
      if (!texto) {
        await enviarWhatsApp(numero, 'Por enquanto só consigo ler mensagens de texto 🙏 Pode escrever pra mim?');
        return;
      }
      const resposta = await responder(numero, texto);
      await enviarWhatsApp(numero, resposta);
    });
  }
});

// Protege as rotas de teste/agenda com ?token=ADMIN_TOKEN (se definido)
function protegido(req, res, next) {
  const t = process.env.ADMIN_TOKEN;
  if (t && req.query.token !== t) return res.sendStatus(401);
  next();
}

// Rota de teste sem WhatsApp: POST /teste {"telefone":"5511999999999","texto":"oi"}
app.post('/teste', protegido, async (req, res) => {
  const { telefone = 'teste', texto } = req.body || {};
  if (!texto) return res.status(400).json({ erro: 'Envie "texto"' });
  const resposta = await enfileirar(telefone, () => responder(telefone, texto));
  res.json({ resposta });
});

// Ver a agenda da demo
app.get('/agenda', protegido, (_req, res) => res.json(agenda.itens));

const porta = process.env.PORT || 3000;
app.listen(porta, () => console.log(`${negocio.nome} ouvindo na porta ${porta}`));
