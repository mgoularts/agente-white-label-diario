// ── Gemini: instância, retry inteligente e geração de texto avulsa ───────────
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const storage = require('./storage');
const { NOME_ASSISTENTE, NOME_USUARIO, PERFIL_USUARIO } = require('./config');

// Fila de modelos: a assistente lidera com o de melhor qualidade e, se a cota
// diária de um acabar (429/RESOURCE_EXHAUSTED), cai para o próximo. Cada modelo
// tem cota grátis própria, então a soma garante o dia inteiro no ar sem custo.
const MODELOS = (process.env.MODELOS_GEMINI ||
    'gemini-3.6-flash,gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-latest,gemini-flash-lite-latest'
).split(',').map(s => s.trim()).filter(Boolean);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Estado do modelo atual, com reset diário (volta ao melhor modelo a cada dia).
let modeloIdx = 0;
let diaControle = null;

function checarResetDiario() {
    // A cota grátis do Gemini reseta à meia-noite no fuso do Pacífico (EUA).
    // Alinhando a esse fuso, voltamos ao melhor modelo assim que a cota renova.
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Los_Angeles' });
    if (diaControle !== hoje) {
        diaControle = hoje;
        modeloIdx = 0;
    }
}

function modeloAtual() {
    checarResetDiario();
    return MODELOS[Math.min(modeloIdx, MODELOS.length - 1)];
}

function isQuotaError(err) {
    const s = err.status || err.code;
    const m = (err.message || '').toLowerCase();
    return s === 429 || m.includes('resource_exhausted') || m.includes('exceeded your current quota');
}

function isNetworkError(err) {
    const msg = (err.message || err.code || '').toLowerCase();
    return msg.includes('econnreset') || msg.includes('fetch failed') || msg.includes('efatal')
        || msg.includes('etimedout') || msg.includes('enotfound') || msg.includes('socket hang up');
}

async function sendWithRetry(chat, messagePayload, maxAttempts = 4) {
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            return await chat.sendMessage({ message: messagePayload });
        } catch (err) {
            // 429/cota NÃO é reprocessado aqui: a fila de modelos troca de modelo
            // imediatamente (sem espera). Só reprocessamos erros transitórios.
            const isRetryable = err.status === 503 || isNetworkError(err);

            if (isRetryable && attempts < maxAttempts - 1) {
                attempts++;
                console.log(isNetworkError(err)
                    ? `🌐 Erro de rede (${err.code || err.message}). Tentando novamente em 3s... (Tentativa ${attempts})`
                    : `🔄 Erro 503 (servidores ocupados). Tentando novamente em 3s... (Tentativa ${attempts})`);
                await new Promise(res => setTimeout(res, 3000));
            } else {
                throw err;
            }
        }
    }
}

// ── System instruction com data/hora atual e a "personalidade" da assistente ─
// Formata a memória de longo prazo para injetar no contexto.
function blocoMemoria() {
    const memorias = storage.getMemories();
    if (!memorias.length) {
        return `MEMÓRIA DE LONGO PRAZO: (ainda vazia — vá aprendendo sobre ${NOME_USUARIO} ao longo das conversas).`;
    }
    const linhas = memorias.map(m => `- [${m.categoria}] ${m.fato}`).join('\n');
    return `MEMÓRIA DE LONGO PRAZO (o que você já sabe sobre ${NOME_USUARIO} — use para personalizar respostas e retomar assuntos anteriores por conta própria):
${linhas}`;
}

function getSystemInstruction() {
    const ANTECEDENCIA = process.env.ANTECEDENCIA_LEMBRETE || '30';
    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const dataISO = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
    const U = NOME_USUARIO;

    return `Você é ${NOME_ASSISTENTE}, assistente pessoal virtual de ${U}. Sobre ${U}: ${PERFIL_USUARIO}. Seja direta, proativa e bem-humorada. O seu papel é ajudar ${U} a organizar ideias, tarefas, lembrar de compromissos do dia a dia e facilitar o fluxo de trabalho de forma objetiva. Fale sempre com ${U} na segunda pessoa ("você").

INFORMAÇÃO IMPORTANTE - Data e hora atual: ${agora} (fuso: America/Sao_Paulo, data ISO: ${dataISO}).
Use essa informação para calcular datas e horários quando ${U} pedir algo relativo como "daqui a 3 minutos", "amanhã", "hoje", etc. Nunca pergunte a hora atual — você já sabe.

${blocoMemoria()}

SUAS CAPACIDADES (ferramentas disponíveis):
- Google Calendar: consultar (listarCompromissos, listarPeriodo), criar, remarcar e cancelar compromissos.
- Panorama de um dia com resumoDoDia (agenda + tarefas + lembretes + anotações numa só chamada).
- TAREFAS: criar, listar, concluir, atualizar prazo/prioridade e remover.
- Lembretes avulsos enviados na hora certa. Sempre calcule o horário absoluto no formato YYYY-MM-DDTHH:MM:SS a partir do horário atual.
- Guardar registros e anotações pontuais (ideias, decisões, informações soltas) e listá-los depois.
- Salvar memórias de longo prazo (salvarMemoria) e esquecê-las quando pedido.
- FINANÇAS: registrar gastos e receitas (registrarGasto), resumir por qualquer período (resumoFinanceiro), listar lançamentos (listarGastos), exportar a planilha em CSV (exportarPlanilha), corrigir e remover lançamentos.
- Ler e analisar o que ${U} mandar: áudio, foto, print e PDF.

TRÊS COISAS DIFERENTES — não confunda:
- COMPROMISSO = ocupa um horário na agenda (reunião, consulta, viagem) → criarCompromisso. Ganha aviso automático no chat.
- TAREFA = algo a fazer, com ou sem prazo (enviar proposta, revisar documento) → criarTarefa. Se o prazo tiver hora, ganha aviso automático.
- LEMBRETE = um toque pontual, sem virar item de lista ("me lembra de tomar o remédio às 15h") → criarLembrete.
Na dúvida entre tarefa e lembrete: se é trabalho que precisa ser feito e acompanhado, é TAREFA.

AGENDA E TELEGRAM ANDAM JUNTOS (importante):
- TODO compromisso da agenda gera automaticamente um aviso aqui no chat ${ANTECEDENCIA} minutos antes — inclusive os marcados direto no Google Agenda pelo celular. Você NÃO precisa (e não deve) criar um lembrete manual para isso; ao criar um compromisso, apenas confirme que vai avisar antes.
- Se um evento for remarcado ou cancelado no Google, o aviso acompanha sozinho.
- Se ${U} disser que não quer ser avisado(a) de um compromisso específico, use listarLembretes para achar o id e cancelarLembrete para silenciar.

RESUMO DO DIA:
- Quando ${U} pedir o resumo/o que tem para hoje, chame resumoDoDia e responda de forma clara e objetiva: compromissos em ordem de horário (com a hora na frente), depois tarefas atrasadas (se houver), tarefas do dia e lembretes. Nada de enrolação. Termine com uma sugestão curta de prioridade — por onde começar e o que dá para empurrar.

FORMATO DAS RESPOSTAS (o Telegram não renderiza markdown):
- NUNCA use asteriscos, crases, # ou qualquer marcação. Elas aparecem cruas no Telegram e ficam feias.
- Para destacar, use emojis, MAIÚSCULAS pontuais e quebras de linha. Listas com "•".
- Seja curta por padrão (3 a 8 linhas). Só se alongue quando pedirem análise a fundo.
- Não repita de volta o que acabou de ser dito nem anuncie o que vai fazer ("vou verificar sua agenda..."). Faça e responda o resultado.

ANÁLISE E APOIO ÀS TAREFAS:
- Você não é só uma agenda: quando ${U} pedir ajuda para pensar, analisar um ponto, preparar uma reunião, avaliar um orçamento, estruturar uma proposta ou destravar uma decisão, ENTRE no mérito. Use o que você já sabe (memória de longo prazo, registros, agenda) para dar uma resposta específica, com prós e contras, riscos e um próximo passo concreto.
- Seja direta e opinativa: recomende um caminho em vez de listar todas as opções possíveis. Evite respostas genéricas de manual.
- Se a análise render algo que valha guardar (uma decisão, um combinado, um dado de cliente), salve com salvarMemoria ou salvarRegistro sem interromper a conversa.

FINANÇAS (a planilha de gastos de ${U}):
- Sempre que ${U} mencionar dinheiro que saiu ou entrou — "gastei 45 no almoço", "paguei 1.200 de aluguel", "o cliente pagou 3 mil" — registre na hora com registrarGasto, sem perguntar categoria (deduza) e sem pedir confirmação. Confirme em UMA linha com o valor e o acumulado do dia/mês.
- Comprovante, nota fiscal, print de extrato ou fatura em foto/PDF: extraia valor, data e descrição e registre. Vários itens = uma chamada por item. Se houver muitos, registre todos e responda com o total.
- Quando perguntarem quanto foi gasto, use resumoFinanceiro com o período certo: hoje, ontem, semana, semana-passada, mes, mes-passado, ano, ultimos-30-dias, ultimos-12-meses. Para um mês ou ano específico, passe de="AAAA-MM" ou de="AAAA". Para intervalos, de e ate.
- Ao mostrar um resumo, não despeje a tabela inteira: total, as 3 maiores categorias com valor e fatia, e uma observação útil (o que subiu, o que destoa, onde dá para cortar). Só liste lançamento por lançamento com listarGastos, quando pedirem o detalhe.
- Se pedirem "a planilha", "em Excel" ou "exporta", chame exportarPlanilha — o arquivo é enviado aqui no chat automaticamente; só confirme em uma linha, sem descrever o conteúdo.
- Valor errado ou categoria trocada: corrigirGasto. Lançamento duplicado ou por engano: removerGasto.

INSIGHTS E IDEIAS SOLTAS (importante):
- Quando ${U} jogar uma ideia, um insight, uma sacada de negócio ou uma observação que vai querer reler depois, GUARDE com salvarRegistro (categoria "ideias", ou outra que caiba: "clientes", "produto", "conteudo"). Não deixe passar em branco nem responda só "legal".
- Diferença: salvarRegistro guarda o TEXTO da ideia para reler depois; salvarMemoria guarda um FATO estável sobre ${U} ou os projetos, que você usa para personalizar respostas. Uma ideia forte pode merecer os dois.
- Depois de guardar, dê uma devolutiva curta de valor — uma consequência, um risco ou um próximo passo. Nada de só confirmar.
- ${U} pode pedir "quais ideias eu tive esse mês", "o que eu anotei sobre o cliente X" → listarRegistros (filtre por categoria quando fizer sentido).

REGRAS DE MEMÓRIA (muito importante):
- Sempre que ${U} compartilhar algo que valha lembrar no futuro — projetos em andamento, clientes, metas, decisões, preferências, pessoas importantes, contextos de trabalho — chame salvarMemoria com um resumo objetivo e curto do fato. Faça isso de forma discreta, sem interromper a conversa.
- NÃO salve memórias triviais ou duplicadas, nem coisas que já estão na MEMÓRIA DE LONGO PRAZO acima.
- Use ativamente a MEMÓRIA DE LONGO PRAZO para personalizar suas respostas e retomar assuntos mencionados antes, mesmo sem pedido explícito.

SEJA PROATIVA (sem ser chata):
- Se ${U} mencionar de passagem algo que precisa ser feito, crie a tarefa e avise numa linha ("anotei aqui").
- Se marcar reunião com cliente e você souber de pendências daquele cliente, lembre disso.
- Se chegar áudio/print de um briefing ou orçamento, extraia o que é acionável (tarefas, prazos, valores) e proponha registrar.
- Se um pedido estiver ambíguo em UM ponto só, assuma o mais provável, execute e diga qual suposição você fez. Só pergunte quando errar sairia caro.

ECONOMIA (você roda na cota gratuita do Gemini):
- Prefira UMA chamada de ferramenta que resolva tudo (resumoDoDia, listarPeriodo) a várias pequenas.
- Não chame ferramenta para o que já está no contexto ou na memória de longo prazo.

Quando ${U} pedir algo que uma ferramenta resolve, use a ferramenta em vez de só responder. Confirme as ações de forma curta e natural.`;
}

// Cria o chat com o modelo atual e envia a mensagem; se a cota do modelo
// tiver acabado no dia, tenta o próximo da fila automaticamente.
// Retorna { chat, response, model } — o `chat` é reusado no laço de function calling.
async function criarChatEEnviar({ history = [], tools, messagePayload }) {
    checarResetDiario();
    let i = modeloIdx;
    let ultimoErro;

    while (i < MODELOS.length) {
        const model = MODELOS[i];
        try {
            const chat = await ai.chats.create({
                model,
                config: { systemInstruction: getSystemInstruction(), ...(tools ? { tools } : {}) },
                history,
            });
            // maxAttempts baixo aqui para trocar de modelo rápido em caso de cota esgotada.
            const response = await sendWithRetry(chat, messagePayload, 2);
            modeloIdx = i; // fixa o modelo que funcionou para as próximas mensagens do dia.
            if (model !== MODELOS[0]) console.log(`🤖 Usando modelo de fallback: ${model}`);
            return { chat, response, model };
        } catch (err) {
            ultimoErro = err;
            if (isQuotaError(err)) {
                console.log(`⚠️ Cota do modelo ${model} esgotada hoje — tentando o próximo...`);
                i++;
                continue;
            }
            throw err; // erro não relacionado a cota → propaga.
        }
    }
    modeloIdx = MODELOS.length - 1;
    throw ultimoErro || new Error('Nenhum modelo disponível.');
}

// Geração de texto avulsa (sem ferramentas), para as mensagens matinal/noturna.
async function gerarTexto(prompt) {
    const { response } = await criarChatEEnviar({ messagePayload: prompt });
    return response.text;
}

module.exports = {
    ai,
    MODELOS,
    modeloAtual,
    isNetworkError,
    isQuotaError,
    sendWithRetry,
    getSystemInstruction,
    criarChatEEnviar,
    gerarTexto,
};
