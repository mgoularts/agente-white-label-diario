# Agente White Label Diário

Uma assistente pessoal no **Telegram** que organiza o seu dia: agenda do Google,
tarefas, lembretes, finanças e memória de longo prazo. A inteligência é a API do
**Gemini**, do Google, e roda na cota gratuita.

É **white label**: o nome da assistente, o nome de quem ela atende e o perfil dessa
pessoa ficam no arquivo `.env`, não no código. Dá para ter a sua e montar uma para
cada cliente.

## O que ela faz

- 📅 **Google Agenda**: consulta, cria, remarca e cancela compromissos, e avisa no
  Telegram X minutos antes de cada um, inclusive dos que você marca direto no celular.
- 📋 **Tarefas** com prazo e prioridade, cobrança das atrasadas e aviso antes do prazo.
- ⏰ **Lembretes** avulsos ("me lembra de ligar pro fornecedor às 15h").
- 💰 **Finanças**: "gastei 45 no almoço" vira lançamento; resumo por dia, semana, mês
  ou ano; planilha CSV que abre no Excel ou no Google Sheets; lê foto de comprovante.
- 🧠 **Memória de longo prazo**: aprende sobre você e usa isso nas respostas.
- 💡 **Ideias e anotações** guardadas para consultar depois.
- ☀️ **Bom-dia** com a agenda e as tarefas do dia, e 🌙 **boa-noite** com o fechamento.
- 🎙️ Entende **texto, áudio, foto, print e PDF**.
- ⚡ **Comandos rápidos** que respondem na hora e não gastam cota de IA: `/hoje`,
  `/semana`, `/tarefas`, `/gasto`, `/planilha`, `/ajuda` e outros.

## Do que você precisa

| Item | Custo | Para quê |
|---|---|---|
| Computador ou servidor com **Node.js 18+** | R$ 0 | Rodar o agente |
| Conta no **Telegram** | R$ 0 | Conversar com a assistente |
| Conta **Google** | R$ 0 | Agenda (Calendar API) e chave do Gemini |

## Primeira vez? Comece por aqui

👉 **[guiapassoapassoconexao.md](guiapassoapassoconexao.md)**: do download até o uso
diário, em 9 etapas. Cada etapa termina com um teste de "está pronto" antes de passar
para a próxima. Não precisa saber programar.

## Instalação rápida (para quem já tem prática)

```bash
git clone https://github.com/mgoularts/agente-white-label-diario.git
cd agente-white-label-diario
npm install
cp .env.example .env        # no Windows (PowerShell): Copy-Item .env.example .env
```

Sem git? No GitHub, use **Code → Download ZIP** e extraia. A pasta vem como
`agente-white-label-diario-main`.

Depois:

1. Preencha o `.env` e coloque o `credentials.json` na pasta. O passo a passo de cada
   conexão (Telegram, Gemini, Google Agenda e o ID do dono) está em
   **[guiadeconexoes.md](guiadeconexoes.md)**.
2. Rode `npm test` para conferir tudo. O teste cria e apaga um evento na sua agenda.
3. Rode `npm start` e mande `/ajuda` para o seu bot no Telegram.

Para deixar no ar 24 horas, mesmo com o PC desligado, siga o
**[guiadenuvem.md](guiadenuvem.md)**.

## Personalização (white label)

No `.env`:

```ini
NOME_ASSISTENTE=Aurora
NOME_USUARIO=Ana
PERFIL_USUARIO=é arquiteta, toca obras com vários fornecedores e vive no carro entre uma visita e outra
```

Esses três valores alimentam o prompt da IA, o bom-dia, o boa-noite e os comandos.
Para outro cliente, use outra pasta com outro `.env` e **outro bot do Telegram**.
Cada instalação atende uma pessoa só.

## Privacidade

- Memórias, tarefas, finanças e histórico ficam num arquivo local, o `data.json`.
  Ele já está no `.gitignore` e não deve ir para o GitHub.
- As mensagens passam pelos servidores do Telegram e, quando precisam de IA, pelos
  do Google (Gemini). Na cota gratuita, o Google pode usar o conteúdo enviado para
  melhorar os produtos dele. Leia os termos da API do Gemini antes de usar com dados
  sensíveis ou de terceiros, e avalie o plano pago se precisar.
- O bot só conversa com o dono (`OWNER_CHAT_ID`). Preencha esse valor antes de divulgar
  o @ do bot.

## Limitações conhecidas

- O fuso horário é fixo em `America/Sao_Paulo` (UTC-3), pensado para o Brasil.
- Uma instalação atende uma pessoa: um bot, um dono, um `data.json`.
- Os nomes de modelos do Gemini mudam com o tempo. Se um sair do ar, troque a lista em
  `MODELOS_GEMINI` no `.env`.

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.js` | Bot do Telegram, fila de mensagens e laço de ferramentas da IA |
| `ai.js` | Gemini: fila de modelos com fallback de cota e o prompt da assistente |
| `config.js` | Identidade white label (lê o `.env`) |
| `tools.js` | Ferramentas que a IA pode chamar |
| `comandos.js` | Comandos rápidos (sem IA) |
| `calendar.js` / `avisos.js` | Google Agenda e avisos antes dos compromissos |
| `scheduler.js` | Bom-dia, boa-noite, disparo de lembretes e sincronização da agenda |
| `financas.js` | Gastos, resumos e planilha CSV |
| `storage.js` | Persistência em `data.json`, com backup e escrita atômica |
| `teste.js` | Bateria de testes (`npm test`) que roda isolada dos seus dados |

## Licença

[MIT](LICENSE). Use, modifique e revenda à vontade, mantendo o aviso de licença.
