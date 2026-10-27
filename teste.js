// Bateria de testes. Roda contra uma CÓPIA do data.json, numa pasta temporária,
// e usa o Google Calendar de verdade só no fim (criando e apagando um evento).
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolamento: os dados reais nunca são escritos. Isso vale principalmente no
// servidor, onde o data.json vive em DATA_DIR e o agente está NO AR enquanto o
// teste roda — mexer no arquivo dela atropelaria o que ela estivesse gravando.
const DATA_REAL = path.join(process.env.DATA_DIR || __dirname, 'data.json');
const ANTES = fs.existsSync(DATA_REAL) ? fs.readFileSync(DATA_REAL, 'utf8') : null;

const DIR_TESTE = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-teste-'));
if (ANTES !== null) fs.writeFileSync(path.join(DIR_TESTE, 'data.json'), ANTES, 'utf8');
process.env.DATA_DIR = DIR_TESTE;   // storage.js lê isso ao ser carregado, logo abaixo.

const limparPastaDeTeste = () => {
    try { fs.rmSync(DIR_TESTE, { recursive: true, force: true }); } catch (_) { /* tudo bem */ }
};

const storage = require('./storage');
const avisos = require('./avisos');
const util = require('./util');
const { tratarComando } = require('./comandos');
const { toolDeclarations, availableFunctions } = require('./tools');

let falhas = 0;
const ok = (nome, cond, extra = '') => {
    console.log(`${cond ? '✅' : '❌'} ${nome}${extra ? ` — ${extra}` : ''}`);
    if (!cond) falhas++;
};

// Instalação nova ainda não tem dono: na pasta de teste usamos um chat fictício
// (nenhuma mensagem é enviada ao Telegram durante os testes).
if (storage.getOwnerChatId() == null) storage.setOwnerChatId(1);
const ctx = { chatId: storage.getOwnerChatId() };
const daquiA = m => new Date(Date.now() + m * 60000).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T');

(async () => {
    console.log('\n━━━ 1. Ferramentas declaradas x implementadas ━━━');
    const nomes = toolDeclarations[0].functionDeclarations.map(d => d.name);
    ok(`${nomes.length} ferramentas declaradas`, nomes.length > 0, nomes.join(', '));
    ok('todas têm implementação', nomes.every(n => availableFunctions[n]), nomes.filter(n => !availableFunctions[n]).join(','));
    ok('nenhuma implementação órfã', Object.keys(availableFunctions).every(n => nomes.includes(n)));

    console.log('\n━━━ 2. Limpeza de histórico (o bug caro) ━━━');
    const audio = { role: 'user', parts: [{ text: 'ouve isso' }, { inlineData: { mimeType: 'audio/ogg', data: 'A'.repeat(50000) } }] };
    const hist = [audio, { role: 'model', parts: [{ text: 'ok' }] }];
    storage.setHistory('teste1', hist);
    const salvo = storage.getHistory('teste1');
    const temBase64 = JSON.stringify(salvo).includes('AAAA');
    ok('base64 removido do histórico', !temBase64, `${JSON.stringify(salvo).length} bytes`);
    ok('nota de contexto no lugar', /áudio enviado/.test(JSON.stringify(salvo)));

    // O histórico que o SDK mantém em memória passa pelo mesmo saneamento antes
    // de voltar ao Gemini — senão cada anexo já enviado seria reenviado sempre.
    const memoriaCrua = [...Array(50)].flatMap(() => hist);
    const preparado = storage.prepararHistorico(memoriaCrua);
    ok('histórico em memória: anexos trocados por nota',
        !JSON.stringify(preparado).includes('AAAA'), `${JSON.stringify(preparado).length} bytes`);
    ok('histórico em memória: cortado em 30 entradas', preparado.length <= 30, `${preparado.length} entradas`);

    console.log('\n━━━ 3. Corte seguro do histórico ━━━');
    // Começa com resposta de ferramenta órfã (Gemini rejeitaria) e termina com chamada pendente.
    storage.setHistory('teste2', [
        { role: 'user', parts: [{ functionResponse: { name: 'x', response: {} } }] },
        { role: 'user', parts: [{ text: 'oi' }] },
        { role: 'model', parts: [{ text: 'olá' }] },
        { role: 'model', parts: [{ functionCall: { name: 'y', args: {} } }] },
    ]);
    const h2 = storage.getHistory('teste2');
    const comecaBem = h2[0].role === 'user' && !h2[0].parts.some(p => p.functionResponse);
    const terminaBem = !h2[h2.length - 1].parts.some(p => p.functionCall);
    ok('descarta functionResponse órfã no início', comecaBem);
    ok('descarta functionCall pendente no fim', terminaBem);
    storage.limparHistorico('teste1'); storage.limparHistorico('teste2');

    console.log('\n━━━ 4. Tarefas ━━━');
    const criada = availableFunctions.criarTarefa({ titulo: 'Enviar proposta ao cliente Alfa', prazo: daquiA(90), prioridade: 'alta', projeto: 'Alfa' }, ctx);
    ok('tarefa criada', !!criada.tarefa, criada.tarefa && criada.tarefa.titulo);
    ok('prazo com hora vira aviso no Telegram', /cutucar/.test(criada.avisoTelegram || ''), criada.avisoTelegram);
    const avisoTarefa = storage.getPendingReminders().find(r => r.tipo === 'tarefa');
    ok('aviso 30 min antes do prazo', avisoTarefa && Math.round((new Date(avisoTarefa.eventoInicio) - new Date(avisoTarefa.quando)) / 60000) === 30);
    console.log('   texto:', JSON.stringify(avisos.textoLembrete(avisoTarefa)));

    availableFunctions.criarTarefa({ titulo: 'Revisar relatório mensal', prioridade: 'baixa' }, ctx);
    availableFunctions.criarTarefa({ titulo: 'Pagar hospedagem', prazo: daquiA(-2000) }, ctx); // atrasada
    const lista = availableFunctions.listarTarefas({});
    ok('lista ordena atrasada primeiro', lista.tarefas[0].ATRASADA === true, lista.tarefas.map(t => t.titulo).join(' | '));

    const concl = availableFunctions.concluirTarefa({ tarefa: 'proposta' }); // por parte do título
    ok('conclui buscando por trecho do título', /Alfa/.test(concl.mensagem || ''), concl.mensagem);
    ok('aviso da tarefa concluída foi cancelado', !storage.getPendingReminders().some(r => r.tipo === 'tarefa'));

    const upd = availableFunctions.atualizarTarefa({ tarefa: 'relatório', prioridade: 'alta', prazo: daquiA(200) }, ctx);
    ok('atualiza prioridade e prazo', upd.tarefa && upd.tarefa.prioridade === 'alta');
    ok('novo prazo gerou aviso', storage.getPendingReminders().some(r => r.tipo === 'tarefa'));

    console.log('\n━━━ 5. Comandos rápidos (sem IA) ━━━');
    for (const cmd of ['/ajuda', '/tarefas', '/lembretes', '/memoria', '/status', '/hoje', '/semana']) {
        const r = await tratarComando(cmd, { chatId: ctx.chatId, modelo: 'gemini-3.6-flash' });
        ok(`${cmd} responde`, typeof r === 'string' && r.length > 10, `${(r || '').split('\n')[0].slice(0, 60)}...`);
    }
    const nova = await tratarComando('/nova Fechar contrato com a Beta', { chatId: ctx.chatId });
    ok('/nova cria tarefa', /Fechar contrato/.test(nova));
    const feito = await tratarComando('/ok contrato', { chatId: ctx.chatId });
    ok('/ok conclui por trecho', /Conclu/.test(feito), feito.split('\n')[0]);
    ok('comando desconhecido cai para a IA', (await tratarComando('/qualquercoisa', {})) === null);
    ok('texto normal não é comando', (await tratarComando('oi assistente', {})) === null);

    console.log('\n━━━ 6. Telegram: markdown e mensagens longas ━━━');
    const sujo = '**Resumo** do dia\n\n- item `um`\n- item *dois*\n### Título\n```js\ncodigo\n```';
    const limpo = util.limparMarkdown(sujo);
    ok('remove markdown', !/[*`#]/.test(limpo), JSON.stringify(limpo));
    ok('vira bullet legível', limpo.includes('• item um'));
    const partes = util.dividirMensagem('a'.repeat(9000));
    ok('quebra em partes de até 4000', partes.length === 3 && partes.every(p => p.length <= 4000), `${partes.length} partes`);
    const texto = ('parágrafo com algumas palavras.\n\n').repeat(400);
    ok('quebra preferindo parágrafo', util.dividirMensagem(texto).every(p => p.length <= 4000));
    ok('texto curto não é quebrado', util.dividirMensagem('oi').length === 1);

    console.log('\n━━━ 7. Agenda: criar, remarcar, cancelar (Google real) ━━━');
    let evId;
    try {
        const c = await availableFunctions.criarCompromisso({ titulo: 'TESTE agente remarcar', dataInicio: daquiA(180), dataFim: daquiA(240) }, ctx);
        evId = c.id;
        ok('compromisso criado', !!c.id, c.avisoTelegram);
        ok('aviso do evento criado', !!storage.findReminderByEvent(c.id));

        const r = await availableFunctions.remarcarCompromisso({ titulo: 'TESTE agente remarcar', novoInicio: daquiA(300) }, ctx);
        ok('remarcado achando pelo título', !r.erro && /remarcado/i.test(r.mensagem || ''), `${r.de} → ${r.para}`);
        const avisoDepois = storage.findReminderByEvent(evId);
        const dif = Math.round((new Date(avisoDepois.eventoInicio) - new Date(avisoDepois.quando)) / 60000);
        ok('aviso acompanhou o novo horário', dif === 30 && !avisoDepois.disparado);

        const per = await availableFunctions.listarPeriodo({ dataInicio: util.hojeISO(), dataFim: util.hojeISO(2) });
        ok('listarPeriodo enxerga o evento', JSON.stringify(per).includes('TESTE agente remarcar'));

        const del = await availableFunctions.cancelarCompromisso({ titulo: 'TESTE agente remarcar' });
        ok('cancelado no Google', !del.erro && /cancelado/i.test(del.mensagem || ''));
        const sobrou = storage.getPendingEventReminders().some(l => l.eventoId === evId);
        ok('aviso retirado junto', !sobrou);
        evId = null;
    } catch (err) {
        ok('fluxo de agenda', false, err.message);
    } finally {
        if (evId) { try { await require('./calendar').excluirCompromisso(evId); } catch (_) { } }
    }

    console.log('\n━━━ 8. resumoDoDia com tarefas ━━━');
    const resumo = await availableFunctions.resumoDoDia({}, ctx);
    ok('resumo traz as 4 seções', ['compromissos', 'tarefasAtrasadas', 'tarefasDoDia', 'lembretes'].every(k => k in resumo));
    console.log('   ', JSON.stringify({ atrasadas: resumo.tarefasAtrasadas, hoje: resumo.tarefasDoDia }).slice(0, 200));

    console.log('\n━━━ 8b. Finanças ━━━');
    const financas = require('./financas');
    const hoje = util.hojeISO();
    const anoAtual = hoje.slice(0, 4);

    // Valores do jeito que as pessoas escrevem.
    ok('valor "R$ 1.250,90"', financas.normalizarValor('R$ 1.250,90') === 1250.9);
    ok('valor "45,90"', financas.normalizarValor('45,90') === 45.9);
    ok('valor "1250.5"', financas.normalizarValor('1250.5') === 1250.5);
    ok('valor "1.250" vira 1250 (padrão BR)', financas.normalizarValor('1.250') === 1250);
    ok('valor inválido vira NaN', Number.isNaN(financas.normalizarValor('abc')));

    // Períodos: dia, semana, mês, mês escolhido e ano escolhido.
    const pSemana = financas.resolverPeriodo({ periodo: 'semana' });
    ok('semana começa na segunda', new Date(`${pSemana.de}T12:00:00Z`).getUTCDay() === 1, pSemana.de);
    ok('semana tem 7 dias', financas.diasEntre(pSemana.de, pSemana.ate) === 7);
    const pMes = financas.resolverPeriodo({ periodo: 'mes' });
    ok('mês atual completo', pMes.de === `${hoje.slice(0, 7)}-01` && pMes.ate >= hoje, `${pMes.de} a ${pMes.ate}`);
    const pJulho = financas.resolverPeriodo({ de: '2026-07' });
    ok('mês escolhido "2026-07"', pJulho.de === '2026-07-01' && pJulho.ate === '2026-07-31');
    const pAno = financas.resolverPeriodo({ de: '2025' });
    ok('ano escolhido "2025"', pAno.de === '2025-01-01' && pAno.ate === '2025-12-31');
    const pIntervalo = financas.resolverPeriodo({ de: '2026-01', ate: '2026-03' });
    ok('meses escolhidos (jan a mar)', pIntervalo.de === '2026-01-01' && pIntervalo.ate === '2026-03-31');

    // Lançamentos e resumo.
    financas.registrar({ valor: '45,90', descricao: 'Almoço', data: hoje });
    financas.registrar({ valor: 'R$ 32', descricao: 'Uber para o cliente', data: hoje });
    financas.registrar({ valor: 1200, descricao: 'Aluguel', categoria: 'moradia', data: `${hoje.slice(0, 7)}-01` });
    financas.registrar({ valor: 3000, descricao: 'Cliente Alfa', tipo: 'receita', data: `${hoje.slice(0, 7)}-01` });
    financas.registrar({ valor: 99, descricao: 'Gasto do ano passado', data: `${Number(anoAtual) - 1}-06-15` });

    ok('categoria deduzida da descrição', financas.deduzirCategoria('Uber para o cliente') === 'transporte');

    const rHoje = financas.resumir({ periodo: 'hoje' });
    ok('resumo de hoje soma certo', rHoje._numeros.totalGastos === 77.9, rHoje.totalGastos);
    const rMes = financas.resumir({ periodo: 'mes' });
    ok('resumo do mês soma certo', rMes._numeros.totalGastos === 1277.9, rMes.totalGastos);
    ok('mês traz receita e saldo', rMes._numeros.totalReceitas === 3000 && rMes._numeros.saldo === 1722.1);
    ok('quebra por categoria ordenada', Array.isArray(rMes.porCategoria) && rMes.porCategoria[0].categoria === 'Moradia');
    const rAnoPassado = financas.resumir({ de: String(Number(anoAtual) - 1) });
    ok('ano escolhido isola o período', rAnoPassado._numeros.totalGastos === 99, rAnoPassado.totalGastos);
    const rCat = financas.resumir({ periodo: 'mes', categoria: 'transporte' });
    ok('filtro por categoria', rCat._numeros.totalGastos === 32, rCat.totalGastos);
    ok('agrupamento por dia', Array.isArray(financas.resumir({ periodo: 'semana', agruparPor: 'dia' }).evolucao));

    // Planilha CSV.
    const csv = financas.gerarCSV({ periodo: 'mes' });
    const conteudo = fs.readFileSync(csv.arquivo, 'utf8');
    ok('CSV gerado com todas as linhas', csv.quantidade === 4, `${csv.quantidade} lançamentos`);
    ok('CSV tem BOM (Excel pt-BR)', conteudo.charCodeAt(0) === 0xFEFF);
    ok('CSV usa ponto e vírgula e vírgula decimal', /Aluguel";-1200,00/.test(conteudo) || conteudo.includes(';-1200,00'));
    ok('CSV traz colunas de mês e ano', conteudo.split('\r\n')[0].endsWith('Mês;Ano'));
    fs.rmSync(path.dirname(csv.arquivo), { recursive: true, force: true });

    // Correção e remoção.
    const corrigido = storage.updateExpense('Almoço', { valor: 50 });
    ok('correção de lançamento', corrigido && corrigido.valor === 50);
    ok('remoção de lançamento', !!storage.removeExpense('Gasto do ano passado'));
    ok('lançamento some depois de removido', !storage.findExpense('Gasto do ano passado'));

    console.log('\n━━━ 8c. Comandos rápidos de finanças e ideias ━━━');
    const rGasto = await tratarComando('/gasto 89,90 mercado da semana', ctx);
    ok('/gasto registra', /89,90/.test(rGasto) && /Mercado/.test(rGasto), String(rGasto).split('\n')[0]);
    const rEntrada = await tratarComando('/entrada 500 adiantamento', ctx);
    ok('/entrada registra receita', /500,00/.test(rEntrada));
    const rGastos = await tratarComando('/gastos mes', ctx);
    ok('/gastos resume o mês', /Por categoria/.test(rGastos));
    const rGastosMes = await tratarComando('/gastos 2026-01', ctx);
    ok('/gastos aceita mês escolhido', /01\/01\/2026/.test(rGastosMes), String(rGastosMes).split('\n')[0]);
    const rPlanilha = await tratarComando('/planilha mes', ctx);
    ok('/planilha devolve arquivo', !!(rPlanilha && rPlanilha.arquivo && fs.existsSync(rPlanilha.arquivo)));
    if (rPlanilha && rPlanilha.arquivo) fs.rmSync(path.dirname(rPlanilha.arquivo), { recursive: true, force: true });
    const rIdeia = await tratarComando('/ideia cobrar setup à parte nos contratos', ctx);
    ok('/ideia guarda o insight', /Anotado/.test(rIdeia));
    ok('/notas lista o insight', /cobrar setup/.test(await tratarComando('/notas', ctx)));
    ok('/status mostra o gasto do mês', /Gastos do mês/.test(await tratarComando('/status', ctx)));

    console.log('\n━━━ 8d. Ferramentas financeiras pelo Gemini ━━━');
    const tRegistro = await availableFunctions.registrarGasto({ valor: '25,50', descricao: 'Café com fornecedor', categoria: 'alimentacao' }, ctx);
    ok('registrarGasto responde com acumulados', !!tRegistro.lancamento && !!tRegistro.totalDoDia && !!tRegistro.totalDoMes);
    ok('resumoFinanceiro responde', !!(await availableFunctions.resumoFinanceiro({ periodo: 'mes' }, ctx)).totalGastos);
    ok('listarGastos responde', Array.isArray((await availableFunctions.listarGastos({ periodo: 'mes' }, ctx)).lancamentos));
    const tPlanilha = await availableFunctions.exportarPlanilha({ periodo: 'mes' }, ctx);
    ok('exportarPlanilha sinaliza o arquivo', !!tPlanilha._arquivo && fs.existsSync(tPlanilha._arquivo));
    if (tPlanilha._arquivo) fs.rmSync(path.dirname(tPlanilha._arquivo), { recursive: true, force: true });
    ok('corrigirGasto acha pela descrição', !(await availableFunctions.corrigirGasto({ lancamento: 'Café com fornecedor', categoria: 'trabalho' }, ctx)).erro);
    ok('removerGasto acha pela descrição', !(await availableFunctions.removerGasto({ lancamento: 'Café com fornecedor' }, ctx)).erro);
    ok('resumo do dia inclui gastos', 'gastosDoDia' in (await availableFunctions.resumoDoDia({}, ctx)));

    console.log('\n━━━ 9. Backup ━━━');
    ok('backup criado', fs.existsSync(path.join(DIR_TESTE, 'data.backup.json')));

    console.log('\n━━━ 10. Isolamento dos dados reais ━━━');
    const depois = fs.existsSync(DATA_REAL) ? fs.readFileSync(DATA_REAL, 'utf8') : null;
    ok('data.json real não foi tocado', depois === ANTES,
        ANTES === null ? '(não existe ainda)' : `${JSON.parse(ANTES).memories.length} memória(s) preservada(s)`);
    limparPastaDeTeste();

    console.log(falhas === 0 ? '\n🎉 Tudo passou.' : `\n⚠️ ${falhas} falha(s).`);
    process.exit(falhas ? 1 : 0);
})().catch(err => {
    console.error('ERRO FATAL:', err);
    limparPastaDeTeste();
    process.exit(1);
});
