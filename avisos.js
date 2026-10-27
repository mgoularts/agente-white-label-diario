// ── Ponte Google Calendar → Telegram ─────────────────────────────────────────
// Todo compromisso da agenda vira um aviso no chat, disparado X minutos antes
// (padrão 30). Vale tanto para os eventos que a assistente cria quanto para os que
// o usuário marca direto no Google Agenda, pelo celular ou pelo navegador.
const calendar = require('./calendar');
const storage = require('./storage');
const { horaSP, emQuantoTempo } = require('./util');

const ANTECEDENCIA_MIN = parseInt(process.env.ANTECEDENCIA_LEMBRETE || '30', 10) || 30;
// Quanto do futuro a sincronização enxerga a cada rodada.
const JANELA_HORAS = 48;

// Instante em que o aviso de um evento deve chegar.
function horaDoAviso(inicio) {
    return new Date(new Date(inicio).getTime() - ANTECEDENCIA_MIN * 60 * 1000);
}

// ── Cria, atualiza ou mantém o aviso de um evento ────────────────────────────
// status: 'criado' | 'atualizado' | 'inalterado' | 'ja-avisado' | 'silenciado'.
// Devolve null quando não faz sentido avisar (evento no passado, sem dono).
function agendarAvisoDeEvento({ id, titulo, inicio }, chatId) {
    if (!chatId || !id || !inicio) return null;

    const agora = new Date();
    const inicioDt = new Date(inicio);
    if (isNaN(inicioDt.getTime()) || inicioDt <= agora) return null; // evento já começou.

    const inicioISO = inicioDt.toISOString();
    const aviso = horaDoAviso(inicioDt);
    // Se já estamos dentro da antecedência, avisa na próxima verificação (~30s).
    const quando = aviso > agora ? aviso : new Date(agora.getTime() + 30 * 1000);
    const base = { antecedenciaMinutos: ANTECEDENCIA_MIN, avisoEm: quando.toISOString() };

    const existente = storage.findReminderByEvent(id);

    if (existente) {
        // O usuário pediu para não ser avisado deste evento → respeita para sempre.
        if (existente.silenciado) return { ...base, status: 'silenciado' };

        const mudou = existente.eventoInicio !== inicioISO || existente.mensagem !== titulo;
        // Já avisado e nada mudou → não recria (senão repetiria a cada sincronização).
        if (existente.disparado && !mudou) return { ...base, status: 'ja-avisado' };
        if (!existente.disparado && !mudou) return { ...base, status: 'inalterado' };

        // Remarcado ou renomeado no Google → o aviso acompanha (e volta a valer).
        storage.updateReminder(existente.id, {
            mensagem: titulo,
            quando: quando.toISOString(),
            eventoInicio: inicioISO,
            disparado: false,
        });
        return { ...base, status: 'atualizado' };
    }

    storage.addReminder({
        mensagem: titulo,
        quando: quando.toISOString(),
        chatId,
        tipo: 'evento',
        eventoId: id,
        eventoInicio: inicioISO,
    });
    return { ...base, status: 'criado' };
}

// ── Sincronização periódica com o Google Calendar ────────────────────────────
// Cobre eventos criados fora da assistente, remarcações e cancelamentos.
async function sincronizarAgenda() {
    const chatId = storage.getOwnerChatId();
    if (!chatId) return { criados: 0, atualizados: 0, removidos: 0 };

    const agora = new Date();
    const fim = new Date(agora.getTime() + JANELA_HORAS * 60 * 60 * 1000);
    const eventos = await calendar.buscarJanela(agora, fim);

    let criados = 0, atualizados = 0, removidos = 0;
    const vistos = new Set();

    for (const ev of eventos) {
        if (ev.diaInteiro) continue; // evento de dia inteiro não tem "30 min antes".
        vistos.add(ev.id);

        const r = agendarAvisoDeEvento(ev, chatId);
        if (r && r.status === 'criado') criados++;
        else if (r && r.status === 'atualizado') atualizados++;
    }

    // Evento apagado/cancelado no Google → o aviso pendente some junto.
    for (const l of storage.getPendingEventReminders()) {
        if (!l.eventoInicio) continue;
        const inicio = new Date(l.eventoInicio);
        if (inicio < agora || inicio > fim) continue; // fora da janela: não dá para julgar.
        if (!vistos.has(l.eventoId)) {
            storage.cancelReminder(l.id);
            removidos++;
        }
    }

    if (criados || atualizados || removidos) {
        console.log(`📅 Agenda sincronizada — ${criados} novo(s), ${atualizados} atualizado(s), ${removidos} cancelado(s).`);
    }
    return { criados, atualizados, removidos };
}

// ── Aviso de prazo de tarefa ─────────────────────────────────────────────────
// Só faz sentido para prazos com hora marcada; prazo "só data" cai no resumo
// matinal em vez de tocar de madrugada.
function agendarAvisoDeTarefa(tarefa, chatId) {
    if (!chatId || !tarefa || !tarefa.prazo) return null;

    const prazo = new Date(tarefa.prazo);
    const agora = new Date();
    if (isNaN(prazo.getTime()) || prazo <= agora) return null;

    // Meia-noite = prazo sem hora definida → não vira alarme.
    const horaLocal = prazo.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    if (horaLocal === '00:00') return null;

    const aviso = new Date(prazo.getTime() - ANTECEDENCIA_MIN * 60 * 1000);
    const quando = aviso > agora ? aviso : new Date(agora.getTime() + 30 * 1000);

    storage.cancelRemindersByTask(tarefa.id); // evita aviso duplicado ao remarcar.
    storage.addReminder({
        mensagem: tarefa.titulo,
        quando: quando.toISOString(),
        chatId,
        tipo: 'tarefa',
        tarefaId: tarefa.id,
        eventoInicio: prazo.toISOString(),
    });
    return { antecedenciaMinutos: ANTECEDENCIA_MIN, avisoEm: quando.toISOString() };
}

// ── Texto do aviso, montado na hora do disparo ───────────────────────────────
function textoLembrete(l) {
    if (l.tipo === 'evento' && l.eventoInicio) {
        const inicio = new Date(l.eventoInicio);
        const faltam = Math.max(0, Math.round((inicio - Date.now()) / 60000));
        return `⏰ Compromisso ${emQuantoTempo(faltam)}\n\n📌 ${l.mensagem}\n🕐 ${horaSP(inicio)}`;
    }
    if (l.tipo === 'tarefa' && l.eventoInicio) {
        const prazo = new Date(l.eventoInicio);
        const faltam = Math.max(0, Math.round((prazo - Date.now()) / 60000));
        return `📋 Prazo ${emQuantoTempo(faltam)}\n\n${l.mensagem}\n🕐 vence às ${horaSP(prazo)}`;
    }
    return `⏰ Lembrete: ${l.mensagem}`;
}

module.exports = {
    ANTECEDENCIA_MIN,
    agendarAvisoDeEvento,
    agendarAvisoDeTarefa,
    sincronizarAgenda,
    textoLembrete,
};
