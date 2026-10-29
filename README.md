# Bot atendente de WhatsApp: vários negócios num bot só

Um único bot atende vários negócios. Cada negócio tem um número de WhatsApp conectado como uma **instância** na Evolution API e um arquivo de configuração em `clientes/`. A IA (Claude) responde dúvidas, mostra preços e agenda horários. Tudo fica salvo no Postgres.

## O que ele faz

- **Vários clientes num deploy só**: a mensagem chega com o nome da instância, e o bot usa o arquivo `clientes/<instancia>.json` certo.
- **Agenda no Postgres**: nada se perde em deploy ou reinício. Também impede dois clientes de pegarem o mesmo horário ao mesmo tempo.
- **Histórico das conversas** das últimas 24h, também no banco.
- **Humano assume**: se alguém da equipe responder manualmente pelo WhatsApp do negócio, o bot fica em silêncio naquela conversa por `pausa_humano_horas` (padrão: 12h).
- **Chamar atendente**: se o cliente pedir uma pessoa, reclamar ou negociar preço, o bot pausa a conversa e avisa o dono.
- **Avisos para o dono** no WhatsApp pessoal dele: novo agendamento, cancelamento, pedido de atendimento humano e erros.
- **Comandos do dono**: ele manda mensagem do WhatsApp pessoal para o número do negócio.
- **Mensagens seguidas são agrupadas**: "oi" + "quero cortar" + "sábado" viram uma resposta só.

### Comandos do dono

| Mensagem | O que faz |
|---|---|
| `agenda` / `agenda amanhã` / `agenda 31/10` | Lista os agendamentos do dia |
| `status` | Mostra se o bot está ligado e quais conversas estão com humano |
| `pausar` / `ativar` | Desliga ou liga o bot para todo mundo |
| `retomar 11999998888` | O bot volta a responder esse cliente |
| `retomar todos` | O bot volta em todas as conversas pausadas |
| qualquer outra coisa | Mostra a lista de comandos |

> O dono não recebe atendimento como cliente pelo número dele. Para testar o bot, use outro número.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `clientes/*.json` | **Um arquivo por negócio.** É aqui que você cadastra clientes. |
| `index.js` | Servidor, webhook, agrupamento de mensagens, humano assume |
| `atendente.js` | Prompt, conversa com o Claude e ferramentas |
| `agenda.js` | Horários livres, agendar, cancelar |
| `dono.js` | Comandos e avisos do dono |
| `pausas.js` | Conversas pausadas ("humano assume") |
| `clientes.js`, `db.js`, `evolution.js`, `tempo.js`, `util.js` | Infraestrutura |

## Atualizar do bot antigo (versão de 1 cliente)

1. **Crie o Postgres:** no projeto do Railway, clique em *New → Database → PostgreSQL*.
2. **Atualize as variáveis do serviço do bot:**
   - Adicione `DATABASE_URL` com o valor `${{Postgres.DATABASE_URL}}`. O Railway preenche sozinho, e o autocomplete aparece quando você digita `${{`.
   - Adicione `WEBHOOK_SECRET` com uma senha qualquer.
   - Pode apagar `EVOLUTION_INSTANCE`, que não é mais usada.
   - Confira se `EVOLUTION_APIKEY` tem a **chave global** da Evolution (`AUTHENTICATION_API_KEY` no serviço da Evolution), para funcionar com todas as instâncias.
3. **Substitua os arquivos do repositório** por estes e faça commit. O Railway publica sozinho e cria as tabelas no primeiro start.
4. **Atualize o webhook** da instância na Evolution para incluir o segredo:
   ```
   https://barbearia-whatsapp-production.up.railway.app/webhook?secret=SEU_WEBHOOK_SECRET
   ```
5. **Coloque seu WhatsApp pessoal** em `dono_whatsapp` no `clientes/demo-barbearia.json`, para receber os avisos e testar os comandos.

Se o nome da instância na Evolution não for `demo-barbearia`, renomeie o arquivo e o campo `instancia` para ficarem **exatamente** iguais, inclusive maiúsculas e minúsculas.

## Cadastrar um cliente novo

1. **Na Evolution:** crie uma instância (ex.: `barbearia-joao`, canal Baileys) e escaneie o QR code com o celular do negócio.
2. **No webhook dessa instância**, use a mesma URL de cima, com `?secret=`, e o evento `MESSAGES_UPSERT`.
3. **No repositório:** copie `clientes/demo-barbearia.json` para `clientes/barbearia-joao.json` e troque os dados. Faça commit.
4. Pronto. Em cerca de 1 minuto o bot já atende o novo número.

Dica: mande para o Claude o print do Instagram ou do Google do negócio e peça "monte o JSON de cliente neste formato".

### Campos do JSON do cliente

| Campo | Obrigatório | Exemplo / observação |
|---|---|---|
| `instancia` | sim | Nome exato da instância na Evolution |
| `nome` | sim | "Barbearia do João" |
| `servicos` | sim | lista de `{ nome, preco, duracao_min }` |
| `horarios` | sim | `"ter": ["09:00", "20:00"]`, ou `null` se fechado |
| `dono_whatsapp` | recomendado | "5511999999999", para avisos e comandos |
| `profissionais` | não | quantidade de pessoas = atendimentos simultâneos |
| `pausa_humano_horas` | não | padrão 12 |
| `intervalo_agenda_min` | não | padrão 30 |
| `antecedencia_min_minutos` | não | antecedência mínima para agendar no mesmo dia (padrão 30) |
| `tipo`, `endereco`, `instagram`, `pagamento`, `regras_extras` | não | informações que a IA usa para responder |
| `instrucoes_extras` | não | texto livre com instruções específicas para a IA |
| `evolution_url`, `evolution_token` | não | só se esse cliente estiver em outra Evolution |

Para desativar um cliente, renomeie o arquivo para começar com `_` (ex.: `_barbearia-joao.json`) **e** mande `pausar` pelo WhatsApp do dono. Os arquivos que começam com `_` são ignorados.

## Testar sem WhatsApp

```bash
curl -X POST "https://SEU-BOT/teste?token=SEU_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"instancia":"demo-barbearia","telefone":"teste1","texto":"tem horário sábado?"}'
```

Outras rotas (todas com `?token=`):
- `GET /admin/clientes`: clientes cadastrados
- `GET /admin/agenda`: próximos agendamentos de todos os clientes
- `GET /admin/agenda?instancia=demo-barbearia&data=2026-10-31`: agenda de um dia

## Variáveis de ambiente

Veja o `.env.example`. **Não defina `PORT` no Railway.**

## Limitações conhecidas

- Só lê texto. Áudio e imagem recebem uma resposta padrão.
- Contas que o WhatsApp mostra só com identificador oculto (LID), sem o número, podem não ser reconhecidas como "dono" pelos comandos.
- O "humano assume" detecta respostas digitadas no celular ou no WhatsApp Web do negócio. Se a equipe usar outra ferramenta conectada à mesma instância, o comportamento depende do eco que a Evolution manda.
