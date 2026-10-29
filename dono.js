// Mensagens que o dono manda do WhatsApp pessoal dele para o número do negócio viram comandos.
import * as agenda from './agenda.js';
import { definirAtivo } from './clientes.js';
import { retomar, retomarTodas, pausasAtivas } from './pausas.js';
import { agoraSP, somarDias, nomeDoDia, dataCurta } from './tempo.js';
import { normalizar, formatarContato } from './util.js';

const AJUDA = `Comandos do dono:
agenda: agenda de hoje
agenda amanhã
agenda 31/10
status: bot ligado? conversas pausadas
pausar: o bot para de responder todo mundo
ativar: o bot volta a responder
retomar 11999998888: o bot volta a responder esse cliente
retomar todos: o bot volta em todas as conversas pausadas`;

function lerData(arg) {
  const hoje = agoraSP().data;
  if (!arg || arg === 'hoje') return hoje;
  if (arg === 'amanha') return somarDias(hoje, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  const m = arg.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const ano = Number(hoje.slice(0, 4));
    let data = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (data < hoje) data = `${ano + 1}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return data;
  }
  return null;
}

export async function comandoDoDono(cliente, texto) {
  const t = normalizar(texto);
  const [cmd, ...resto] = t.split(/\s+/);
  const arg = resto.join(' ');

  if (cmd === 'agenda') {
    const data = lerData(arg);
    if (!data) return 'Não entendi a data. Exemplos: agenda, agenda amanhã, agenda 31/10';
    const itens = await agenda.doDia(cliente.instancia, data);
    const titulo = `Agenda de ${nomeDoDia(data)}, ${dataCurta(data)}`;
    if (!itens.length) return `${titulo}: nenhum agendamento.`;
    const linhas = itens.map((a) => `${a.hora} ${a.servico}: ${a.nome || 'sem nome'} (${formatarContato(a.telefone)}) #${a.id}`);
    return `${titulo} (${itens.length}):\n${linhas.join('\n')}`;
  }

  if (cmd === 'pausar') {
    await definirAtivo(cliente.instancia, false);
    return '⏸️ Bot pausado. Ninguém vai receber resposta automática. Mande "ativar" para voltar.';
  }

  if (cmd === 'ativar') {
    await definirAtivo(cliente.instancia, true);
    return '▶️ Bot ativo de novo.';
  }

  if (cmd === 'retomar') {
    if (arg === 'todos' || arg === 'todas') {
      const n = await retomarTodas(cliente.instancia);
      return `▶️ Bot voltou a responder em ${n} conversa(s).`;
    }
    const n = await retomar(cliente.instancia, arg);
    return n ? '▶️ Pronto, o bot voltou a responder esse cliente.' : 'Não achei conversa pausada com esse número.';
  }

  if (cmd === 'status') {
    const pausas = await pausasAtivas(cliente.instancia);
    const linhas = pausas.map((p) => `- ${formatarContato(p.telefone)}${p.motivo ? `: ${p.motivo}` : ''}`);
    return `Bot: ${cliente.ativo ? 'ativo ▶️' : 'pausado ⏸️'}\nConversas com humano: ${pausas.length}${linhas.length ? `\n${linhas.join('\n')}` : ''}`;
  }

  return AJUDA;
}

export function textoDoAviso(cliente, ev) {
  const quem = formatarContato(ev.contato);
  if (ev.tipo === 'agendado') {
    const a = ev.agendamento;
    return `📅 Novo agendamento\n${a.nome}: ${a.servico} (R$ ${a.preco})\n${a.dia}, ${dataCurta(a.data)} às ${a.hora}\nCódigo ${a.id} · ${quem}`;
  }
  if (ev.tipo === 'cancelado') {
    const a = ev.agendamento;
    return `❌ Agendamento cancelado\n${a.nome}: ${a.servico}\n${a.dia}, ${dataCurta(a.data)} às ${a.hora}\nCódigo ${a.id} · ${quem}`;
  }
  if (ev.tipo === 'humano') {
    return `🙋 Cliente pediu atendimento humano\n${quem}\nMotivo: ${ev.motivo}\n\nResponda direto pelo WhatsApp do negócio. O bot fica em silêncio nessa conversa por ${ev.horas}h (ou mande "retomar ${ev.contato}").`;
  }
  if (ev.tipo === 'erro') {
    return `⚠️ O bot teve um erro ao responder ${quem}. Dá uma olhada na conversa.`;
  }
  return null;
}
