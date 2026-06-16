import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inicializarBanco, fecharBanco, verificarJaAplicou } from '../src/database';
import { criarExecutorDeTools } from '../src/tools';
import type { Perfil, AgenteConfig } from '../src/types';

// Perfil minimo para o executor
function perfilFake(): Perfil {
  return {
    nome: 'Fulano', email: 'f@e.com', telefone: '(34) 90000-0000',
    linkedin: 'https://linkedin.com/in/f', github: 'https://github.com/f', portfolio: '',
    curriculo_path: './cv.pdf', titulo_profissional: 'Dev', anos_experiencia: 3,
    stack_principal: ['Java', 'React'], resumo_profissional: 'Resumo.',
    pretensao_salarial: 'A combinar', modelo_trabalho: ['remoto'], cidade: 'Uberlândia, MG',
    disponibilidade: 'Imediata', palavras_chave_busca: ['Dev'],
  };
}

function configFake(over: Partial<AgenteConfig> = {}): AgenteConfig {
  return {
    geminiApiKey: 'fake', geminiModel: 'gemini-2.5-flash', cdpEndpoint: 'http://localhost:9222',
    limiteDiario: 10, maxPorExecucao: 5, delayMin: 1, delayMax: 2, dryRun: true, scoreMinimo: 6,
    custoMaxUsd: 0, dashboardPort: 3000,
    telegramBotToken: '', telegramChatId: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '',
    emailDestinatario: '', cronAtivo: false, cronHorario: '09:00',
    llmAuxProvider: 'gemini', llmAuxModel: 'gemini-2.5-flash', ollamaUrl: '', openaiApiKey: '', openaiBaseUrl: '',
    ...over,
  };
}

beforeAll(() => {
  inicializarBanco(':memory:');
});
afterAll(() => fecharBanco());

describe('executor — guard de score (gate deterministico)', () => {
  it('NAO registra candidatura com score abaixo do minimo', async () => {
    // Cenário: executor com scoreMinimo 6
    const executar = criarExecutorDeTools(perfilFake(), configFake({ scoreMinimo: 6 }));

    // Ação: tenta registrar vaga com score 3
    const resp = await executar('registrar_candidatura', {
      plataforma: 'Gupy', titulo_vaga: 'Dev', empresa: 'ACME', url: 'https://x/baixo', score: 3,
    });

    // Validação: bloqueado e NADA gravado no banco
    expect(resp).toMatch(/SCORE_ABAIXO_DO_MINIMO|abaixo do minimo/i);
    expect(verificarJaAplicou('https://x/baixo')).toBe(false);
  });

  it('registra candidatura com score igual/acima do minimo', async () => {
    // Cenário
    const executar = criarExecutorDeTools(perfilFake(), configFake({ scoreMinimo: 6 }));

    // Ação
    const resp = await executar('registrar_candidatura', {
      plataforma: 'Gupy', titulo_vaga: 'Dev', empresa: 'ACME', url: 'https://x/ok', score: 8,
    });

    // Validação
    expect(resp).toMatch(/REGISTRADO/i);
    expect(verificarJaAplicou('https://x/ok')).toBe(true);
  });
});

describe('executor — trava tecnica de dry-run (confirmar_envio)', () => {
  it('em dry-run, confirmar_envio BLOQUEIA o envio', async () => {
    // Cenário: dry-run ligado
    const executar = criarExecutorDeTools(perfilFake(), configFake({ dryRun: true }));

    // Ação
    const resp = await executar('confirmar_envio', { url_vaga: 'https://x/dry', acao: 'enviar candidatura' });

    // Validação: bloqueio explícito
    expect(resp).toMatch(/DRY-RUN|bloqueado/i);
    expect(resp).not.toMatch(/PODE_ENVIAR/);
  });

  it('em producao, confirmar_envio LIBERA o envio', async () => {
    // Cenário: dry-run desligado
    const executar = criarExecutorDeTools(perfilFake(), configFake({ dryRun: false }));

    // Ação
    const resp = await executar('confirmar_envio', { url_vaga: 'https://x/prod', acao: 'enviar candidatura' });

    // Validação
    expect(resp).toMatch(/PODE_ENVIAR|liberado/i);
  });

  it('bloqueia envio ao atingir o teto por execucao', async () => {
    // Cenário: produção com teto de 2 envios por execução
    const executar = criarExecutorDeTools(perfilFake(), configFake({ dryRun: false, maxPorExecucao: 2 }));

    // Ação: três tentativas de envio
    const r1 = await executar('confirmar_envio', { url_vaga: 'https://x/e1' });
    const r2 = await executar('confirmar_envio', { url_vaga: 'https://x/e2' });
    const r3 = await executar('confirmar_envio', { url_vaga: 'https://x/e3' });

    // Validação: as duas primeiras liberam, a terceira é barrada pelo teto
    expect(r1).toMatch(/PODE_ENVIAR/);
    expect(r2).toMatch(/PODE_ENVIAR/);
    expect(r3).toMatch(/TETO_POR_EXECUCAO/);
  });
});
