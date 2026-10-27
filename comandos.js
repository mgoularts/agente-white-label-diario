// ── Comandos rápidos (/hoje, /tarefas, ...) ──────────────────────────────────
// Respondidos direto pelo código, SEM passar pela IA. Isso economiza a cota
// gratuita do Gemini para o que realmente exige inteligência (conversa, análise)
// e responde instantaneamente, mesmo com a cota do dia esgotada.
const calendar = require('./calendar');
const storage = require('./storage');
const financas = require('./financas');
const { hojeISO, horaSP, paraInstanteSP } = require('./util');
const { NOME_ASSISTENTE } = require('./config');

const AJUDA = `🤖 ${NOME_ASSISTENTE} — comandos rápidos (não gastam cota de IA)

/hoje — agenda + tarefas + lembretes de hoje
/semana — compromissos dos próximos 7 dias
/tarefas — tudo que está pendente, por urgência
/nova <tarefa> — cria uma tarefa na hora
/ok <tarefa> — marca uma tarefa como concluída
/lembretes — avisos programados

💰 Finanças
/gasto <valor> <descrição> — lança na hora (ex: /gasto 45,90 almoço)
/entrada <valor> <descrição> — lança dinheiro que entrou
/gastos [periodo] — resumo (hoje, semana, mes, mes-passado, ano ou 2026-07)
/planilha [periodo] — manda o CSV para abrir no Excel/Sheets

🧠 Ideias e memória
/ideia <texto> — guarda um insight na hora
/notas — os últimos insights guardados
/memoria — o que eu já sei sobre você

/status — como estou de cota, agenda e dados
/limpar — recomeça a conversa do zero (memórias e tarefas ficam)
/ajuda — esta lista

Fora isso, é só falar comigo normalmente — por texto, áudio, foto ou documento.
Marcou algo no Google Agenda? Eu te aviso aqui 30 min antes, sem você pedir.`;

function rotuloPrioridade(p) {
    return p === 'alta' ? '🔴' : p === 'baixa' ? '⚪' : '🟡';
}

function linhaTarefa(t) {
    const atrasada = t.prazo && new Date(t.prazo) < new Date();
    const prazo = t.prazo
        ? ` — ${new Date(t.prazo).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${atrasada ? ' ⚠️ ATRASADA' : ''}`
        : '';
    const projeto = t.projeto ? ` [${t.projeto}]` : '';
    return `${rotuloPrioridade(t.prioridade)} ${t.titulo}${projeto}${prazo}`;
}

function linhaEvento(e) {
    if (e.diaInteiro) return `• ${e.titulo} (dia inteiro)`;
    return `• ${horaSP(e.inicio)} — ${e.titulo}`;
}

async function comandoHoje() {
    const dia = hojeISO();
    let agenda;
    try {
        const eventos = await calendar.buscarEventos(dia);
        agenda = eventos.length ? eventos.map(linhaEvento).join('\n') : 'Nada marcado.';
    } catch (err) {
        agenda = `Não consegui consultar o Google Calendar (${err.message}).`;
    }

    const agora = new Date();
    const fimDoDia = paraInstanteSP(`${dia}T23:59:59`);
    const tarefas = storage.getTasks();
    const relevantes = tarefas.filter(t => !t.prazo || new Date(t.prazo) <= fimDoDia);
    const lembretes = storage.getPendingReminders()
        .filter(l => l.tipo === 'manual' && new Date(l.quando) <= fimDoDia && new Date(l.quando) >= agora);

    const partes = [
        `📅 Hoje, ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long' })}`,
        `\n🗓️ Agenda\n${agenda}`,
        `\n📋 Tarefas\n${relevantes.length ? relevantes.map(linhaTarefa).join('\n') : 'Nada pendente para hoje. 🎉'}`,
    ];
    if (lembretes.length) {
        partes.push(`\n⏰ Lembretes\n${lembretes.map(l => `• ${horaSP(l.quando)} — ${l.mensagem}`).join('\n')}`);
    }
    const semPrazo = tarefas.filter(t => !t.prazo).length;
    if (semPrazo) partes.push(`\n(+${semPrazo} tarefa(s) sem prazo — veja em /tarefas)`);

    return partes.join('\n');
}

async function comandoSemana() {
    try {
        const eventos = await calendar.buscarJanela(new Date(), new Date(Date.now() + 7 * 24 * 3600 * 1000));
        if (!eventos.length) return '🗓️ Nenhum compromisso nos próximos 7 dias.';

        const porDia = {};
        for (const e of eventos) {
            const dia = new Date(e.inicio).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit' });
            (porDia[dia] = porDia[dia] || []).push(e);
        }
        return '🗓️ Próximos 7 dias\n\n' + Object.entries(porDia)
            .map(([dia, evs]) => `${dia}\n${evs.map(linhaEvento).join('\n')}`)
            .join('\n\n');
    } catch (err) {
        return `Não consegui consultar o Google Calendar (${err.message}).`;
    }
}

function comandoTarefas() {
    const tarefas = storage.getTasks();
    if (!tarefas.length) return '📋 Nenhuma tarefa pendente. Tudo em dia! 🎉';

    const agora = new Date();
    const atrasadas = tarefas.filter(t => t.prazo && new Date(t.prazo) < agora);
    const comPrazo = tarefas.filter(t => t.prazo && new Date(t.prazo) >= agora);
    const semPrazo = tarefas.filter(t => !t.prazo);

    const blocos = [`📋 ${tarefas.length} tarefa(s) pendente(s)`];
    if (atrasadas.length) blocos.push(`\n⚠️ Atrasadas\n${atrasadas.map(linhaTarefa).join('\n')}`);
    if (comPrazo.length) blocos.push(`\n📆 Com prazo\n${comPrazo.map(linhaTarefa).join('\n')}`);
    if (semPrazo.length) blocos.push(`\n📝 Sem prazo\n${semPrazo.map(linhaTarefa).join('\n')}`);
    blocos.push('\nPara concluir: /ok <parte do título>');
    return blocos.join('\n');
}

function comandoNova(texto) {
    const titulo = (texto || '').trim();
    if (!titulo) return 'Escreve assim: /nova Enviar proposta para o cliente X';
    const t = storage.addTask({ titulo });
    return `✅ Tarefa criada: ${t.titulo}\n\nSe quiser prazo ou prioridade, é só me falar em linguagem normal (ex.: "a proposta do cliente X é pra sexta às 17h, prioridade alta").`;
}

function comandoOk(texto) {
    const chave = (texto || '').trim();
    if (!chave) return 'Escreve assim: /ok proposta';
    const t = storage.completeTask(chave);
    if (!t) return `Não achei tarefa parecida com "${chave}". Veja a lista com /tarefas.`;
    storage.cancelRemindersByTask(t.id);
    const restam = storage.getTasks().length;
    return `✅ Concluída: ${t.titulo}\n${restam ? `Ainda restam ${restam} tarefa(s).` : 'Sua lista está limpa! 🎉'}`;
}

function comandoLembretes() {
    const pendentes = storage.getPendingReminders();
    if (!pendentes.length) return '⏰ Nenhum aviso programado.';
    const icone = l => (l.tipo === 'evento' ? '📅' : l.tipo === 'tarefa' ? '📋' : '⏰');
    return '⏰ Avisos programados\n\n' + pendentes.map(l => {
        const quando = new Date(l.quando).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `${icone(l)} ${quando} — ${l.mensagem}`;
    }).join('\n');
}

function comandoMemoria() {
    const memorias = storage.getMemories();
    if (!memorias.length) return '🧠 Ainda não guardei nada sobre você. Vamos conversando que eu aprendo.';
    const porCategoria = {};
    for (const m of memorias) (porCategoria[m.categoria] = porCategoria[m.categoria] || []).push(m.fato);
    return '🧠 O que eu sei sobre você\n\n' + Object.entries(porCategoria)
        .map(([cat, fatos]) => `${cat}\n${fatos.map(f => `• ${f}`).join('\n')}`)
        .join('\n\n');
}

// ── Finanças ─────────────────────────────────────────────────────────────────
// "/gasto 45,90 almoço com o cliente" → valor na frente, resto é descrição.
function comandoGasto(texto, tipo = 'gasto') {
    const bruto = (texto || '').trim();
    const m = bruto.match(/^(r?\$?\s*[\d.,]+)\s*(.*)$/i);
    if (!m) {
        return tipo === 'receita'
            ? 'Escreve assim: /entrada 3500 pagamento do cliente'
            : 'Escreve assim: /gasto 45,90 almoço';
    }

    const r = financas.registrar({ valor: m[1], descricao: m[2], tipo });
    if (r.erro) return `⚠️ ${r.erro}\nExemplo: /gasto 45,90 almoço`;

    const l = r.lancamento;
    const doDia = financas.totalDoDia(l.data);
    const doMes = financas.resumir({ de: l.data.slice(0, 7) });
    const icone = tipo === 'receita' ? '💚' : '💸';

    return [
        `${icone} ${financas.formatarBRL(l.valor)} — ${l.descricao}`,
        `Categoria: ${financas.rotularCategoria(l.categoria)}${l.categoria === 'outros' ? ' (me diz a categoria certa se quiser trocar)' : ''}`,
        '',
        `Hoje: ${financas.formatarBRL(doDia.total)} • No mês: ${doMes.totalGastos}`,
    ].join('\n');
}

function comandoGastos(arg) {
    const r = financas.resumir(argParaPeriodo(arg));
    const partes = [`💰 Gastos — ${r.periodo} (${r.de} a ${r.ate})`, `\nTotal: ${r.totalGastos}`];

    if (r.totalReceitas) partes.push(`Entradas: ${r.totalReceitas}\nSaldo: ${r.saldo}`);
    if (r.lancamentos === 0) return `💰 Nenhum lançamento em ${r.periodo}.\n\nPara lançar: /gasto 45,90 almoço`;

    partes.push(`Média por dia: ${r.mediaDiaria} • ${r.lancamentos} lançamento(s)`);

    if (Array.isArray(r.porCategoria)) {
        partes.push('\n📊 Por categoria\n' + r.porCategoria
            .map(c => `• ${c.categoria}: ${c.total} (${c.fatia})`).join('\n'));
    }
    if (Array.isArray(r.evolucao) && r.evolucao.length > 1) {
        partes.push('\n📈 Evolução\n' + r.evolucao.slice(-12)
            .map(e => `• ${e.periodo}: ${e.gastos}`).join('\n'));
    }
    partes.push('\nPlanilha completa: /planilha' + (arg ? ` ${arg.trim()}` : ''));
    return partes.join('\n');
}

function comandoPlanilha(arg) {
    const r = financas.gerarCSV(argParaPeriodo(arg));
    if (!r.quantidade) {
        return `Não há lançamentos em ${r.janela.rotulo} para montar a planilha.`;
    }
    return {
        arquivo: r.arquivo,
        legenda: `📊 Gastos — ${r.janela.rotulo}\n${r.quantidade} lançamento(s) • Total ${financas.formatarBRL(r.totalGastos)}\nAbre direto no Excel e no Google Sheets.`,
    };
}

// "/gastos 2026-07" e "/gastos mes-passado" chegam pelo mesmo argumento; datas
// vão para `de`, atalhos vão para `periodo`.
function argParaPeriodo(arg) {
    const a = (arg || '').trim();
    if (!a) return {};
    return /^\d{4}(-\d{2}){0,2}$/.test(a) ? { de: a } : { periodo: a };
}

// ── Insights ─────────────────────────────────────────────────────────────────
function comandoIdeia(texto) {
    const conteudo = (texto || '').trim();
    if (!conteudo) return 'Escreve assim: /ideia oferecer um plano anual com desconto';
    const n = storage.addNote({ conteudo, categoria: 'ideias' });
    const total = storage.getNotes('ideias').length;
    return `💡 Anotado!\n\n"${n.conteudo}"\n\nJá são ${total} ideia(s) guardada(s). Veja em /notas.`;
}

function comandoNotas() {
    const notas = storage.getNotes();
    if (!notas.length) return '📝 Nenhuma anotação ainda. Guarde uma com /ideia <texto> ou é só me contar por aqui.';
    const linhas = notas.slice(0, 20).map(n => {
        const quando = new Date(n.criadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
        return `• [${quando} | ${n.categoria}] ${n.conteudo}`;
    });
    const extra = notas.length > 20 ? `\n\n(+${notas.length - 20} mais antigas — me pergunte que eu busco)` : '';
    return `📝 Suas anotações (${notas.length})\n\n${linhas.join('\n')}${extra}`;
}

function comandoStatus(info = {}) {
    const tarefas = storage.getTasks();
    const atrasadas = tarefas.filter(t => t.prazo && new Date(t.prazo) < new Date()).length;
    const up = Math.floor(process.uptime());
    const tempo = up < 3600 ? `${Math.floor(up / 60)} min` : `${Math.floor(up / 3600)}h${String(Math.floor((up % 3600) / 60)).padStart(2, '0')}`;

    return [
        `🩺 Status — ${NOME_ASSISTENTE}`,
        `\n🤖 Modelo em uso: ${info.modelo || '—'}`,
        `♻️ No ar há: ${tempo}`,
        `\n📋 Tarefas pendentes: ${tarefas.length}${atrasadas ? ` (${atrasadas} atrasada(s))` : ''}`,
        `⏰ Avisos programados: ${storage.getPendingReminders().length}`,
        `🧠 Memórias guardadas: ${storage.getMemories().length}`,
        `📝 Anotações: ${storage.getNotes().length}`,
        `💰 Gastos do mês: ${financas.resumir({ periodo: 'mes' }).totalGastos}`,
    ].join('\n');
}

function comandoLimpar(chatId) {
    storage.limparHistorico(chatId);
    return '🧹 Conversa reiniciada. Suas tarefas, lembretes e memórias continuam intactos.';
}

// ── Roteador ─────────────────────────────────────────────────────────────────
// Devolve o texto da resposta, ou null se a mensagem não for um comando
// conhecido (aí ela segue o fluxo normal para a IA).
async function tratarComando(texto, ctx = {}) {
    const bruto = String(texto || '').trim();
    if (!bruto.startsWith('/')) return null;

    // "/ok proposta@SeuBot" → comando "ok", argumento "proposta".
    const [cabeca, ...resto] = bruto.split(/\s+/);
    const cmd = cabeca.slice(1).split('@')[0].toLowerCase();
    const arg = resto.join(' ');

    switch (cmd) {
        case 'start':
        case 'ajuda':
        case 'help':
            return AJUDA;
        case 'hoje':
            return comandoHoje();
        case 'semana':
        case 'agenda':
            return comandoSemana();
        case 'tarefas':
            return comandoTarefas();
        case 'nova':
            return comandoNova(arg);
        case 'ok':
        case 'feito':
            return comandoOk(arg);
        case 'lembretes':
            return comandoLembretes();
        case 'gasto':
        case 'gastei':
            return comandoGasto(arg, 'gasto');
        case 'entrada':
        case 'recebi':
            return comandoGasto(arg, 'receita');
        case 'gastos':
        case 'financeiro':
            return comandoGastos(arg);
        case 'planilha':
        case 'csv':
            return comandoPlanilha(arg);
        case 'ideia':
        case 'insight':
        case 'anota':
            return comandoIdeia(arg);
        case 'notas':
        case 'ideias':
        case 'anotacoes':
        case 'anotações':
            return comandoNotas();
        case 'memoria':
        case 'memórias':
        case 'memorias':
            return comandoMemoria();
        case 'status':
            return comandoStatus(ctx);
        case 'limpar':
            return comandoLimpar(ctx.chatId);
        default:
            return null; // comando desconhecido → deixa a IA responder.
    }
}

module.exports = { tratarComando, AJUDA };
