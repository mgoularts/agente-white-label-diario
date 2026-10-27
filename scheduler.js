// ── Agendador: mensagens matinal/noturna + disparo de lembretes ──────────────
const cron = require('node-cron');
const storage = require('./storage');
const calendar = require('./calendar');
const financas = require('./financas');
const { gerarTexto } = require('./ai');
const { sincronizarAgenda, textoLembrete } = require('./avisos');
const { hojeISO, TZ, limparMarkdown, dividirMensagem } = require('./util');
const { NOME_USUARIO } = require('./config');

// Envia mensagem ao Telegram com pequena tolerância a falhas de rede.
// Limpa markdown (o Telegram mostraria os símbolos crus) e respeita o teto de
// 4096 caracteres por mensagem.
async function enviar(bot, chatId, texto) {
    const partes = dividirMensagem(limparMarkdown(texto));
    for (const parte of partes) {
        let entregue = false;
        for (let i = 0; i < 3 && !entregue; i++) {
            try {
                await bot.sendMessage(chatId, parte);
                entregue = true;
            } catch (err) {
                if (i === 2) {
                    console.error('❌ Falha ao enviar mensagem proativa:', err.message);
                    return false;
                }
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    }
    return true;
}

// Converte "HH:MM" em expressão cron "M H * * *".
function cronDeHorario(horario, padrao) {
    const [h, m] = (horario || padrao).split(':').map(s => parseInt(s, 10));
    const hora = Number.isInteger(h) ? h : parseInt(padrao.split(':')[0], 10);
    const min = Number.isInteger(m) ? m : parseInt(padrao.split(':')[1], 10);
    return `${min} ${hora} * * *`;
}

// ── Mensagem matinal: bom-dia + motivação + agenda do dia ────────────────────
async function enviarBomDia(bot) {
    const chatId = storage.getOwnerChatId();
    if (!chatId) {
        console.log('☀️ Bom-dia não enviado: ainda não conheço o chat do dono (mande uma mensagem primeiro).');
        return;
    }

    let agendaTexto = 'Nenhum compromisso na agenda.';
    try {
        const eventos = await calendar.buscarEventos(hojeISO(0));
        agendaTexto = calendar.formatarAgenda(eventos);
    } catch (err) {
        console.error('⚠️ Erro ao buscar agenda para o bom-dia:', err.message);
    }

    // Registros recentes ajudam a personalizar a motivação (últimos 5).
    const registrosRecentes = storage.getNotes().slice(0, 5).map(n => `- ${n.conteudo}`).join('\n');

    // Tarefas: atrasadas cobram atenção, as de hoje entram no plano do dia.
    const agora = new Date();
    const fimDeHoje = new Date(`${hojeISO()}T23:59:59-03:00`);
    const pendentes = storage.getTasks();
    const atrasadas = pendentes.filter(t => t.prazo && new Date(t.prazo) < agora);
    const paraHoje = pendentes.filter(t => t.prazo && new Date(t.prazo) >= agora && new Date(t.prazo) <= fimDeHoje);
    const descreve = t => `- ${t.titulo}${t.projeto ? ` (${t.projeto})` : ''}${t.prioridade === 'alta' ? ' [PRIORIDADE ALTA]' : ''}`;

    const prompt = `Gere a mensagem matinal para ${NOME_USUARIO} (fale na segunda pessoa, "você"). Estrutura:
1) Um bom-dia caloroso seguido de uma motivação CURTA e PERSONALIZADA, conectada ao que ${NOME_USUARIO} está trabalhando/vivendo. Use a MEMÓRIA DE LONGO PRAZO e os registros recentes abaixo para deixar isso específico (cite projetos/metas reais quando fizer sentido). Evite clichês genéricos.
2) A agenda de HOJE, organizada por horário.
3) As tarefas do dia. Se houver atrasadas, comece por elas — cobre com leveza, sem culpar.
4) Feche com UMA sugestão de prioridade: por onde começar hoje.

Registros recentes de ${NOME_USUARIO}:
${registrosRecentes || '(nenhum registro recente)'}

Agenda de hoje:
${agendaTexto}

Tarefas ATRASADAS:
${atrasadas.length ? atrasadas.map(descreve).join('\n') : '(nenhuma)'}

Tarefas com prazo para hoje:
${paraHoje.length ? paraHoje.map(descreve).join('\n') : '(nenhuma)'}

Se não houver nada marcado, incentive a aproveitar o dia livre ou a puxar algo da lista de pendências. Seja concisa (no máximo ~10 linhas). NÃO use markdown (nada de asteriscos, crases ou #) — o Telegram mostra os símbolos crus.`;

    let texto;
    try {
        texto = await gerarTexto(prompt);
    } catch (err) {
        console.error('⚠️ Erro ao gerar bom-dia com IA, usando texto padrão:', err.message);
        const listaTarefas = [...atrasadas, ...paraHoje];
        texto = `Bom dia, ${NOME_USUARIO}! ☀️ Que hoje renda bons frutos.\n\nSua agenda de hoje:\n${agendaTexto}`
            + (listaTarefas.length ? `\n\nTarefas:\n${listaTarefas.map(t => `• ${t.titulo}`).join('\n')}` : '');
    }

    await enviar(bot, chatId, texto);
    storage.cleanupReminders(); // limpeza diária dos lembretes já disparados.
    storage.cleanupTasks();
    console.log('☀️ Mensagem matinal enviada.');
}

// ── Mensagem noturna: pergunta o planejamento do dia seguinte ────────────────
async function enviarBoaNoite(bot) {
    const chatId = storage.getOwnerChatId();
    if (!chatId) {
        console.log('🌙 Mensagem noturna não enviada: ainda não conheço o chat do dono.');
        return;
    }

    let agendaAmanha = 'Nenhum compromisso ainda marcado.';
    try {
        const eventos = await calendar.buscarEventos(hojeISO(1));
        agendaAmanha = calendar.formatarAgenda(eventos);
    } catch (err) {
        console.error('⚠️ Erro ao buscar agenda de amanhã:', err.message);
    }

    // O que foi concluído hoje (para reconhecer) e o que ficou para trás.
    const inicioDeHoje = new Date(`${hojeISO()}T00:00:00-03:00`);
    const concluidasHoje = storage.getTasks({ incluirConcluidas: true })
        .filter(t => t.concluida && t.concluidaEm && new Date(t.concluidaEm) >= inicioDeHoje);
    const aindaPendentes = storage.getTasks();

    // Fechamento financeiro do dia — só entra na mensagem se houve movimento.
    const gastosHoje = financas.totalDoDia();

    const prompt = `Gere a mensagem noturna para ${NOME_USUARIO} (fale na segunda pessoa, "você"). Objetivo: fechar o dia e perguntar, de forma acolhedora, como quer planejar amanhã. Mencione que dá para responder por aqui que você anota e organiza.

Se houve tarefas concluídas hoje, reconheça isso em uma linha (sem exagero). Se sobraram pendências, cite no máximo as 3 mais urgentes e pergunte se devem ir para amanhã.

Gastos lançados hoje:
${gastosHoje.quantidade
            ? `${financas.formatarBRL(gastosHoje.total)} em ${gastosHoje.quantidade} lançamento(s) — cite o total em UMA linha, sem julgar.`
            : '(nenhum — NÃO mencione gastos nem pergunte sobre eles)'}

Concluídas hoje:
${concluidasHoje.length ? concluidasHoje.map(t => `- ${t.titulo}`).join('\n') : '(nenhuma)'}

Ainda pendentes:
${aindaPendentes.length ? aindaPendentes.slice(0, 5).map(t => `- ${t.titulo}`).join('\n') : '(nenhuma)'}

O que já está marcado para amanhã:
${agendaAmanha}

Seja concisa (no máximo ~7 linhas), calorosa e NÃO use markdown (nada de asteriscos, crases ou #).`;

    let texto;
    try {
        texto = await gerarTexto(prompt);
    } catch (err) {
        console.error('⚠️ Erro ao gerar mensagem noturna, usando texto padrão:', err.message);
        texto = `Boa noite, ${NOME_USUARIO}! 🌙 Como você quer planejar o dia de amanhã? Me conta as prioridades que eu anoto.\n\nJá marcado para amanhã:\n${agendaAmanha}`;
    }

    await enviar(bot, chatId, texto);
    console.log('🌙 Mensagem noturna enviada.');
}

// ── Verificador de lembretes: dispara os que já venceram ─────────────────────
// Um lembrete que não sai (chat bloqueado, por exemplo) seria retentado a cada
// 30s para sempre. Depois de algumas falhas, damos ele por perdido e seguimos.
const falhasDeEnvio = new Map();
const MAX_FALHAS_ENVIO = 5;

let verificando = false;
async function verificarLembretes(bot) {
    if (verificando) return; // evita sobreposição de ciclos.
    verificando = true;
    try {
        const agora = new Date();
        const vencidos = storage.getDueReminders(agora);
        for (const l of vencidos) {
            // Aviso de agenda que só venceu porque o bot ficou fora do ar e o
            // compromisso já começou: não adianta avisar, só marca como visto.
            if (l.tipo === 'evento' && l.eventoInicio && new Date(l.eventoInicio) < agora) {
                storage.markReminderFired(l.id);
                console.log(`⏭️ Aviso vencido ignorado (compromisso já começou): "${l.mensagem}"`);
                continue;
            }
            const ok = await enviar(bot, l.chatId, textoLembrete(l));
            if (ok) {
                storage.markReminderFired(l.id);
                falhasDeEnvio.delete(l.id);
                console.log(`⏰ Lembrete disparado: "${l.mensagem}"`);
                continue;
            }
            const falhas = (falhasDeEnvio.get(l.id) || 0) + 1;
            falhasDeEnvio.set(l.id, falhas);
            if (falhas >= MAX_FALHAS_ENVIO) {
                storage.markReminderFired(l.id);
                falhasDeEnvio.delete(l.id);
                console.error(`❌ Desisti do lembrete "${l.mensagem}" após ${falhas} tentativas de envio.`);
            }
        }
    } catch (err) {
        console.error('❌ Erro ao verificar lembretes:', err.message);
    } finally {
        verificando = false;
    }
}

// ── Sincronização da agenda: eventos do Google viram avisos no Telegram ──────
let sincronizando = false;
async function rodarSincronizacao() {
    if (sincronizando) return;
    sincronizando = true;
    try {
        await sincronizarAgenda();
    } catch (err) {
        console.error('⚠️ Erro ao sincronizar a agenda:', err.message);
    } finally {
        sincronizando = false;
    }
}

// ── Inicialização ────────────────────────────────────────────────────────────
function startScheduler(bot) {
    const cronManha = cronDeHorario(process.env.HORARIO_MANHA, '07:00');
    const cronNoite = cronDeHorario(process.env.HORARIO_NOITE, '22:00');

    cron.schedule(cronManha, () => enviarBomDia(bot), { timezone: TZ });
    cron.schedule(cronNoite, () => enviarBoaNoite(bot), { timezone: TZ });

    // Verifica lembretes a cada 30s (pega inclusive os vencidos enquanto esteve offline).
    setInterval(() => verificarLembretes(bot), 30 * 1000);
    verificarLembretes(bot); // primeira verificação imediata ao subir.

    // Varre o Google Calendar a cada 5 min atrás de eventos novos/remarcados.
    setInterval(rodarSincronizacao, 5 * 60 * 1000);
    rodarSincronizacao();

    console.log(`⏰ Agendador ativo — bom-dia às ${process.env.HORARIO_MANHA || '07:00'}, boa-noite às ${process.env.HORARIO_NOITE || '22:00'} (${TZ}).`);
    console.log(`📅 Sincronização da agenda a cada 5 min — avisos ${process.env.ANTECEDENCIA_LEMBRETE || '30'} min antes de cada compromisso.`);
}

module.exports = { startScheduler, enviarBomDia, enviarBoaNoite, verificarLembretes, rodarSincronizacao };
