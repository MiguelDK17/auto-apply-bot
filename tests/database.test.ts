import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  inicializarBanco,
  fecharBanco,
  registrarCandidatura,
  verificarJaAplicou,
  contarCandidaturasHoje,
  salvarRespostaCache,
  buscarRespostaCache,
  sanitizarPergunta,
  atualizarResultado,
  listarCandidaturas,
} from '../src/database';

// Diretório de teste propositalmente inexistente, para validar a criação automática.
const dirTeste = path.join(tmpdir(), 'auto-apply-bot-test');
const dbTeste = path.join(dirTeste, 'data', 'candidaturas.db');

beforeAll(() => {
  // Cenário: garante que o diretório NÃO existe antes (simula um clone limpo)
  rmSync(dirTeste, { recursive: true, force: true });
  inicializarBanco(dbTeste);
});

afterAll(() => {
  fecharBanco();
  rmSync(dirTeste, { recursive: true, force: true });
});

describe('database — inicialização', () => {
  it('cria o diretório data/ automaticamente (não crasha em clone limpo)', () => {
    // Validação: o arquivo .db foi criado num diretório que não existia
    expect(existsSync(dbTeste)).toBe(true);
  });
});

describe('database — candidaturas', () => {
  it('registra candidatura nova e detecta duplicata pela URL', () => {
    // Cenário
    const nova = {
      plataforma: 'Gupy',
      titulo_vaga: 'Dev Backend',
      empresa: 'ACME',
      url: 'https://exemplo.com/vaga/1',
      mensagem_enviada: 0,
      status: 'aplicado',
      score: 7,
    };

    // Ação
    const primeira = registrarCandidatura(nova);
    const duplicata = registrarCandidatura(nova);

    // Validação: a primeira insere (true), a segunda é ignorada como duplicata (false)
    expect(primeira).toBe(true);
    expect(duplicata).toBe(false);
    expect(verificarJaAplicou('https://exemplo.com/vaga/1')).toBe(true);
    expect(contarCandidaturasHoje()).toBeGreaterThanOrEqual(1);
  });
});

describe('database — cache de respostas', () => {
  it('salva e recupera uma resposta do cache (exact match)', () => {
    // Cenário
    salvarRespostaCache('Qual sua pretensão salarial?', 'textbox', 'A combinar');

    // Ação
    const hit = buscarRespostaCache('Qual sua pretensão salarial?', 'textbox');

    // Validação
    expect(hit).not.toBeNull();
    expect(hit?.resposta).toBe('A combinar');
  });

  it('sanitizarPergunta normaliza espaços e remove aspas', () => {
    // Cenário + Ação
    const resultado = sanitizarPergunta('  Qual   sua "pretensão"?  ');

    // Validação
    expect(resultado).toBe('qual sua pretensão?');
  });
});

describe('database — resultado (loop de feedback)', () => {
  it('atualiza o resultado de uma candidatura existente', () => {
    // Cenário: registra uma candidatura e recupera o id pela URL
    const url = 'https://exemplo.com/vaga/resultado';
    registrarCandidatura({
      plataforma: 'LinkedIn', titulo_vaga: 'Dev', empresa: 'Beta',
      url, mensagem_enviada: 0, status: 'aplicado', score: 8,
    });
    const id = listarCandidaturas(50).find((c) => c.url === url)!.id as number;

    // Ação
    const ok = atualizarResultado(id, 'entrevista');

    // Validação
    expect(ok).toBe(true);
    expect(listarCandidaturas(50).find((c) => c.id === id)?.resultado).toBe('entrevista');
  });

  it('rejeita resultado fora do vocabulario fechado', () => {
    // Cenário
    const url = 'https://exemplo.com/vaga/invalido';
    registrarCandidatura({
      plataforma: 'LinkedIn', titulo_vaga: 'Dev', empresa: 'Gama',
      url, mensagem_enviada: 0, status: 'aplicado', score: 8,
    });
    const id = listarCandidaturas(50).find((c) => c.url === url)!.id as number;

    // Ação + Validação
    expect(atualizarResultado(id, 'foo_invalido')).toBe(false);
  });

  it('retorna false para id inexistente', () => {
    // Cenário + Ação + Validação
    expect(atualizarResultado(999999, 'entrevista')).toBe(false);
  });
});
