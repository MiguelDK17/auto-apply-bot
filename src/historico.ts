import type OpenAI from 'openai';

// Gestão do histórico de conversa do agente (sliding window) — formato OpenAI.
//
// A API de Chat Completions com tool calling exige pareamento:
//   1. toda mensagem `assistant` com `tool_calls` deve ser seguida pelas
//      respostas `tool` correspondentes (uma por `tool_call_id`);
//   2. nenhuma mensagem `role: "tool"` pode aparecer órfã (sem o
//      `assistant` com `tool_calls` correspondente antes dela).
//
// O agente acumula o histórico no formato:
//   [ system?, user(texto inicial), assistant(tool_calls), tool, tool, assistant(...), tool, ... ]
//
// Um `splice` ingênuo do início corromperia esse pareamento (deixaria uma
// resposta `tool` órfã como primeiro elemento após a inicial), gerando erro
// 400 da API e derrubando o agente. Esta função poda preservando a validade.

export type HistoricoChat = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

/**
 * Verifica se uma mensagem é um início de rodada válido para abrir o
 * histórico logo após a mensagem inicial. Apenas turnos `assistant` (que
 * carregam os `tool_calls`) ou `user` textuais podem abrir uma rodada —
 * uma resposta `tool` ficaria órfã.
 */
function ehInicioDeRodada(
  msg: OpenAI.Chat.Completions.ChatCompletionMessageParam | undefined,
): boolean {
  return msg?.role === 'assistant' || msg?.role === 'user';
}

/**
 * Poda o histórico para no máximo `max` mensagens, mantendo-o válido para a
 * API OpenAI.
 *
 * Estratégia:
 * - Sempre preserva a primeira mensagem (system prompt ou instrução inicial)
 *   — ela ancora o comportamento do agente.
 * - Remove as mensagens mais antigas DEPOIS da inicial, mas avança o ponto de
 *   corte até a próxima fronteira de rodada (um turno `assistant` ou `user`
 *   textual), de modo que o elemento seguinte à inicial nunca seja uma
 *   resposta `tool` órfã.
 *
 * Retorna sempre um novo array (não muta a entrada).
 */
export function podarHistorico(
  history: HistoricoChat,
  max: number,
): HistoricoChat {
  if (history.length <= max) return history.slice();

  const inicial = history[0];

  // Queremos manter ~max mensagens: 1 (inicial) + (length - corte) <= max
  //   => corte >= length - max + 1
  let corte = history.length - max + 1;

  // Avança o corte até uma fronteira de rodada limpa.
  while (corte < history.length && !ehInicioDeRodada(history[corte])) {
    corte++;
  }

  // Sem fronteira limpa até o fim: mantém apenas a mensagem inicial.
  if (corte >= history.length) return [inicial];

  return [inicial, ...history.slice(corte)];
}

// ========== COMPACTAÇÃO DE SNAPSHOTS ANTIGOS ==========
//
// O custo por chamada é dominado por snapshots: cada `browser_snapshot`
// tem dezenas de milhares de tokens, e cada chamada reenvia o histórico
// inteiro. Mas snapshot velho é lixo — cada navegação invalida as [ref]
// anteriores, então o modelo não consegue usar aquele conteúdo para nada.
//
// Esta função reescreve o CONTEÚDO das mensagens `tool` antigas (mantendo
// `role`, `tool_call_id` e a quantidade de mensagens — o pareamento exigido
// pela API continua válido), preservando intactas apenas as mais recentes.
// Economia típica: 70–80% dos tokens por chamada, já que snapshot é quase
// tudo que trafega no histórico.

/** Quantas mensagens `tool` mais recentes mantêm o conteúdo integral. */
export const MAX_TOOL_INTACTAS = 4;
/** Abaixo deste tamanho (chars), o conteúdo é mantido como está. */
export const LIMITE_TOOL_CHARS = 2000;
/** Quanto do início (chars) é preservado ao truncar, para não perder o fio. */
export const CABECA_TRUNCADA = 500;

const AVISO_TRUNCADO =
  'conteudo antigo truncado para economizar contexto. ' +
  'Para o estado ATUAL da pagina, use browser_snapshot.';

/**
 * Trunca o conteúdo das mensagens `tool` antigas e longas.
 * Retorna sempre um novo array (não muta a entrada).
 */
export function compactarHistorico(history: HistoricoChat): HistoricoChat {
  const idxTools: number[] = [];
  history.forEach((m, i) => {
    if (m.role === 'tool') idxTools.push(i);
  });
  const preservar = new Set(idxTools.slice(-MAX_TOOL_INTACTAS));

  return history.map((m, i) => {
    if (m.role !== 'tool' || preservar.has(i)) return m;
    if (typeof m.content !== 'string') return m;
    if (m.content.length <= LIMITE_TOOL_CHARS) return m;
    return {
      ...m,
      content:
        `[${AVISO_TRUNCADO} (${m.content.length} chars)]\n` +
        m.content.slice(0, CABECA_TRUNCADA),
    };
  });
}
