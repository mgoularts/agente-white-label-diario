require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api').default;
const https = require('https');
const fs = require('fs');
const path = require('path');

const { isNetworkError, sendWithRetry, criarChatEEnviar, modeloAtual } = require('./ai');
const { toolDeclarations, availableFunctions } = require('./tools');
const { tratarComando } = require('./comandos');
const storage = require('./storage');
const { startScheduler } = require('./scheduler');
const { limparMarkdown, dividirMensagem } = require('./util');
const { NOME_ASSISTENTE, NOME_USUARIO } = require('./config');

// ── Utilitário: download de arquivo (áudio do Telegram) com retry ────────────
function downloadFile(url, retries = 3) {
    return new Promise((resolve, reject) => {
        const attempt = (n) => {
            https.get(url, (res) => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks)));
                res.on('error', (err) => {
                    if (n > 1) {
                        console.log(`Download falhou, tentando novamente... (${retries - n + 1})`);
                        setTimeout(() => attempt(n - 1), 1000);
                    } else reject(err);
                });
            }).on('error', (err) => {
                if (n > 1) {
                    console.log(`Conexão falhou, tentando novamente... (${retries - n + 1})`);
                    setTimeout(() => attempt(n - 1), 1000);
                } else reject(err);
            });
        };
        attempt(retries);
    });
}

// ── Obtém um anexo do Telegram em base64, resiliente a quedas de rede ────────
// O passo getFileLink usa fetch e pode cair com ECONNRESET/"fetch failed" em
// soluços de rede; aqui repetimos algumas vezes antes de desistir.
async function obterAnexoBase64(fileId, tentativas = 3) {
    let ultimoErro;
    for (let i = 1; i <= tentativas; i++) {
        try {
            const fileLink = await bot.getFileLink(fileId);
            const buffer = await downloadFile(fileLink);
            return buffer.toString('base64');
        } catch (err) {
            ultimoErro = err;
            const m = (err.message || '').toLowerCase();
            // Arquivo acima do teto de 20 MB do Telegram → não adianta repetir.
            if (m.includes('too big')) {
                throw Object.assign(new Error('ARQUIVO_GRANDE'), { code: 'ARQUIVO_GRANDE' });
            }
            if (i < tentativas && isNetworkError(err)) {
                console.log(`🌐 Falha ao obter anexo (${err.code || err.message}); tentando novamente... (${i}/${tentativas})`);
                await new Promise(r => setTimeout(r, 1500));
                continue;
            }
            throw err;
        }
    }
    throw ultimoErro;
}

// Identifica o anexo da mensagem e o tipo MIME correspondente.
// Retorna null quando é uma mensagem só de texto.
const MIMES_ACEITOS = /^(image\/|audio\/|video\/|text\/|application\/pdf)/;

function identificarAnexo(msg) {
    if (msg.voice) return { fileId: msg.voice.file_id, mimeType: 'audio/ogg', rotulo: 'áudio' };
    if (msg.audio) return { fileId: msg.audio.file_id, mimeType: msg.audio.mime_type || 'audio/mpeg', rotulo: 'áudio' };
    if (msg.photo && msg.photo.length) {
        // O Telegram manda várias resoluções; a última é a maior.
        return { fileId: msg.photo[msg.photo.length - 1].file_id, mimeType: 'image/jpeg', rotulo: 'imagem' };
    }
    if (msg.document) {
        const mime = msg.document.mime_type || 'application/octet-stream';
        return { fileId: msg.document.file_id, mimeType: mime, rotulo: `arquivo (${msg.document.file_name || mime})`, nome: msg.document.file_name };
    }
    if (msg.video) return { fileId: msg.video.file_id, mimeType: msg.video.mime_type || 'video/mp4', rotulo: 'vídeo' };
    if (msg.video_note) return { fileId: msg.video_note.file_id, mimeType: 'video/mp4', rotulo: 'vídeo' };
    return null;
}

// ── Resumo de fallback quando a IA não consegue redigir a resposta final ─────
// (as ações já foram executadas; garante que o usuário receba a confirmação).
function resumirResultados(payload) {
    const linhas = payload.map(({ functionResponse: { name, response } }) => {
        if (response && response.erro) return `⚠️ ${response.erro}`;
        switch (name) {
            case 'criarLembrete':
                return `✅ Lembrete agendado: "${response.lembrete}" para ${response.quando}.`;
            case 'criarCompromisso':
                return `✅ Compromisso "${response.titulo}" criado para ${response.inicio}.`
                    + (response.avisoTelegram ? `\n⏰ ${response.avisoTelegram}` : '');
            case 'remarcarCompromisso':
                return `✅ "${response.titulo}" remarcado de ${response.de} para ${response.para}.`;
            case 'cancelarCompromisso':
                return `✅ "${response.titulo}" (${response.quandoEra}) foi cancelado.`;
            case 'criarTarefa':
                return `✅ Tarefa criada: ${response.tarefa.titulo} (prazo: ${response.tarefa.prazo}).`;
            case 'concluirTarefa':
                return `✅ ${response.mensagem}`;
            case 'salvarRegistro':
                return `✅ Registro salvo${response.categoria ? ` em "${response.categoria}"` : ''}.`;
            case 'cancelarLembrete':
                return `✅ ${response.mensagem || 'Lembrete cancelado.'}`;
            case 'salvarMemoria':
                return `🧠 ${response.mensagem || 'Guardado na memória.'}`;
            case 'registrarGasto':
                return `💰 ${response.lancamento.descricao}: ${response.lancamento.valor} (${response.lancamento.categoria})`
                    + `\nHoje: ${response.totalDoDia} • No mês: ${response.totalDoMes}`;
            case 'resumoFinanceiro': {
                const cats = Array.isArray(response.porCategoria)
                    ? response.porCategoria.slice(0, 5).map(c => `• ${c.categoria}: ${c.total} (${c.fatia})`).join('\n')
                    : response.porCategoria;
                return `💰 Gastos — ${response.periodo}\nTotal: ${response.totalGastos}\n\n${cats}`;
            }
            case 'exportarPlanilha':
                return `📊 ${response.mensagem} (${response.lancamentos} lançamento(s), ${response.totalGastos})`;
            case 'resumoDoDia': {
                const bloco = (titulo, valor) => {
                    if (typeof valor === 'string') return `${titulo}\n${valor}`;
                    const itens = valor.map(i => i.hora
                        ? `• ${i.hora} — ${i.titulo}`
                        : `• ${i.quando ? `${i.quando} — ` : ''}${i.titulo || i.mensagem || i.conteudo}`);
                    return `${titulo}\n${itens.join('\n')}`;
                };
                return [
                    `📅 Resumo de ${response.data}`,
                    bloco('\nCompromissos:', response.compromissos),
                    bloco('\nTarefas de hoje:', response.tarefasDoDia),
                    bloco('\nAtrasadas:', response.tarefasAtrasadas),
                ].join('\n');
            }
            default:
                return (response && response.mensagem) || '✅ Feito!';
        }
    });
    return linhas.join('\n') || '✅ Feito!';
}

// ── Inicialização Bot + Gemini ──────────────────────────────────────────────
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const chats = {};

// ── Trava de dono ────────────────────────────────────────────────────────────
// O bot é pessoal: qualquer um que descubra o @ dele conseguiria conversar,
// ler a agenda/memórias do dono e torrar a cota gratuita do Gemini. Só o dono
// passa. OWNER_CHAT_ID no .env manda; sem ele, o primeiro chat vira o dono.
const OWNER_ENV = (process.env.OWNER_CHAT_ID || '').trim();
if (OWNER_ENV && storage.getOwnerChatId() !== Number(OWNER_ENV)) {
    storage.setOwnerChatId(Number(OWNER_ENV));
    console.log(`🔒 Dono fixado pelo .env: ${OWNER_ENV}`);
}

function ehDono(chatId) {
    const dono = storage.getOwnerChatId();
    if (dono == null) {          // primeiro contato de todos assume a titularidade.
        storage.setOwnerChatId(chatId);
        console.log(`🔒 Dono registrado: ${chatId} (fixe OWNER_CHAT_ID=${chatId} no .env)`);
        return true;
    }
    return Number(chatId) === Number(dono);
}

// ── Envio ao Telegram: limpa markdown, quebra em 4096 e tolera falhas ────────
async function responder(chatId, texto) {
    for (const parte of dividirMensagem(limparMarkdown(texto))) {
        if (!parte) continue;
        let tentativas = 0;
        while (tentativas < 3) {
            try {
                await bot.sendMessage(chatId, parte);
                break;
            } catch (err) {
                tentativas++;
                if (tentativas === 3) throw err;
                await new Promise(res => setTimeout(res, 1000));
            }
        }
    }
}

// Envia um arquivo gerado por ferramenta (hoje, a planilha CSV de gastos).
// O arquivo vive numa pasta temporária; some depois de entregue.
async function enviarArquivo(chatId, caminho, legenda) {
    const nome = path.basename(caminho);
    try {
        await bot.sendDocument(chatId, caminho, { caption: legenda || '' }, { filename: nome, contentType: 'text/csv' });
        return true;
    } catch (err) {
        console.error('⚠️ Falha ao enviar arquivo:', err.message);
        await responder(chatId, 'Gerei a planilha, mas o Telegram recusou o envio do arquivo. Tenta pedir de novo?').catch(() => { });
        return false;
    } finally {
        try { fs.rmSync(path.dirname(caminho), { recursive: true, force: true }); } catch (_) { /* tudo bem */ }
    }
}

// O "digitando..." do Telegram expira em ~5s; renova enquanto a IA pensa.
function manterDigitando(chatId) {
    const enviar = () => bot.sendChatAction(chatId, 'typing').catch(() => { });
    enviar();
    const timer = setInterval(enviar, 4000);
    return () => clearInterval(timer);
}

// ── Fila por conversa ────────────────────────────────────────────────────────
// Duas mensagens processadas ao mesmo tempo embaralhariam o histórico e as
// chamadas de ferramenta. Cada chat processa uma de cada vez, em ordem.
const filas = {};
function enfileirar(chatId, tarefa) {
    filas[chatId] = (filas[chatId] || Promise.resolve())
        .then(tarefa)
        .catch(err => console.error('Erro na fila do chat:', err));
    return filas[chatId];
}

// ── Processamento de uma mensagem ───────────────────────────────────────────
async function processarMensagem(msg) {
    const chatId = msg.chat.id;
    const anexo = identificarAnexo(msg);
    const texto = msg.text || msg.caption || '';

    // ── Comandos rápidos: respondidos sem gastar cota da IA ──
    if (!anexo && texto.startsWith('/')) {
        // Um comando devolve texto ou, quando produz um arquivo (/planilha),
        // um objeto { texto, arquivo, legenda }.
        const resposta = await tratarComando(texto, { chatId, modelo: modeloAtual() });
        if (resposta) {
            if (texto.trim().toLowerCase().startsWith('/limpar')) delete chats[chatId];
            if (typeof resposta === 'string') {
                await responder(chatId, resposta);
            } else {
                if (resposta.texto) await responder(chatId, resposta.texto);
                if (resposta.arquivo) await enviarArquivo(chatId, resposta.arquivo, resposta.legenda);
            }
            return;
        }
    }

    const pararDigitando = manterDigitando(chatId);
    try {
        // Continuidade: usa o histórico em memória ou, se o bot reiniciou, o salvo em disco.
        // O de memória vem cru do SDK (com os anexos em base64 e sem limite de
        // tamanho); passa pelo mesmo saneamento do disco antes de voltar ao Gemini,
        // senão um processo que fica meses no ar reenviaria cada áudio/foto já
        // mandado a cada nova mensagem, torrando a cota.
        const emMemoria = chats[chatId]?.history;
        const historico = emMemoria
            ? storage.prepararHistorico(emMemoria)
            : storage.getHistory(chatId);

        let messagePayload = texto || '';

        if (anexo) {
            if (!MIMES_ACEITOS.test(anexo.mimeType)) {
                await responder(chatId, `Não consigo ler esse tipo de arquivo (${anexo.mimeType}). Mando bem com imagem, PDF, texto e áudio!`);
                return;
            }
            try {
                const base64 = await obterAnexoBase64(anexo.fileId);
                messagePayload = [];
                // Sem legenda, uma dica de contexto ajuda a IA a saber o que fazer.
                messagePayload.push(texto || `(${NOME_USUARIO} enviou ${anexo.rotulo} sem legenda — interprete e responda de forma útil.)`);
                messagePayload.push({ inlineData: { mimeType: anexo.mimeType, data: base64 } });
            } catch (err) {
                console.error('Erro ao baixar anexo:', err.code || err.message);
                const aviso = err.code === 'ARQUIVO_GRANDE'
                    ? 'Esse arquivo passou do limite de 20 MB que o Telegram deixa eu baixar. Manda um menor! 🙏'
                    : 'Tive uma instabilidade de rede ao baixar seu arquivo. Pode mandar de novo? 📎';
                await responder(chatId, aviso);
                return;
            }
        }

        if (!texto && !anexo) return;

        // ── Cria o chat e envia ao Gemini, com fallback de modelo se a cota acabar ──
        const enviado = await criarChatEEnviar({
            history: historico,
            tools: toolDeclarations,
            messagePayload,
        });
        chats[chatId] = enviado.chat;
        let response = enviado.response;

        // ── Function Calling: laço que resolve todas as chamadas encadeadas ──
        const contexto = { chatId };
        let guarda = 0;
        while (response.functionCalls && response.functionCalls.length > 0 && guarda < 5) {
            guarda++;
            const functionResponsePayload = [];

            for (const call of response.functionCalls) {
                console.log(`📞 Function Call: ${call.name}(${JSON.stringify(call.args)})`);

                const fn = availableFunctions[call.name];
                let result;

                if (fn) {
                    try {
                        result = await fn(call.args || {}, contexto);
                        console.log(`✅ ${call.name} executado com sucesso`);
                    } catch (err) {
                        console.error(`❌ Erro ao executar ${call.name}:`, err.message);
                        result = { erro: `Erro ao executar a função: ${err.message}` };
                    }
                } else {
                    result = { erro: `Função "${call.name}" não encontrada.` };
                }

                // Ferramenta que gerou arquivo (planilha CSV): entrega já, e não
                // devolve o caminho ao Gemini — ele não tem o que fazer com isso.
                if (result && result._arquivo) {
                    await enviarArquivo(chatId, result._arquivo, result._legenda);
                    delete result._arquivo;
                    delete result._legenda;
                }

                functionResponsePayload.push({
                    functionResponse: { name: call.name, response: result },
                });
            }

            // Devolve os resultados para o Gemini gerar o próximo passo/resposta.
            // A ação já foi executada; se o Gemini não conseguir redigir a resposta
            // final (ex.: 429), confirmamos com um resumo simples em vez de mostrar erro.
            try {
                response = await sendWithRetry(chats[chatId], functionResponsePayload);
            } catch (err) {
                console.error('⚠️ Falha ao gerar resposta final pós-função, usando resumo:', err.message);
                await responder(chatId, resumirResultados(functionResponsePayload));
                try { storage.setHistory(chatId, chats[chatId].history); } catch (_) { /* ignora */ }
                return;
            }
        }

        // ── Envia resposta final ao Telegram ────────────────────────────────
        const respText = response.text;
        if (!respText) {
            console.warn('⚠️ Resposta do Gemini sem texto:', JSON.stringify(response).slice(0, 500));
            await responder(chatId, 'Recebi uma resposta vazia do Gemini. Tente de novo!');
            return;
        }

        await responder(chatId, respText);

        // Persiste o histórico para a conversa sobreviver a reinícios do bot.
        try {
            storage.setHistory(chatId, chats[chatId].history);
        } catch (err) {
            console.error('⚠️ Não consegui salvar o histórico:', err.message);
        }

    } catch (error) {
        console.error('Erro na API:', error);

        let userMsg = 'Ops, deu um erro aqui. Tenta de novo em instantes!';
        if (error.status === 429) {
            userMsg = '😴 Por hoje esgotei minha cota gratuita em todos os modelos. Ela reseta na madrugada — amanhã cedo já estou 100% de novo!\n\nEnquanto isso, os comandos rápidos continuam funcionando: /hoje, /tarefas, /semana.';
        } else if (error.status === 503) {
            userMsg = '🔧 Os servidores do Gemini estão sobrecarregados. Tenta de novo em alguns segundos!';
        } else if (error.status === 400) {
            // Histórico inconsistente costuma ser a causa; recomeçar destrava.
            console.warn('⚠️ Erro 400 — limpando o histórico deste chat para destravar.');
            delete chats[chatId];
            storage.limparHistorico(chatId);
            userMsg = 'Me embananei com o histórico da conversa e dei uma reiniciada nele. Pode repetir o que você pediu?';
        } else if (isNetworkError(error)) {
            userMsg = '🌐 Tive um problema de conexão com a internet. Tenta mandar de novo!';
        }

        await responder(chatId, userMsg).catch(console.error);
    } finally {
        pararDigitando();
    }
}

bot.on('message', (msg) => {
    const chatId = msg.chat.id;

    // Ignora mensagens sem conteúdo aproveitável (entrou no grupo, fixou msg...).
    if (!msg.text && !msg.caption && !identificarAnexo(msg)) return;

    if (!ehDono(chatId)) {
        console.warn(`🚫 Mensagem ignorada de chat não autorizado: ${chatId} (${msg.chat.username || msg.chat.title || 'sem nome'})`);
        bot.sendMessage(chatId, 'Oi! Eu sou uma assistente pessoal privada e só converso com o meu dono. 🙂').catch(() => { });
        return;
    }

    enfileirar(chatId, () => processarMensagem(msg));
});

bot.on('polling_error', (error) => {
    const msg = error.message || String(error);
    if (msg.includes('409')) {
        console.error('❌ Conflito 409: outra instância do agente já está rodando com este token. Encerre a duplicata.');
        return;
    }
    console.error('Erro de Polling (Telegram):', msg);
});

// ── Sobe o agendador (mensagens matinal/noturna + lembretes) ─────────────────
startScheduler(bot);

// Encerramento limpo: evita perder o que estava sendo gravado.
for (const sinal of ['SIGINT', 'SIGTERM']) {
    process.on(sinal, () => {
        console.log(`\n👋 Recebi ${sinal}, encerrando ${NOME_ASSISTENTE}...`);
        bot.stopPolling().catch(() => { }).finally(() => process.exit(0));
    });
}

process.on('unhandledRejection', (err) => {
    console.error('⚠️ Promessa rejeitada sem tratamento:', err && err.message ? err.message : err);
});

console.log(`🤖 ${NOME_ASSISTENTE} online e aguardando mensagens no Telegram!`);
console.log('📅 Google Calendar + ⏰ Lembretes + 📋 Tarefas + 🧠 Memória + 💰 Finanças ativos!');
