import { describe, it, expect } from 'vitest';
import { estaNaBlacklist } from '../src/blacklist';

describe('estaNaBlacklist', () => {
  it('bloqueia empresa que está na lista (case/acento insensível)', () => {
    // Cenário: candidato não quer aparecer na "Acme Corp"
    const r = estaNaBlacklist('ACME Corp', 'Dev Backend', ['acme corp'], []);

    // Validação
    expect(r.bloqueado).toBe(true);
    expect(r.motivo).toMatch(/acme/i);
  });

  it('NÃO bloqueia por substring parcial (borda de palavra)', () => {
    // Cenário: blacklist "Globo" não deve pegar "Globant"
    const r = estaNaBlacklist('Globant', 'Dev', ['Globo'], []);

    // Validação
    expect(r.bloqueado).toBe(false);
  });

  it('bloqueia título que contém termo proibido', () => {
    // Cenário: candidato não quer vagas de estágio
    const r = estaNaBlacklist('Empresa X', 'Estágio em Desenvolvimento', [], ['estagio']);

    // Validação
    expect(r.bloqueado).toBe(true);
    expect(r.motivo).toMatch(/estagio|estágio/i);
  });

  it('bloqueia termos que contêm símbolos (c++, .net)', () => {
    // Cenário: termos técnicos com símbolo — \b não funcionaria aqui
    expect(estaNaBlacklist('X', 'Vaga C++ Senior', [], ['c++']).bloqueado).toBe(true);
    expect(estaNaBlacklist('X', 'Dev .NET Pleno', [], ['.net']).bloqueado).toBe(true);
    // E não bloqueia o que não deve
    expect(estaNaBlacklist('X', 'Dev Java', [], ['c++']).bloqueado).toBe(false);
  });

  it('não bloqueia quando as listas estão vazias', () => {
    // Cenário + Ação + Validação
    expect(estaNaBlacklist('Qualquer', 'Qualquer Vaga', [], []).bloqueado).toBe(false);
    expect(estaNaBlacklist('Qualquer', 'Qualquer Vaga').bloqueado).toBe(false);
  });
});
