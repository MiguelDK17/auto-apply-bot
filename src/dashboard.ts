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
  // O botão de tema existe mesmo sem o painel de controle.
  const semControle = controle?.ativo ? '' : `
  <script>
    (function () {
      const btn = document.getElementById('btnTema');
      const salvo = localStorage.getItem('jobbot-tema');
      if (salvo === 'light') document.documentElement.setAttribute('data-theme', 'light');
      if (btn) btn.addEventListener('click', () => {
        const claro = document.documentElement.getAttribute('data-theme') === 'light';
        if (claro) document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('jobbot-tema', claro ? 'dark' : 'light');
      });
    })();
  </script>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Job Bot - Dashboard</title>
<style>
  /* Paleta Solosis Psychic Teal */
  :root {
    --teal-principal: #25C6A2;   /* identidade, destaque, ações principais */
    --teal-escuro:    #15876D;   /* estados escuros e contraste */
    --mint-vibrante:  #44E3A8;   /* destaques luminosos e interativos */
    --mint-claro:     #82F4CD;   /* variações suaves e realces */
    --teal-profundo:  #156956;   /* tons escuros complementares */
    --branco-frio:    #FDFFFF;   /* superfícies claras e contraste neutro */

    --bg:        #061310;
    --surface:   #0C241F;
    --surface-2: #10302A;
    --border:    #17544A;
    --text:      var(--branco-frio);
    --text-mute: #9FC9BF;
    --text-dim:  #6E9A8E;
    --shadow:    0 1px 0 rgba(37, 198, 162, 0.12);
  }
  [data-theme="light"] {
    --bg:        var(--branco-frio);
    --surface:   #F2FBF8;
    --surface-2: #E4F6F0;
    --border:    #BFE7DC;
    --text:      #06231D;
    --text-mute: #3E6C61;
    --text-dim:  #6E9A8E;
    --shadow:    0 1px 2px rgba(21, 105, 86, 0.10);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  h1 { font-size: 24px; color: var(--text); display: flex; align-items: center; gap: 12px; }
  h1::before { content: ''; width: 10px; height: 26px; border-radius: 4px; background: linear-gradient(180deg, var(--mint-vibrante), var(--teal-principal) 55%, var(--teal-escuro)); box-shadow: 0 0 18px rgba(37, 198, 162, 0.45); }
  .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; min-width: 150px; box-shadow: var(--shadow); }
  .stat-value { font-size: 32px; font-weight: 700; color: var(--teal-principal); }
  .stat-label { font-size: 14px; color: var(--text-mute); margin-top: 4px; }
  .stat-sub { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  th { background: var(--surface-2); padding: 12px 16px; text-align: left; font-size: 13px; color: var(--mint-claro); text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 16px; border-top: 1px solid var(--border); font-size: 14px; }
  tr:hover { background: var(--surface-2); }
  a { color: var(--mint-vibrante); text-decoration: none; }
  a:hover { color: var(--mint-claro); text-decoration: underline; }
  .score { display: inline-block; width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 50%; font-size: 12px; font-weight: 700; }
  .score.high { background: rgba(37, 198, 162, 0.18); color: var(--mint-vibrante); }
  .score.mid { background: rgba(251, 191, 36, 0.16); color: #FBBF24; }
  .score.low { background: rgba(248, 113, 113, 0.16); color: #FCA5A5; }
  .status { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .status.aplicado { background: rgba(37, 198, 162, 0.18); color: var(--mint-vibrante); }
  .status.dry-run { background: rgba(130, 244, 205, 0.14); color: var(--mint-claro); }
  .empty { text-align: center; padding: 48px; color: var(--text-dim); }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; box-shadow: var(--shadow); }
  .btn { border: 0; border-radius: 10px; padding: 12px 22px; font-size: 15px; font-weight: 700; cursor: pointer; transition: filter .15s ease, transform .05s ease; }
  .btn.start { background: linear-gradient(180deg, var(--mint-vibrante), var(--teal-principal) 60%, var(--teal-escuro)); color: #04211C; }
  .btn.start:hover:not(:disabled) { filter: brightness(1.08); }
  .btn.stop { background: var(--teal-profundo); color: var(--mint-claro); border: 1px solid var(--teal-escuro); }
  .btn.stop:hover:not(:disabled) { filter: brightness(1.25); }
  .btn.ghost { background: transparent; color: var(--text-mute); border: 1px solid var(--border); padding: 9px 14px; font-size: 13px; }
  .btn.ghost:hover { color: var(--mint-vibrante); border-color: var(--teal-principal); }
  .btn:active:not(:disabled) { transform: translateY(1px); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .chip { padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 700; letter-spacing: .3px; }
  .chip.on { background: rgba(37, 198, 162, 0.18); color: var(--mint-vibrante); border: 1px solid var(--teal-principal); }
  .chip.off { background: var(--surface-2); color: var(--text-mute); border: 1px solid var(--border); }
  .log { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; max-height: 340px; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; color: var(--text-mute); margin-bottom: 24px; }
  .log .lv-info  { color: var(--text-dim); }
  .log .lv-agente{ color: var(--teal-principal); }
  .log .lv-tool  { color: var(--mint-vibrante); }
  .log .lv-warn  { color: #FBBF24; }
  .log .lv-erro  { color: #FCA5A5; }
  .label { font-size: 13px; color: var(--text-mute); display: inline-flex; align-items: center; gap: 6px; }
  .label input { accent-color: var(--teal-principal); }
</style>
</head>
<body>
  <header>
    <h1>Job Bot - Dashboard</h1>
    <button class="btn ghost" id="btnTema" title="Alternar tema">◐ Tema</button>
  </header>

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
${semControle}
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

    // Tema: começa salvo, senão escuro (padrão).
    const btnTema = document.getElementById('btnTema');
    const temaSalvo = localStorage.getItem('jobbot-tema');
    if (temaSalvo === 'light') document.documentElement.setAttribute('data-theme', 'light');
    if (btnTema) btnTema.addEventListener('click', () => {
      const atual = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const novo = atual === 'light' ? 'dark' : 'light';
      if (novo === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('jobbot-tema', novo);
    });

    // Escape obrigatório: o log carrega conteúdo de páginas de vagas
    // (não confiável) — nunca injetar HTML cru.
    function esc(t) {
      return String(t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function colorir(linha) {
      let cls = 'lv-info';
      if (/\\[ERRO\\]/.test(linha)) cls = 'lv-erro';
      else if (/\\[WARN\\]/.test(linha)) cls = 'lv-warn';
      else if (/\\[TOOL\\]/.test(linha)) cls = 'lv-tool';
      else if (/\\[AGENTE\\]/.test(linha)) cls = 'lv-agente';
      return '<span class="' + cls + '">' + esc(linha) + '</span>';
    }

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
          logBox.innerHTML = l.linhas.slice(-120).map(colorir).join('\\n');
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
