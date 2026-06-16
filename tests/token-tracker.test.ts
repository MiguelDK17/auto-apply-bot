import { describe, it, expect, beforeEach } from 'vitest';
import {
  registrarUsoTokens,
  obterCustoTotal,
  obterTokensTotal,
  resetarTracker,
} from '../src/token-tracker';

describe('token-tracker — cálculo de custo', () => {
  beforeEach(() => {
    // Cenário base: tracker zerado antes de cada teste
    resetarTracker();
  });

  it('não cobra nada para o provider Ollama (local/grátis)', () => {
    // Cenário: 2M tokens via Ollama
    // Ação
    registrarUsoTokens(
      'ollama',
      { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000, totalTokenCount: 2_000_000 },
      'cover_letter',
    );

    // Validação
    expect(obterCustoTotal()).toBe(0);
    expect(obterTokensTotal()).toBe(2_000_000);
  });

  it('reconhece Ollama por prefixo (ex.: "ollama:aux")', () => {
    // Cenário + Ação
    registrarUsoTokens(
      'ollama:aux',
      { promptTokenCount: 500_000, candidatesTokenCount: 0, totalTokenCount: 500_000 },
      'curriculo',
    );

    // Validação: ainda custo zero
    expect(obterCustoTotal()).toBe(0);
  });

  it('calcula o custo do gemini-2.5-flash pelo pricing conhecido', () => {
    // Cenário: 1M input + 1M output ($0.15 + $0.60)
    // Ação
    registrarUsoTokens(
      'gemini-2.5-flash',
      { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000, totalTokenCount: 2_000_000 },
      'agente',
    );

    // Validação
    expect(obterCustoTotal()).toBeCloseTo(0.75, 5);
  });

  it('ignora chamadas sem usageMetadata', () => {
    // Cenário + Ação
    registrarUsoTokens('gemini-2.5-pro', undefined, 'agente');

    // Validação
    expect(obterCustoTotal()).toBe(0);
    expect(obterTokensTotal()).toBe(0);
  });
});
