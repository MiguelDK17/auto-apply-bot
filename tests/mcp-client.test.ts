import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { montarComandoMCP, PLAYWRIGHT_MCP_VERSION } from '../src/mcp-client';

const requireLocal = createRequire(import.meta.url);
const binReal = requireLocal.resolve('@playwright/mcp/package.json').replace(/package\.json$/, 'cli.js');

describe('montarComandoMCP — binário local vs npx', () => {
  it('usa o binário local (node + cli.js) quando disponível — sem download em runtime', () => {
    // Cenário: binário pré-instalado (imagem Docker ou dependência local)
    const bin = binReal;

    // Ação
    const { command, args } = montarComandoMCP('http://127.0.0.1:9222', bin);

    // Validação
    expect(command).toBe(process.execPath);
    expect(args).toEqual([bin, '--cdp-endpoint', 'http://127.0.0.1:9222']);
  });

  it('cai para npx com versão pinada quando não há binário local', () => {
    // Cenário: sem binário (dev local sem a dependência instalada)
    // Ação
    const { command, args } = montarComandoMCP('http://127.0.0.1:9222', '/inexistente/cli.js');

    // Validação: nunca @latest — sempre a versão pinada
    expect(command).toBe('npx');
    expect(args).toEqual([
      `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`,
      '--cdp-endpoint',
      'http://127.0.0.1:9222',
    ]);
    expect(PLAYWRIGHT_MCP_VERSION).toBe('0.0.76');
  });

  it('resolve o binário do node_modules local sem override', () => {
    // Cenário: dependência instalada no projeto (pós yarn add)
    // Ação
    const { command, args } = montarComandoMCP('http://127.0.0.1:9222');

    // Validação
    expect(command).toBe(process.execPath);
    expect(args[0]).toMatch(/@playwright\/mcp\/cli\.js$/);
    expect(args.slice(1)).toEqual(['--cdp-endpoint', 'http://127.0.0.1:9222']);
  });
});
