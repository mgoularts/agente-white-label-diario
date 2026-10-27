// ── Google Calendar (Service Account) ────────────────────────────────────────
const { google } = require('googleapis');
const path = require('path');
const { paraInstanteSP } = require('./util');

// Credenciais: em servidor na nuvem raramente dá para subir arquivos, então
// aceitamos o mesmo JSON colado numa variável de ambiente. Localmente segue
// usando o credentials.json de sempre.
const ESCOPOS = ['https://www.googleapis.com/auth/calendar'];
const auth = process.env.GOOGLE_CREDENTIALS_JSON
    ? new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
        scopes: ESCOPOS,
    })
    : new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'credentials.json'),
        scopes: ESCOPOS,
    });
const calendar = google.calendar({ version: 'v3', auth });

// Busca os eventos entre dois instantes → array normalizado.
async function buscarJanela(timeMin, timeMax) {
    const res = await calendar.events.list({
        calendarId: process.env.EMAIL_AGENDA,
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
    });

    return (res.data.items || [])
        .filter(e => e.status !== 'cancelled')
        .map(e => ({
            id: e.id,
            titulo: e.summary || '(sem título)',
            inicio: e.start.dateTime || e.start.date,
            fim: e.end.dateTime || e.end.date,
            diaInteiro: !e.start.dateTime,
            local: e.location || null,
        }));
}

// Busca crua dos eventos de um dia → devolve um array (usado internamente e pelo agendador).
async function buscarEventos(dataBase) {
    // Limites do dia ancorados no fuso de São Paulo (dataBase = YYYY-MM-DD).
    const dia = String(dataBase).slice(0, 10);
    return buscarJanela(paraInstanteSP(`${dia}T00:00:00`), paraInstanteSP(`${dia}T23:59:59`));
}

// Versão "ferramenta" para o Gemini: mensagem amigável quando vazio.
async function listarCompromissos(dataBase) {
    const compromissos = await buscarEventos(dataBase);
    if (compromissos.length === 0) {
        return { mensagem: 'Nenhum compromisso encontrado para essa data.' };
    }
    return { compromissos };
}

async function criarCompromisso(titulo, dataInicio, dataFim) {
    const evento = {
        summary: titulo,
        start: { dateTime: paraInstanteSP(dataInicio).toISOString(), timeZone: 'America/Sao_Paulo' },
        end: { dateTime: paraInstanteSP(dataFim).toISOString(), timeZone: 'America/Sao_Paulo' },
    };

    const res = await calendar.events.insert({
        calendarId: process.env.EMAIL_AGENDA,
        resource: evento,
    });

    return {
        mensagem: 'Compromisso criado com sucesso!',
        id: res.data.id,
        titulo: res.data.summary,
        inicio: res.data.start.dateTime,
        fim: res.data.end.dateTime,
        link: res.data.htmlLink,
    };
}

// Busca os compromissos de um intervalo de dias (ex.: a semana toda).
async function listarPeriodo(dataInicio, dataFim) {
    const ini = String(dataInicio).slice(0, 10);
    const fim = String(dataFim || dataInicio).slice(0, 10);
    const eventos = await buscarJanela(
        paraInstanteSP(`${ini}T00:00:00`),
        paraInstanteSP(`${fim}T23:59:59`),
    );
    if (!eventos.length) return { mensagem: 'Nenhum compromisso encontrado nesse período.' };
    return { compromissos: eventos };
}

// Localiza um evento pelo título dentro de uma janela, para remarcar/cancelar
// sem o Márcio precisar saber o id técnico do Google.
async function acharEvento(titulo, dataBase = null) {
    const agora = new Date();
    const [timeMin, timeMax] = dataBase
        ? [paraInstanteSP(`${String(dataBase).slice(0, 10)}T00:00:00`), paraInstanteSP(`${String(dataBase).slice(0, 10)}T23:59:59`)]
        : [agora, new Date(agora.getTime() + 60 * 24 * 60 * 60 * 1000)];

    const eventos = await buscarJanela(timeMin, timeMax);
    const chave = String(titulo || '').trim().toLowerCase();
    if (!chave) return null;
    return eventos.find(e => e.titulo.toLowerCase() === chave)
        || eventos.find(e => e.titulo.toLowerCase().includes(chave))
        || eventos.find(e => chave.includes(e.titulo.toLowerCase()))
        || null;
}

async function atualizarCompromisso(eventoId, { titulo, dataInicio, dataFim }) {
    const corpo = {};
    if (titulo) corpo.summary = titulo;
    if (dataInicio) corpo.start = { dateTime: paraInstanteSP(dataInicio).toISOString(), timeZone: 'America/Sao_Paulo' };
    if (dataFim) corpo.end = { dateTime: paraInstanteSP(dataFim).toISOString(), timeZone: 'America/Sao_Paulo' };

    const res = await calendar.events.patch({
        calendarId: process.env.EMAIL_AGENDA,
        eventId: eventoId,
        resource: corpo,
    });

    return {
        id: res.data.id,
        titulo: res.data.summary,
        inicio: res.data.start.dateTime || res.data.start.date,
        fim: res.data.end.dateTime || res.data.end.date,
    };
}

async function excluirCompromisso(eventoId) {
    await calendar.events.delete({
        calendarId: process.env.EMAIL_AGENDA,
        eventId: eventoId,
    });
    return true;
}

// Formata a agenda de um dia em texto legível (para as mensagens proativas).
function formatarAgenda(compromissos) {
    if (!compromissos || compromissos.length === 0) {
        return 'Nenhum compromisso na agenda.';
    }
    return compromissos.map(c => {
        if (c.diaInteiro) return `• ${c.titulo} (dia inteiro)`;
        const hora = new Date(c.inicio).toLocaleTimeString('pt-BR', {
            hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
        });
        return `• ${hora} — ${c.titulo}`;
    }).join('\n');
}

module.exports = {
    buscarJanela,
    buscarEventos,
    listarCompromissos,
    listarPeriodo,
    acharEvento,
    criarCompromisso,
    atualizarCompromisso,
    excluirCompromisso,
    formatarAgenda,
};
