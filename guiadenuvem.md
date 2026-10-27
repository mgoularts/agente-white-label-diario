# Guia de nuvem: o agente no ar 24 horas, com o PC desligado

Pré-requisito: o agente já funcionando no seu PC, com o
[guiadeconexoes.md](guiadeconexoes.md) completo e `npm test` passando.

## Antes de começar

O agente usa **polling** do Telegram: fica conectado o tempo todo perguntando se há
mensagem nova. Por isso precisa de um servidor **sempre ligado**. Hospedagens grátis
que "dormem" depois de alguns minutos sem acesso não servem, porque o bot pararia de
responder e os lembretes não sairiam.

Duas instâncias com o mesmo token dão **erro 409** e as duas param. Quando o agente
subir na nuvem, desligue o do seu PC.

### Onde hospedar

| Opção | Custo | Observação |
|---|---|---|
| **Oracle Cloud Always Free** | R$ 0 | VM Linux gratuita. Pede cartão só para validar identidade. |
| **Google Cloud e2-micro** | R$ 0 | VM pequena gratuita em algumas regiões dos EUA. |
| VPS barata (qualquer provedor) | ~R$ 20–40/mês | Menos burocracia que as gratuitas. |

> As condições dessas plataformas mudam com frequência. Confira os termos na hora
> de contratar.

Os passos abaixo valem para **qualquer VM Ubuntu**. A parte de criar a VM usa a
Oracle como exemplo.

---

## Parte 1: criar a VM (exemplo: Oracle Cloud)

1. Crie a conta em https://www.oracle.com/cloud/free/ e escolha a região mais
   próxima. A região não pode ser trocada depois.
2. Gere uma chave SSH no seu PC:
   ```bash
   ssh-keygen -t ed25519 -C "agente-diario" -f ~/.ssh/agente_diario
   ```
   No Windows (PowerShell), troque `~` por `$env:USERPROFILE`.
   - `agente_diario` é a chave **privada**: nunca compartilhe.
   - `agente_diario.pub` é a **pública**: você vai colar na Oracle.
3. No painel: ☰ → **Compute → Instances → Create instance**.
   - **Image:** Canonical Ubuntu 24.04
   - **Shape:** `VM.Standard.A1.Flex` (Ampere) com 1 OCPU e 6 GB. Se aparecer "Out of
     capacity", use `VM.Standard.E2.1.Micro`. Confira o selo **Always Free eligible**.
   - **Networking:** padrão, com IPv4 público.
   - **SSH keys:** cole o conteúdo do `agente_diario.pub`.
4. Anote o **Public IP**. Daqui em diante ele aparece como `SEU_IP`.

> O agente só faz conexões **de saída** (Telegram, Gemini e Google). Não precisa
> abrir nenhuma porta de entrada.

---

## Parte 2: preparar o servidor

Conecte do seu PC:

```bash
ssh -i ~/.ssh/agente_diario ubuntu@SEU_IP
```

Dentro da VM:

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone America/Sao_Paulo   # só para os logs; o código já usa SP

# Node 22 LTS (o "apt install nodejs" puro costuma trazer versão velha)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v

sudo npm install -g pm2
mkdir -p ~/agente-dados
```

Se a VM tiver só 1 GB de RAM (E2.1.Micro), crie swap:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Parte 3: levar o projeto e os segredos

O código vem do GitHub. Os segredos vão **direto do seu PC**, nunca pelo GitHub.

Na VM:

```bash
git clone <url-deste-repositório> ~/agente-white-label-diario
cd ~/agente-white-label-diario && npm install
```

No seu PC, dentro da pasta do projeto:

```bash
scp -i ~/.ssh/agente_diario .env credentials.json ubuntu@SEU_IP:~/agente-white-label-diario/
# Se você já usava o agente no PC e quer levar memórias e tarefas:
scp -i ~/.ssh/agente_diario data.json ubuntu@SEU_IP:~/agente-dados/
```

De volta na VM:

```bash
cd ~/agente-white-label-diario
chmod 600 .env credentials.json
printf '\nDATA_DIR=/home/ubuntu/agente-dados\n' >> .env
npm test        # precisa terminar com "🎉 Tudo passou."
```

---

## Parte 4: desligar o agente do PC ⚠️

Sem este passo, as duas instâncias brigam (erro 409). No seu PC:

```bash
pm2 delete agente-diario
pm2 save --force
```

Se você colocou o `iniciar-agente.cmd` na pasta de inicialização do Windows, apague
de lá também (Win+R → `shell:startup`).

---

## Parte 5: ligar na nuvem

Na VM:

```bash
cd ~/agente-white-label-diario
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd      # ele imprime um comando "sudo env PATH=..." — copie e execute
```

Rotação de logs, para eles não encherem o disco:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

Backup diário do `data.json`:

```bash
(crontab -l 2>/dev/null; echo '0 3 * * * cp ~/agente-dados/data.json ~/agente-dados/backup-$(date +\%F).json') | crontab -
```

---

## Parte 6: validar

```bash
pm2 logs agente-diario --lines 30
```

O log deve mostrar o agendador ativo, a sincronização da agenda e a linha
`online e aguardando mensagens no Telegram!`, **sem** erro 409.

No Telegram:
1. `/status` responde na hora e mostra poucos minutos em "No ar há".
2. `oi` passa pela IA.
3. `me lembra de testar a nuvem daqui a 2 minutos` → o lembrete chega sozinho.

O teste definitivo é desligar o PC e conferir se o bom-dia chega no horário.

---

## Manutenção

| O que | Comando (na VM) |
|---|---|
| Ver se está no ar | `pm2 status` |
| Ver logs | `pm2 logs agente-diario` |
| Reiniciar | `pm2 restart agente-diario` |
| Atualizar o código | `git pull && npm install && pm2 restart agente-diario` |
| Trazer backup para o PC | `scp -i ~/.ssh/agente_diario ubuntu@SEU_IP:~/agente-dados/data.json .` (rodar no PC) |

**Atenção, Oracle Always Free:** a Oracle pode recuperar VMs gratuitas consideradas
ociosas, e o agente consome pouquíssima CPU. Se isso acontecer, você recebe aviso por
e-mail. Dá para recriar a VM com este guia e o backup do `data.json`, ou migrar a
conta para *Pay As You Go*, que mantém os recursos gratuitos e não sofre essa
recuperação.

## Custo mensal esperado

| Item | Custo |
|---|---|
| Servidor (camada gratuita) | R$ 0 |
| Telegram Bot API | R$ 0 |
| Google Calendar API | R$ 0 para uso pessoal |
| Gemini API (fila de modelos grátis) | R$ 0 |

Se a cota grátis do Gemini ficar apertada, o próximo passo é ativar o billing da API.
