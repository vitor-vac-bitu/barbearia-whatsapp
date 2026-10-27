// Agenda de demonstração: guarda agendamentos num arquivo JSON.
// Para clientes reais, troque por Google Agenda, Trinks, Booksy etc.
import fs from 'node:fs';
import path from 'node:path';

const TZ = 'America/Sao_Paulo';
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const NOMES_DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export function agoraSP() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  const hora = p.hour === '24' ? '00' : p.hour;
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${hora}:${p.minute}` };
}

const paraMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const paraHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function diaDaSemana(data) {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}
export const nomeDoDia = (data) => NOMES_DIAS[diaDaSemana(data)];

export class Agenda {
  constructor(negocio, arquivo = path.resolve('data/agendamentos.json')) {
    this.negocio = negocio;
    this.arquivo = arquivo;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    this.itens = fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : [];
  }

  salvar() {
    fs.writeFileSync(this.arquivo, JSON.stringify(this.itens, null, 2));
  }

  servico(nome) {
    const alvo = (nome || '').toLowerCase().trim();
    return this.negocio.servicos.find((s) => s.nome.toLowerCase() === alvo)
      || this.negocio.servicos.find((s) => s.nome.toLowerCase().includes(alvo));
  }

  horariosLivres(data, nomeServico) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { erro: 'Data inválida, use AAAA-MM-DD.' };
    const servico = this.servico(nomeServico);
    if (!servico) return { erro: `Serviço não encontrado. Opções: ${this.negocio.servicos.map((s) => s.nome).join(', ')}.` };

    const hoje = agoraSP();
    if (data < hoje.data) return { erro: 'Essa data já passou.' };

    const expediente = this.negocio.horarios[DIAS[diaDaSemana(data)]];
    if (!expediente) return { data, dia: nomeDoDia(data), fechado: true, horarios: [] };

    const passo = this.negocio.intervalo_agenda_min || 30;
    const nProf = Math.max(1, (this.negocio.profissionais || []).length);
    const inicio = paraMin(expediente[0]);
    const fim = paraMin(expediente[1]);
    const minimo = data === hoje.data ? paraMin(hoje.hora) + 30 : 0; // 30 min de antecedência

    const doDia = this.itens.filter((a) => a.data === data);
    const livres = [];
    for (let t = inicio; t + servico.duracao_min <= fim; t += passo) {
      if (t < minimo) continue;
      const ocupados = doDia.filter((a) => {
        const ai = paraMin(a.hora);
        return t < ai + a.duracao_min && ai < t + servico.duracao_min;
      }).length;
      if (ocupados < nProf) livres.push(paraHora(t));
    }
    return { data, dia: nomeDoDia(data), servico: servico.nome, horarios: livres };
  }

  agendar({ telefone, nome, servico: nomeServico, data, hora }) {
    const servico = this.servico(nomeServico);
    if (!servico) return { erro: 'Serviço não encontrado.' };
    const disp = this.horariosLivres(data, servico.nome);
    if (disp.erro) return disp;
    if (!disp.horarios.includes(hora)) {
      return { erro: 'Horário indisponível.', alternativas: disp.horarios.slice(0, 6) };
    }
    const item = {
      id: Math.random().toString(36).slice(2, 8).toUpperCase(),
      telefone, nome, servico: servico.nome, preco: servico.preco,
      duracao_min: servico.duracao_min, data, hora,
      criado_em: new Date().toISOString(),
    };
    this.itens.push(item);
    this.salvar();
    return { ok: true, agendamento: { ...item, dia: nomeDoDia(data) } };
  }

  doCliente(telefone) {
    const hoje = agoraSP().data;
    return this.itens
      .filter((a) => a.telefone === telefone && a.data >= hoje)
      .map((a) => ({ ...a, dia: nomeDoDia(a.data) }));
  }

  cancelar(telefone, id) {
    const i = this.itens.findIndex((a) => a.telefone === telefone && a.id === id);
    if (i === -1) return { erro: 'Agendamento não encontrado para este número.' };
    const [removido] = this.itens.splice(i, 1);
    this.salvar();
    return { ok: true, cancelado: removido };
  }
}
