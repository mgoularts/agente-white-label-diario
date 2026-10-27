# Guia de conexões: do zero até a primeira conversa

Este guia explica como ligar o agente a cada serviço de que ele depende. Faça na
ordem: cada passo gera um valor que vai para o `.env`. Leva de 30 a 45 minutos.

| Passo | Serviço | O que você ganha | Vai para |
|---|---|---|---|
| 1 | Node.js | O motor que roda o agente | — |
| 2 | Telegram (BotFather) | O token do bot | `TELEGRAM_TOKEN` |
| 3 | Google AI Studio | A chave do Gemini | `GEMINI_API_KEY` |
| 4 | Google Cloud + Google Agenda | O `credentials.json` e o ID da agenda | `EMAIL_AGENDA` |
| 5 | Telegram | O seu chat ID (a trava de dono) | `OWNER_CHAT_ID` |
| 6 | `.env` | A identidade da assistente | `NOME_ASSISTENTE`, `NOME_USUARIO`, `PERFIL_USUARIO` |
| 7 | Teste e primeira conversa | A confirmação de que tudo funciona | — |

> **Regra de ouro:** `.env`, `credentials.json` e `data.json` são seus e de mais
> ninguém. Nunca mande esses arquivos para o GitHub, para grupos ou para suporte.
> O `.gitignore` do projeto já bloqueia os três.

---

## Passo 1: instalar o Node.js e baixar o projeto

1. Baixe o Node.js **LTS** em https://nodejs.org e instale.
2. Confira no terminal (PowerShell no Windows, Terminal no Mac ou Linux):
   ```bash
   node -v     # precisa ser v18 ou maior
   npm -v
   ```
3. Baixe o projeto. Com git, use `git clone <url-deste-repositório>`. Sem git, clique
   em **Code → Download ZIP** no GitHub e extraia.
4. Dentro da pasta do projeto:
   ```bash
   npm install
   cp .env.example .env          # Windows (PowerShell): Copy-Item .env.example .env
   ```
5. Abra o `.env` num editor de texto. Você vai preenchê-lo nos próximos passos.

---

## Passo 2: criar o bot no Telegram → `TELEGRAM_TOKEN`

1. No Telegram, procure **@BotFather** (o oficial tem o selo azul) e abra a conversa.
2. Mande `/newbot`.
3. Ele pede um **nome de exibição** (ex.: `Aurora Assistente`) e depois um
   **username**, que precisa terminar em `bot` (ex.: `aurora_da_ana_bot`).
4. Ele responde com um **token** parecido com `123456789:AAH...`. Copie.
5. No `.env`:
   ```ini
   TELEGRAM_TOKEN=123456789:AAH...seu_token
   ```

Se quiser, cadastre o menu de comandos: mande `/setcommands` ao BotFather, escolha
o seu bot e cole:

```
hoje - agenda e tarefas de hoje
semana - compromissos dos próximos 7 dias
tarefas - tudo que está pendente
nova - cria uma tarefa
ok - conclui uma tarefa
lembretes - avisos programados
gasto - lança um gasto
entrada - lança uma receita
gastos - resumo financeiro
planilha - envia a planilha CSV
ideia - guarda um insight
notas - últimos insights
memoria - o que ela sabe sobre você
status - saúde do agente
limpar - recomeça a conversa
ajuda - lista de comandos
```

> ⚠️ O token é a senha do bot. Se vazar, mande `/revoke` ao BotFather para gerar
> outro.

---

## Passo 3: chave do Gemini → `GEMINI_API_KEY`

1. Acesse https://aistudio.google.com/apikey e entre com a sua conta Google.
2. Clique em **Create API key** (ou "Criar chave de API"). Se ele pedir um projeto,
   deixe criar um novo.
3. Copie a chave, que começa com `AIza...`.
4. No `.env`:
   ```ini
   GEMINI_API_KEY=AIza...sua_chave
   ```

**Sobre a cota gratuita:** cada modelo do Gemini tem um limite diário próprio no
plano grátis. O agente usa uma **fila de modelos** (`MODELOS_GEMINI`). Quando a cota
de um acaba, ele passa para o próximo sozinho e volta ao primeiro quando a cota
renova. Os comandos rápidos (`/hoje`, `/tarefas`, `/gasto`...) não usam IA e
funcionam mesmo com a cota esgotada.

Os nomes de modelo mudam com o tempo. Se aparecer erro de "modelo não encontrado",
veja os disponíveis em https://ai.google.dev/gemini-api/docs/models e ajuste a lista
no `.env`.

> 🔒 **Privacidade:** no plano gratuito, o Google pode usar o conteúdo enviado à API
> para melhorar os produtos dele. Confira os termos atuais antes de usar com dados
> sensíveis ou de clientes.

---

## Passo 4: Google Agenda → `credentials.json` + `EMAIL_AGENDA`

O agente acessa a sua agenda por uma **conta de serviço** (service account), um
"usuário robô" do Google. Você compartilha a sua agenda com esse robô, como faria
com uma pessoa.

### 4.1 Criar o projeto e ativar a API

1. Acesse https://console.cloud.google.com e entre com a sua conta Google.
2. No topo, abra o seletor de projetos → **Novo projeto**. Use um nome como
   `agente-diario` → **Criar**. Confira que ele ficou selecionado.
3. Menu ☰ → **APIs e serviços → Biblioteca**. Busque **Google Calendar API** →
   **Ativar**.

### 4.2 Criar a conta de serviço e baixar a chave

1. Menu ☰ → **IAM e administrador → Contas de serviço** → **Criar conta de serviço**.
2. Dê um nome (ex.: `agente-agenda`) → **Criar e continuar**. Não precisa dar
   nenhum papel: pule as etapas opcionais e clique em **Concluir**.
3. Clique na conta criada → aba **Chaves** → **Adicionar chave → Criar nova chave**
   → **JSON** → **Criar**. Um arquivo `.json` será baixado.
4. Renomeie esse arquivo para **`credentials.json`** e coloque na **pasta do projeto**,
   ao lado do `index.js`.
5. Copie o **e-mail da conta de serviço**. Ele tem o formato
   `agente-agenda@seu-projeto.iam.gserviceaccount.com` e está dentro do JSON, no
   campo `client_email`.

### 4.3 Compartilhar a sua agenda com a conta de serviço

1. Abra https://calendar.google.com no computador.
2. Na lateral esquerda, passe o mouse sobre a sua agenda → **⋮ → Configurações e
   compartilhamento**.
3. Em **Compartilhar com pessoas específicas** → **Adicionar pessoas**. Cole o e-mail
   da conta de serviço e escolha a permissão **Fazer alterações nos eventos**.
   Clique em **Enviar**.
4. Na mesma página, desça até **Integrar agenda** e copie o **ID da agenda**. Na
   agenda principal, o ID é o seu próprio e-mail do Gmail.
5. No `.env`:
   ```ini
   EMAIL_AGENDA=seu-email@gmail.com
   ```

> Sem esse compartilhamento, o Google responde "Not Found" ou "Forbidden" e o
> agente não enxerga a agenda.

---

## Passo 5: trava de dono → `OWNER_CHAT_ID`

O bot é pessoal. Só um chat pode conversar com ele, e é esse valor que define qual.
**Não pule este passo:** com o campo vazio, o primeiro chat que falar com o bot vira
o dono, mesmo que seja um estranho que descobriu o @.

**Opção A (mais simples):** no Telegram, procure **@userinfobot**, mande qualquer
mensagem e copie o número que aparece em `Id`.

**Opção B (pelo próprio agente):**
1. Deixe `OWNER_CHAT_ID` vazio e rode `npm start`.
2. Mande `/start` para o seu bot **antes de qualquer outra pessoa**.
3. O terminal mostra `🔒 Dono registrado: 123456789 (fixe OWNER_CHAT_ID=123456789 no .env)`.
4. Pare o agente (Ctrl+C).

Em qualquer das opções, termine com:

```ini
OWNER_CHAT_ID=123456789
```

---

## Passo 6: identidade da assistente (white label)

```ini
NOME_ASSISTENTE=Aurora
NOME_USUARIO=Ana
PERFIL_USUARIO=é arquiteta, toca obras com vários fornecedores e vive no carro entre uma visita e outra
```

- **NOME_ASSISTENTE**: como a assistente se apresenta.
- **NOME_USUARIO**: como ela chama você no bom-dia, no boa-noite e nas respostas.
- **PERFIL_USUARIO**: uma frase sobre a sua rotina. Quanto mais concreta, melhores as
  sugestões e a motivação do bom-dia.

Opcionais, que já têm padrão:

| Variável | Padrão | O que faz |
|---|---|---|
| `HORARIO_MANHA` | `07:00` | Hora do bom-dia |
| `HORARIO_NOITE` | `22:00` | Hora do boa-noite |
| `ANTECEDENCIA_LEMBRETE` | `30` | Minutos de antecedência do aviso de compromisso |
| `MODELOS_GEMINI` | lista no `.env.example` | Fila de modelos com fallback de cota |
| `DATA_DIR` | pasta do projeto | Onde fica o `data.json` (útil na nuvem) |
| `GOOGLE_CREDENTIALS_JSON` | vazio | O `credentials.json` em uma linha, para hosts sem upload de arquivo |

---

## Passo 7: testar e conversar

1. Rode a bateria de testes:
   ```bash
   npm test
   ```
   Ela usa uma cópia isolada dos dados e **cria e apaga um evento de teste** na sua
   agenda para provar que o Google está conectado. O resultado esperado é
   `🎉 Tudo passou.`
2. Ligue o agente:
   ```bash
   npm start
   ```
   Ele deve mostrar `online e aguardando mensagens no Telegram!`.
3. No Telegram, abra o seu bot e mande:
   - `/status`: responde na hora, sem gastar cota.
   - `oi, tudo bem?`: passa pela IA e confirma o Gemini.
   - `me lembra de beber água daqui a 2 minutos`: confirma os lembretes.
   - `marca reunião amanhã às 10h com o fornecedor`: confirma a agenda.

Para manter o agente ligado no seu PC, mesmo depois de fechar o terminal:

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

No Windows, para o agente voltar sozinho depois de reiniciar o PC, copie o
`iniciar-agente.cmd` para a pasta de inicialização. Aperte Win+R, digite
`shell:startup` e cole o arquivo lá.

Para rodar 24 horas com o PC desligado, siga o **[guiadenuvem.md](guiadenuvem.md)**.

---

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `409 Conflict` no log | Duas instâncias usando o mesmo token | Deixe só uma rodando (`pm2 list`, `pm2 delete agente-diario`) |
| Bot não responde e o log diz "chat não autorizado" | `OWNER_CHAT_ID` diferente do seu chat | Refaça o passo 5 |
| `Not Found` / `Forbidden` na agenda | Agenda não compartilhada ou ID errado | Refaça o passo 4.3 |
| `invalid_grant` / erro de chave | `credentials.json` errado, ausente ou revogado | Gere uma chave nova (4.2) |
| Não consigo criar chave da conta de serviço | Política da organização bloqueia chaves (comum em contas Google Workspace) | Use uma conta Google pessoal ou peça ao administrador para liberar |
| "Esgotei minha cota gratuita" | Todos os modelos da fila bateram o limite do dia | Espere a renovação ou ative o billing da API do Gemini |
| Erro de modelo inexistente | Nome de modelo antigo na fila | Atualize `MODELOS_GEMINI` |
| Horários errados | Fuso diferente de Brasília | O agente é fixo em `America/Sao_Paulo` |

## Montando para um cliente (white label)

Cada cliente precisa da própria instalação:

1. Uma pasta do projeto por cliente (ou uma VM por cliente).
2. Um **bot novo** no BotFather, porque um token só pode rodar em uma instância.
3. Um `.env` próprio, com o nome, o perfil e o `OWNER_CHAT_ID` do cliente.
4. A agenda do cliente compartilhada com uma conta de serviço (a sua ou a dele).
5. Se várias rodarem no mesmo servidor, troque o `name` em `ecosystem.config.js`
   (ex.: `agente-ana`, `agente-joao`) para o pm2 não confundir os processos.

Os dados de cada cliente ficam no `data.json` da instalação dele. Trate esse arquivo
como dado pessoal: a LGPD se aplica.
