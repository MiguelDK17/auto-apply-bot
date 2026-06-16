import { describe, it, expect } from 'vitest';
import type { Content } from '@google/genai';
import { podarHistorico } from '../src/historico';

// Helpers que reproduzem o formato real do histórico do agente:
// [user(texto), model(functionCall), user(functionResponse), model(...), user(...), ...]
const userTexto = (t: string): Content => ({ role: 'user', parts: [{ text: t }] });
const modelCall = (nome: string): Content => ({
  role: 'model',
  parts: [{ functionCall: { name: nome, args: {} } }],
});
const userResp = (nome: string): Content => ({
  role: 'user',
  parts: [{ functionResponse: { name: nome, response: { result: 'ok' } } }],
});

function construirHistorico(rodadas: number): Content[] {
  const history: Content[] = [userTexto('inicio')];
  for (let i = 0; i < rodadas; i++) {
    history.push(modelCall(`t${i}`), userResp(`t${i}`));
  }
  return history;
}

function temFunctionResponse(content: Content): boolean {
  return (content.parts ?? []).some((p) => p.functionResponse !== undefined);
}

describe('podarHistorico — sliding window', () => {
  it('não altera histórico menor ou igual ao máximo', () => {
    // Cenário: histórico pequeno (3 mensagens)
    const history = [userTexto('inicio'), modelCall('a'), userResp('a')];

    // Ação
    const resultado = podarHistorico(history, 30);

    // Validação
    expect(resultado).toHaveLength(3);
    expect(resultado).toEqual(history);
  });

  it('preserva a mensagem inicial do usuário ao podar', () => {
    // Cenário: 1 inicial + 20 rodadas = 41 mensagens (acima do máximo)
    const history = construirHistorico(20);

    // Ação
    const resultado = podarHistorico(history, 30);

    // Validação: a primeira mensagem continua sendo a instrução inicial
    expect(resultado[0]).toEqual(userTexto('inicio'));
    expect(resultado.length).toBeLessThanOrEqual(30);
  });

  it('mantém o histórico válido: começa com user e o turno seguinte é model', () => {
    // Cenário: histórico grande
    const history = construirHistorico(20);

    // Ação
    const resultado = podarHistorico(history, 30);

    // Validação: começa com user (instrução inicial) e o 2º turno é um model íntegro
    expect(resultado[0].role).toBe('user');
    expect(resultado[1].role).toBe('model');
    // o 2º turno NÃO pode ser um functionResponse órfão
    expect(temFunctionResponse(resultado[1])).toBe(false);
  });

  it('nunca deixa functionResponse órfão logo após a inicial, em vários tamanhos de corte', () => {
    // Cenário: histórico grande
    const history = construirHistorico(25);

    // Ação + Validação para diferentes limites
    for (const max of [8, 10, 15, 21, 30]) {
      const resultado = podarHistorico(history, max);
      // primeiro elemento é sempre a instrução inicial (texto)
      expect(resultado[0].parts?.[0]).toHaveProperty('text');
      // o elemento logo após a inicial nunca é um functionResponse órfão
      if (resultado.length > 1) {
        expect(temFunctionResponse(resultado[1])).toBe(false);
      }
    }
  });

  it('cada functionResponse no resultado tem um functionCall anterior pareado', () => {
    // Cenário: histórico grande que será podado
    const history = construirHistorico(18);

    // Ação
    const resultado = podarHistorico(history, 20);

    // Validação: varre o resultado garantindo que todo functionResponse (user)
    // seja precedido por um turno model com functionCall
    for (let i = 0; i < resultado.length; i++) {
      if (temFunctionResponse(resultado[i])) {
        expect(i).toBeGreaterThan(0);
        const anterior = resultado[i - 1];
        expect(anterior.role).toBe('model');
        expect((anterior.parts ?? []).some((p) => p.functionCall !== undefined)).toBe(true);
      }
    }
  });
});
