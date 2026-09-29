import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import {
  podarHistorico,
  compactarHistorico,
  MAX_TOOL_INTACTAS,
  LIMITE_TOOL_CHARS,
  type HistoricoChat,
} from '../src/historico';

// Helpers que reproduzem o formato real do histórico do agente (OpenAI):
// [system/user(texto), assistant(tool_calls), tool, tool, assistant(...), tool, ...]
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const userTexto = (t: string): Msg => ({ role: 'user', content: t });
const assistantCall = (nome: string, id: string): Msg => ({
  role: 'assistant',
  content: null,
  tool_calls: [
    { id, type: 'function', function: { name: nome, arguments: '{}' } },
  ],
});
const toolResp = (id: string): Msg => ({
  role: 'tool',
  tool_call_id: id,
  content: 'ok',
});

function construirHistorico(rodadas: number): HistoricoChat {
  const history: HistoricoChat = [{ role: 'system', content: 'prompt' }, userTexto('inicio')];
  for (let i = 0; i < rodadas; i++) {
    history.push(assistantCall(`t${i}`, `call_${i}`), toolResp(`call_${i}`));
  }
  return history;
}

function ehTool(msg: Msg): boolean {
  return msg.role === 'tool';
}

describe('compactarHistorico — truncagem de snapshots antigos', () => {
  const snapshotGrande = (id: string): Msg => ({
    role: 'tool',
    tool_call_id: id,
    content: 'SNAPSHOT:' + 'x'.repeat(LIMITE_TOOL_CHARS + 1000),
  });

  function historicoComSnapshots(n: number): HistoricoChat {
    const h: HistoricoChat = [{ role: 'system', content: 'prompt' }];
    for (let i = 0; i < n; i++) {
      h.push(assistantCall(`t${i}`, `call_${i}`), snapshotGrande(`call_${i}`));
    }
    return h;
  }

  it('trunca tools antigas e preserva as mais recentes intactas', () => {
    // Cenário: 8 snapshots grandes
    const history = historicoComSnapshots(8);

    // Ação
    const resultado = compactarHistorico(history);

    // Validação: mesmas mensagens, mas só as últimas MAX_TOOL_INTACTAS intactas
    expect(resultado).toHaveLength(history.length);
    const tools = resultado.filter((m) => m.role === 'tool');
    expect(tools).toHaveLength(8);
    const intactas = tools.filter(
      (m) => typeof m.content === 'string' && m.content.startsWith('SNAPSHOT:'),
    );
    expect(intactas).toHaveLength(MAX_TOOL_INTACTAS);
    // Truncadas carregam o aviso + cabeça do conteúdo
    const truncadas = tools.filter(
      (m) => typeof m.content === 'string' && m.content.includes('truncado'),
    );
    expect(truncadas).toHaveLength(8 - MAX_TOOL_INTACTAS);
  });

  it('mantém o pareamento tool_calls ↔ tool após compactar', () => {
    // Cenário
    const history = historicoComSnapshots(6);

    // Ação
    const resultado = compactarHistorico(history);

    // Validação: tool_call_ids e ordem/roles inalterados
    expect(resultado.map((m) => m.role)).toEqual(history.map((m) => m.role));
    const idsAntes = history.filter((m) => m.role === 'tool').map((m) => (m as { tool_call_id: string }).tool_call_id);
    const idsDepois = resultado.filter((m) => m.role === 'tool').map((m) => (m as { tool_call_id: string }).tool_call_id);
    expect(idsDepois).toEqual(idsAntes);
  });

  it('não toca em conteúdos curtos nem em mensagens não-tool', () => {
    // Cenário
    const history: HistoricoChat = [
      { role: 'system', content: 'prompt' },
      userTexto('inicio'),
      assistantCall('a', 'call_a'),
      toolResp('call_a'),
    ];

    // Ação
    const resultado = compactarHistorico(history);

    // Validação
    expect(resultado).toEqual(history);
  });

  it('não muta o array original', () => {
    // Cenário
    const history = historicoComSnapshots(6);
    const antes = history.map((m) => (typeof m.content === 'string' ? m.content.length : 0));

    // Ação
    compactarHistorico(history);

    // Validação
    expect(history.map((m) => (typeof m.content === 'string' ? m.content.length : 0))).toEqual(antes);
  });
});

describe('podarHistorico — sliding window', () => {
  it('não altera histórico menor ou igual ao máximo', () => {
    // Cenário: histórico pequeno (3 mensagens)
    const history: HistoricoChat = [
      { role: 'system', content: 'prompt' },
      userTexto('inicio'),
      assistantCall('a', 'call_a'),
    ];

    // Ação
    const resultado = podarHistorico(history, 30);

    // Validação
    expect(resultado).toHaveLength(3);
    expect(resultado).toEqual(history);
  });

  it('preserva a mensagem inicial ao podar', () => {
    // Cenário: system + inicial + 20 rodadas = 42 mensagens (acima do máximo)
    const history = construirHistorico(20);

    // Ação
    const resultado = podarHistorico(history, 30);

    // Validação: a primeira mensagem continua sendo o system prompt
    expect(resultado[0]).toEqual({ role: 'system', content: 'prompt' });
    expect(resultado.length).toBeLessThanOrEqual(30);
  });

  it('mantém o histórico válido: o turno seguinte à inicial nunca é tool órfã', () => {
    // Cenário: histórico grande
    const history = construirHistorico(20);

    // Ação
    const resultado = podarHistorico(history, 30);

    // Validação: o 2º turno é assistant ou user — NUNCA tool órfã
    expect(['assistant', 'user']).toContain(resultado[1].role);
    expect(ehTool(resultado[1])).toBe(false);
  });

  it('nunca deixa tool órfã logo após a inicial, em vários tamanhos de corte', () => {
    // Cenário: histórico grande
    const history = construirHistorico(25);

    // Ação + Validação para diferentes limites
    for (const max of [8, 10, 15, 21, 30]) {
      const resultado = podarHistorico(history, max);
      // o elemento logo após a inicial nunca é uma resposta tool órfã
      if (resultado.length > 1) {
        expect(ehTool(resultado[1])).toBe(false);
      }
    }
  });

  it('cada resposta tool no resultado tem um assistant com tool_calls antes', () => {
    // Cenário: histórico grande que será podado
    const history = construirHistorico(18);

    // Ação
    const resultado = podarHistorico(history, 20);

    // Validação: toda tool é precedida por um assistant com o tool_call_id pareado
    const toolCallIds = new Set<string>();
    for (const msg of resultado) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) toolCallIds.add(tc.id);
      }
      if (msg.role === 'tool') {
        expect(toolCallIds.has(msg.tool_call_id)).toBe(true);
      }
    }
  });
});
