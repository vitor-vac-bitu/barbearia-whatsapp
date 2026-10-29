import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { migrar } from './db.js';
import { sincronizarArquivos, obterCliente, listarClientes } from './clientes.js';
import { enviarTexto, foiOBot } from './evolution.js';
import { responder, salvarMensagem } from './atendente.js';
import { pausar, estaPausado } from './pausas.js';
import { comandoDoDono, textoDoAviso } from './dono.js';
import * as agenda from './agenda.js';
import { contatoDe, extrairTexto, mesmoNumero, soDigitos } from './util.js';

const AGRUPAR_MS = Number(process.env.AGRUPAR_MS ?? 2500); // junta mensagens seguidas do cliente

// ---------- Avisos para o dono ----------
async function avisarDono(cliente, ev) {
  if (!cliente.dono_whatsapp) return;
  const texto = textoDoAviso(cliente, ev);
  if (texto) await enviarTexto(cliente, soDigitos(cliente.dono_whatsapp), texto);
}

// ---------- Fila por conversa (uma resposta de cada vez) ----------
const filas = new Map();
function enfileirar(chave, tarefa) {
  const anterior = filas.get(chave) || Promise.resolve();
  const proxima = anterior.then(tarefa).catch((e) => console.error(`[${chave}]`, e));
  filas.set(chave, proxima);
  proxima.finally(() => { if (filas.get(chave) === proxima) filas.delete(chave); });
  return proxima;
}

// ---------- Atendimento ----------
async function atender(cliente, contato, texto, nomeContato) {
  if (await estaPausado(cliente.instancia, contato)) {
    await salvarMensagem(cliente.instancia, contato, 'user', texto);
    return;
  }
  let r;
  try {
    r = await responder(cliente, contato, texto, nomeContato);
  } catch (e) {
    console.error(`[${cliente.instancia}] erro da IA:`, e.message);
    await enviarTexto(cliente, contato, 'Opa, tive um probleminha aqui 😅 Já já alguém da equipe te responde.');
    await pausar(cliente.instancia, contato, 1, 'erro do bot');
    await avisarDono(cliente, { tipo: 'erro', contato });
    return;
  }
  await enviarTexto(cliente, contato, r.resposta);
  for (const ev of r.eventos) await avisarDono(cliente, ev);
}

const buffers = new Map();
function agrupar(cliente, contato, texto, nomeContato) {
  const chave = `${cliente.instancia}|${contato}`;
  const b = buffers.get(chave) || { textos: [] };
  b.textos.push(texto);
  clearTimeout(b.timer);
  b.timer = setTimeout(() => {
    buffers.delete(chave);
    enfileirar(chave, () => atender(cliente, contato, b.textos.join('\n'), nomeContato));
  }, AGRUPAR_MS);
  buffers.set(chave, b);
}

const vistos = new Set();

async function tratarMensagem(cliente, d) {
  const key = d?.key;
  const jid = key?.remoteJid;
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@newsletter') || jid === 'status@broadcast') return;

  const idUnico = `${cliente.instancia}|${key.id}`;
  if (vistos.has(idUnico)) return;
  vistos.add(idUnico);
  if (vistos.size > 20000) vistos.clear();

  const contato = contatoDe(key);
  const texto = extrairTexto(d.message);

  // Mensagem enviada pelo número do negócio: ou é o próprio bot, ou alguém da equipe respondendo à mão.
  if (key.fromMe) {
    if (foiOBot(cliente.instancia, contato, key.id, texto)) return;
    const horas = cliente.pausa_humano_horas ?? 12;
    await pausar(cliente.instancia, contato, horas, 'equipe respondeu manualmente');
    await salvarMensagem(cliente.instancia, contato, 'assistant', `[atendente humano] ${texto || '(enviou mídia)'}`);
    console.log(`[${cliente.instancia}] humano assumiu ${contato} por ${horas}h`);
    return;
  }

  // Dono falando com o número do negócio: comandos.
  if (cliente.dono_whatsapp && mesmoNumero(contato, cliente.dono_whatsapp)) {
    if (!texto) return;
    enfileirar(`${cliente.instancia}|dono`, async () => {
      const resposta = await comandoDoDono(cliente, texto);
      await enviarTexto(cliente, contato, resposta);
    });
    return;
  }

  if (!cliente.ativo) return;

  if (await estaPausado(cliente.instancia, contato)) {
    if (texto) await salvarMensagem(cliente.instancia, contato, 'user', texto);
    return;
  }

  if (!texto) {
    await enviarTexto(cliente, contato, 'Por enquanto só consigo ler mensagens de texto 🙏 Pode escrever pra mim?');
    return;
  }

  agrupar(cliente, contato, texto, d.pushName);
}

async function processarEvento(corpo) {
  const { event, instance, data } = corpo || {};
  if (!instance) return;
  if (event && !/messages[._]upsert/i.test(String(event))) return;

  const cliente = await obterCliente(instance);
  if (!cliente) {
    console.warn(`Mensagem da instância "${instance}", mas não existe clientes/${instance}.json`);
    return;
  }
  for (const d of Array.isArray(data) ? data : [data]) await tratarMensagem(cliente, d);
}

// ---------- Servidor ----------
const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (_req, res) => res.send('Bot atendente no ar ✅'));

app.post('/webhook', (req, res) => {
  const segredo = process.env.WEBHOOK_SECRET;
  if (segredo && req.query.secret !== segredo) return res.sendStatus(401);
  res.sendStatus(200); // responde rápido; o resto roda em segundo plano
  processarEvento(req.body).catch((e) => console.error('webhook:', e));
});

function protegido(req, res, next) {
  const t = process.env.ADMIN_TOKEN;
  if (!t || req.query.token !== t) return res.sendStatus(401);
  next();
}

app.get('/admin/clientes', protegido, async (_req, res) => res.json(await listarClientes()));

app.get('/admin/agenda', protegido, async (req, res) => {
  const { instancia, data } = req.query;
  if (instancia && data) return res.json(await agenda.doDia(instancia, data));
  res.json(await agenda.proximos(instancia));
});

// Conversa de teste sem WhatsApp: POST /teste?token=... {"instancia":"demo-barbearia","telefone":"5511999999999","texto":"oi"}
app.post('/teste', protegido, async (req, res) => {
  const { instancia, telefone = 'teste', texto } = req.body || {};
  const cliente = instancia && await obterCliente(instancia);
  if (!cliente) return res.status(404).json({ erro: 'Instância não cadastrada em clientes/' });
  if (!texto) return res.status(400).json({ erro: 'Envie "texto"' });
  try {
    const r = await enfileirar(`${instancia}|${telefone}`, () => responder(cliente, telefone, texto));
    res.json(r);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

await migrar();
const carregados = await sincronizarArquivos(path.resolve('clientes'));
console.log(`Clientes carregados: ${carregados.join(', ') || 'nenhum'}`);

const porta = process.env.PORT || 3000;
app.listen(porta, () => console.log(`Bot ouvindo na porta ${porta}`));
