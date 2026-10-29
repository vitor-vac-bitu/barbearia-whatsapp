// Envio de mensagens pela Evolution API e registro do que o próprio bot mandou
// (para diferenciar a resposta do bot de uma resposta manual da equipe).
const idsDoBot = new Set();
const recentes = new Map(); // "instancia|contato" -> [{ texto, t }]
const JANELA_MS = 3 * 60 * 1000;

const limpar = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function lembrar(instancia, contato, texto) {
  const k = `${instancia}|${contato}`;
  const agora = Date.now();
  const lista = (recentes.get(k) || []).filter((m) => agora - m.t < JANELA_MS);
  lista.push({ texto: limpar(texto), t: agora });
  recentes.set(k, lista);
}

export function foiOBot(instancia, contato, id, texto) {
  if (id && idsDoBot.has(id)) return true;
  if (!texto) return false;
  const agora = Date.now();
  return (recentes.get(`${instancia}|${contato}`) || [])
    .some((m) => agora - m.t < JANELA_MS && m.texto === limpar(texto));
}

export async function enviarTexto(cliente, destino, texto) {
  const base = (cliente.evolution_url || process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
  const chave = cliente.evolution_token || process.env.EVOLUTION_APIKEY;
  lembrar(cliente.instancia, destino, texto); // antes do envio: o eco do webhook pode chegar antes da resposta HTTP

  try {
    const r = await fetch(`${base}/message/sendText/${encodeURIComponent(cliente.instancia)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chave },
      body: JSON.stringify({ number: destino, text: texto, delay: 1200 }),
    });
    if (!r.ok) {
      console.error(`[${cliente.instancia}] falha ao enviar para ${destino}:`, r.status, await r.text());
      return null;
    }
    const j = await r.json().catch(() => ({}));
    const id = j?.key?.id;
    if (id) {
      idsDoBot.add(id);
      if (idsDoBot.size > 10000) idsDoBot.clear();
    }
    return id || true;
  } catch (e) {
    console.error(`[${cliente.instancia}] erro de rede ao enviar:`, e.message);
    return null;
  }
}
