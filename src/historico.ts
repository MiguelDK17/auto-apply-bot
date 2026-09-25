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
