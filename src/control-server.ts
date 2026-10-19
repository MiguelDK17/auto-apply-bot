// Control Server — a UI que comanda o bot.
//
// Antes, subir o container já rodava o agente (gastando cota sem ninguém
// pedir). Agora o container sobe SÓ este servidor: ele serve o dashboard e
// espera o usuário mandar rodar.
//
// Arquitetura: o control server é o PAI e roda o bot como PROCESSO FILHO
// (`node dist/index.js`). Assim o run tem ciclo de vida próprio (pode ser
// parado, ter seu exit code consultado) e a UI sobrevive entre execuções.
//
// Endpoints:
//   GET  /             → dashboard (com painel de controle)
//   GET  /api/status   → estado do run (rodando, pid, custo, dry-run)
//   GET  /api/logs     → últimas linhas de log do run
//   POST /api/start    → inicia o bot ({ dryRun?: boolean })
//   POST /api/stop     → para o bot em andamento

import http from 'http';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';
import { inicializarBanco } from './database.js';
import { gerarHTML } from './dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_LINHAS_LOG = 400;

interface EstadoRun {
  rodando: boolean;
  pid: number | null;
  iniciadoEm: string | null;
  encerradoEm: string | null;
  codigoSaida: number | null;
  dryRun: boolean;
  origem: string | null;
  linhas: string[];
  ultimoCusto: number | null;
}

const estado: EstadoRun = {
  rodando: false,
  pid: null,
  iniciadoEm: null,
  encerradoEm: null,
  codigoSaida: null,
  dryRun: true,
  origem: null,
  linhas: [],
  ultimoCusto: null,
};

let processo: ChildProcess | null = null;

/** Comando para rodar o bot: build (dist) em produção, tsx em desenvolvimento. */
function comandoDoBot(): { command: string; args: string[] } {
  const entry = process.argv[1] ?? '';
  if (entry.endsWith('.ts')) {
    return { command: 'npx', args: ['tsx', path.resolve(__dirname, 'index.ts')] };
  }
  return { command: process.execPath, args: [path.resolve(__dirname, 'index.js')] };
}

function registrarLinha(linha: string): void {
  const limpa = linha.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
  if (!limpa) return;
  estado.linhas.push(limpa);
  if (estado.linhas.length > MAX_LINHAS_LOG) {
    estado.linhas.splice(0, estado.linhas.length - MAX_LINHAS_LOG);
  }
  // Custo aparece no resumo final do run ("Custo tokens: $0.0165 USD").
  const m = limpa.match(/Custo tokens:\s*\$([0-9.]+)/);
  if (m) {
    const v = parseFloat(m[1]);
    if (!Number.isNaN(v)) estado.ultimoCusto = v;
  }
}

/** Inicia o bot como processo filho. Retorna false se já houver um rodando. */
export function iniciarRun(dryRun?: boolean): boolean {
  if (estado.rodando) return false;

  const { command, args } = comandoDoBot();
  const usarDryRun = dryRun ?? (process.env.DRY_RUN === 'true');

  estado.rodando = true;
  estado.pid = null;
  estado.iniciadoEm = new Date().toISOString();
  estado.encerradoEm = null;
  estado.codigoSaida = null;
  estado.ultimoCusto = null;
  estado.origem = 'ui';

  // O filho NÃO sobe dashboard (esta porta já é do control server) e roda em
  // modo agente normal.
  const env = {
    ...process.env,
    DASHBOARD_ENABLED: 'false',
    CONTROL_MODE: 'false',
    DRY_RUN: String(usarDryRun),
  };

  registrarLinha(`[control] iniciando bot (dry-run=${usarDryRun}) — ${command} ${args.join(' ')}`);
  log('INFO', `Control: iniciando bot (dry-run=${usarDryRun})`);

  processo = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  estado.pid = processo.pid ?? null;

  processo.stdout?.on('data', (d: Buffer) => {
    for (const l of d.toString('utf-8').split('\n')) registrarLinha(l);
  });
  processo.stderr?.on('data', (d: Buffer) => {
    for (const l of d.toString('utf-8').split('\n')) registrarLinha(l);
  });

  processo.on('exit', (code) => {
    estado.rodando = false;
    estado.codigoSaida = code;
    estado.encerradoEm = new Date().toISOString();
    estado.pid = null;
    registrarLinha(`[control] bot encerrado (codigo ${code})`);
    log('INFO', `Control: bot encerrado (código ${code})`);
  });

  processo.on('error', (err) => {
    estado.rodando = false;
    registrarLinha(`[control] erro ao iniciar bot: ${err.message}`);
    log('ERRO', `Control: erro ao iniciar bot — ${err.message}`);
  });

  return true;
}

/** Para o processo do bot (SIGTERM) se estiver rodando. */
export function pararRun(): boolean {
  if (!estado.rodando || !processo) return false;
  registrarLinha('[control] parada solicitada (SIGTERM)');
  try {
    processo.kill('SIGTERM');
  } catch (err) {
    registrarLinha(`[control] falha ao parar: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  return true;
}

export function obterEstado(): EstadoRun {
  return {
    ...estado,
    linhas: estado.linhas.slice(-120),
  };
}

function responderJSON(res: http.ServerResponse, codigo: number, corpo: unknown): void {
  const json = JSON.stringify(corpo);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(json);
}

function lerCorpo(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let dados = '';
    req.on('data', (c) => {
      dados += c;
      if (dados.length > 10_000) req.destroy();
    });
    req.on('end', () => resolve(dados));
    req.on('error', () => resolve(''));
  });
}

/** Sobe o control server (UI + API). */
export function iniciarControlServer(port: number, host: string): void {
  inicializarBanco();

  const srv = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    const caminho = url.split('?')[0];

    if (caminho === '/' || caminho === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(gerarHTML({ ativo: true, rodando: estado.rodando, dryRun: estado.dryRun }));
      return;
    }

    if (caminho === '/api/status') {
      responderJSON(res, 200, {
        rodando: estado.rodando,
        pid: estado.pid,
        iniciadoEm: estado.iniciadoEm,
        encerradoEm: estado.encerradoEm,
        codigoSaida: estado.codigoSaida,
        dryRun: estado.dryRun,
        ultimoCusto: estado.ultimoCusto,
        linhas: estado.linhas.length,
      });
      return;
    }

    if (caminho === '/api/logs') {
      responderJSON(res, 200, { linhas: estado.linhas.slice(-200) });
      return;
    }

    if (caminho === '/api/start' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      let dryRun: boolean | undefined;
      try {
        const parsed = JSON.parse(corpo || '{}') as { dryRun?: boolean };
        if (typeof parsed.dryRun === 'boolean') dryRun = parsed.dryRun;
      } catch {
        // corpo inválido: usa o padrão do .env
      }
      const ok = iniciarRun(dryRun);
      responderJSON(res, ok ? 200 : 409, {
        ok,
        mensagem: ok ? 'Bot iniciado' : 'Já existe um run em andamento',
        rodando: estado.rodando,
      });
      return;
    }

    if (caminho === '/api/stop' && req.method === 'POST') {
      const ok = pararRun();
      responderJSON(res, ok ? 200 : 409, {
        ok,
        mensagem: ok ? 'Parada solicitada' : 'Nenhum run em andamento',
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  srv.on('error', (err) => {
    log('ERRO', `Control server: falha na porta ${port} — ${err.message}`);
  });

  srv.listen(port, host, () => {
    log('INFO', `Control server em http://${host}:${port} (UI — o bot só roda quando você pedir)`);
  });

  // Ao encerrar o container, o processo filho não pode ficar órfão.
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sinal, () => {
      if (estado.rodando) {
        try {
          processo?.kill('SIGTERM');
        } catch {
          // silencioso
        }
      }
      process.exit(0);
    });
  }
}
