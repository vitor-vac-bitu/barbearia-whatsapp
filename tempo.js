// Datas e horas sempre no fuso de Brasília.
const TZ = 'America/Sao_Paulo';
export const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
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

export const paraMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const paraHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const diaDaSemana = (data) => new Date(`${data}T12:00:00Z`).getUTCDay();
export const nomeDoDia = (data) => NOMES_DIAS[diaDaSemana(data)];

export function somarDias(data, n) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dataCurta = (data) => { const [, m, d] = data.split('-'); return `${d}/${m}`; };
