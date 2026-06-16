import { describe, it, expect } from 'vitest';
import {
  anonimizarPerfil,
  desanonimizar,
  contemPlaceholderResidual,
  perfilParaSystemPrompt,
} from '../src/anonimizacao';
import type { Perfil } from '../src/types';

function perfilFake(overrides: Partial<Perfil> = {}): Perfil {
  return {
    nome: 'Fulano de Tal',
    email: 'fulano@exemplo.com',
    telefone: '(34) 99999-1234',
    linkedin: 'https://linkedin.com/in/fulano',
    github: 'https://github.com/fulano',
    portfolio: 'https://fulano.dev',
    curriculo_path: './assets/cv.pdf',
    titulo_profissional: 'Desenvolvedor Backend',
    anos_experiencia: 3,
    stack_principal: ['Java', 'Spring'],
    resumo_profissional: 'Resumo profissional sem PII.',
    pretensao_salarial: 'A combinar',
    modelo_trabalho: ['remoto'],
    cidade: 'Uberlândia, MG',
    disponibilidade: 'Imediata',
    palavras_chave_busca: ['Backend'],
    ...overrides,
  };
}

describe('anonimizarPerfil', () => {
  it('substitui PII de contato por placeholders', () => {
    // Cenário
    const perfil = perfilFake();

    // Ação
    const { perfilAnonimo } = anonimizarPerfil(perfil);

    // Validação
    expect(perfilAnonimo.nome).toBe('[CANDIDATO]');
    expect(perfilAnonimo.email).toBe('candidato@email.example');
    expect(perfilAnonimo.telefone).toBe('(00) 00000-0000');
    // dados profissionais permanecem intactos
    expect(perfilAnonimo.stack_principal).toEqual(['Java', 'Spring']);
    expect(perfilAnonimo.resumo_profissional).toBe('Resumo profissional sem PII.');
  });

  it('não mapeia campos vazios', () => {
    // Cenário: perfil sem portfolio
    const perfil = perfilFake({ portfolio: '' });

    // Ação
    const { mapa } = anonimizarPerfil(perfil);

    // Validação: o placeholder de portfolio não deve mapear para vazio
    expect(Object.keys(mapa)).not.toContain('');
  });
});

describe('desanonimizar — round-trip', () => {
  it('restaura a PII real a partir dos placeholders', () => {
    // Cenário: texto gerado pelo LLM com placeholders
    const perfil = perfilFake();
    const { mapa } = anonimizarPerfil(perfil);
    const textoLLM = 'Contato: [CANDIDATO], candidato@email.example, (00) 00000-0000';

    // Ação
    const restaurado = desanonimizar(textoLLM, mapa);

    // Validação
    expect(restaurado).toContain('Fulano de Tal');
    expect(restaurado).toContain('fulano@exemplo.com');
    expect(restaurado).toContain('(34) 99999-1234');
    expect(contemPlaceholderResidual(restaurado)).toBe(false);
  });

  it('não interpreta padrões especiais de regex ($&, $1) no valor real', () => {
    // Cenário: valor real contém sequências que o String.replace trataria como
    // referências de captura — devem ser inseridas literalmente
    const mapa = { 'Cifras $& Cia $1': '[CANDIDATO]' };
    const texto = 'Empresa: [CANDIDATO]';

    // Ação
    const restaurado = desanonimizar(texto, mapa);

    // Validação: literal, sem interpretar $& nem $1
    expect(restaurado).toBe('Empresa: Cifras $& Cia $1');
  });
});

describe('contemPlaceholderResidual', () => {
  it('detecta placeholder remanescente', () => {
    // Cenário: de-anonimização falhou e sobrou um placeholder
    const texto = 'Atenciosamente, [CANDIDATO]';

    // Ação + Validação
    expect(contemPlaceholderResidual(texto)).toBe(true);
  });

  it('retorna false para texto totalmente restaurado', () => {
    // Cenário
    const texto = 'Atenciosamente, Fulano de Tal';

    // Ação + Validação
    expect(contemPlaceholderResidual(texto)).toBe(false);
  });
});

describe('perfilParaSystemPrompt', () => {
  it('remove os campos de contato do perfil exposto ao agente', () => {
    // Cenário
    const perfil = perfilFake();

    // Ação
    const reduzido = perfilParaSystemPrompt(perfil) as Record<string, unknown>;

    // Validação: contato omitido, dados profissionais mantidos
    expect(reduzido.email).toBeUndefined();
    expect(reduzido.telefone).toBeUndefined();
    expect(reduzido.linkedin).toBeUndefined();
    expect(reduzido.stack_principal).toEqual(['Java', 'Spring']);
  });
});
