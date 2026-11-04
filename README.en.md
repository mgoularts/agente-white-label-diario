# Agente White Label Diário (Daily White Label Assistant)

🇧🇷 [Leia em português](README.md)

A personal AI assistant on **Telegram** that organizes your day: Google Calendar,
tasks, reminders, expenses and long-term memory. The intelligence comes from Google's
**Gemini** API, and it runs on the free tier.

It is **white label**: the assistant's name, the name of the person it serves and that
person's profile live in the `.env` file, not in the code. You can run your own, and
set up a separate one for each client.

> The assistant talks to its owner in **Brazilian Portuguese**, and the setup guides
> are in Portuguese. This page is an English overview of the project.

## Why it exists

Most small and medium-sized businesses will never hire an AI team, and most AI tools
offered to them are closed SaaS, in English and priced in dollars. This project is a
self-hosted, open alternative built for people who don't code: one independent
producer can deploy a private assistant for each client company, and each company
keeps its own data.

## What it does

- 📅 **Google Calendar**: checks, creates, reschedules and cancels events, and sends a
  Telegram alert X minutes before each one, including events added from your phone.
- 📋 **Tasks** with deadlines and priorities, follow-up on overdue ones and alerts
  before the deadline.
- ⏰ **One-off reminders** ("remind me to call the supplier at 3 pm").
- 💰 **Expenses**: "spent 45 on lunch" becomes an entry; summaries by day, week, month
  or year; a CSV spreadsheet for Excel or Google Sheets; reads receipt photos.
- 🧠 **Long-term memory**: learns about you and uses it in its answers.
- 💡 **Ideas and notes** saved for later.
- ☀️ **Good morning** message with the day's agenda and tasks, and 🌙 **good night**
  wrap-up.
- 🎙️ Understands **text, voice, photos, screenshots and PDFs**.
- ⚡ **Quick commands** that answer instantly without using AI quota: `/hoje` (today),
  `/semana` (week), `/tarefas` (tasks), `/gasto` (expense), `/planilha` (spreadsheet),
  `/ajuda` (help) and more.

## What you need

| Item | Cost | Purpose |
|---|---|---|
| Computer or server with **Node.js 18+** | Free | Run the agent |
| **Telegram** account | Free | Talk to the assistant |
| **Google** account | Free | Calendar API and Gemini key |

## Quick install

```bash
git clone https://github.com/mgoularts/agente-white-label-diario.git
cd agente-white-label-diario
npm install
cp .env.example .env        # Windows (PowerShell): Copy-Item .env.example .env
```

Then:

1. Fill in `.env` and put `credentials.json` in the folder. Each connection (Telegram,
   Gemini, Google Calendar and the owner's chat ID) is explained step by step in
   [guiadeconexoes.md](guiadeconexoes.md) (Portuguese).
2. Run `npm test` to check everything. The test creates and deletes an event in your
   calendar.
3. Run `npm start` and send `/ajuda` to your Telegram bot.

First time, with no programming experience? Follow
[guiapassoapassoconexao.md](guiapassoapassoconexao.md): 9 steps, each ending with a
"ready" check. To keep it online 24/7, see [guiadenuvem.md](guiadenuvem.md).

## White label setup

In `.env`:

```ini
NOME_ASSISTENTE=Aurora      # assistant's name
NOME_USUARIO=Ana            # owner's name
PERFIL_USUARIO=...          # short profile of the owner, in Portuguese
```

These values feed the AI prompt, the morning and night messages and the commands.
For another client, use another folder with another `.env` and **another Telegram
bot**. Each installation serves one person.

## Privacy

- Memories, tasks, expenses and history are stored in a local file, `data.json`. It is
  already in `.gitignore` and must not be pushed to GitHub.
- Messages go through Telegram's servers and, when AI is needed, Google's (Gemini). On
  the free tier, Google may use the content to improve its products. Read the Gemini
  API terms before using it with sensitive or third-party data, and consider the paid
  plan if needed.
- The bot only talks to its owner (`OWNER_CHAT_ID`). Set it before sharing the bot's
  handle.

## Known limitations

- The time zone is fixed to `America/Sao_Paulo` (UTC-3).
- One installation serves one person: one bot, one owner, one `data.json`.
- Gemini model names change over time. If one is retired, update `MODELOS_GEMINI` in
  `.env`.

## Structure

| File | Role |
|---|---|
| `index.js` | Telegram bot, message queue and AI tool loop |
| `ai.js` | Gemini: model queue with quota fallback and the assistant prompt |
| `config.js` | White label identity (reads `.env`) |
| `tools.js` | Tools the AI can call |
| `comandos.js` | Quick commands (no AI) |
| `calendar.js` / `avisos.js` | Google Calendar and pre-event alerts |
| `scheduler.js` | Morning/night messages, reminders and calendar sync |
| `financas.js` | Expenses, summaries and CSV export |
| `storage.js` | Persistence in `data.json`, with backup and atomic writes |
| `teste.js` | Test suite (`npm test`), isolated from your data |

## Contributing

Issues and pull requests are welcome, in Portuguese or English.

## License

[MIT](LICENSE). Use, modify and resell freely, keeping the license notice.
