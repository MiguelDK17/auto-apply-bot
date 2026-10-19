import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { resolverDirTailored } from '../src/curriculo-tailored';

describe('resolverDirTailored — diretório gravável', () => {
  const envOriginal = process.env.CURRICULOS_DIR_TAILORED;
  let temp: string;

  beforeEach(() => {
    temp = mkdtempSync(path.join(os.tmpdir(), 'curriculos-'));
  });

  afterEach(() => {
    if (envOriginal === undefined) delete process.env.CURRICULOS_DIR_TAILORED;
    else process.env.CURRICULOS_DIR_TAILORED = envOriginal;
    try {
      chmodSync(temp, 0o755);
    } catch {
      // já removido
    }
    rmSync(temp, { recursive: true, force: true });
  });

  it('usa o diretório configurado em CURRICULOS_DIR_TAILORED quando é gravável', () => {
    // Cenário: diretório gravável (volume do Docker, por exemplo)
    process.env.CURRICULOS_DIR_TAILORED = temp;

    // Ação
    const dir = resolverDirTailored();

    // Validação
    expect(dir).toBe(temp);
  });

  it('cai para data/curriculos_tailored quando o diretório não é gravável (EACCES do bind-mount)', () => {
    // Cenário: pasta sem permissão de escrita (uid do host != uid do container)
    const semAcesso = path.join(temp, 'somente-leitura');
    require('fs').mkdirSync(semAcesso, { recursive: true });
    chmodSync(semAcesso, 0o500); // r-x: não permite criar arquivos
    process.env.CURRICULOS_DIR_TAILORED = semAcesso;

    // Ação
    const dir = resolverDirTailored();

    // Validação: não devolve o diretório bloqueado
    expect(dir).not.toBe(semAcesso);
    expect(dir).toContain('curriculos_tailored');
  });

  it('garante que o diretório retornado existe e aceita escrita', () => {
    // Cenário: diretório alvo ainda não existe
    const novo = path.join(temp, 'novo', 'sub');
    process.env.CURRICULOS_DIR_TAILORED = novo;

    // Ação
    const dir = resolverDirTailored();

    // Validação: criou a pasta e o arquivo de teste entra
    expect(existsSync(dir)).toBe(true);
    writeFileSync(path.join(dir, 'teste.html'), 'ok');
    expect(existsSync(path.join(dir, 'teste.html'))).toBe(true);
  });
});
