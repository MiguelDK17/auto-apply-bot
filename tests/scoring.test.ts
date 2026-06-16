import { describe, it, expect } from 'vitest';
import { pontuarVaga, type PerfilFit } from '../src/scoring';

// Perfil de fit padrão; aceita todos os modelos por padrão para isolar cada teste.
function fit(over: Partial<PerfilFit> = {}): PerfilFit {
  return {
    stackPrincipal: [],
    cidade: 'Uberlândia, MG',
    modelosAceitos: ['remoto', 'hibrido', 'presencial'],
    ...over,
  };
}

describe('pontuarVaga — compatibilidade da vaga', () => {
  it('soma +1 por tecnologia do candidato presente na vaga', () => {
    // Cenário
    const r = pontuarVaga(
      { tecnologias_pedidas: 'Java, Spring Boot, React' },
      fit({ stackPrincipal: ['Java', 'React', 'Node.js'] }),
      6,
    );

    // Validação: base 5 + Java + React = 7
    expect(r.score).toBe(7);
    expect(r.veredicto).toBe('APLICAR');
    expect(r.eliminatorios).toEqual([]);
  });

  it('penaliza vaga sênior (-2)', () => {
    const r = pontuarVaga({ tecnologias_pedidas: 'php', senioridade: 'Senior' }, fit({ stackPrincipal: ['Java'] }), 6);
    expect(r.score).toBe(3);
    expect(r.veredicto).toBe('PULAR');
  });

  it('usa o scoreMinimo configurável no veredicto', () => {
    const vaga = { tecnologias_pedidas: 'java' };
    const p = fit({ stackPrincipal: ['Java'] });
    expect(pontuarVaga(vaga, p, 6).veredicto).toBe('APLICAR');
    expect(pontuarVaga(vaga, p, 8).veredicto).toBe('PULAR');
  });

  it('aceita presencial quando a vaga é na cidade do candidato', () => {
    const r = pontuarVaga(
      { tecnologias_pedidas: 'x', localizacao: 'Uberlândia/MG', modelo_trabalho: 'presencial' },
      fit({ cidade: 'Uberlandia, MG' }),
      6,
    );
    expect(r.score).toBe(6);
    expect(r.eliminatorios).toEqual([]);
  });

  it('penaliza presencial fora da cidade quando o candidato aceita presencial', () => {
    const r = pontuarVaga(
      { tecnologias_pedidas: 'x', localizacao: 'São Paulo', modelo_trabalho: 'presencial' },
      fit({ modelosAceitos: ['remoto', 'hibrido', 'presencial'] }),
      6,
    );
    // -3 de penalidade, mas NÃO eliminatório (candidato aceita presencial)
    expect(r.score).toBe(2);
    expect(r.eliminatorios).toEqual([]);
    expect(r.veredicto).toBe('PULAR');
  });

  it('soma +1 para modelo remoto', () => {
    const r = pontuarVaga({ tecnologias_pedidas: 'x', modelo_trabalho: 'Remoto' }, fit(), 6);
    expect(r.score).toBe(6);
  });

  it('não quebra quando tecnologias_pedidas está ausente', () => {
    expect(() => pontuarVaga({}, fit({ stackPrincipal: ['Java'] }), 6)).not.toThrow();
    expect(pontuarVaga({}, fit({ stackPrincipal: ['Java'] }), 6).score).toBe(5);
  });

  it('mantém o score no intervalo 1-10 (clamp)', () => {
    const r = pontuarVaga(
      { tecnologias_pedidas: 'a b c d e f g h', modelo_trabalho: 'remoto' },
      fit({ stackPrincipal: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }),
      6,
    );
    expect(r.score).toBeLessThanOrEqual(10);
    expect(r.score).toBeGreaterThanOrEqual(1);
  });
});

describe('pontuarVaga — critérios eliminatórios', () => {
  it('elimina vaga que exige inglês acima do nível do candidato', () => {
    // Cenário: vaga exige fluente, candidato intermediário, com match forte de tech
    const r = pontuarVaga(
      { tecnologias_pedidas: 'Java, React', idioma_exigido: 'fluente' },
      fit({ stackPrincipal: ['Java', 'React'], nivelIngles: 'intermediario' }),
      6,
    );

    // Validação: mesmo com score alto, é PULAR por eliminatório
    expect(r.eliminatorios.length).toBeGreaterThan(0);
    expect(r.veredicto).toBe('PULAR');
    expect(r.motivo.toLowerCase()).toContain('ingl');
  });

  it('NÃO elimina por idioma quando o candidato atende o nível exigido', () => {
    const r = pontuarVaga(
      { tecnologias_pedidas: 'Java', idioma_exigido: 'avancado' },
      fit({ stackPrincipal: ['Java'], nivelIngles: 'fluente' }),
      6,
    );
    expect(r.eliminatorios).toEqual([]);
  });

  it('NÃO elimina por idioma quando o nível do candidato é desconhecido', () => {
    // Cenário: sem nivel_ingles no perfil → não há base para eliminar
    const r = pontuarVaga(
      { tecnologias_pedidas: 'Java', idioma_exigido: 'fluente' },
      fit({ stackPrincipal: ['Java'] }),
      6,
    );
    expect(r.eliminatorios).toEqual([]);
  });

  it('elimina vaga presencial fora da cidade quando o candidato só aceita remoto', () => {
    const r = pontuarVaga(
      { tecnologias_pedidas: 'Java', localizacao: 'São Paulo', modelo_trabalho: 'presencial' },
      fit({ stackPrincipal: ['Java'], modelosAceitos: ['remoto'] }),
      6,
    );
    expect(r.eliminatorios.length).toBeGreaterThan(0);
    expect(r.veredicto).toBe('PULAR');
  });
});
