// ── Persistência simples em disco (JSON) ─────────────────────────────────────
// Guarda o chat ID do dono, lembretes e registros. Tudo sobrevive a reinício.
const fs = require('fs');
const path = require('path');

// Na nuvem o disco costuma ser efêmero (some a cada deploy). DATA_DIR permite
// apontar os dados para um volume persistente sem mexer no código.
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (DATA_DIR !== __dirname) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) { /* já existe */ }
}
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_FILE = path.join(DATA_DIR, 'data.backup.json');
const defaultData = { ownerChatId: null, reminders: [], notes: [], tasks: [], memories: [], expenses: [], histories: {} };

function load() {
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        return { ...defaultData, ...JSON.parse(raw) };
    } catch (err) {
        // Arquivo principal ilegível → tenta o backup antes de desistir.
        try {
            const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
            console.warn('⚠️ data.json ilegível; restaurando a partir do backup.');
            return { ...defaultData, ...JSON.parse(raw) };
        } catch (_) {
            return { ...defaultData };
        }
    }
}

// Guarda uma cópia de segurança no máximo a cada 6h — memórias e histórico são
// o que a assistente sabe sobre o usuário; perder isso não tem como refazer.
function talvezFazerBackup() {
    try {
        const idade = Date.now() - fs.statSync(BACKUP_FILE).mtimeMs;
        if (idade < 6 * 60 * 60 * 1000) return;
    } catch (_) { /* backup ainda não existe → cria agora. */ }
    try {
        fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    } catch (_) { /* sem data.json ainda; nada a copiar. */ }
}

function save(data) {
    talvezFazerBackup();
    // Escrita atômica: grava num .tmp e renomeia, evitando arquivo pela metade.
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
}

function novoId(prefixo) {
    return `${prefixo}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

// ── Dono (para mensagens proativas) ──────────────────────────────────────────
function getOwnerChatId() {
    return load().ownerChatId;
}

function setOwnerChatId(id) {
    const d = load();
    if (d.ownerChatId !== id) {
        d.ownerChatId = id;
        save(d);
    }
}

// ── Lembretes ────────────────────────────────────────────────────────────────
// `tipo`: 'manual' (pedido do usuário), 'evento' (aviso automático de um
// compromisso do Google Calendar) ou 'tarefa' (aviso de prazo). Nos dois últimos,
// eventoId/tarefaId ligam o aviso ao item de origem — é por esse vínculo que o
// aviso é cancelado quando o compromisso some ou a tarefa é concluída.
function addReminder({ mensagem, quando, chatId, tipo = 'manual', eventoId = null, tarefaId = null, eventoInicio = null }) {
    const d = load();
    const lembrete = {
        id: novoId('r'),
        mensagem,
        quando,              // instante ISO em que o lembrete deve ser enviado
        chatId,
        tipo,
        eventoId,
        tarefaId,
        eventoInicio,        // início do compromisso / prazo, para "daqui a X min"
        disparado: false,
        criadoEm: new Date().toISOString(),
    };
    d.reminders.push(lembrete);
    save(d);
    return lembrete;
}

// Aviso já criado para um evento do Calendar — inclui os já disparados e os
// silenciados, para a sincronização não recriar avisos que ela mesma já resolveu.
function findReminderByEvent(eventoId) {
    if (!eventoId) return null;
    return load().reminders.find(r => r.eventoId === eventoId) || null;
}

// Aviso de agenda que o usuário pediu para cancelar: fica marcado como silenciado
// para que a próxima sincronização com o Google não o traga de volta.
function silenceReminder(id) {
    return updateReminder(id, { disparado: true, silenciado: true });
}

// Avisos de agenda ainda não enviados (usado para limpar eventos cancelados/remarcados).
function getPendingEventReminders() {
    return load().reminders.filter(r => r.tipo === 'evento' && !r.disparado);
}

function updateReminder(id, campos) {
    const d = load();
    const r = d.reminders.find(x => x.id === id);
    if (!r) return false;
    Object.assign(r, campos);
    save(d);
    return true;
}

// Lembretes vencidos e ainda não disparados.
function getDueReminders(agora = new Date()) {
    const d = load();
    return d.reminders.filter(r => !r.disparado && new Date(r.quando) <= agora);
}

// Lembretes futuros ainda pendentes (para listar / cancelar).
function getPendingReminders(chatId = null) {
    const d = load();
    return d.reminders
        .filter(r => !r.disparado && (chatId == null || r.chatId === chatId))
        .sort((a, b) => new Date(a.quando) - new Date(b.quando));
}

function markReminderFired(id) {
    const d = load();
    const r = d.reminders.find(x => x.id === id);
    if (r) {
        r.disparado = true;
        save(d);
    }
}

function cancelReminder(id, chatId = null) {
    const d = load();
    const antes = d.reminders.length;
    d.reminders = d.reminders.filter(r => {
        const alvo = r.id === id && (chatId == null || r.chatId === chatId);
        return !alvo;
    });
    const removidos = antes - d.reminders.length;
    if (removidos > 0) save(d);
    return removidos > 0;
}

// Remove os avisos pendentes de uma tarefa (ao concluí-la, apagá-la ou remarcá-la).
function cancelRemindersByTask(tarefaId) {
    if (!tarefaId) return 0;
    const d = load();
    const antes = d.reminders.length;
    d.reminders = d.reminders.filter(r => !(r.tarefaId === tarefaId && !r.disparado));
    const removidos = antes - d.reminders.length;
    if (removidos) save(d);
    return removidos;
}

// Remove lembretes já disparados há mais de 7 dias, para não crescer sem limite.
// Silenciados só saem depois que o compromisso passou (senão a sincronização os recria).
function cleanupReminders() {
    const d = load();
    const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const antes = d.reminders.length;
    d.reminders = d.reminders.filter(r => {
        if (!r.disparado) return true;
        if (r.silenciado && r.eventoInicio && new Date(r.eventoInicio).getTime() > Date.now()) return true;
        return new Date(r.criadoEm).getTime() > limite;
    });
    if (d.reminders.length !== antes) save(d);
}

// ── Registros / anotações ────────────────────────────────────────────────────
function addNote({ conteudo, categoria }) {
    const d = load();
    const nota = {
        id: novoId('n'),
        conteudo,
        categoria: categoria || 'geral',
        criadoEm: new Date().toISOString(),
    };
    d.notes.push(nota);
    save(d);
    return nota;
}

function getNotes(categoria = null) {
    const d = load();
    return d.notes
        .filter(n => categoria == null || n.categoria.toLowerCase() === categoria.toLowerCase())
        .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
}

// ── Tarefas (o "o que preciso fazer") ────────────────────────────────────────
// Diferente de anotação: tem prazo, prioridade e estado de conclusão.
function addTask({ titulo, prazo = null, prioridade = 'media', projeto = null }) {
    const d = load();
    const tarefa = {
        id: novoId('t'),
        titulo: String(titulo).trim(),
        prazo,                       // instante ISO ou null (sem data marcada)
        prioridade,                  // 'alta' | 'media' | 'baixa'
        projeto,                     // cliente/projeto ao qual pertence
        concluida: false,
        criadoEm: new Date().toISOString(),
        concluidaEm: null,
    };
    d.tasks.push(tarefa);
    save(d);
    return tarefa;
}

// Ordena por: atrasadas → com prazo mais próximo → prioridade → mais antigas.
const PESO_PRIORIDADE = { alta: 0, media: 1, baixa: 2 };
function ordenarTarefas(a, b) {
    if (a.prazo && b.prazo) {
        const dif = new Date(a.prazo) - new Date(b.prazo);
        if (dif) return dif;
    } else if (a.prazo !== b.prazo) {
        return a.prazo ? -1 : 1; // quem tem prazo vem antes de quem não tem.
    }
    const p = (PESO_PRIORIDADE[a.prioridade] ?? 1) - (PESO_PRIORIDADE[b.prioridade] ?? 1);
    return p || (new Date(a.criadoEm) - new Date(b.criadoEm));
}

function getTasks({ incluirConcluidas = false, ate = null } = {}) {
    const d = load();
    return d.tasks
        .filter(t => (incluirConcluidas || !t.concluida))
        .filter(t => !ate || (t.prazo && new Date(t.prazo) <= new Date(ate)))
        .sort(ordenarTarefas);
}

// Localiza por id exato ou, se não achar, pelo texto do título (o usuário fala
// "conclui a proposta do cliente X", não o id).
function findTask(idOuTitulo) {
    const d = load();
    const chave = String(idOuTitulo || '').trim().toLowerCase();
    if (!chave) return null;
    const porId = d.tasks.find(t => t.id === idOuTitulo);
    if (porId) return porId;
    const pendentes = d.tasks.filter(t => !t.concluida);
    return pendentes.find(t => t.titulo.toLowerCase() === chave)
        || pendentes.find(t => t.titulo.toLowerCase().includes(chave))
        || pendentes.find(t => chave.includes(t.titulo.toLowerCase()))
        || null;
}

function completeTask(idOuTitulo) {
    const alvo = findTask(idOuTitulo);
    if (!alvo) return null;
    const d = load();
    const t = d.tasks.find(x => x.id === alvo.id);
    t.concluida = true;
    t.concluidaEm = new Date().toISOString();
    save(d);
    return t;
}

function updateTask(idOuTitulo, campos) {
    const alvo = findTask(idOuTitulo);
    if (!alvo) return null;
    const d = load();
    const t = d.tasks.find(x => x.id === alvo.id);
    Object.assign(t, campos);
    save(d);
    return t;
}

function removeTask(idOuTitulo) {
    const alvo = findTask(idOuTitulo);
    if (!alvo) return false;
    const d = load();
    d.tasks = d.tasks.filter(t => t.id !== alvo.id);
    save(d);
    return true;
}

// Remove tarefas concluídas há mais de 30 dias.
function cleanupTasks() {
    const d = load();
    const limite = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const antes = d.tasks.length;
    d.tasks = d.tasks.filter(t => !t.concluida || !t.concluidaEm || new Date(t.concluidaEm).getTime() > limite);
    if (d.tasks.length !== antes) save(d);
}

// ── Memória de longo prazo (fatos que a assistente sempre "sabe") ───────────────
function addMemory({ fato, categoria }) {
    const d = load();
    // Evita duplicar um fato idêntico já registrado.
    const jaExiste = d.memories.some(m => m.fato.trim().toLowerCase() === String(fato).trim().toLowerCase());
    if (jaExiste) return null;
    const memoria = {
        id: novoId('m'),
        fato: String(fato).trim(),
        categoria: categoria || 'geral',
        criadoEm: new Date().toISOString(),
    };
    d.memories.push(memoria);
    save(d);
    return memoria;
}

// Retorna as memórias mais recentes (limitadas), para injeção no contexto.
function getMemories(limite = 60) {
    const d = load();
    return d.memories
        .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))
        .slice(0, limite);
}

function removeMemory(id) {
    const d = load();
    const antes = d.memories.length;
    d.memories = d.memories.filter(m => m.id !== id);
    const removido = antes !== d.memories.length;
    if (removido) save(d);
    return removido;
}

// ── Finanças (a "planilha" de gastos e receitas) ─────────────────────────────
// Um lançamento por linha, com a data no formato YYYY-MM-DD ancorada em São
// Paulo — comparar strings nesse formato já ordena e filtra por período.
// Nada é apagado por limpeza automática: histórico financeiro é para durar.
function addExpense({ valor, descricao, categoria, tipo = 'gasto', data, pagamento = null }) {
    const d = load();
    const lancamento = {
        id: novoId('g'),
        valor: Number(valor),
        descricao: String(descricao || '').trim(),
        categoria: categoria || 'outros',
        tipo,                        // 'gasto' | 'receita'
        data,                        // YYYY-MM-DD do fato (não de quando foi digitado)
        pagamento,                   // 'pix', 'crédito', 'dinheiro'... quando o usuário disser
        criadoEm: new Date().toISOString(),
    };
    d.expenses.push(lancamento);
    save(d);
    return lancamento;
}

// Mais recentes primeiro; empate no dia decidido pela ordem de digitação.
function getExpenses({ de = null, ate = null, categoria = null, tipo = null } = {}) {
    return load().expenses
        .filter(l => (!de || l.data >= de) && (!ate || l.data <= ate))
        .filter(l => !categoria || l.categoria === categoria)
        .filter(l => !tipo || l.tipo === tipo)
        .sort((a, b) => b.data.localeCompare(a.data) || String(b.criadoEm).localeCompare(String(a.criadoEm)));
}

// Acha pelo id ou pelo texto da descrição — o usuário diz "apaga o almoço de
// ontem", não o id. Procura do lançamento mais recente para o mais antigo.
function findExpense(idOuDescricao) {
    const chave = String(idOuDescricao || '').trim().toLowerCase();
    if (!chave) return null;
    const todos = getExpenses();
    return todos.find(l => l.id === idOuDescricao)
        || todos.find(l => l.descricao.toLowerCase() === chave)
        || todos.find(l => l.descricao.toLowerCase().includes(chave))
        || null;
}

function updateExpense(idOuDescricao, campos) {
    const alvo = findExpense(idOuDescricao);
    if (!alvo) return null;
    const d = load();
    const l = d.expenses.find(x => x.id === alvo.id);
    Object.assign(l, campos);
    save(d);
    return l;
}

function removeExpense(idOuDescricao) {
    const alvo = findExpense(idOuDescricao);
    if (!alvo) return null;
    const d = load();
    d.expenses = d.expenses.filter(l => l.id !== alvo.id);
    save(d);
    return alvo;
}

// ── Histórico de conversa (continuidade entre reinícios) ─────────────────────
function getHistory(chatId) {
    const d = load();
    return d.histories[chatId] || [];
}

// Áudios/imagens chegam como base64 dentro do histórico. Eles já foram
// interpretados pelo modelo, mas se ficassem guardados seriam REENVIADOS a cada
// nova mensagem — centenas de KB por vez, queimando cota e deixando tudo lento.
// Trocamos o anexo por uma nota de texto, preservando o fio da conversa.
function trocarAnexosPorNota(parts) {
    return (parts || []).map(p => {
        if (!p.inlineData) return p;
        const tipo = String(p.inlineData.mimeType || '').split('/')[0];
        const rotulo = tipo === 'audio' ? 'áudio' : tipo === 'image' ? 'imagem' : 'arquivo';
        return { text: `[${rotulo} enviado pelo usuário nesta altura da conversa]` };
    });
}

// O Gemini rejeita um histórico que comece no meio de uma chamada de ferramenta
// (functionResponse sem o functionCall correspondente) ou que termine numa
// chamada sem resposta. Aqui aparamos as duas pontas.
function aparar(historico) {
    let h = historico.slice();

    const temFunctionResponse = e => (e.parts || []).some(p => p.functionResponse);
    const temFunctionCall = e => (e.parts || []).some(p => p.functionCall);

    // Início válido: fala do usuário que não seja resposta de ferramenta.
    while (h.length && (h[0].role !== 'user' || temFunctionResponse(h[0]))) h = h.slice(1);
    // Fim válido: não pode parar numa chamada de ferramenta pendente.
    while (h.length && temFunctionCall(h[h.length - 1])) h = h.slice(0, -1);

    return h;
}

// Deixa um histórico pronto para voltar ao Gemini: troca anexos por nota, corta
// nas últimas `max` entradas e apara as pontas para a sequência continuar válida.
// Vale tanto para o que vai ao disco quanto para o histórico que o SDK mantém em
// memória — este último vem cru e, num processo que fica meses no ar, cresceria
// sem limite carregando todo base64 já enviado.
function prepararHistorico(history, max = 30) {
    const limpo = (Array.isArray(history) ? history : []).map(e => ({
        ...e,
        parts: trocarAnexosPorNota(e.parts),
    }));
    return aparar(limpo.slice(-max));
}

function setHistory(chatId, history, max = 30) {
    const d = load();
    d.histories[chatId] = prepararHistorico(history, max);
    save(d);
}

function limparHistorico(chatId) {
    const d = load();
    delete d.histories[chatId];
    save(d);
}

module.exports = {
    getOwnerChatId,
    setOwnerChatId,
    addReminder,
    findReminderByEvent,
    getPendingEventReminders,
    updateReminder,
    silenceReminder,
    getDueReminders,
    getPendingReminders,
    markReminderFired,
    cancelReminder,
    cancelRemindersByTask,
    cleanupReminders,
    addNote,
    getNotes,
    addTask,
    getTasks,
    findTask,
    completeTask,
    updateTask,
    removeTask,
    cleanupTasks,
    addMemory,
    getMemories,
    removeMemory,
    addExpense,
    getExpenses,
    findExpense,
    updateExpense,
    removeExpense,
    getHistory,
    setHistory,
    prepararHistorico,
    limparHistorico,
};
