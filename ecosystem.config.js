// Configuração do pm2 para o Agente White Label Diário.
// Uso: pm2 start ecosystem.config.js
module.exports = {
    apps: [
        {
            name: 'agente-diario',
            script: 'index.js',
            // Caminho fixo do projeto, para o `pm2 resurrect` funcionar de qualquer lugar.
            cwd: __dirname,
            autorestart: true,        // reinicia sozinha se cair.
            // Servidor sem ninguém olhando: um teto baixo faria o agente desistir
            // de vez depois de uma queda de rede prolongada. O backoff progressivo
            // (5s, 10s, 20s... até 15s fixos) já evita o loop apertado de restart.
            max_restarts: 100,
            min_uptime: '30s',        // só conta como "estável" após 30s no ar.
            exp_backoff_restart_delay: 5000,
            max_memory_restart: '400M', // rede de segurança em VM pequena.
            watch: false,             // NÃO reinicia a cada alteração de arquivo.
            time: true,               // adiciona timestamp aos logs.
            merge_logs: true,
            env: {
                NODE_ENV: 'production',
            },
        }
    ],
};
