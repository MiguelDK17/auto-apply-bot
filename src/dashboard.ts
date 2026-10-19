import http from 'http';
import { listarCandidaturas, obterEstatisticas } from './database.js';
import { log } from './logger.js';

// Servidor único (singleton). No modo cron, executarFluxoPrincipal roda várias
// vezes; sem este controle, cada execução tentaria reabrir a mesma porta
// (EADDRINUSE) e derrubaria o processo.
let server: http.Server | null = null;

/** Escapa caracteres especiais de HTML para evitar XSS/quebra de layout. */
export function escaparHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Aceita a URL apenas se o esquema for http/https; caso contrário retorna '#'.
 *  Bloqueia vetores como javascript: vindos de páginas de vagas não confiáveis. */
export function sanitizarUrl(url: unknown): string {
  const s = String(url ?? '');
  return /^https?:\/\//i.test(s) ? escaparHtml(s) : '#';
}

/** Estado do painel de controle (opcional — só no modo control server). */
export interface ControleUI {
  ativo: boolean;
  rodando: boolean;
  dryRun: boolean;
}

export function gerarHTML(controle?: ControleUI): string {
  const stats = obterEstatisticas();
  const candidaturas = listarCandidaturas(100);

  // IMPORTANTE: empresa/titulo/url vêm das páginas de vagas (não confiáveis) via
  // LLM. Todo valor dinâmico é escapado para impedir XSS armazenado no dashboard.
  const linhasTabela = candidaturas.map(c => `
    <tr>
      <td>${escaparHtml(c.data_aplicacao)}</td>
      <td>${escaparHtml(c.plataforma)}</td>
      <td>${escaparHtml(c.empresa)}</td>
      <td>${escaparHtml(c.titulo_vaga)}</td>
      <td><span class="score ${c.score && c.score >= 7 ? 'high' : c.score && c.score >= 5 ? 'mid' : 'low'}">${c.score || '-'}</span></td>
      <td><span class="status ${escaparHtml(c.status)}">${escaparHtml(c.status)}</span></td>
      <td>${escaparHtml(c.resultado ?? 'aguardando')}</td>
      <td><a href="${sanitizarUrl(c.url)}" target="_blank" rel="noopener noreferrer">Ver</a></td>
    </tr>
  `).join('');

  const plataformasRows = stats.porPlataforma.map(p => `
    <div class="stat-card">
      <div class="stat-value">${p.total}</div>
      <div class="stat-label">${escaparHtml(p.plataforma)}</div>
      <div class="stat-sub">Score medio: ${p.score_medio ? p.score_medio.toFixed(1) : '-'}</div>
    </div>
  `).join('');

  // Funil de resultados (qualidade > quantidade). Denominador honesto = só as
  // candidaturas com desfecho conhecido; sem dados, mostra empty-state em vez
  // de exibir "0%" enganoso.
  const cont = (r: string) => stats.porResultado.find(x => x.resultado === r)?.total ?? 0;
  const comDesfecho = stats.porResultado
    .filter(x => x.resultado !== 'aguardando')
    .reduce((acc, x) => acc + x.total, 0);
  const entrevistas = cont('entrevista') + cont('oferta');
  const taxaResposta = comDesfecho > 0 ? Math.round(((comDesfecho - cont('sem_resposta')) / comDesfecho) * 100) : null;

  const funilHtml = comDesfecho > 0 ? `
    <div class="stat-card">
      <div class="stat-value">${taxaResposta}%</div>
      <div class="stat-label">Taxa de resposta</div>
      <div class="stat-sub">${comDesfecho} com desfecho conhecido</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${entrevistas}</div>
      <div class="stat-label">Entrevistas + ofertas</div>
    </div>` : `
    <div class="stat-card" style="min-width: 280px;">
      <div class="stat-label">Funil de resultados</div>
      <div class="stat-sub">Marque desfechos com "npm run resultado &lt;id&gt; &lt;resultado&gt;" para ativar as metricas de retorno.</div>
    </div>`;

  const painelControle = controle?.ativo ? gerarPainelControle(controle) : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Job Bot - Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 24px; color: #f8fafc; }
  .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .stat-card { background: #1e293b; border-radius: 12px; padding: 20px; min-width: 150px; }
  .stat-value { font-size: 32px; font-weight: 700; color: #38bdf8; }
  .stat-label { font-size: 14px; color: #94a3b8; margin-top: 4px; }
  .stat-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; }
  th { background: #334155; padding: 12px 16px; text-align: left; font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 16px; border-top: 1px solid #334155; font-size: 14px; }
  tr:hover { background: #334155; }
  a { color: #38bdf8; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .score { display: inline-block; width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 50%; font-size: 12px; font-weight: 700; }
  .score.high { background: #166534; color: #4ade80; }
  .score.mid { background: #854d0e; color: #fbbf24; }
  .score.low { background: #991b1b; color: #fca5a5; }
  .status { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .status.aplicado { background: #166534; color: #4ade80; }
  .status.dry-run { background: #1e40af; color: #93c5fd; }
  .empty { text-align: center; padding: 48px; color: #64748b; }
  .panel { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 24px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .btn { border: 0; border-radius: 10px; padding: 12px 22px; font-size: 15px; font-weight: 600; cursor: pointer; color: #0f172a; }
  .btn.start { background: #38bdf8; }
  .btn.stop { background: #f87171; color: #fff; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .chip { padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; }
  .chip.on { background: #166534; color: #4ade80; }
  .chip.off { background: #475569; color: #cbd5e1; }
  .log { background: #0b1220; border-radius: 12px; padding: 16px; max-height: 340px; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; color: #cbd5e1; }
  .label { font-size: 13px; color: #94a3b8; }
</style>
</head>
<body>
  <h1>Job Bot - Dashboard</h1>

  ${painelControle}

  <div class="stats">
    <div class="stat-card">
      <div class="stat-value">${stats.hoje.total}</div>
      <div class="stat-label">Hoje</div>
      <div class="stat-sub">Score medio: ${stats.hoje.score_medio ? stats.hoje.score_medio.toFixed(1) : '-'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.total}</div>
      <div class="stat-label">Total</div>
    </div>
    ${plataformasRows}
    ${funilHtml}
  </div>

  ${candidaturas.length > 0 ? `
  <table>
    <thead>
      <tr>
        <th>Data</th>
        <th>Plataforma</th>
        <th>Empresa</th>
        <th>Vaga</th>
        <th>Score</th>
        <th>Status</th>
        <th>Resultado</th>
        <th>Link</th>
      </tr>
    </thead>
    <tbody>
      ${linhasTabela}
    </tbody>
  </table>
  ` : '<div class="empty">Nenhuma candidatura registrada ainda.</div>'}

</body>
</html>`;
}

/** Painel de controle (botões de iniciar/parar + log ao vivo). */
function gerarPainelControle(controle: ControleUI): string {
  return `
  <div class="panel">
    <button class="btn start" id="btnStart">▶ Iniciar bot</button>
    <button class="btn stop" id="btnStop" disabled>⏹ Parar</button>
    <label class="label">
      <input type="checkbox" id="chkDryRun" ${controle.dryRun ? 'checked' : ''}> dry-run (simula, não envia)
    </label>
    <span class="chip ${controle.rodando ? 'on' : 'off'}" id="chipEstado">${controle.rodando ? 'RODANDO' : 'PARADO'}</span>
    <span class="label" id="infoCusto"></span>
  </div>
  <div class="log" id="logBox">carregando log…</div>
  <script>
    const chip = document.getElementById('chipEstado');
    const btnStart = document.getElementById('btnStart');
    const btnStop = document.getElementById('btnStop');
    const chkDry = document.getElementById('chkDryRun');
    const logBox = document.getElementById('logBox');
    const infoCusto = document.getElementById('infoCusto');
    let ultimoRodando = ${controle.rodando ? 'true' : 'false'};

    async function post(url, body) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      return r.json();
    }

    btnStart.addEventListener('click', async () => {
      btnStart.disabled = true;
      await post('/api/start', { dryRun: chkDry.checked });
      setTimeout(atualizar, 400);
    });
    btnStop.addEventListener('click', async () => {
      btnStop.disabled = true;
      await post('/api/stop', {});
      setTimeout(atualizar, 400);
    });

    async function atualizar() {
      try {
        const s = await (await fetch('/api/status')).json();
        chip.textContent = s.rodando ? 'RODANDO' : 'PARADO';
        chip.className = 'chip ' + (s.rodando ? 'on' : 'off');
        btnStart.disabled = s.rodando;
        btnStop.disabled = !s.rodando;
        if (s.ultimoCusto !== null && s.ultimoCusto !== undefined) {
          infoCusto.textContent = 'último custo: $' + s.ultimoCusto.toFixed(4);
        }
        // Terminou um run: recarrega a página para atualizar a tabela.
        if (ultimoRodando && !s.rodando) { location.reload(); return; }
        ultimoRodando = s.rodando;

        const l = await (await fetch('/api/logs')).json();
        if (l.linhas && l.linhas.length) {
          logBox.textContent = l.linhas.slice(-120).join('\\n');
          logBox.scrollTop = logBox.scrollHeight;
        }
      } catch (e) {
        logBox.textContent = 'erro ao consultar status: ' + e;
      }
    }
    atualizar();
    setInterval(atualizar, 2000);
  </script>`;
}

export function iniciarDashboard(port: number, host = '127.0.0.1'): void {
  // Idempotente: no modo cron não reabrimos o servidor a cada execução.
  if (server) return;

  const srv = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(gerarHTML());
  });

  // Não derrubar o processo se a porta estiver ocupada.
  srv.on('error', (err) => {
    log('ERRO', `Dashboard: falha na porta ${port} — ${err.message}`);
    server = null;
  });

  // Por padrão, bind só em localhost: não expõe o histórico de candidaturas
  // na rede. No Docker, DASHBOARD_HOST=0.0.0.0 permite o port-mapping
  // (1717→3000) — a exposição continua controlada pelo mapeamento de portas.
  srv.listen(port, host, () => {
    log('INFO', `Dashboard rodando em http://${host}:${port}`);
  });

  server = srv;
}

/** Encerra o servidor do dashboard (usado na execução única para o processo poder sair). */
export function pararDashboard(): void {
  if (server) {
    server.close();
    server = null;
  }
}
