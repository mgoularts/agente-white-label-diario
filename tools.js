// ── Declaração das ferramentas (Function Calling) e suas implementações ──────
const calendar = require('./calendar');
const storage = require('./storage');
const financas = require('./financas');
const { agendarAvisoDeEvento, agendarAvisoDeTarefa, ANTECEDENCIA_MIN } = require('./avisos');
const { paraInstanteSP, hojeISO, horaSP } = require('./util');

function formatarQuando(iso) {
    return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
}

// ── Implementações das ferramentas de lembrete/registro ──────────────────────
function criarLembrete(mensagem, quando, chatId) {
    if (!chatId) return { erro: 'Não sei para qual conversa enviar o lembrete.' };
    // Normaliza para instante absoluto (âncora em São Paulo), independente do fuso do servidor.
    const instante = paraInstanteSP(quando);
    if (isNaN(instante.getTime())) return { erro: `Não entendi o horário "${quando}".` };
    const l = storage.addReminder({ mensagem, quando: instante.toISOString(), chatId });
    return {
        mensagem: 'Lembrete agendado!',
        lembrete: l.mensagem,
        quando: formatarQuando(l.quando),
    };
}

// Cria o evento no Google Calendar e já pendura o aviso no Telegram.
async function criarCompromisso({ titulo, dataInicio, dataFim }, chatId) {
    const res = await calendar.criarCompromisso(titulo, dataInicio, dataFim);
    const aviso = agendarAvisoDeEvento({ id: res.id, titulo: res.titulo, inicio: res.inicio }, chatId);
    // Se o compromisso está a menos de 30 min, o aviso sai quase junto — não
    // prometa "30 minutos antes" nesse caso.
    const emCimaDaHora = aviso && new Date(aviso.avisoEm) - Date.now() < 60 * 1000;

    return {
        ...res,
        inicio: formatarQuando(res.inicio),
        avisoTelegram: !aviso
            ? 'Não deu para agendar aviso prévio (esse horário já passou).'
            : emCimaDaHora
                ? 'Como é logo mais, já te aviso aqui no chat em instantes.'
                : `Vou te avisar aqui no chat ${aviso.antecedenciaMinutos} minutos antes.`,
    };
}

// ── Remarcar / cancelar compromissos ─────────────────────────────────────────
async function remarcarCompromisso({ titulo, dataBase, novoTitulo, novoInicio, novoFim }, chatId) {
    const ev = await calendar.acharEvento(titulo, dataBase);
    if (!ev) return { erro: `Não achei nenhum compromisso parecido com "${titulo}" na agenda.` };

    // Sem novo fim explícito, preserva a duração original do compromisso.
    let fim = novoFim;
    if (novoInicio && !novoFim) {
        const duracao = new Date(ev.fim) - new Date(ev.inicio);
        fim = new Date(paraInstanteSP(novoInicio).getTime() + duracao).toISOString();
    }

    const atualizado = await calendar.atualizarCompromisso(ev.id, {
        titulo: novoTitulo, dataInicio: novoInicio, dataFim: fim,
    });
    const aviso = agendarAvisoDeEvento(atualizado, chatId);

    return {
        mensagem: 'Compromisso remarcado!',
        titulo: atualizado.titulo,
        de: formatarQuando(ev.inicio),
        para: formatarQuando(atualizado.inicio),
        avisoTelegram: aviso && aviso.status !== 'silenciado'
            ? `O aviso aqui no chat acompanhou o novo horário.`
            : undefined,
    };
}

async function cancelarCompromisso({ titulo, dataBase }) {
    const ev = await calendar.acharEvento(titulo, dataBase);
    if (!ev) return { erro: `Não achei nenhum compromisso parecido com "${titulo}" na agenda.` };

    await calendar.excluirCompromisso(ev.id);
    const aviso = storage.findReminderByEvent(ev.id);
    if (aviso && !aviso.disparado) storage.cancelReminder(aviso.id);

    return {
        mensagem: 'Compromisso cancelado no Google Calendar e o aviso foi retirado.',
        titulo: ev.titulo,
        quandoEra: formatarQuando(ev.inicio),
    };
}

// ── Tarefas ──────────────────────────────────────────────────────────────────
function descreverTarefa(t) {
    const atrasada = t.prazo && !t.concluida && new Date(t.prazo) < new Date();
    return {
        id: t.id,
        titulo: t.titulo,
        prazo: t.prazo ? formatarQuando(t.prazo) : 'sem prazo',
        prioridade: t.prioridade,
        ...(t.projeto ? { projeto: t.projeto } : {}),
        ...(atrasada ? { ATRASADA: true } : {}),
        ...(t.concluida ? { concluida: true } : {}),
    };
}

function criarTarefa({ titulo, prazo, prioridade, projeto }, chatId) {
    const t = storage.addTask({
        titulo,
        prazo: prazo ? paraInstanteSP(prazo).toISOString() : null,
        prioridade: ['alta', 'media', 'baixa'].includes(prioridade) ? prioridade : 'media',
        projeto: projeto || null,
    });
    const aviso = agendarAvisoDeTarefa(t, chatId);
    return {
        mensagem: 'Tarefa criada!',
        tarefa: descreverTarefa(t),
        avisoTelegram: aviso ? `Vou te cutucar ${aviso.antecedenciaMinutos} min antes do prazo.` : undefined,
    };
}

function listarTarefas({ incluirConcluidas, ate } = {}) {
    const tarefas = storage.getTasks({
        incluirConcluidas: !!incluirConcluidas,
        ate: ate ? paraInstanteSP(ate).toISOString() : null,
    });
    if (!tarefas.length) return { mensagem: 'Nenhuma tarefa pendente. Tudo em dia! 🎉' };
    return { tarefas: tarefas.map(descreverTarefa) };
}

function concluirTarefa({ tarefa }) {
    const t = storage.completeTask(tarefa);
    if (!t) return { erro: `Não achei a tarefa "${tarefa}".` };
    storage.cancelRemindersByTask(t.id);
    const restantes = storage.getTasks().length;
    return { mensagem: `Tarefa "${t.titulo}" concluída!`, tarefasPendentes: restantes };
}

function atualizarTarefa({ tarefa, titulo, prazo, prioridade, projeto }, chatId) {
    const campos = {};
    if (titulo) campos.titulo = titulo;
    if (prazo !== undefined) campos.prazo = prazo ? paraInstanteSP(prazo).toISOString() : null;
    if (prioridade) campos.prioridade = prioridade;
    if (projeto !== undefined) campos.projeto = projeto;

    const t = storage.updateTask(tarefa, campos);
    if (!t) return { erro: `Não achei a tarefa "${tarefa}".` };
    if (campos.prazo !== undefined) {
        storage.cancelRemindersByTask(t.id);
        agendarAvisoDeTarefa(t, chatId);
    }
    return { mensagem: 'Tarefa atualizada!', tarefa: descreverTarefa(t) };
}

function removerTarefa({ tarefa }) {
    const alvo = storage.findTask(tarefa);
    if (!alvo) return { erro: `Não achei a tarefa "${tarefa}".` };
    storage.cancelRemindersByTask(alvo.id);
    storage.removeTask(alvo.id);
    return { mensagem: `Tarefa "${alvo.titulo}" removida.` };
}

// Panorama do dia num único lugar: agenda + tarefas + lembretes + anotações.
async function resumoDoDia(dataBase, chatId) {
    const dia = (dataBase && String(dataBase).slice(0, 10)) || hojeISO();

    let compromissos = [];
    let erroAgenda = null;
    try {
        const eventos = await calendar.buscarEventos(dia);
        compromissos = eventos.map(e => ({
            titulo: e.titulo,
            hora: e.diaInteiro ? 'dia inteiro' : horaSP(e.inicio),
            local: e.local || undefined,
        }));
    } catch (err) {
        erroAgenda = `Não consegui consultar o Google Calendar: ${err.message}`;
    }

    const noDia = iso => String(paraInstanteSP(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })) === dia;

    const lembretes = storage.getPendingReminders(chatId)
        .filter(l => l.tipo !== 'evento' && noDia(l.quando))
        .map(l => ({ id: l.id, mensagem: l.mensagem, quando: formatarQuando(l.quando) }));

    const anotacoes = storage.getNotes()
        .filter(n => noDia(n.criadoEm))
        .map(n => ({ conteudo: n.conteudo, categoria: n.categoria }));

    // Tarefas que pesam sobre o dia: atrasadas, com prazo até o fim do dia e as
    // sem prazo (que ficam de pano de fundo).
    const fimDoDia = paraInstanteSP(`${dia}T23:59:59`);
    const todas = storage.getTasks();
    const atrasadas = todas.filter(t => t.prazo && new Date(t.prazo) < paraInstanteSP(`${dia}T00:00:00`));
    const doDia = todas.filter(t => t.prazo && noDia(t.prazo));
    const semPrazo = todas.filter(t => !t.prazo);
    const gastos = financas.totalDoDia(dia);

    return {
        data: dia,
        compromissos: compromissos.length ? compromissos : 'Nenhum compromisso na agenda.',
        tarefasAtrasadas: atrasadas.length ? atrasadas.map(descreverTarefa) : 'Nenhuma tarefa atrasada.',
        tarefasDoDia: doDia.length ? doDia.map(descreverTarefa) : 'Nenhuma tarefa com prazo para hoje.',
        tarefasSemPrazo: semPrazo.length ? semPrazo.slice(0, 8).map(descreverTarefa) : 'Nenhuma.',
        lembretes: lembretes.length ? lembretes : 'Nenhum lembrete pendente para hoje.',
        anotacoes: anotacoes.length ? anotacoes : 'Nenhuma anotação registrada hoje.',
        gastosDoDia: gastos.quantidade
            ? { total: financas.formatarBRL(gastos.total), itens: gastos.itens }
            : 'Nenhum gasto lançado hoje.',
        ...(erroAgenda ? { avisoAgenda: erroAgenda } : {}),
        _dica: 'Responda em ordem: compromissos por horário, depois tarefas atrasadas (se houver), tarefas do dia e por fim uma sugestão curta de prioridade. Só cite os gastos do dia se houver algum lançado.',
        _fimDoDia: fimDoDia.toISOString(),
    };
}

function listarLembretes(chatId) {
    const pendentes = storage.getPendingReminders(chatId);
    if (pendentes.length === 0) return { mensagem: 'Você não tem lembretes pendentes.' };
    return {
        lembretes: pendentes.map(l => ({
            id: l.id,
            mensagem: l.mensagem,
            quando: formatarQuando(l.quando),
            tipo: l.tipo === 'evento' ? 'aviso automático de compromisso da agenda' : 'lembrete pedido pelo usuário',
            ...(l.eventoInicio ? { compromissoAs: formatarQuando(l.eventoInicio) } : {}),
        })),
    };
}

function cancelarLembrete(id, chatId) {
    const pendentes = storage.getPendingReminders(chatId);
    const alvo = pendentes.find(l => l.id === id);
    if (!alvo) return { erro: 'Não encontrei um lembrete com esse id.' };

    // Aviso de agenda: silencia em vez de apagar, senão a próxima sincronização
    // com o Google Calendar traria o aviso de volta.
    if (alvo.tipo === 'evento') {
        storage.silenceReminder(alvo.id);
        return { mensagem: 'Não vou mais te avisar sobre esse compromisso (ele continua no Google Agenda).' };
    }

    const ok = storage.cancelReminder(id, chatId);
    return ok
        ? { mensagem: 'Lembrete cancelado.' }
        : { erro: 'Não encontrei um lembrete com esse id.' };
}

function salvarRegistro(conteudo, categoria) {
    const n = storage.addNote({ conteudo, categoria });
    return { mensagem: 'Registro salvo!', categoria: n.categoria };
}

function salvarMemoria(fato, categoria) {
    const m = storage.addMemory({ fato, categoria });
    if (!m) return { mensagem: 'Isso eu já sabia — não precisei registrar de novo.' };
    return { mensagem: 'Guardado na memória de longo prazo.', fato: m.fato };
}

function listarMemorias() {
    const memorias = storage.getMemories();
    if (!memorias.length) return { mensagem: 'Minha memória de longo prazo ainda está vazia.' };
    return {
        memorias: memorias.map(m => ({ id: m.id, fato: m.fato, categoria: m.categoria })),
    };
}

function esquecerMemoria(id) {
    const ok = storage.removeMemory(id);
    return ok ? { mensagem: 'Esqueci isso, como pedido.' } : { erro: 'Não encontrei essa memória.' };
}

// ── Finanças ─────────────────────────────────────────────────────────────────
function registrarGasto(args) {
    const r = financas.registrar(args);
    if (r.erro) return r;
    const l = r.lancamento;
    // Devolve o acumulado do dia/mês junto: o usuário quase sempre quer saber
    // "e aí, como estou?" logo depois de lançar — evita uma segunda chamada.
    const doDia = financas.totalDoDia(l.data);
    const mes = financas.resumir({ de: l.data.slice(0, 7) });
    return {
        mensagem: l.tipo === 'receita' ? 'Receita registrada!' : 'Gasto registrado!',
        lancamento: financas.descrever(l),
        totalDoDia: financas.formatarBRL(doDia.total),
        totalDoMes: mes.totalGastos,
    };
}

function listarGastos(args = {}) {
    const { janela, lancamentos, mostrados } = financas.listar(args);
    if (!lancamentos.length) {
        return { mensagem: `Nenhum lançamento registrado em ${janela.rotulo}.` };
    }
    return {
        periodo: janela.rotulo,
        total: lancamentos.length,
        ...(mostrados.length < lancamentos.length ? { mostrando: `os ${mostrados.length} mais recentes` } : {}),
        lancamentos: mostrados.map(financas.descrever),
    };
}

function resumoFinanceiro(args = {}) {
    const r = financas.resumir(args);
    delete r._numeros;
    return {
        ...r,
        _dica: 'Responda em texto puro: total do período, top 3 categorias com valor e fatia, a evolução (se ajudar) e uma observação curta e útil — algo que mudou, um exagero, ou onde dá para cortar.',
    };
}

// Gera o CSV e sinaliza ao index.js, via _arquivo, para enviá-lo no Telegram.
function exportarPlanilha(args = {}) {
    const r = financas.gerarCSV(args);
    if (!r.quantidade) {
        return { mensagem: `Não há lançamentos em ${r.janela.rotulo} para montar a planilha.` };
    }
    return {
        mensagem: 'Planilha gerada e enviada aqui no chat.',
        periodo: r.janela.rotulo,
        lancamentos: r.quantidade,
        totalGastos: financas.formatarBRL(r.totalGastos),
        _arquivo: r.arquivo,
        _legenda: `📊 ${r.quantidade} lançamento(s) — ${financas.dataBR(r.janela.de)} a ${financas.dataBR(r.janela.ate)}\nAbre direto no Excel e no Google Sheets.`,
    };
}

function corrigirGasto({ lancamento, valor, descricao, categoria, data, tipo, pagamento }) {
    const campos = {};
    if (valor !== undefined) {
        const v = financas.normalizarValor(valor);
        if (!Number.isFinite(v) || v <= 0) return { erro: `Não entendi o valor "${valor}".` };
        campos.valor = v;
    }
    if (descricao) campos.descricao = String(descricao).trim();
    if (categoria) campos.categoria = financas.normalizarCategoria(categoria);
    if (data) campos.data = String(data).slice(0, 10);
    if (tipo) campos.tipo = tipo === 'receita' ? 'receita' : 'gasto';
    if (pagamento !== undefined) campos.pagamento = pagamento || null;

    const l = storage.updateExpense(lancamento, campos);
    if (!l) return { erro: `Não achei o lançamento "${lancamento}".` };
    return { mensagem: 'Lançamento corrigido!', lancamento: financas.descrever(l) };
}

function removerGasto({ lancamento }) {
    const l = storage.removeExpense(lancamento);
    if (!l) return { erro: `Não achei o lançamento "${lancamento}".` };
    return { mensagem: `Lançamento removido: ${l.descricao} (${financas.formatarBRL(l.valor)}).` };
}

function listarRegistros(categoria) {
    const notas = storage.getNotes(categoria);
    if (notas.length === 0) {
        return { mensagem: categoria ? `Nenhum registro na categoria "${categoria}".` : 'Nenhum registro salvo ainda.' };
    }
    return {
        registros: notas.map(n => ({
            conteudo: n.conteudo,
            categoria: n.categoria,
            quando: formatarQuando(n.criadoEm),
        })),
    };
}

// ── Declarações para o Gemini ────────────────────────────────────────────────
const toolDeclarations = [
    {
        functionDeclarations: [
            {
                name: 'listarCompromissos',
                description: 'Lista os compromissos do Google Calendar para uma data específica.',
                parameters: {
                    type: 'object',
                    properties: {
                        dataBase: { type: 'string', description: 'A data para listar os compromissos, no formato YYYY-MM-DD.' },
                    },
                    required: ['dataBase'],
                },
            },
            {
                name: 'resumoDoDia',
                description: `Panorama consolidado de um dia: compromissos da agenda, lembretes pendentes e anotações. Use SEMPRE que o usuário pedir "resumo do dia", "o que tenho hoje", "como está meu dia", "o que tenho que fazer" ou algo equivalente — é uma única chamada, em vez de várias.`,
                parameters: {
                    type: 'object',
                    properties: {
                        dataBase: { type: 'string', description: 'Data no formato YYYY-MM-DD. Omita para hoje.' },
                    },
                },
            },
            {
                name: 'criarCompromisso',
                description: `Cria um novo compromisso no Google Calendar. O aviso no Telegram ${ANTECEDENCIA_MIN} minutos antes é criado automaticamente junto — NÃO chame criarLembrete para isso.`,
                parameters: {
                    type: 'object',
                    properties: {
                        titulo: { type: 'string', description: 'O título do compromisso.' },
                        dataInicio: { type: 'string', description: 'Data e hora de início, no formato YYYY-MM-DDTHH:MM:SS.' },
                        dataFim: { type: 'string', description: 'Data e hora de fim, no formato YYYY-MM-DDTHH:MM:SS.' },
                    },
                    required: ['titulo', 'dataInicio', 'dataFim'],
                },
            },
            {
                name: 'listarPeriodo',
                description: 'Lista os compromissos de um intervalo de datas. Use para "minha semana", "próximos dias", "de segunda a sexta" — é uma chamada só, em vez de várias por dia.',
                parameters: {
                    type: 'object',
                    properties: {
                        dataInicio: { type: 'string', description: 'Primeiro dia do intervalo, YYYY-MM-DD.' },
                        dataFim: { type: 'string', description: 'Último dia do intervalo, YYYY-MM-DD.' },
                    },
                    required: ['dataInicio', 'dataFim'],
                },
            },
            {
                name: 'remarcarCompromisso',
                description: 'Remarca (muda horário e/ou título) um compromisso existente no Google Calendar, achando-o pelo título. O aviso no Telegram acompanha o novo horário automaticamente.',
                parameters: {
                    type: 'object',
                    properties: {
                        titulo: { type: 'string', description: 'Título (ou parte dele) do compromisso a remarcar.' },
                        dataBase: { type: 'string', description: 'Dia atual do compromisso, YYYY-MM-DD, se o usuário disser. Omita para procurar nos próximos 60 dias.' },
                        novoInicio: { type: 'string', description: 'Novo início, YYYY-MM-DDTHH:MM:SS.' },
                        novoFim: { type: 'string', description: 'Novo fim, YYYY-MM-DDTHH:MM:SS. Omita para manter a mesma duração.' },
                        novoTitulo: { type: 'string', description: 'Novo título, se for renomear.' },
                    },
                    required: ['titulo'],
                },
            },
            {
                name: 'cancelarCompromisso',
                description: 'Exclui um compromisso do Google Calendar, achando-o pelo título, e retira o aviso do Telegram.',
                parameters: {
                    type: 'object',
                    properties: {
                        titulo: { type: 'string', description: 'Título (ou parte dele) do compromisso a cancelar.' },
                        dataBase: { type: 'string', description: 'Dia do compromisso, YYYY-MM-DD, se souber.' },
                    },
                    required: ['titulo'],
                },
            },
            {
                name: 'criarTarefa',
                description: 'Cria uma TAREFA (algo a fazer, com ou sem prazo). Use para "preciso fazer X", "não deixa eu esquecer de entregar Y", "adiciona na lista". Diferente de compromisso (que ocupa horário na agenda) e de lembrete (que é só um toque na hora marcada).',
                parameters: {
                    type: 'object',
                    properties: {
                        titulo: { type: 'string', description: 'O que precisa ser feito, começando por um verbo. Ex: "Enviar proposta para o cliente X".' },
                        prazo: { type: 'string', description: 'Prazo em YYYY-MM-DDTHH:MM:SS. Só a data (YYYY-MM-DD) se não houver hora definida. Omita se não tiver prazo.' },
                        prioridade: { type: 'string', description: '"alta", "media" ou "baixa". Padrão: media.' },
                        projeto: { type: 'string', description: 'Cliente ou projeto ao qual a tarefa pertence, se o usuário mencionar.' },
                    },
                    required: ['titulo'],
                },
            },
            {
                name: 'listarTarefas',
                description: 'Lista as tarefas pendentes, já ordenadas por urgência (atrasadas primeiro). Use para "o que eu tenho pra fazer", "minhas tarefas", "o que está pendente".',
                parameters: {
                    type: 'object',
                    properties: {
                        ate: { type: 'string', description: 'Só tarefas com prazo até esta data (YYYY-MM-DD). Opcional.' },
                        incluirConcluidas: { type: 'boolean', description: 'true para incluir as já concluídas. Padrão false.' },
                    },
                },
            },
            {
                name: 'concluirTarefa',
                description: 'Marca uma tarefa como concluída. Aceita o título (ou parte dele), não precisa do id. Use quando o usuário disser "terminei X", "já fiz Y", "pode dar baixa em Z".',
                parameters: {
                    type: 'object',
                    properties: {
                        tarefa: { type: 'string', description: 'Título (ou parte) da tarefa concluída, ou o id.' },
                    },
                    required: ['tarefa'],
                },
            },
            {
                name: 'atualizarTarefa',
                description: 'Muda prazo, prioridade, título ou projeto de uma tarefa existente. Use para "adia X para sexta", "isso virou urgente".',
                parameters: {
                    type: 'object',
                    properties: {
                        tarefa: { type: 'string', description: 'Título (ou parte) da tarefa a alterar, ou o id.' },
                        titulo: { type: 'string', description: 'Novo título.' },
                        prazo: { type: 'string', description: 'Novo prazo (YYYY-MM-DDTHH:MM:SS). String vazia remove o prazo.' },
                        prioridade: { type: 'string', description: '"alta", "media" ou "baixa".' },
                        projeto: { type: 'string', description: 'Novo projeto/cliente.' },
                    },
                    required: ['tarefa'],
                },
            },
            {
                name: 'removerTarefa',
                description: 'Apaga uma tarefa da lista (quando ela deixou de fazer sentido, e não porque foi concluída).',
                parameters: {
                    type: 'object',
                    properties: {
                        tarefa: { type: 'string', description: 'Título (ou parte) da tarefa, ou o id.' },
                    },
                    required: ['tarefa'],
                },
            },
            {
                name: 'criarLembrete',
                description: 'Agenda um lembrete avulso para ser ENVIADO ao usuário na hora certa. Use para pedidos como "me lembra de X daqui a 1 hora" ou "me lembra amanhã às 9h" que NÃO sejam compromissos de agenda — compromissos já ganham aviso automático via criarCompromisso.',
                parameters: {
                    type: 'object',
                    properties: {
                        mensagem: { type: 'string', description: 'O texto do lembrete, do ponto de vista de quem vai receber. Ex: "Ligar para o cliente".' },
                        quando: { type: 'string', description: 'Data e hora absolutas em que o lembrete deve ser enviado, no formato YYYY-MM-DDTHH:MM:SS (calculado a partir da hora atual).' },
                    },
                    required: ['mensagem', 'quando'],
                },
            },
            {
                name: 'listarLembretes',
                description: 'Lista os lembretes pendentes (ainda não enviados) do usuário.',
                parameters: { type: 'object', properties: {} },
            },
            {
                name: 'cancelarLembrete',
                description: 'Cancela um lembrete pendente pelo seu id (obtido através de listarLembretes). Se for o aviso automático de um compromisso, apenas silencia o aviso — o evento continua no Google Calendar.',
                parameters: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'O id do lembrete a cancelar.' },
                    },
                    required: ['id'],
                },
            },
            {
                name: 'salvarMemoria',
                description: 'Guarda um fato importante na MEMÓRIA DE LONGO PRAZO (projetos, clientes, metas, decisões, preferências, pessoas, contexto de trabalho do usuário). Use proativamente quando o usuário revelar algo digno de ser lembrado no futuro.',
                parameters: {
                    type: 'object',
                    properties: {
                        fato: { type: 'string', description: 'Resumo objetivo e curto do fato a memorizar. Ex: "Está lançando um novo produto no próximo trimestre".' },
                        categoria: { type: 'string', description: 'Categoria opcional (ex: "projetos", "clientes", "preferencias", "pessoal").' },
                    },
                    required: ['fato'],
                },
            },
            {
                name: 'listarMemorias',
                description: 'Lista tudo o que está guardado na memória de longo prazo sobre o usuário.',
                parameters: { type: 'object', properties: {} },
            },
            {
                name: 'esquecerMemoria',
                description: 'Remove um fato da memória de longo prazo pelo seu id (obtido via listarMemorias).',
                parameters: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'O id da memória a esquecer.' },
                    },
                    required: ['id'],
                },
            },
            {
                name: 'salvarRegistro',
                description: 'Salva uma anotação, ideia ou informação que o usuário queira registrar para consultar depois.',
                parameters: {
                    type: 'object',
                    properties: {
                        conteudo: { type: 'string', description: 'O conteúdo a registrar.' },
                        categoria: { type: 'string', description: 'Categoria opcional para organizar (ex: "ideias", "clientes", "pessoal").' },
                    },
                    required: ['conteudo'],
                },
            },
            {
                name: 'listarRegistros',
                description: 'Lista os registros/anotações salvos, opcionalmente filtrando por categoria.',
                parameters: {
                    type: 'object',
                    properties: {
                        categoria: { type: 'string', description: 'Categoria para filtrar (opcional).' },
                    },
                },
            },
            {
                name: 'registrarGasto',
                description: 'Registra um GASTO ou uma RECEITA na planilha financeira do usuário. Use sempre que o usuário disser quanto gastou/recebeu ("gastei 45 no almoço", "paguei 1200 de aluguel", "cliente pagou 3 mil", "almoço 32,90"). Se mandar foto/print de um comprovante ou nota, extraia valor, data e descrição e registre. Vários itens de uma vez = várias chamadas, uma por item.',
                parameters: {
                    type: 'object',
                    properties: {
                        valor: { type: 'string', description: 'Valor em reais. Aceita "45,90", "R$ 1.250,00" ou "1250.5". Sempre positivo — quem define entrada/saída é o campo tipo.' },
                        descricao: { type: 'string', description: 'O que foi, em poucas palavras. Ex: "Almoço no shopping", "Aluguel do escritório".' },
                        categoria: { type: 'string', description: 'Categoria: alimentacao, mercado, transporte, moradia, saude, assinaturas, lazer, educacao, trabalho, impostos, pessoal ou outra que faça sentido. Deduza pelo contexto; não pergunte.' },
                        data: { type: 'string', description: 'Dia do gasto em YYYY-MM-DD. Omita para hoje. Use a data que o usuário disser ("ontem", "dia 3") já convertida.' },
                        tipo: { type: 'string', description: '"gasto" (padrão) ou "receita" quando for dinheiro que entrou.' },
                        pagamento: { type: 'string', description: 'Forma de pagamento, se o usuário mencionar: pix, débito, crédito, dinheiro, boleto.' },
                    },
                    required: ['valor'],
                },
            },
            {
                name: 'resumoFinanceiro',
                description: 'Resumo dos gastos por período, com total, quebra por categoria, evolução no tempo e maiores gastos. Use para "quanto gastei hoje/essa semana/esse mês/em julho/esse ano", "como estão meus gastos", "quanto foi de transporte em 2026".',
                parameters: {
                    type: 'object',
                    properties: {
                        periodo: { type: 'string', description: 'Atalho: "hoje", "ontem", "semana", "semana-passada", "mes", "mes-passado", "ano", "ano-passado", "ultimos-7-dias", "ultimos-30-dias", "ultimos-12-meses" ou "tudo". Padrão: mes.' },
                        de: { type: 'string', description: 'Início de um período específico. Aceita "2026" (ano inteiro), "2026-07" (mês inteiro) ou "2026-07-15". Use em vez de periodo quando o usuário escolher datas/meses/anos.' },
                        ate: { type: 'string', description: 'Fim do período, mesmos formatos de "de". Omita para um único dia/mês/ano.' },
                        categoria: { type: 'string', description: 'Filtrar só uma categoria (ex: "transporte"). Opcional.' },
                        agruparPor: { type: 'string', description: '"dia", "semana", "mes", "ano" ou "categoria". Omita para a assistente escolher pela largura do período.' },
                    },
                },
            },
            {
                name: 'listarGastos',
                description: 'Lista os lançamentos individuais de um período (a planilha em si, linha por linha). Use para "me mostra os gastos da semana", "o que eu lancei ontem", "todos os gastos de mercado em julho".',
                parameters: {
                    type: 'object',
                    properties: {
                        periodo: { type: 'string', description: 'Mesmos atalhos de resumoFinanceiro. Padrão: mes.' },
                        de: { type: 'string', description: 'Início: "2026", "2026-07" ou "2026-07-15".' },
                        ate: { type: 'string', description: 'Fim, mesmos formatos.' },
                        categoria: { type: 'string', description: 'Filtrar por categoria. Opcional.' },
                        tipo: { type: 'string', description: '"gasto" ou "receita" para filtrar. Omita para trazer os dois.' },
                        limite: { type: 'number', description: 'Máximo de linhas (padrão 40).' },
                    },
                },
            },
            {
                name: 'exportarPlanilha',
                description: 'Gera a planilha de gastos em CSV (abre no Excel e no Google Sheets) e ENVIA o arquivo aqui no chat. Use quando o usuário pedir "a planilha", "me manda em Excel", "exporta os gastos do mês", "quero a planilha do ano".',
                parameters: {
                    type: 'object',
                    properties: {
                        periodo: { type: 'string', description: 'Mesmos atalhos de resumoFinanceiro. Padrão: mes.' },
                        de: { type: 'string', description: 'Início: "2026", "2026-07" ou "2026-07-15".' },
                        ate: { type: 'string', description: 'Fim, mesmos formatos.' },
                        categoria: { type: 'string', description: 'Exportar só uma categoria. Opcional.' },
                    },
                },
            },
            {
                name: 'corrigirGasto',
                description: 'Corrige um lançamento já registrado (valor errado, categoria trocada, data errada). Ache pela descrição, não precisa do id.',
                parameters: {
                    type: 'object',
                    properties: {
                        lancamento: { type: 'string', description: 'Descrição (ou parte dela) do lançamento a corrigir, ou o id.' },
                        valor: { type: 'string', description: 'Novo valor.' },
                        descricao: { type: 'string', description: 'Nova descrição.' },
                        categoria: { type: 'string', description: 'Nova categoria.' },
                        data: { type: 'string', description: 'Nova data, YYYY-MM-DD.' },
                        tipo: { type: 'string', description: '"gasto" ou "receita".' },
                        pagamento: { type: 'string', description: 'Nova forma de pagamento.' },
                    },
                    required: ['lancamento'],
                },
            },
            {
                name: 'removerGasto',
                description: 'Apaga um lançamento da planilha (registro duplicado ou feito por engano).',
                parameters: {
                    type: 'object',
                    properties: {
                        lancamento: { type: 'string', description: 'Descrição (ou parte) do lançamento, ou o id.' },
                    },
                    required: ['lancamento'],
                },
            },
        ],
    },
];

// ── Mapa de execução. Recebem (args, ctx) — ctx.chatId identifica a conversa. ─
const availableFunctions = {
    listarCompromissos: (args) => calendar.listarCompromissos(args.dataBase),
    listarPeriodo: (args) => calendar.listarPeriodo(args.dataInicio, args.dataFim),
    criarCompromisso: (args, ctx) => criarCompromisso(args, ctx.chatId),
    remarcarCompromisso: (args, ctx) => remarcarCompromisso(args, ctx.chatId),
    cancelarCompromisso: (args) => cancelarCompromisso(args),
    resumoDoDia: (args, ctx) => resumoDoDia(args.dataBase, ctx.chatId),
    criarTarefa: (args, ctx) => criarTarefa(args, ctx.chatId),
    listarTarefas: (args) => listarTarefas(args),
    concluirTarefa: (args) => concluirTarefa(args),
    atualizarTarefa: (args, ctx) => atualizarTarefa(args, ctx.chatId),
    removerTarefa: (args) => removerTarefa(args),
    criarLembrete: (args, ctx) => criarLembrete(args.mensagem, args.quando, ctx.chatId),
    listarLembretes: (args, ctx) => listarLembretes(ctx.chatId),
    cancelarLembrete: (args, ctx) => cancelarLembrete(args.id, ctx.chatId),
    salvarRegistro: (args) => salvarRegistro(args.conteudo, args.categoria),
    listarRegistros: (args) => listarRegistros(args.categoria),
    salvarMemoria: (args) => salvarMemoria(args.fato, args.categoria),
    listarMemorias: () => listarMemorias(),
    esquecerMemoria: (args) => esquecerMemoria(args.id),
    registrarGasto: (args) => registrarGasto(args),
    listarGastos: (args) => listarGastos(args),
    resumoFinanceiro: (args) => resumoFinanceiro(args),
    exportarPlanilha: (args) => exportarPlanilha(args),
    corrigirGasto: (args) => corrigirGasto(args),
    removerGasto: (args) => removerGasto(args),
};

module.exports = { toolDeclarations, availableFunctions };
