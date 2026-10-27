// ── Utilitários de fuso horário ──────────────────────────────────────────────
// O Gemini gera horários no formato YYYY-MM-DDTHH:MM(:SS) representando a hora
// de São Paulo. Este helper converte esse "horário de parede" para um instante
// absoluto (Date), independente do fuso onde o servidor estiver rodando.
// O Brasil não usa mais horário de verão desde 2019 → offset fixo UTC-03:00.

const OFFSET_SP = '-03:00';
const TZ = 'America/Sao_Paulo';

// Data de hoje (ou com deslocamento em dias) no fuso de São Paulo: YYYY-MM-DD.
function hojeISO(offsetDias = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDias);
    return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}

// "14:30" a partir de um instante/ISO.
function horaSP(instante) {
    return new Date(instante).toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', timeZone: TZ,
    });
}

// Distância em minutos → "daqui a 25 min" / "daqui a 1h30".
function emQuantoTempo(minutos) {
    if (minutos < 1) return 'agora';
    if (minutos < 60) return `daqui a ${minutos} min`;
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m === 0 ? `daqui a ${h}h` : `daqui a ${h}h${String(m).padStart(2, '0')}`;
}

function paraInstanteSP(str) {
    if (str instanceof Date) return str;
    const s = String(str).trim();

    // Já tem fuso explícito (Z ou ±HH:MM)? Usa como está.
    if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
        return new Date(s);
    }

    // Formato de data/hora sem fuso → ancora em São Paulo (UTC-03:00).
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
        const [, data, hh, mm, ss] = m;
        return new Date(`${data}T${hh}:${mm}:${ss || '00'}${OFFSET_SP}`);
    }

    // Só a data (YYYY-MM-DD) → meia-noite em São Paulo.
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return new Date(`${s}T00:00:00${OFFSET_SP}`);
    }

    // Fallback: deixa o Date tentar interpretar.
    return new Date(s);
}

// ── Texto para o Telegram ────────────────────────────────────────────────────
// O bot envia sem parse_mode (mais seguro: nenhum texto quebra o envio), então
// marcações de markdown apareceriam cruas. Aqui viram texto limpo.
function limparMarkdown(texto) {
    return String(texto || '')
        .replace(/```[a-z]*\n?/gi, '')          // cercas de bloco de código
        .replace(/\*\*(.+?)\*\*/gs, '$1')       // **negrito**
        .replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/gs, '$1') // *itálico*
        .replace(/(?<!\w)__(.+?)__(?!\w)/gs, '$1')
        .replace(/`([^`]+)`/g, '$1')            // `código`
        .replace(/^#{1,6}\s+/gm, '')            // ### títulos
        .replace(/^\s*[-*]\s+/gm, '• ')         // listas
        .replace(/\n{3,}/g, '\n\n')             // excesso de linhas em branco
        .trim();
}

// Telegram recusa mensagens acima de 4096 caracteres. Quebra preferindo
// parágrafos, depois linhas, e só corta no meio como último recurso.
function dividirMensagem(texto, limite = 4000) {
    const t = String(texto || '');
    if (t.length <= limite) return [t];

    const partes = [];
    let resto = t;
    while (resto.length > limite) {
        const janela = resto.slice(0, limite);
        let corte = janela.lastIndexOf('\n\n');
        if (corte < limite * 0.5) corte = janela.lastIndexOf('\n');
        if (corte < limite * 0.5) corte = janela.lastIndexOf(' ');
        if (corte < limite * 0.5) corte = limite;
        partes.push(resto.slice(0, corte).trim());
        resto = resto.slice(corte).trim();
    }
    if (resto) partes.push(resto);
    return partes;
}

module.exports = {
    paraInstanteSP, hojeISO, horaSP, emQuantoTempo,
    limparMarkdown, dividirMensagem,
    OFFSET_SP, TZ,
};
