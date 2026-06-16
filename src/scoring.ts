// Pontuação de compatibilidade de vagas (1-10) + critérios eliminatórios.
//
// Lógica pura e determinística. Além do score aditivo, aplica ELIMINATÓRIOS
// (idioma e localização): bloqueadores reais em que candidatar não faz sentido,
// independente de quão bem a stack bate. Antes o scoring era cego a isso (uma
// vaga que exige inglês fluente passava se a tech batesse) e a regra de
// localização estava hardcoded em "Uberlândia" no system prompt.

import type { NivelIngles } from './types.js';

export interface DadosVaga {
  tecnologias_pedidas?: string;
  senioridade?: string;
  localizacao?: string;
  modelo_trabalho?: string;
  /** Nível de inglês que a vaga exige (extraído da descrição pelo agente). */
  idioma_exigido?: string;
}

export interface PerfilFit {
  stackPrincipal: string[];
  cidade: string;
  /** Modelos de trabalho que o candidato aceita (ex.: ['remoto']). */
  modelosAceitos: string[];
  nivelIngles?: NivelIngles;
}

export interface ResultadoPontuacao {
  score: number;
  veredicto: 'APLICAR' | 'PULAR';
  motivo: string;
  /** Razões de eliminação; se houver alguma, o veredicto é sempre PULAR. */
  eliminatorios: string[];
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

/** Mapeia um nível de inglês textual para ordinal. -1 = desconhecido (não elimina). */
function nivelOrdinal(nivel?: string): number {
  const n = normalizarTexto(nivel ?? '');
  if (!n || n.includes('nenhum')) return 0;
  if (n.includes('basico')) return 1;
  if (n.includes('intermediario')) return 2;
  if (n.includes('avancado')) return 3;
  if (n.includes('fluente') || n.includes('nativo')) return 4;
  return -1;
}

/**
 * Pontua uma vaga de 1 a 10 e aplica critérios eliminatórios.
 *
 * @param vaga        Dados extraídos da vaga
 * @param perfil      Dados de fit do candidato (stack, cidade, modelos, inglês)
 * @param scoreMinimo Limiar para aplicar (vem do SCORE_MINIMO do .env)
 */
export function pontuarVaga(
  vaga: DadosVaga,
  perfil: PerfilFit,
  scoreMinimo: number,
): ResultadoPontuacao {
  const tecsPedidas = normalizarTexto(vaga.tecnologias_pedidas ?? '');
  const senioridade = normalizarTexto(vaga.senioridade ?? '');
  const localizacao = normalizarTexto(vaga.localizacao ?? '');
  const modelo = normalizarTexto(vaga.modelo_trabalho ?? '');

  let score = 5; // Base

  // Match de tecnologias: +1 por cada tech do candidato citada na vaga
  for (const tech of perfil.stackPrincipal) {
    const t = normalizarTexto(tech);
    if (t && tecsPedidas.includes(t)) score += 1;
  }

  // Senioridade
  if (senioridade.includes('senior')) score -= 2;
  if (senioridade.includes('pleno')) score += 1;
  if (senioridade.includes('junior')) score += 1;

  // Localização (penalidade/bônus; usa a cidade do perfil, não um valor fixo)
  const cidadeBase = normalizarCidade(perfil.cidade);
  const naCidade = !!cidadeBase && localizacao.includes(cidadeBase);
  const vagaPresencialOuHibrida = modelo.includes('presencial') || modelo.includes('hibrido');
  if (naCidade) {
    score += 1; // mesma cidade do candidato: aceita qualquer modelo
  } else if (vagaPresencialOuHibrida) {
    score -= 3; // fora da cidade e não remoto: penalidade forte
  }
  if (modelo.includes('remoto')) score += 1;

  // Clamp entre 1 e 10
  score = Math.max(1, Math.min(10, score));

  // ===== Critérios eliminatórios (forçam PULAR, independente do score) =====
  const eliminatorios: string[] = [];

  // Idioma: a vaga exige um nível de inglês acima do que o candidato declara.
  // Só dispara com dado dos dois lados (sem nível no perfil, não há base).
  if (vaga.idioma_exigido && perfil.nivelIngles) {
    const exigido = nivelOrdinal(vaga.idioma_exigido);
    const possui = nivelOrdinal(perfil.nivelIngles);
    if (exigido > 0 && possui >= 0 && exigido > possui) {
      eliminatorios.push(`Vaga exige ingles ${vaga.idioma_exigido}, candidato tem ${perfil.nivelIngles}`);
    }
  }

  // Localização: vaga presencial/híbrida fora da cidade quando o candidato só
  // aceita remoto. Aí não é só penalidade — é incompatível.
  const aceitaPresencial = perfil.modelosAceitos.some((m) => {
    const mn = normalizarTexto(m);
    return mn.includes('presencial') || mn.includes('hibrido');
  });
  if (vagaPresencialOuHibrida && !naCidade && !aceitaPresencial) {
    eliminatorios.push(
      `Vaga ${vaga.modelo_trabalho ?? 'presencial/hibrida'} fora de ${perfil.cidade}; candidato aceita apenas: ${perfil.modelosAceitos.join(', ')}`,
    );
  }

  const temEliminatorio = eliminatorios.length > 0;
  const aplicar = !temEliminatorio && score >= scoreMinimo;

  let motivo: string;
  if (temEliminatorio) {
    motivo = `PULAR (eliminatorio): ${eliminatorios.join('; ')}.`;
  } else if (aplicar) {
    motivo = `Score ${score}/10: compatibilidade suficiente (minimo ${scoreMinimo}).`;
  } else {
    motivo = `Score ${score}/10: abaixo do minimo (${scoreMinimo}). Pule para a proxima vaga.`;
  }

  return { score, veredicto: aplicar ? 'APLICAR' : 'PULAR', motivo, eliminatorios };
}
