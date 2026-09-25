import { describe, it, expect } from 'vitest';
import { MAX_RATE_LIMIT_CONSECUTIVOS } from '../src/erros';
import {
  converterMcpToolParaOpenAI,
  montarToolsAgente,
  ehErroDeSeletor,
  extrairTextoMcp,
  criarClientAgente,
} from '../src/agente';
import { customTools, ehToolCustomizada } from '../src/tools';
import type { AgenteConfig } from '../src/types';

function configFake(over: Partial<AgenteConfig> = {}): AgenteConfig {
  return {
    agentLlmBaseUrl: 'https://openrouter.ai/api/v1',
    agentLlmApiKey: 'fake',
    agentLlmModel: 'google/gemini-2.0-flash-001',
    geminiApiKey: '', geminiModel: '', cdpEndpoint: 'http://localhost:9222',
    limiteDiario: 10, maxPorExecucao: 5, delayMin: 1, delayMax: 2, dryRun: true, scoreMinimo: 6,
    custoMaxUsd: 0, dashboardPort: 3000,
    telegramBotToken: '', telegramChatId: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '',
    emailDestinatario: '', cronAtivo: false, cronHorario: '09:00',
    llmAuxProvider: 'gemini', llmAuxModel: 'gemini-2.5-flash', ollamaUrl: '', openaiApiKey: '', openaiBaseUrl: '',
    ...over,
  };
}

describe('teto de rate limit — anti-espera-infinita', () => {
  it('limita a 5 rate limits consecutivos antes de parar com aviso no Telegram', () => {
    // Cenário + Ação + Validação: o loop do agente (src/agente.ts) usa esta
    // constante para interromper e notificar via Telegram em vez de aplicar
    // backoffs indefinidamente.
    expect(MAX_RATE_LIMIT_CONSECUTIVOS).toBe(5);
  });
});

describe('converterMcpToolParaOpenAI', () => {
  it('converte tool MCP para o formato { type: "function", ... } repassando o schema intacto', () => {
    // Cenário: tool do Playwright MCP com inputSchema JSON Schema
    const inputSchema = {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    };

    // Ação
    const tool = converterMcpToolParaOpenAI({
      name: 'browser_navigate',
      description: 'Navega para uma URL',
      inputSchema,
    });

    // Validação
    expect(tool.type).toBe('function');
    expect(tool.function.name).toBe('browser_navigate');
    expect(tool.function.parameters).toBe(inputSchema);
  });

  it('usa schema vazio quando a tool MCP não tem inputSchema', () => {
    // Cenário + Ação
    const tool = converterMcpToolParaOpenAI({ name: 'x' });

    // Validação
    expect(tool).toEqual({
      type: 'function',
      function: { name: 'x', description: '', parameters: { type: 'object', properties: {} } },
    });
  });
});

describe('montarToolsAgente', () => {
  it('combina tools MCP convertidas + tools customizadas no padrão OpenAI', () => {
    // Cenário: 2 tools MCP
    const mcp = [
      { name: 'browser_navigate', description: 'n', inputSchema: { type: 'object', properties: {} } },
      { name: 'browser_snapshot', description: 's', inputSchema: { type: 'object', properties: {} } },
    ];

    // Ação
    const tools = montarToolsAgente(mcp);

    // Validação
    expect(tools).toHaveLength(2 + customTools.length);
    expect(tools.every((t) => t.type === 'function')).toBe(true);
    expect(tools[0].function.name).toBe('browser_navigate');
  });
});

describe('customTools — formato OpenAI Function Calling', () => {
  it('todas as tools customizadas usam type: "function" com function.{name, description, parameters}', () => {
    // Cenário + Ação + Validação
    expect(customTools.length).toBeGreaterThan(0);
    for (const t of customTools) {
      expect(t.type).toBe('function');
      expect(typeof t.function.name).toBe('string');
      expect(typeof t.function.description).toBe('string');
      expect(t.function.parameters).toMatchObject({ type: 'object' });
    }
  });

  it('expõe as tools esperadas do bot (spot check)', () => {
    // Cenário + Ação
    const nomes = new Set(customTools.map((t) => t.function.name));

    // Validação
    for (const esperada of [
      'obter_perfil_candidato', 'verificar_ja_aplicou', 'registrar_candidatura',
      'confirmar_envio', 'pontuar_vaga', 'reportar_falha', 'gerar_cover_letter',
      'gerar_curriculo_tailored', 'aguardar',
    ]) {
      expect(nomes.has(esperada)).toBe(true);
      expect(ehToolCustomizada(esperada)).toBe(true);
    }
    expect(ehToolCustomizada('browser_navigate')).toBe(false);
  });
});

describe('ehErroDeSeletor — detecção anti-loop', () => {
  it('detecta mensagens típicas de falha de seletor/elemento', () => {
    // Cenário + Ação + Validação
    expect(ehErroDeSeletor('ERRO_TOOL: Error: strict mode violation: locator resolved to 2 elements')).toBe(true);
    expect(ehErroDeSeletor('Error: locator.click: Target element not found')).toBe(true);
    expect(ehErroDeSeletor('Timeout: element is not visible')).toBe(true);
    expect(ehErroDeSeletor('falha de selector css invalido')).toBe(true);
    expect(ehErroDeSeletor('elemento não encontrado na pagina')).toBe(true);
  });

  it('não classifica erros comuns como erro de seletor', () => {
    // Cenário + Ação + Validação
    expect(ehErroDeSeletor('REGISTRADO: Candidatura salva no banco de dados.')).toBe(false);
    expect(ehErroDeSeletor('NOVA_VAGA: O candidato ainda nao se candidatou.')).toBe(false);
    expect(ehErroDeSeletor('ERRO_TOOL: net::ERR_CONNECTION_REFUSED')).toBe(false);
  });
});

describe('extrairTextoMcp — payload intacto', () => {
  it('concatena partes text e serializa o resto', () => {
    // Cenário + Ação
    const texto = extrairTextoMcp([
      { type: 'text', text: 'parte1' },
      { type: 'text', text: 'parte2' },
      { type: 'image', data: 'abc' },
    ]);

    // Validação: texto preservado, não-texto vira JSON
    expect(texto).toContain('parte1');
    expect(texto).toContain('parte2');
    expect(texto).toContain('"type":"image"');
  });

  it('retorna OK para conteúdo vazio/nulo', () => {
    // Cenário + Ação + Validação
    expect(extrairTextoMcp(undefined)).toBe('OK');
    expect(extrairTextoMcp(null)).toBe('OK');
    expect(extrairTextoMcp([])).toBe('OK');
  });
});

describe('criarClientAgente — descentralização multi-LLM', () => {
  it('aponta para a baseURL e o modelo configurados (sem lock-in de provedor)', () => {
    // Cenário
    const config = configFake({
      agentLlmBaseUrl: 'http://localhost:11434/v1',
      agentLlmModel: 'llama3.1',
    });

    // Ação
    const client = criarClientAgente(config);

    // Validação
    expect(client.baseURL).toBe('http://localhost:11434/v1');
    expect((client as unknown as { apiKey?: string }).apiKey).toBe('fake');
  });
});
