# Guia passo a passo de conexão

Este guia leva você do download até usar a assistente no dia a dia, **uma etapa por
vez**. Cada etapa termina com um **✅ Ponto de verificação**: só passe para a próxima
quando ele der certo. Assim, se algo falhar, você sabe exatamente onde está o problema.

Não precisa saber programar. Precisa de atenção para copiar e colar com cuidado.

---

## Mapa da jornada

| Etapa | O que você faz | Tempo | Ao final, você tem |
|---|---|---|---|
| **1** | Prepara o computador e baixa o projeto | 10 min | O projeto instalado |
| **2** | Cria o arquivo de configuração `.env` | 5 min | O `.env` pronto para preencher |
| **3** | Cria o bot no Telegram e trava o dono | 10 min | O bot respondendo `/status` |
| **4** | Liga a inteligência (Gemini) | 5 min | A assistente conversando |
| **5** | Conecta a Google Agenda | 20 min | Agenda + `npm test` passando |
| **6** | Personaliza nome, perfil e horários | 5 min | A assistente com a sua cara |
| **7** | Primeiro dia de uso | — | A rotina funcionando |
| **8** | Deixa ligada sozinha | 10 min | A assistente ligada sem você abrir nada |
| **9** | Segurança e manutenção | — | Tudo protegido e com backup |

**Total:** de 1 a 1h30, com calma.

### Antes de começar, tenha em mãos

- [ ] Um computador com Windows, Mac ou Linux, com internet
- [ ] O **Telegram** instalado no celular (e, se quiser, no computador)
- [ ] Uma **conta Google** (Gmail), que é a da agenda que a assistente vai usar
- [ ] Um editor de texto. O Bloco de Notas serve, mas o
      [VS Code](https://code.visualstudio.com) (grátis) facilita muito.

### Três regras de ouro

1. **`.env`, `credentials.json` e `data.json` são só seus.** Nunca mande esses
   arquivos para ninguém: nem por WhatsApp, nem para "suporte", nem para o GitHub.
2. **Mudou o `.env`? Reinicie a assistente.** Ela só lê as configurações quando liga.
   Para reiniciar: no terminal onde ela está rodando, aperte `Ctrl + C`, depois rode
   `npm start` de novo.
3. **Uma assistente ligada por vez.** Se rodar duas com o mesmo bot (por exemplo,
   duas janelas de terminal), as duas param e aparece "erro 409".

### Como abrir o terminal

- **Windows:** tecla Windows → digite `PowerShell` → Enter.
- **Mac:** `Cmd + Espaço` → digite `Terminal` → Enter.
- **Linux:** `Ctrl + Alt + T`.

Para "rodar um comando", digite ou cole o comando no terminal e aperte Enter.

---

## Etapa 1 — Preparar o computador e baixar o projeto

**Objetivo:** ter o Node.js instalado e o projeto na sua máquina, com as dependências
baixadas.

### 1.1 Instalar o Node.js

1. Acesse https://nodejs.org e baixe a versão **LTS**, a recomendada.
2. Instale com as opções padrão: avançar, avançar, concluir.
3. **Feche e abra de novo** o terminal. Isso é necessário para ele reconhecer o Node.
4. Rode:
   ```bash
   node -v
   npm -v
   ```
   O primeiro deve mostrar `v18` ou maior (ex.: `v22.11.0`). O segundo mostra um
   número qualquer, como `10.9.0`.

### 1.2 Baixar o projeto

Escolha **um** dos caminhos.

**Caminho A — sem git (mais simples):**
1. Abra https://github.com/mgoularts/agente-white-label-diario
2. Clique no botão verde **Code → Download ZIP**.
3. Extraia o ZIP onde quiser, por exemplo na Área de Trabalho. A pasta vem como
   `agente-white-label-diario-main`. Se quiser, renomeie para `agente-white-label-diario`.

**Caminho B — com git:**
```bash
git clone https://github.com/mgoularts/agente-white-label-diario.git
```

### 1.3 Entrar na pasta e instalar as dependências

No terminal, entre na pasta do projeto. O jeito mais fácil:
- **Windows:** abra a pasta no Explorador de Arquivos, clique na barra de endereço,
  digite `powershell` e aperte Enter. O terminal já abre dentro dela.
- **Mac/Linux:** digite `cd ` (com espaço), arraste a pasta para dentro do terminal e
  aperte Enter.

Depois rode:
```bash
npm install
```
Espere terminar. Leva de 1 a 3 minutos e aparece algo como `added 111 packages`.
Avisos em amarelo (`warn`) são normais.

### ✅ Ponto de verificação da Etapa 1

- [ ] `node -v` mostra `v18` ou maior
- [ ] `npm install` terminou sem a palavra `ERR!` em vermelho
- [ ] Apareceu uma pasta `node_modules` dentro do projeto

### 🛠️ Se deu errado

| Sintoma | Solução |
|---|---|
| `node não é reconhecido como comando` | Feche e abra o terminal. Se continuar, reinstale o Node marcando "Add to PATH". |
| `npm install` dá `ENOENT package.json` | Você não está dentro da pasta do projeto. Refaça o 1.3. |
| Erro de permissão no PowerShell (`execução de scripts desabilitada`) | Rode `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, confirme com `S` e tente de novo. |

---

## Etapa 2 — Criar o arquivo de configuração `.env`

**Objetivo:** criar o `.env`, o arquivo onde ficam as suas chaves e preferências.
Ele nasce de uma cópia do modelo `.env.example`.

### 2.1 Criar a cópia

Na pasta do projeto, rode:

- **Windows (PowerShell):**
  ```powershell
  Copy-Item .env.example .env
  ```
- **Mac/Linux:**
  ```bash
  cp .env.example .env
  ```

> ⚠️ **Armadilha clássica no Windows:** se você criar o arquivo pelo Bloco de Notas,
> ele pode ser salvo como `.env.txt`, e a assistente não encontra. Use o comando
> acima. Para conferir, ative no Explorador de Arquivos **Exibir → Mostrar →
> Extensões de nomes de arquivos**.

### 2.2 Abrir o `.env` para editar

- **VS Code:** abra a pasta do projeto (Arquivo → Abrir Pasta) e clique em `.env`.
- **Bloco de Notas:** no PowerShell, rode `notepad .env`.
- **Mac:** `open -e .env`.

Você verá linhas como `TELEGRAM_TOKEN=cole_aqui_o_token_do_BotFather`. Nas próximas
etapas você vai trocar o que vem **depois do `=`**. Regras de preenchimento:

- Não coloque espaços antes nem depois do `=`.
- Não coloque aspas.
- Uma configuração por linha.
- Linhas começando com `#` são comentários e são ignoradas.

### ✅ Ponto de verificação da Etapa 2

- [ ] Existe um arquivo chamado exatamente `.env`, e não `.env.txt`, na pasta do projeto
- [ ] Ele abre no editor e começa com `# Copie para .env e preencha.`

---

## Etapa 3 — Criar o bot no Telegram e travar o dono

**Objetivo:** ter um bot seu no Telegram, ligado ao projeto, que só responde a você.
Nesta etapa a assistente ainda não tem inteligência. Vamos provar só a conexão.

### 3.1 Criar o bot com o BotFather

1. No Telegram, busque **@BotFather**. É o oficial, com selo azul de verificado.
2. Toque em **Iniciar** e mande: `/newbot`
3. Ele pergunta o **nome** do bot. É o nome de exibição, pode ter espaços.
   Ex.: `Aurora Assistente`
4. Ele pergunta o **username**: precisa ser único e terminar em `bot`.
   Ex.: `aurora_da_ana_bot`. Se já existir, tente outra variação.
5. Ele responde com uma mensagem contendo o **token**, algo como:
   `7123456789:AAHk3j...xyz`
6. Copie o token inteiro.

### 3.2 Colocar o token no `.env`

No `.env`, troque a linha do token:
```ini
TELEGRAM_TOKEN=7123456789:AAHk3j...xyz
```
Salve o arquivo (`Ctrl + S`).

### 3.3 Descobrir o seu chat ID e travar o dono

O bot é pessoal: só **um** chat pode usá-lo. Vamos descobrir o número do seu chat.

1. Confira que `OWNER_CHAT_ID=` está **vazio** no `.env`.
2. No terminal, dentro da pasta do projeto, rode:
   ```bash
   npm start
   ```
   Deve aparecer, entre outras linhas:
   ```
   🤖 Assistente online e aguardando mensagens no Telegram!
   ```
   O nome muda na Etapa 6. **Deixe esse terminal aberto.**
3. No Telegram, abra o seu bot: busque pelo username que você criou ou use o link que
   o BotFather mandou. Toque em **Iniciar** (isso envia `/start`).
   ⚠️ Faça isso **antes de passar o @ do bot para qualquer pessoa**: o primeiro chat
   que falar com o bot vira o dono.
4. Volte ao terminal. Deve ter aparecido:
   ```
   🔒 Dono registrado: 123456789 (fixe OWNER_CHAT_ID=123456789 no .env)
   ```
5. Copie o número para o `.env`:
   ```ini
   OWNER_CHAT_ID=123456789
   ```
6. Salve o `.env` e **reinicie**: no terminal, `Ctrl + C`, depois `npm start`.
   Com o número no `.env`, o dono fica travado de vez, mesmo se o arquivo de dados
   for apagado.

> **Alternativa:** no Telegram, mande qualquer mensagem para **@userinfobot**. Ele
> responde com o seu `Id`, que é o mesmo número. Coloque no `.env` **antes** do
> primeiro `npm start`. Ao ligar, o terminal mostra `🔒 Dono fixado pelo .env: 123456789`.

### 3.4 Testar

No Telegram, mande para o seu bot:
- `/status` → responde com um painel `🩺 Status — Assistente`.
- `/ajuda` → mostra a lista de comandos.

> Nesta etapa, **não mande mensagens normais** como "oi". Sem a chave do Gemini (Etapa
> 4), elas voltam com um erro, como "Ops, deu um erro aqui" ou "Me embananei com o
> histórico". Isso é esperado agora.

### 3.5 (Opcional) Menu de comandos no Telegram

Para aparecer um menu com os comandos ao digitar `/`: no @BotFather, mande
`/setcommands`, escolha o seu bot e cole:
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
status - saúde da assistente
limpar - recomeça a conversa
ajuda - lista de comandos
```

### ✅ Ponto de verificação da Etapa 3

- [ ] O terminal mostra `online e aguardando mensagens no Telegram!`
- [ ] `OWNER_CHAT_ID` preenchido no `.env` com o seu número
- [ ] `/status` e `/ajuda` respondem no Telegram

### 🛠️ Se deu errado

| Sintoma | Solução |
|---|---|
| `ETELEGRAM: 401 Unauthorized` no terminal | Token errado ou incompleto. Copie de novo do BotFather, sem espaços. |
| `Conflito 409` no terminal | Tem outra assistente ligada com o mesmo bot. Feche os outros terminais (ou `pm2 delete agente-diario`). |
| O bot responde "só converso com o meu dono" | O `OWNER_CHAT_ID` não é o seu chat. Refaça o 3.3. |
| Nada aparece no terminal quando mando mensagem | Você está falando com outro bot. Confira o username. |
| `polling_error` / `EFATAL` / `ECONNRESET` | Oscilação de internet ou firewall. Ela tenta de novo sozinha. Se persistir, teste em outra rede. |

---

## Etapa 4 — Ligar a inteligência (Gemini)

**Objetivo:** a assistente entender linguagem natural, áudios, fotos e PDFs.

### 4.1 Gerar a chave

1. Acesse https://aistudio.google.com/apikey e entre com a sua conta Google.
2. Aceite os termos, se for o primeiro acesso.
3. Clique em **Create API key** (ou **Criar chave de API**). Se pedir um projeto,
   deixe ele criar um novo.
4. Copie a chave. Ela começa com `AIza...`.

### 4.2 Colocar no `.env`

```ini
GEMINI_API_KEY=AIzaSy...sua_chave
```
Salve e **reinicie** a assistente (`Ctrl + C`, depois `npm start`).

### 4.3 Testar

No Telegram, mande:
- `oi, tudo bem? o que você sabe fazer?`
- `me lembra de beber água daqui a 2 minutos`. Em 2 minutos o lembrete deve chegar.
- Um **áudio** qualquer, dizendo por exemplo "anota aí: ligar para o contador amanhã".

### Entenda a cota gratuita

O plano grátis do Gemini tem um limite diário de uso **por modelo**. A assistente usa
uma **fila de modelos** (`MODELOS_GEMINI` no `.env`): quando a cota de um acaba, ela
passa para o próximo sozinha e volta ao melhor quando a cota renova. Se todos
esgotarem no mesmo dia, ela avisa. Os **comandos rápidos** (`/hoje`, `/tarefas`,
`/gasto`...) não usam IA e continuam funcionando.

> 🔒 **Privacidade:** no plano gratuito, o Google pode usar o conteúdo enviado à API
> para melhorar os produtos dele. Leia os termos antes de usar com dados sensíveis ou
> de clientes. O plano pago muda essa condição.

### ✅ Ponto de verificação da Etapa 4

- [ ] "oi" recebe uma resposta natural
- [ ] O lembrete de 2 minutos chegou sozinho
- [ ] O áudio foi entendido

### 🛠️ Se deu errado

| Sintoma | Solução |
|---|---|
| "Me embananei com o histórico" e no terminal aparece `API key not valid` | Chave errada. Copie de novo, sem espaços, e reinicie. |
| Erro com `model not found` / `404` | Um nome da fila de modelos saiu do ar. Veja os atuais em https://ai.google.dev/gemini-api/docs/models e ajuste `MODELOS_GEMINI`. |
| "Esgotei minha cota gratuita" | Normal em dias de muito uso. Renova em até 24h. Use os comandos rápidos enquanto isso. |
| No terminal aparece `Cota do modelo X esgotada — tentando o próximo` | Não é erro: é a fila trabalhando. |

---

## Etapa 5 — Conectar a Google Agenda

**Objetivo:** a assistente ler, criar, remarcar e cancelar compromissos na sua
agenda, e avisar no Telegram antes de cada um.

Como funciona: você cria um **"usuário robô"** do Google (chamado *conta de serviço*)
e compartilha a sua agenda com ele, como faria com uma pessoa. A assistente entra
na agenda como esse robô.

### 5.1 Criar um projeto no Google Cloud

1. Acesse https://console.cloud.google.com com a **mesma conta Google da agenda**.
2. Se for o primeiro acesso, aceite os termos. Se aparecer oferta de teste
   gratuito ou cadastro de cartão, pode fechar: a Calendar API não exige isso.
3. No topo da página, clique no seletor de projetos → **Novo projeto**.
4. Nome: `agente-diario` → **Criar**.
5. Espere a notificação e **confirme que o projeto novo está selecionado** no topo.

### 5.2 Ativar a Google Calendar API

1. Menu ☰ (canto superior esquerdo) → **APIs e serviços → Biblioteca**.
2. Busque `Google Calendar API` → clique no resultado → **Ativar**.

### 5.3 Criar a conta de serviço (o "robô")

1. Menu ☰ → **IAM e administrador → Contas de serviço**.
2. **+ Criar conta de serviço**.
3. Nome: `agente-agenda` → **Criar e continuar**.
4. Nas etapas "Permissões" e "Acesso de principais", **não preencha nada**: clique em
   **Continuar** e depois em **Concluir**.
5. Na lista, aparece o e-mail do robô, no formato
   `agente-agenda@agente-diario-123456.iam.gserviceaccount.com`. **Copie esse e-mail.**
   Você vai usar no 5.5.

### 5.4 Baixar a chave do robô (`credentials.json`)

1. Clique no e-mail da conta de serviço → aba **Chaves**.
2. **Adicionar chave → Criar nova chave → JSON → Criar**.
3. Um arquivo `.json` com nome comprido é baixado.
4. **Renomeie** para exatamente `credentials.json`. Cuidado no Windows para não virar
   `credentials.json.json` (ative a exibição de extensões, como na Etapa 2).
5. **Mova** o arquivo para a pasta do projeto, ao lado do `index.js` e do `.env`.

> ⚠️ Esse arquivo dá acesso à sua agenda. Trate como senha.

### 5.5 Compartilhar a sua agenda com o robô

1. Abra https://calendar.google.com **no computador**. O app do celular não tem essa opção.
2. Na lateral esquerda, em **Minhas agendas**, passe o mouse sobre a sua agenda → **⋮**
   (três pontinhos) → **Configurações e compartilhamento**.
3. Role até **Compartilhar com pessoas e grupos específicos** → **+ Adicionar pessoas
   e grupos**.
4. Cole o e-mail do robô (do 5.3) e, em permissões, escolha **Fazer alterações nos
   eventos**. Clique em **Enviar**.
5. Na mesma página, role até **Integrar agenda** e copie o **ID da agenda**. Na agenda
   principal, o ID é o seu próprio Gmail.

### 5.6 Colocar no `.env`

```ini
EMAIL_AGENDA=seu-email@gmail.com
```
Salve e **reinicie** a assistente.

### 5.7 Testar

1. No Telegram, mande `/hoje`. A seção "🗓️ Agenda" deve listar os seus compromissos
   ou dizer "Nada marcado.", **sem** a frase "Não consegui consultar o Google Calendar".
2. Mande `marca uma reunião de teste amanhã às 10h`. Confira no Google Agenda: o
   evento deve aparecer. Depois mande `cancela a reunião de teste de amanhã`.
3. Pare a assistente (`Ctrl + C`) e rode a bateria completa de testes:
   ```bash
   npm test
   ```
   Ela usa uma cópia isolada dos dados, então não mexe nas suas tarefas nem nas
   memórias. Cria e apaga um evento chamado "TESTE agente remarcar" na sua agenda.
   O final precisa ser:
   ```
   🎉 Tudo passou.
   ```
4. Ligue a assistente de novo: `npm start`.

### ✅ Ponto de verificação da Etapa 5

- [ ] `/hoje` mostra a agenda sem erro
- [ ] Criar e cancelar por mensagem funcionou e apareceu no Google Agenda
- [ ] `npm test` terminou com `🎉 Tudo passou.`

### 🛠️ Se deu errado

| Sintoma (no `/hoje` ou no `npm test`) | Solução |
|---|---|
| `Missing required parameters: calendarId` | `EMAIL_AGENDA` vazio no `.env`, ou a assistente não foi reiniciada. |
| `Not Found` | A agenda não foi compartilhada com o robô, ou o ID está errado. Refaça o 5.5. |
| `Forbidden` / `insufficient permission` | Compartilhou com permissão só de leitura. Troque para **Fazer alterações nos eventos**. |
| `ENOENT ... credentials.json` | O arquivo não está na pasta ou o nome está errado (ex.: `.json.json`). |
| `Google Calendar API has not been used in project` | A API não foi ativada, ou foi ativada em outro projeto. Refaça o 5.2 no projeto certo. |
| `invalid_grant` | A chave foi apagada ou o relógio do computador está errado. Gere outra chave (5.4) e confira data e hora do PC. |
| A opção "Criar chave" está bloqueada | Contas de empresa (Google Workspace) às vezes proíbem. Use uma conta Google pessoal ou peça liberação ao administrador. |

---

## Etapa 6 — Personalizar: nome, perfil e horários

**Objetivo:** a assistente ter nome próprio, saber quem você é e falar na hora certa.

### 6.1 Identidade

No `.env`:
```ini
NOME_ASSISTENTE=Aurora
NOME_USUARIO=Ana
PERFIL_USUARIO=é arquiteta, toca obras com vários fornecedores e vive no carro entre uma visita e outra
```

- **NOME_ASSISTENTE**: o nome com que ela se apresenta.
- **NOME_USUARIO**: como ela chama você.
- **PERFIL_USUARIO**: uma frase sobre a sua rotina. Esse campo faz muita diferença:
  quanto mais concreto, mais úteis ficam o bom-dia, as sugestões e as análises.
  Diga o que você faz, o que mais toma o seu tempo e onde você costuma se enrolar.

### 6.2 Horários (opcional)

```ini
HORARIO_MANHA=07:00          # quando chega o bom-dia com a agenda do dia
HORARIO_NOITE=22:00          # quando chega o fechamento do dia
ANTECEDENCIA_LEMBRETE=30     # minutos de antecedência do aviso de cada compromisso
```

Os horários seguem o fuso de Brasília (`America/Sao_Paulo`).

### 6.3 Aplicar

Salve e **reinicie** a assistente. No terminal deve aparecer
`🤖 Aurora online...` (com o nome que você escolheu) e a linha
`⏰ Agendador ativo — bom-dia às 07:00, boa-noite às 22:00`.

### ✅ Ponto de verificação da Etapa 6

- [ ] `/ajuda` começa com `🤖 <nome da assistente> — comandos rápidos`
- [ ] Perguntando "quem é você e quem sou eu?", ela responde com os nomes e o perfil certos

---

## Etapa 7 — Primeiro dia de uso

**Objetivo:** a assistente entrar na sua rotina. A partir daqui é só conversar
naturalmente, por texto, áudio, foto ou PDF.

### Para experimentar já

| Você manda | O que acontece |
|---|---|
| "o que eu tenho hoje?" | Resumo da agenda, das tarefas e dos lembretes, com sugestão de prioridade |
| "preciso enviar o orçamento pro João até sexta 17h, é urgente" | Cria uma **tarefa** com prazo e prioridade alta, e avisa 30 min antes |
| "marca dentista quinta às 15h" | Cria um **compromisso** no Google Agenda, com aviso automático |
| "me lembra de tomar o remédio às 21h" | Cria um **lembrete** avulso |
| "terminei o orçamento do João" | Conclui a tarefa |
| "gastei 45,90 no almoço" | Lança o gasto na planilha e mostra o total do dia e do mês |
| foto de um comprovante ou nota | Lê o valor e a data e lança |
| "quanto gastei esse mês? onde dá pra cortar?" | Resumo por categoria com uma observação |
| "me manda a planilha do mês" | Envia um CSV que abre no Excel ou no Google Sheets |
| "ideia: oferecer plano anual com desconto" | Guarda o insight para você reler depois |
| "lembra que eu não marco reunião antes das 9h" | Guarda na **memória de longo prazo** |
| um áudio de 1 minuto contando o seu dia | Ela extrai tarefas, prazos e gastos e organiza |

### Comandos rápidos (respondem na hora e não gastam cota)

| Comando | Para quê |
|---|---|
| `/hoje` | Agenda, tarefas e lembretes de hoje |
| `/semana` | Compromissos dos próximos 7 dias |
| `/tarefas` | Pendências por urgência |
| `/nova Enviar proposta` | Cria uma tarefa na hora |
| `/ok proposta` | Conclui pelo trecho do título |
| `/lembretes` | Avisos programados |
| `/gasto 32 uber` · `/entrada 500 cliente` | Lançamento rápido |
| `/gastos mes` · `/gastos 2026-07` | Resumo financeiro do período |
| `/planilha mes` | Planilha CSV |
| `/ideia texto` · `/notas` | Guarda ou lista ideias |
| `/memoria` | O que ela já sabe sobre você |
| `/status` | Saúde da assistente |
| `/limpar` | Recomeça a conversa (tarefas e memórias ficam) |

### O ritmo do dia

- **De manhã** (no `HORARIO_MANHA`): bom-dia com a agenda, as tarefas atrasadas e as
  do dia, e por onde começar.
- **Ao longo do dia:** aviso no Telegram antes de cada compromisso, inclusive dos que
  você marcar direto no Google Agenda pelo celular.
- **À noite** (no `HORARIO_NOITE`): o que foi concluído, o que ficou pendente, os
  gastos do dia e a pergunta "como planejamos amanhã?". Responda por áudio que ela
  organiza.

> **Importante:** tudo isso só acontece **enquanto a assistente estiver ligada**. Se
> o terminal fechar, ela para. A Etapa 8 resolve isso.

---

## Etapa 8 — Deixar a assistente ligada sozinha

**Objetivo:** ela funcionar sem você precisar abrir o terminal todo dia.

Escolha conforme o seu caso:

| Opção | Funciona quando | Custo |
|---|---|---|
| **A — No seu PC com pm2** | O PC está ligado | R$ 0 |
| **B — Na nuvem** | Sempre, mesmo com o PC desligado | R$ 0 a ~R$ 40/mês |

### Opção A — No seu PC com pm2

1. Pare a assistente que está no terminal (`Ctrl + C`).
2. Instale o pm2, um "gerente" que mantém a assistente de pé e a religa se cair:
   ```bash
   npm install -g pm2
   ```
3. Na pasta do projeto:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   ```
4. Confira:
   ```bash
   pm2 status            # deve mostrar "agente-diario" como "online"
   pm2 logs agente-diario
   ```
   Para sair dos logs, aperte `Ctrl + C`. A assistente **continua** ligada.
5. **Windows — ligar sozinha ao iniciar o PC:** aperte `Win + R`, digite
   `shell:startup` e Enter. Copie o arquivo `iniciar-agente.cmd` do projeto para a
   pasta que abriu.
   **Mac/Linux:** rode `pm2 startup` e execute o comando que ele imprimir.

Depois de mudar o `.env`, com pm2, reinicie assim:
```bash
pm2 restart agente-diario
```

### Opção B — Na nuvem (24h, PC desligado)

Siga o **[guiadenuvem.md](guiadenuvem.md)**. Ele usa uma máquina virtual gratuita.
Lembre: **desligue a do PC** antes de ligar a da nuvem (regra de ouro nº 3).

### ✅ Ponto de verificação da Etapa 8

- [ ] Fechou o terminal e `/status` continua respondendo
- [ ] (Opção A) Reiniciou o PC e ela voltou sozinha
- [ ] (Opção B) Desligou o PC e o bom-dia chegou no horário

---

## Etapa 9 — Segurança e manutenção

### Backup

Tudo o que a assistente sabe fica em `data.json`: memórias, tarefas, lembretes,
finanças e histórico. Ela já mantém um `data.backup.json` automático, mas **guarde uma
cópia fora do computador** de vez em quando (pendrive, Google Drive privado). Na
nuvem, o guia de nuvem configura backup diário.

### Se um segredo vazar

| Vazou | O que fazer agora |
|---|---|
| Token do Telegram | No @BotFather: `/revoke`, escolha o bot e troque o token no `.env` |
| Chave do Gemini | Em https://aistudio.google.com/apikey, apague a chave e crie outra |
| `credentials.json` | No Google Cloud → conta de serviço → Chaves: apague a chave e crie outra (5.4) |

### Atualizar para uma versão nova do projeto

- **Baixou com git:** na pasta do projeto, `git pull`, depois `npm install` e reinicie.
- **Baixou ZIP:** baixe o ZIP novo e copie para a pasta nova **só** os seus arquivos
  `.env`, `credentials.json`, `data.json` e `data.backup.json`. Rode `npm install`
  e ligue.

Os seus arquivos pessoais nunca são sobrescritos por uma atualização: eles não fazem
parte do repositório.

### Lembretes de privacidade

- O bot só responde ao `OWNER_CHAT_ID`. Mesmo assim, não divulgue o @ dele à toa.
- Se for usar com dados de clientes ou de terceiros, lembre que esses dados passam pelo
  Telegram e pelo Google (Gemini). Avalie a LGPD e os termos de cada serviço.

---

## Checklist final

- [ ] **Etapa 1:** Node instalado, projeto baixado, `npm install` ok
- [ ] **Etapa 2:** `.env` criado (e não `.env.txt`)
- [ ] **Etapa 3:** Bot criado, `OWNER_CHAT_ID` fixado, `/status` respondendo
- [ ] **Etapa 4:** Gemini conversando, lembrete de teste chegou
- [ ] **Etapa 5:** Agenda conectada, `npm test` → `🎉 Tudo passou.`
- [ ] **Etapa 6:** Nome, perfil e horários personalizados
- [ ] **Etapa 7:** Primeiro dia de uso com tarefas, agenda e gastos
- [ ] **Etapa 8:** Ligada sozinha (pm2 ou nuvem)
- [ ] **Etapa 9:** Backup do `data.json` guardado fora do computador

Pronto: agora é conversar com a assistente todo dia. Quanto mais você contar para
ela, mais ela personaliza.

Precisa da referência rápida de cada variável? Veja o
**[guiadeconexoes.md](guiadeconexoes.md)**.
