import { describe, it, expect } from 'vitest';
import {
  ehFalhaPermanente,
  ehFalhaRetriavel,
  calcularBackoff,
  calcularBackoffRateLimit,
  classificarErroAPI,
  MAX_TENTATIVAS,
} from '../src/erros';

describe('erros — classificação de falhas', () => {
  it('reconhece falhas permanentes conhecidas', () => {
    // Cenário: códigos que nunca devem ser retentados
    const codigos = ['captcha', 'vaga_expirada', 'cloudflare', 'sso_obrigatorio'];

    // Ação + Validação
    for (const codigo of codigos) {
      expect(ehFalhaPermanente(codigo)).toBe(true);
    }
  });

  it('não classifica falha retriável como permanente', () => {
    // Cenário: um código retriável
    const codigo = 'timeout';

    // Ação
    const permanente = ehFalhaPermanente(codigo);

    // Validação
    expect(permanente).toBe(false);
  });

  it('reconhece falhas retriáveis conhecidas', () => {
    // Cenário: códigos temporários que valem nova tentativa
    const codigos = ['timeout', 'erro_rede', 'erro_servidor', 'erro_mcp'];

    // Ação + Validação
    for (const codigo of codigos) {
      expect(ehFalhaRetriavel(codigo)).toBe(true);
    }
  });

  it('código desconhecido não é permanente nem retriável', () => {
    // Cenário: um código que não existe em nenhuma das listas
    const codigo = 'codigo_inexistente_xyz';

    // Ação + Validação
    expect(ehFalhaPermanente(codigo)).toBe(false);
    expect(ehFalhaRetriavel(codigo)).toBe(false);
  });
});

describe('erros — backoff exponencial', () => {
  it('calcula backoff de tools 5s → 15s → 45s', () => {
    // Cenário: tentativas 1, 2 e 3
    // Ação + Validação
    expect(calcularBackoff(1)).toBe(5000);
    expect(calcularBackoff(2)).toBe(15000);
    expect(calcularBackoff(3)).toBe(45000);
  });

  it('calcula backoff de rate limit 30s → 60s → 120s', () => {
    // Cenário: tentativas 1, 2 e 3 de rate limit
    // Ação + Validação
    expect(calcularBackoffRateLimit(1)).toBe(30000);
    expect(calcularBackoffRateLimit(2)).toBe(60000);
    expect(calcularBackoffRateLimit(3)).toBe(120000);
  });

  it('expõe o máximo de tentativas como 3', () => {
    // Validação do contrato público usado pelo agente e pelas tools
    expect(MAX_TENTATIVAS).toBe(3);
  });
});

describe('erros — classificação de erros de API/rede', () => {
  it('classifica HTTP 429 e resource_exhausted como rate_limit', () => {
    // Cenário: mensagens típicas de limite de taxa
    // Ação + Validação
    expect(classificarErroAPI('Error 429 Too Many Requests')).toBe('rate_limit');
    expect(classificarErroAPI('RESOURCE_EXHAUSTED: quota')).toBe('rate_limit');
  });

  it('classifica erros de conexão como rede', () => {
    // Cenário: erros de socket/DNS e 5xx
    // Ação + Validação
    expect(classificarErroAPI('connect ECONNREFUSED 127.0.0.1')).toBe('rede');
    expect(classificarErroAPI('socket hang up')).toBe('rede');
    expect(classificarErroAPI('Service Unavailable 503')).toBe('rede');
  });

  it('classifica erro desconhecido como fatal', () => {
    // Cenário: uma mensagem que não casa com rate_limit nem rede
    const mensagem = 'TypeError: cannot read properties of undefined';

    // Ação
    const tipo = classificarErroAPI(mensagem);

    // Validação
    expect(tipo).toBe('fatal');
  });
});
