export const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Identificador do contato: o número (ex.: 5511999999999) quando disponível.
// Em contas com "LID" (identificador oculto do WhatsApp), usa o número alternativo que a Evolution envia;
// se não houver, guarda o JID completo, que a Evolution também aceita para responder.
export function contatoDe(key) {
  const jid = key.remoteJid;
  if (jid.endsWith('@s.whatsapp.net')) return jid.split('@')[0];
  const alt = [key.remoteJidAlt, key.senderPn, key.participantAlt].find((x) => x && x.includes('@s.whatsapp.net'));
  return alt ? alt.split('@')[0] : jid;
}

// Compara dois números ignorando +55, espaços e o nono dígito.
export function mesmoNumero(a, b) {
  const x = soDigitos(a);
  const y = soDigitos(b);
  if (x.length < 8 || y.length < 8) return false;
  return x.slice(-8) === y.slice(-8);
}

export function extrairTexto(msg) {
  if (!msg) return null;
  const m = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg;
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.buttonsResponseMessage?.selectedDisplayText
    || m.listResponseMessage?.title
    || null;
}

export const formatarContato = (c) => (/^\d+$/.test(c) ? `+${c}` : c);

// Texto sem acento e minúsculo, para comparar comandos.
export const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
