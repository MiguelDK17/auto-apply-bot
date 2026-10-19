import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gerarHTML, escaparHtml, sanitizarUrl } from '../src/dashboard';
import { inicializarBanco, fecharBanco } from '../src/database';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  inicializarBanco(':memory:');
});
afterAll(() => fecharBanco());

describe('dashboard — painel de controle', () => {
  it('NÃO mostra o painel de controle quando o modo control está inativo', () => {
    // Cenário: dashboard tradicional (agente rodando direto)
    // Ação
    const html = gerarHTML();

    // Validação
    expect(html).not.toContain('btnStart');
    expect(html).not.toContain('/api/start');
  });

  it('mostra os botões de iniciar/parar no modo control', () => {
    // Cenário: control server
    // Ação
    const html = gerarHTML({ ativo: true, rodando: false, dryRun: true });

    // Validação
    expect(html).toContain('btnStart');
    expect(html).toContain('btnStop');
    expect(html).toContain('/api/start');
    expect(html).toContain('/api/stop');
    expect(html).toContain('id="logBox"');
  });

  it('marca o estado inicial e o dry-run', () => {
    // Cenário: control server parado
    // Ação
    const html = gerarHTML({ ativo: true, rodando: false, dryRun: true });

    // Validação
    expect(html).toContain('PARADO');
    expect(html).toMatch(/id="chkDryRun"[^>]*checked/);
  });

  it('reflete o estado RODANDO', () => {
    // Cenário: control server com run em andamento
    // Ação
    const html = gerarHTML({ ativo: true, rodando: true, dryRun: false });

    // Validação
    expect(html).toContain('RODANDO');
  });

  it('usa a paleta Solosis Psychic Teal em todos os tokens', () => {
    // Cenário: dashboard renderizado
    // Ação
    const html = gerarHTML({ ativo: true, rodando: false, dryRun: true });

    // Validação: os 6 cores da identidade estão presentes
    for (const cor of ['#25C6A2', '#15876D', '#44E3A8', '#82F4CD', '#156956', '#FDFFFF']) {
      expect(html).toContain(cor);
    }
  });
});

describe('dashboard — escaping (XSS)', () => {
  it('escapa HTML em valores dinâmicos', () => {
    // Cenário + Ação + Validação
    expect(escaparHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('bloqueia URLs com esquema perigoso', () => {
    // Cenário + Ação + Validação
    expect(sanitizarUrl('javascript:alert(1)')).toBe('#');
    expect(sanitizarUrl('https://x.com/vaga')).toContain('https://x.com/vaga');
  });
});

describe('control-server — contrato da API', () => {
  const caminho = path.resolve(__dirname, '..', 'src', 'control-server.ts');
  const fonte = readFileSync(caminho, 'utf-8');

  it('expõe start/stop/status/logs', () => {
    // Cenário + Ação + Validação
    expect(fonte).toContain("'/api/start'");
    expect(fonte).toContain("'/api/stop'");
    expect(fonte).toContain("'/api/status'");
    expect(fonte).toContain("'/api/logs'");
  });

  it('o filho do run NÃO sobe dashboard (a porta é do control server)', () => {
    // Cenário + Ação + Validação: o env passado ao filho desliga o dashboard
    expect(fonte).toContain("DASHBOARD_ENABLED: 'false'");
    expect(fonte).toContain("CONTROL_MODE: 'false'");
  });
});
