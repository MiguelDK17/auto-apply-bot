import type { Content } from '@google/genai';

// Gestão do histórico de conversa do agente (sliding window).
//
// A API do Gemini exige que o histórico:
//   1. comece sempre com um turno role: 'user';
//   2. alterne user/model;
//   3. cada Part.functionResponse (turno 'user') venha logo após o
//      Part.functionCall correspondente (turno 'model').
//
// O agente acumula o histórico no formato:
//   [ user(texto inicial), model(functionCall), user(functionResponse), model(...), user(...), ... ]
//
// Um `splice` ingênuo do início corromperia esse pareamento (deixaria um
// functionResponse órfão como primeiro elemento), gerando erro 400 da API e
// derrubando o agente. Esta função poda preservando a validade do histórico.

/**
 * Verifica se um Content é um início de rodada válido para abrir o histórico
 * logo após a mensagem inicial. Apenas turnos do modelo (que carregam o
 * functionCall) podem abrir uma rodada — um functionResponse ficaria órfão.
 */
function ehInicioDeRodada(content: Content | undefined): boolean {
  return content?.role === 'model';
}

/**
 * Poda o histórico para no máximo `max` mensagens, mantendo-o válido para a API
 * do Gemini.
 *
 * Estratégia:
 * - Sempre preserva a primeira mensagem (instrução inicial do usuário, role
 *   'user' textual) — ela garante que o histórico continue começando com 'user'.
 * - Remove as mensagens mais antigas DEPOIS da inicial, mas avança o ponto de
 *   corte até a próxima fronteira de rodada (um turno 'model'), de modo que o
 *   elemento seguinte à inicial nunca seja um functionResponse órfão.
 *
 * Retorna sempre um novo array (não muta a entrada).
 */
export function podarHistorico(history: Content[], max: number): Content[] {
  if (history.length <= max) return history.slice();

  const inicial = history[0];

  // Queremos manter ~max mensagens: 1 (inicial) + (length - corte) <= max
  //   => corte >= length - max + 1
  let corte = history.length - max + 1;

  // Avança o corte até uma fronteira de rodada limpa (um turno 'model').
  while (corte < history.length && !ehInicioDeRodada(history[corte])) {
    corte++;
  }

  // Sem fronteira limpa até o fim: mantém apenas a instrução inicial.
  if (corte >= history.length) return [inicial];

  return [inicial, ...history.slice(corte)];
}
