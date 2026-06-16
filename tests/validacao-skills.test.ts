import { describe, it, expect } from 'vitest';
import { detectarSkillsFabricadas, limparMarkdown } from '../src/validacao-skills';

describe('detectarSkillsFabricadas', () => {
  it('detecta tecnologia que o candidato não possui', () => {
    // Cenário: texto menciona Python, mas o candidato só tem Java
    const texto = 'Tenho experiência sólida em Python e Django.';
    const skillsReais = ['Java', 'Spring'];

    // Ação
    const fabricadas = detectarSkillsFabricadas(texto, skillsReais);

    // Validação
    expect(fabricadas).toContain('python');
    expect(fabricadas).toContain('django');
  });

  it('não acusa tecnologia que o candidato realmente possui', () => {
    // Cenário: candidato tem React
    const texto = 'Trabalho com Angular e React no dia a dia.';
    const skillsReais = ['Angular', 'React'];

    // Ação
    const fabricadas = detectarSkillsFabricadas(texto, skillsReais);

    // Validação: nenhuma das duas é fabricada (ambas são reais)
    expect(fabricadas).toEqual([]);
  });

  it('cobre "spring boot" quando o candidato tem "Spring" (match bidirecional)', () => {
    // Cenário
    const texto = 'Experiência com Spring Boot em produção.';
    const skillsReais = ['Spring Boot'];

    // Ação + Validação
    expect(detectarSkillsFabricadas(texto, skillsReais)).toEqual([]);
  });

  it('retorna lista vazia para texto sem tecnologias suspeitas', () => {
    // Cenário
    const texto = 'Sou um profissional dedicado e colaborativo.';

    // Ação + Validação
    expect(detectarSkillsFabricadas(texto, ['Java'])).toEqual([]);
  });
});

describe('limparMarkdown', () => {
  it('remove cerca de código com linguagem (```html ... ```)', () => {
    // Cenário
    const entrada = '```html\n<p>Olá</p>\n```';

    // Ação
    const saida = limparMarkdown(entrada);

    // Validação
    expect(saida).toBe('<p>Olá</p>');
  });

  it('remove cerca de código sem linguagem', () => {
    // Cenário
    const entrada = '```\ntexto puro\n```';

    // Ação + Validação
    expect(limparMarkdown(entrada)).toBe('texto puro');
  });

  it('mantém texto sem cercas inalterado (apenas trim)', () => {
    // Cenário + Ação + Validação
    expect(limparMarkdown('  apenas texto  ')).toBe('apenas texto');
  });
});
