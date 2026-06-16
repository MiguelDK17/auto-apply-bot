import { describe, it, expect } from 'vitest';
import { escaparHtml, sanitizarUrl } from '../src/dashboard';

describe('escaparHtml — proteção contra XSS', () => {
  it('escapa os caracteres perigosos de HTML', () => {
    // Cenário: título de vaga malicioso vindo de um site externo
    const malicioso = '<img src=x onerror="alert(1)">';

    // Ação
    const seguro = escaparHtml(malicioso);

    // Validação: nenhuma tag executável permanece
    expect(seguro).not.toContain('<img');
    expect(seguro).toContain('&lt;img');
    expect(seguro).toContain('&quot;');
  });

  it('lida com valores nulos/indefinidos sem quebrar', () => {
    // Cenário + Ação + Validação
    expect(escaparHtml(null)).toBe('');
    expect(escaparHtml(undefined)).toBe('');
  });
});

describe('sanitizarUrl — bloqueio de esquemas perigosos', () => {
  it('mantém URLs http/https', () => {
    // Cenário + Ação + Validação
    expect(sanitizarUrl('https://gupy.io/vaga/123')).toContain('https://gupy.io/vaga/123');
    expect(sanitizarUrl('http://exemplo.com')).toContain('http://exemplo.com');
  });

  it('bloqueia javascript: e outros esquemas', () => {
    // Cenário: URL maliciosa
    // Ação + Validação: vira '#'
    expect(sanitizarUrl('javascript:alert(1)')).toBe('#');
    expect(sanitizarUrl('data:text/html,<script>')).toBe('#');
    expect(sanitizarUrl('')).toBe('#');
  });
});
