# Bot atendente de WhatsApp (demo de barbearia)

Atendente com IA (Claude) que responde dúvidas, mostra preços e agenda horários pelo WhatsApp, usando a Evolution API.

## O que tem aqui

| Arquivo | Para que serve |
|---|---|
| `negocio.json` | **Tudo do negócio**: nome, serviços, preços, horários, regras. É o único arquivo que você troca para cada prospect. |
| `index.js` | Servidor: recebe o webhook da Evolution, conversa com o Claude e responde no WhatsApp. |
| `agenda.js` | Agenda de demo (salva em `data/agendamentos.json`). |
| `.env.example` | Variáveis de ambiente que você precisa preencher. |

## 1. Rodar no seu computador (opcional, para testar)

```bash
npm install
cp .env.example .env      # preencha ANTHROPIC_API_KEY e ADMIN_TOKEN
npm start
```

Teste sem WhatsApp:

```bash
curl -X POST "http://localhost:3000/teste?token=SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"telefone":"5511999999999","texto":"oi, quero cortar o cabelo sábado"}'
```

Mande várias mensagens com o mesmo `telefone` para simular a conversa. Veja os agendamentos em `/agenda?token=SEU_TOKEN`.

## 2. Subir no Railway

1. Suba esta pasta para um repositório novo no GitHub (ex.: `bot-atendente`).
2. No Railway, no **mesmo projeto da sua Evolution API**: *New* → *GitHub Repo* → escolha o repositório.
3. Em *Variables*, cadastre as variáveis do `.env.example`:
   - `ANTHROPIC_API_KEY`
   - `CLAUDE_MODEL=claude-haiku-5-5`
   - `EVOLUTION_URL` (a URL pública da sua Evolution)
   - `EVOLUTION_APIKEY`
   - `EVOLUTION_INSTANCE=demo-barbearia`
   - `ADMIN_TOKEN`
4. Em *Settings → Networking*, clique em *Generate Domain*. Você vai ganhar algo como `https://bot-atendente.up.railway.app`.

## 3. Conectar o número de demo na Evolution

1. Crie a instância `demo-barbearia` na Evolution e escaneie o QR code com o **chip da demo** (não use seu número pessoal).
2. Configure o webhook dessa instância:
   - URL: `https://bot-atendente.up.railway.app/webhook`
   - Evento: `MESSAGES_UPSERT`
   - *Webhook by events*: desligado
3. De outro celular, mande "oi" para o número da demo. Pronto.

## 4. Personalizar para um prospect (o truque de venda)

Abra o `negocio.json` e troque nome, endereço, serviços, preços e horários pelos do negócio que você vai abordar (pegue do Instagram ou do Google). Faça commit, e o Railway publica sozinho em ~1 minuto. Aí mande o link `https://wa.me/55DDDNUMERO` para o dono testar.

Dica: peça ao Claude "monte o negocio.json da barbearia X a partir deste print do Instagram" e cole o print.

## Custos estimados

- Railway: plano Hobby, já pago pela sua Evolution.
- Claude Haiku: centavos por conversa de agendamento.
- Chip da demo: um pré-pago simples.

## Limitações da demo (resolver antes de cliente real)

- A agenda fica num arquivo, e o Railway apaga arquivos a cada novo deploy. Para cliente pagante, use um Volume do Railway, um banco (Postgres) ou integre com o Google Agenda.
- O histórico da conversa fica em memória e zera quando o servidor reinicia.
- Só lê texto (áudio e imagem recebem uma resposta padrão).
- Não avisa o dono do negócio sobre novos agendamentos. Uma melhoria simples é mandar uma mensagem para o WhatsApp do dono a cada agendamento.
