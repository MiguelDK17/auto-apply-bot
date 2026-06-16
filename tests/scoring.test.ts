import { describe, it, expect } from 'vitest';
import { pontuarVaga } from '../src/scoring';

describe('pontuarVaga — compatibilidade da vaga', () => {
  it('soma +1 por tecnologia do candidato presente na vaga', () => {
    // Cenário: vaga pede Java e React; candidato tem ambos (+ Node.js que não aparece)
    const vaga = { tecnologias_pedidas: 'Java, Spring Boot, React' };
    const stack = ['Java', 'React', 'Node.js'];

    // Ação
    const r = pontuarVaga(vaga, stack, 'Uberlândia, MG', 6);

    // Validação: base 5 + Java + React = 7
    expect(r.score).toBe(7);
    expect(r.veredicto).toBe('APLICAR');
  });

  it('penaliza vaga sênior (-2)', () => {
    // Cenário
    const vaga = { tecnologias_pedidas: 'php', senioridade: 'Senior' };

    // Ação
    const r = pontuarVaga(vaga, ['Java'], 'Uberlândia, MG', 6);

    // Validação: 5 + 0 - 2 = 3
    expect(r.score).toBe(3);
    expect(r.veredicto).toBe('PULAR');
  });

  it('usa o scoreMinimo configurável no veredicto (não o 6 fixo)', () => {
    // Cenário: vaga que resulta em score 6
    const vaga = { tecnologias_pedidas: 'java' };
    const stack = ['Java'];

    // Ação: mesmo score, limiares diferentes
    const comMinimo6 = pontuarVaga(vaga, stack, 'X, UF', 6);
    const comMinimo8 = pontuarVaga(vaga, stack, 'X, UF', 8);

    // Validação
    expect(comMinimo6.score).toBe(6);
    expect(comMinimo6.veredicto).toBe('APLICAR');
    expect(comMinimo8.veredicto).toBe('PULAR');
  });

  it('aceita presencial quando a vaga é na cidade do candidato (acento normalizado)', () => {
    // Cenário: cidade do perfil sem acento, vaga com acento
    const vaga = { tecnologias_pedidas: 'x', localizacao: 'Uberlândia/MG', modelo_trabalho: 'presencial' };

    // Ação
    const r = pontuarVaga(vaga, [], 'Uberlandia, MG', 6);

    // Validação: mesma cidade dá +1 e NÃO penaliza presencial → 5 + 1 = 6
    expect(r.score).toBe(6);
  });

  it('penaliza presencial/híbrido fora da cidade do candidato (-3)', () => {
    // Cenário
    const vaga = { tecnologias_pedidas: 'x', localizacao: 'São Paulo', modelo_trabalho: 'presencial' };

    // Ação
    const r = pontuarVaga(vaga, [], 'Uberlândia, MG', 6);

    // Validação: 5 - 3 = 2
    expect(r.score).toBe(2);
    expect(r.veredicto).toBe('PULAR');
  });

  it('soma +1 para modelo remoto', () => {
    // Cenário
    const vaga = { tecnologias_pedidas: 'x', modelo_trabalho: 'Remoto' };

    // Ação
    const r = pontuarVaga(vaga, [], 'Uberlândia, MG', 6);

    // Validação: 5 + 1 = 6
    expect(r.score).toBe(6);
  });

  it('não quebra quando tecnologias_pedidas está ausente', () => {
    // Cenário: vaga sem nenhum campo
    const vaga = {};

    // Ação + Validação: não lança e usa a base
    expect(() => pontuarVaga(vaga, ['Java'], 'X, UF', 6)).not.toThrow();
    expect(pontuarVaga(vaga, ['Java'], 'X, UF', 6).score).toBe(5);
  });

  it('mantém o score no intervalo 1-10 (clamp)', () => {
    // Cenário: muitas tecnologias batendo elevariam o score acima de 10
    const stack = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const vaga = { tecnologias_pedidas: 'a b c d e f g h', modelo_trabalho: 'remoto' };

    // Ação
    const r = pontuarVaga(vaga, stack, 'X, UF', 6);

    // Validação
    expect(r.score).toBeLessThanOrEqual(10);
    expect(r.score).toBeGreaterThanOrEqual(1);
  });
});
