// ── Identidade do agente (o que torna o projeto "white label") ───────────────
// Tudo que é pessoal vem do .env: o nome da assistente, o nome de quem ela
// atende e uma descrição curta da rotina dessa pessoa. Nada disso fica no código.
require('dotenv').config();

const NOME_ASSISTENTE = (process.env.NOME_ASSISTENTE || 'Assistente').trim();
const NOME_USUARIO = (process.env.NOME_USUARIO || 'Usuário').trim();
const PERFIL_USUARIO = (process.env.PERFIL_USUARIO
    || 'uma pessoa que coordena vários projetos, compromissos e tarefas no dia a dia').trim();

module.exports = { NOME_ASSISTENTE, NOME_USUARIO, PERFIL_USUARIO };
