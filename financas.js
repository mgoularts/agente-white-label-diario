// ── Finanças: valores, períodos, resumos e a planilha em CSV ────────────────
// A "planilha" do usuário é o próprio arquivo de registros: cada lançamento
// entra aqui pelo Telegram (texto, áudio ou foto do comprovante) e sai daqui
// como resumo por dia/semana/mês/ano ou como CSV para abrir no Excel/Sheets.
const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('./storage');
const { hojeISO } = require('./util');

// ── Valores ──────────────────────────────────────────────────────────────────
// O usuário escreve "R$ 1.250,90", "45,90", "1250.5" ou manda o número solto.
// Tudo vira um número em reais, com 2 casas.
function normalizarValor(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(Math.abs(v) * 100) / 100 : NaN;

    let s = String(v || '').trim().toLowerCase()
        .replace(/r\$/g, '')
        .replace(/reais?/g, '')
        .replace(/\s/g, '');
    if (!s) return NaN;

    const temVirgula = s.includes(',');
    const temPonto = s.includes('.');

    if (temVirgula && temPonto) {
        // O separador que vier por último é o decimal ("1.250,90" ou "1,250.90").
        s = s.lastIndexOf(',') > s.lastIndexOf('.')
            ? s.replace(/\./g, '').replace(',', '.')
            : s.replace(/,/g, '');
    } else if (temVirgula) {
        s = s.replace(',', '.');
    } else if (temPonto) {
        // "1.250" no Brasil é mil duzentos e cinquenta, não 1,25. Grupos de 3
        // dígitos depois do ponto → separador de milhar.
        const partes = s.split('.');
        if (partes.length > 2 || (partes[1] && partes[1].length === 3)) s = s.replace(/\./g, '');
    }

    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : NaN;
}

function formatarBRL(n) {
    return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Categorias ───────────────────────────────────────────────────────────────
// O usuário fala "almoço", "uber", "netflix" — tudo cai numa categoria canônica
// para o resumo não virar uma lista de 40 rótulos com um lançamento cada.
const SINONIMOS = {
    alimentacao: ['comida', 'almoço', 'almoco', 'jantar', 'lanche', 'café', 'cafe', 'restaurante', 'ifood', 'delivery', 'padaria', 'bar'],
    mercado: ['supermercado', 'feira', 'compras do mês', 'compras do mes', 'açougue', 'acougue', 'hortifruti'],
    transporte: ['uber', '99', 'táxi', 'taxi', 'gasolina', 'combustível', 'combustivel', 'ônibus', 'onibus', 'estacionamento', 'pedágio', 'pedagio', 'carro'],
    moradia: ['aluguel', 'luz', 'energia', 'água', 'agua', 'internet', 'condomínio', 'condominio', 'gás', 'gas', 'iptu', 'casa'],
    saude: ['saúde', 'farmácia', 'farmacia', 'remédio', 'remedio', 'médico', 'medico', 'dentista', 'academia', 'plano de saúde', 'plano de saude', 'exame'],
    assinaturas: ['assinatura', 'netflix', 'spotify', 'youtube premium', 'chatgpt', 'adobe', 'figma', 'hospedagem', 'domínio', 'dominio', 'saas', 'software'],
    lazer: ['diversão', 'diversao', 'cinema', 'viagem', 'passeio', 'jogos', 'games', 'streaming'],
    educacao: ['educação', 'educacao', 'curso', 'livro', 'faculdade', 'workshop'],
    trabalho: ['equipe', 'freelancer', 'freela', 'terceirizado', 'material de trabalho', 'ferramenta', 'escritório', 'escritorio'],
    impostos: ['imposto', 'das', 'simples nacional', 'inss', 'contador', 'contabilidade', 'taxa'],
    pessoal: ['roupa', 'vestuário', 'vestuario', 'cabeleireiro', 'barbeiro', 'presente'],
    receita: ['salário', 'salario', 'pagamento recebido', 'cliente pagou', 'entrada', 'honorário', 'honorario'],
};

const ROTULOS = {
    alimentacao: 'Alimentação', mercado: 'Mercado', transporte: 'Transporte',
    moradia: 'Moradia', saude: 'Saúde', assinaturas: 'Assinaturas', lazer: 'Lazer',
    educacao: 'Educação', trabalho: 'Trabalho', impostos: 'Impostos',
    pessoal: 'Pessoal', receita: 'Receita', outros: 'Outros',
};

function semAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function normalizarCategoria(cat) {
    const bruto = semAcento(cat);
    if (!bruto) return 'outros';
    if (ROTULOS[bruto]) return bruto;
    for (const [canonica, lista] of Object.entries(SINONIMOS)) {
        if (lista.some(s => semAcento(s) === bruto)) return canonica;
    }
    return bruto; // categoria própria do usuário: respeita como foi escrita.
}

// Sem categoria informada, tenta deduzir pelas palavras da descrição — é o que
// salva o lançamento rápido por comando (/gasto 32 uber pro centro).
function deduzirCategoria(descricao) {
    const palavras = semAcento(descricao).split(/[^a-z0-9]+/).filter(Boolean);
    if (!palavras.length) return 'outros';
    for (const [canonica, lista] of Object.entries(SINONIMOS)) {
        const alvos = [canonica, ...lista].map(semAcento);
        if (palavras.some(p => alvos.includes(p))) return canonica;
    }
    return 'outros';
}

function rotularCategoria(cat) {
    return ROTULOS[cat] || String(cat || 'outros').charAt(0).toUpperCase() + String(cat || 'outros').slice(1);
}

// ── Datas (trabalhamos com strings YYYY-MM-DD ancoradas em São Paulo) ────────
function paraDiaUTC(iso) {
    const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(a, (m || 1) - 1, d || 1));
}
const paraISO = dUTC => dUTC.toISOString().slice(0, 10);

function somarDias(iso, n) {
    const d = paraDiaUTC(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return paraISO(d);
}
function somarMeses(iso, n) {
    const d = paraDiaUTC(iso);
    d.setUTCMonth(d.getUTCMonth() + n);
    return paraISO(d);
}
// Semana começa na segunda (convenção brasileira).
function inicioSemana(iso) {
    const dw = paraDiaUTC(iso).getUTCDay();       // 0 = domingo
    return somarDias(iso, -((dw + 6) % 7));
}
const inicioMes = iso => `${String(iso).slice(0, 7)}-01`;
function fimMes(iso) {
    const [a, m] = String(iso).slice(0, 7).split('-').map(Number);
    return paraISO(new Date(Date.UTC(a, m, 0)));
}
function diasEntre(de, ate) {
    return Math.round((paraDiaUTC(ate) - paraDiaUTC(de)) / 86400000) + 1;
}
function dataBR(iso) {
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
}

// Aceita "2026", "2026-08" ou "2026-08-05" e devolve o primeiro/último dia.
function expandir(valor, fim = false) {
    const s = String(valor || '').trim();
    if (/^\d{4}$/.test(s)) return fim ? `${s}-12-31` : `${s}-01-01`;
    if (/^\d{4}-\d{2}$/.test(s)) return fim ? fimMes(`${s}-01`) : `${s}-01`;
    return s.slice(0, 10);
}

// Traduz "mês passado", "essa semana", "2026-03" etc. numa janela concreta.
function resolverPeriodo({ periodo, de, ate } = {}) {
    const hoje = hojeISO();

    if (de || ate) {
        const ini = expandir(de || ate, false);
        const fim = expandir(ate || de, true);
        return { de: ini, ate: fim, rotulo: ini === fim ? dataBR(ini) : `${dataBR(ini)} a ${dataBR(fim)}` };
    }

    const p = semAcento(periodo || 'mes').replace(/[\s_]+/g, '-');

    switch (p) {
        case 'hoje':
            return { de: hoje, ate: hoje, rotulo: 'hoje' };
        case 'ontem': {
            const o = somarDias(hoje, -1);
            return { de: o, ate: o, rotulo: 'ontem' };
        }
        case 'semana':
        case 'semana-atual':
        case 'essa-semana':
            return { de: inicioSemana(hoje), ate: somarDias(inicioSemana(hoje), 6), rotulo: 'esta semana' };
        case 'semana-passada': {
            const ini = somarDias(inicioSemana(hoje), -7);
            return { de: ini, ate: somarDias(ini, 6), rotulo: 'semana passada' };
        }
        case 'mes-passado': {
            const ref = somarMeses(inicioMes(hoje), -1);
            return { de: inicioMes(ref), ate: fimMes(ref), rotulo: 'mês passado' };
        }
        case 'ano':
        case 'ano-atual':
            return { de: `${hoje.slice(0, 4)}-01-01`, ate: `${hoje.slice(0, 4)}-12-31`, rotulo: `${hoje.slice(0, 4)}` };
        case 'ano-passado': {
            const a = Number(hoje.slice(0, 4)) - 1;
            return { de: `${a}-01-01`, ate: `${a}-12-31`, rotulo: `${a}` };
        }
        case 'ultimos-7-dias':
        case '7-dias':
            return { de: somarDias(hoje, -6), ate: hoje, rotulo: 'últimos 7 dias' };
        case 'ultimos-30-dias':
        case '30-dias':
            return { de: somarDias(hoje, -29), ate: hoje, rotulo: 'últimos 30 dias' };
        case 'ultimos-12-meses':
        case '12-meses':
            return { de: inicioMes(somarMeses(hoje, -11)), ate: fimMes(hoje), rotulo: 'últimos 12 meses' };
        case 'tudo':
        case 'sempre':
            return { de: '1970-01-01', ate: hoje, rotulo: 'todo o histórico' };
        case 'mes':
        case 'mes-atual':
        default:
            return { de: inicioMes(hoje), ate: fimMes(hoje), rotulo: 'este mês' };
    }
}

// ── Registro ─────────────────────────────────────────────────────────────────
function registrar({ valor, descricao, categoria, data, tipo, pagamento }) {
    const v = normalizarValor(valor);
    if (!Number.isFinite(v) || v <= 0) return { erro: `Não entendi o valor "${valor}".` };

    const t = semAcento(tipo) === 'receita' || semAcento(tipo) === 'entrada' ? 'receita' : 'gasto';
    const dia = data ? expandir(data, false) : hojeISO();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { erro: `Não entendi a data "${data}".` };

    const cat = categoria
        ? normalizarCategoria(categoria)
        : (t === 'receita' ? 'receita' : deduzirCategoria(descricao));
    const lancamento = storage.addExpense({
        valor: v,
        descricao: String(descricao || '').trim() || rotularCategoria(cat),
        categoria: cat,
        tipo: t,
        data: dia,
        pagamento: pagamento ? String(pagamento).trim() : null,
    });

    return { lancamento };
}

function descrever(l) {
    return {
        id: l.id,
        data: dataBR(l.data),
        tipo: l.tipo,
        valor: formatarBRL(l.valor),
        descricao: l.descricao,
        categoria: rotularCategoria(l.categoria),
        ...(l.pagamento ? { pagamento: l.pagamento } : {}),
    };
}

// ── Resumos ──────────────────────────────────────────────────────────────────
// Chave de agrupamento por granularidade: dia, semana, mês ou ano.
function chaveGrupo(dataISO, granularidade) {
    switch (granularidade) {
        case 'dia': return dataISO;
        case 'semana': return inicioSemana(dataISO);
        case 'ano': return dataISO.slice(0, 4);
        case 'mes':
        default: return dataISO.slice(0, 7);
    }
}

function rotularGrupo(chave, granularidade) {
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    switch (granularidade) {
        case 'dia': return dataBR(chave);
        case 'semana': return `semana de ${dataBR(chave)}`;
        case 'ano': return chave;
        case 'mes':
        default: {
            const [a, m] = chave.split('-');
            return `${MESES[Number(m) - 1]}/${a}`;
        }
    }
}

function resumir({ periodo, de, ate, categoria, agruparPor } = {}) {
    const janela = resolverPeriodo({ periodo, de, ate });
    const cat = categoria ? normalizarCategoria(categoria) : null;
    const lancamentos = storage.getExpenses({ de: janela.de, ate: janela.ate, categoria: cat });

    const gastos = lancamentos.filter(l => l.tipo === 'gasto');
    const receitas = lancamentos.filter(l => l.tipo === 'receita');
    const soma = arr => Math.round(arr.reduce((s, l) => s + l.valor, 0) * 100) / 100;
    const totalGastos = soma(gastos);
    const totalReceitas = soma(receitas);

    // Por categoria (só gastos — receita não compete por fatia do bolo).
    const porCat = {};
    for (const g of gastos) {
        const c = (porCat[g.categoria] = porCat[g.categoria] || { total: 0, quantidade: 0 });
        c.total = Math.round((c.total + g.valor) * 100) / 100;
        c.quantidade++;
    }
    const porCategoria = Object.entries(porCat)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([c, v]) => ({
            categoria: rotularCategoria(c),
            total: formatarBRL(v.total),
            fatia: totalGastos ? `${Math.round((v.total / totalGastos) * 100)}%` : '0%',
            lancamentos: v.quantidade,
        }));

    // Evolução no tempo. Sem granularidade explícita, escolhe pela largura da janela.
    const dias = diasEntre(janela.de, janela.ate);
    const granularidade = agruparPor && semAcento(agruparPor) !== 'categoria'
        ? semAcento(agruparPor)
        : (dias <= 14 ? 'dia' : dias <= 70 ? 'semana' : dias <= 400 ? 'mes' : 'ano');

    const porTempo = {};
    for (const l of lancamentos) {
        const k = chaveGrupo(l.data, granularidade);
        const g = (porTempo[k] = porTempo[k] || { gastos: 0, receitas: 0 });
        if (l.tipo === 'gasto') g.gastos = Math.round((g.gastos + l.valor) * 100) / 100;
        else g.receitas = Math.round((g.receitas + l.valor) * 100) / 100;
    }
    const evolucao = Object.entries(porTempo).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({
        periodo: rotularGrupo(k, granularidade),
        gastos: formatarBRL(v.gastos),
        ...(v.receitas ? { receitas: formatarBRL(v.receitas) } : {}),
    }));

    // Média diária considera só os dias já vividos dentro da janela.
    const hoje = hojeISO();
    const ateReal = janela.ate > hoje ? hoje : janela.ate;
    const diasCorridos = Math.max(1, diasEntre(janela.de > ateReal ? ateReal : janela.de, ateReal));

    return {
        periodo: janela.rotulo,
        de: dataBR(janela.de),
        ate: dataBR(janela.ate),
        ...(cat ? { filtroCategoria: rotularCategoria(cat) } : {}),
        totalGastos: formatarBRL(totalGastos),
        ...(totalReceitas ? { totalReceitas: formatarBRL(totalReceitas), saldo: formatarBRL(totalReceitas - totalGastos) } : {}),
        lancamentos: lancamentos.length,
        mediaDiaria: formatarBRL(totalGastos / diasCorridos),
        porCategoria: porCategoria.length ? porCategoria : 'Nenhum gasto registrado nesse período.',
        evolucao: evolucao.length ? evolucao : 'Sem movimentação no período.',
        maioresGastos: gastos.slice().sort((a, b) => b.valor - a.valor).slice(0, 5).map(descrever),
        _numeros: { totalGastos, totalReceitas, saldo: Math.round((totalReceitas - totalGastos) * 100) / 100 },
    };
}

function listar({ periodo, de, ate, categoria, tipo, limite } = {}) {
    const janela = resolverPeriodo({ periodo, de, ate });
    const lancamentos = storage.getExpenses({
        de: janela.de,
        ate: janela.ate,
        categoria: categoria ? normalizarCategoria(categoria) : null,
        tipo: tipo ? semAcento(tipo) : null,
    });
    const max = Math.min(Number(limite) || 40, 100);
    return { janela, lancamentos, mostrados: lancamentos.slice(0, max) };
}

// ── Planilha (CSV que abre direto no Excel e no Google Sheets) ───────────────
// Ponto e vírgula + vírgula decimal + BOM: é o que o Excel em português espera.
function gerarCSV({ periodo, de, ate, categoria } = {}) {
    const janela = resolverPeriodo({ periodo, de, ate });
    const cat = categoria ? normalizarCategoria(categoria) : null;
    const lancamentos = storage.getExpenses({ de: janela.de, ate: janela.ate, categoria: cat })
        .slice()
        .sort((a, b) => a.data.localeCompare(b.data) || a.criadoEm.localeCompare(b.criadoEm));

    const escapar = t => `"${String(t == null ? '' : t).replace(/"/g, '""')}"`;
    const numero = n => String(n.toFixed(2)).replace('.', ',');

    const linhas = [['Data', 'Tipo', 'Categoria', 'Descrição', 'Valor (R$)', 'Pagamento', 'Mês', 'Ano'].join(';')];
    for (const l of lancamentos) {
        linhas.push([
            dataBR(l.data),
            l.tipo === 'receita' ? 'Receita' : 'Gasto',
            rotularCategoria(l.categoria),
            escapar(l.descricao),
            numero(l.tipo === 'receita' ? l.valor : -l.valor),
            escapar(l.pagamento || ''),
            l.data.slice(0, 7),
            l.data.slice(0, 4),
        ].join(';'));
    }

    const totalGastos = lancamentos.filter(l => l.tipo === 'gasto').reduce((s, l) => s + l.valor, 0);
    const totalReceitas = lancamentos.filter(l => l.tipo === 'receita').reduce((s, l) => s + l.valor, 0);
    linhas.push('');
    linhas.push(['', '', '', 'TOTAL GASTOS', numero(totalGastos)].join(';'));
    if (totalReceitas) {
        linhas.push(['', '', '', 'TOTAL RECEITAS', numero(totalReceitas)].join(';'));
        linhas.push(['', '', '', 'SALDO', numero(totalReceitas - totalGastos)].join(';'));
    }

    const nome = `gastos_${janela.de}_a_${janela.ate}.csv`;
    const destino = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agente-csv-')), nome);
    fs.writeFileSync(destino, '﻿' + linhas.join('\r\n'), 'utf8');

    return {
        arquivo: destino,
        nome,
        janela,
        quantidade: lancamentos.length,
        totalGastos,
        totalReceitas,
    };
}

// Total gasto num dia — usado pelo resumo do dia e pela mensagem da noite.
function totalDoDia(dia = hojeISO()) {
    const lancamentos = storage.getExpenses({ de: dia, ate: dia });
    const gastos = lancamentos.filter(l => l.tipo === 'gasto');
    return {
        quantidade: gastos.length,
        total: Math.round(gastos.reduce((s, l) => s + l.valor, 0) * 100) / 100,
        itens: gastos.map(l => ({ descricao: l.descricao, valor: formatarBRL(l.valor), categoria: rotularCategoria(l.categoria) })),
    };
}

module.exports = {
    normalizarValor, formatarBRL, normalizarCategoria, deduzirCategoria, rotularCategoria,
    resolverPeriodo, dataBR, inicioSemana, inicioMes, fimMes, somarDias, somarMeses, diasEntre,
    registrar, descrever, resumir, listar, gerarCSV, totalDoDia,
};
