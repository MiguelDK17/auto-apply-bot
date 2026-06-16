// Pontuação de compatibilidade de vagas (1-10).
//
// Lógica pura e determinística, extraída de tools.ts para ser testável e
// configurável. Antes o veredicto usava o literal 6 e a cidade "uberlandia"
// estava cravada no código — o que quebrava o scoring para qualquer pessoa que
// não morasse lá e ignorava o SCORE_MINIMO do .env. Agora recebe a cidade do
// perfil e o scoreMinimo como parâmetros.

export interface DadosVaga {
  tecnologias_pedidas?: string;
  senioridade?: string;
  localizacao?: string;
  modelo_trabalho?: string;
}

export interface ResultadoPontuacao {
  score: number;
  veredicto: 'APLICAR' | 'PULAR';
  motivo: string;
}

/** Remove acentos e normaliza para comparação (ex.: "Uberlândia" → "uberlandia"). */
function normalizarTexto(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Extrai a cidade base do perfil (parte antes da vírgula) já normalizada. */
function normalizarCidade(cidade: string): string {
  const base = (cidade ?? '').split(',')[0] ?? '';
  return normalizarTexto(base);
}

/**
 * Pontua uma vaga de 1 a 10 com base no match de tecnologias, senioridade,
 * localização e modelo de trabalho.
 *
 * @param vaga         Dados extraídos da vaga
 * @param stackPrincipal Tecnologias reais do candidato
 * @param cidade       Cidade do candidato (ex.: "Uberlândia, MG")
 * @param scoreMinimo  Limiar para aplicar (vem do SCORE_MINIMO do .env)
 */
export function pontuarVaga(
  vaga: DadosVaga,
  stackPrincipal: string[],
  cidade: string,
  scoreMinimo: number,
): ResultadoPontuacao {
  const tecsPedidas = normalizarTexto(vaga.tecnologias_pedidas ?? '');
  const senioridade = normalizarTexto(vaga.senioridade ?? '');
  const localizacao = normalizarTexto(vaga.localizacao ?? '');
  const modelo = normalizarTexto(vaga.modelo_trabalho ?? '');

  let score = 5; // Base

  // Match de tecnologias: +1 por cada tech do candidato citada na vaga
  for (const tech of stackPrincipal) {
    const t = normalizarTexto(tech);
    if (t && tecsPedidas.includes(t)) score += 1;
  }

  // Senioridade
  if (senioridade.includes('senior')) score -= 2;
  if (senioridade.includes('pleno')) score += 1;
  if (senioridade.includes('junior')) score += 1;

  // Localização: usa a cidade do perfil (não mais um valor fixo).
  const cidadeBase = normalizarCidade(cidade);
  if (cidadeBase && localizacao.includes(cidadeBase)) {
    score += 1; // mesma cidade do candidato: aceita qualquer modelo
  } else if (modelo.includes('presencial') || modelo.includes('hibrido')) {
    score -= 3; // fora da cidade e não remoto: penalidade forte
  }
  if (modelo.includes('remoto')) score += 1;

  // Clamp entre 1 e 10
  score = Math.max(1, Math.min(10, score));

  const aplicar = score >= scoreMinimo;
  return {
    score,
    veredicto: aplicar ? 'APLICAR' : 'PULAR',
    motivo: aplicar
      ? `Score ${score}/10: compatibilidade suficiente (minimo ${scoreMinimo}).`
      : `Score ${score}/10: abaixo do minimo (${scoreMinimo}). Pule para a proxima vaga.`,
  };
}
