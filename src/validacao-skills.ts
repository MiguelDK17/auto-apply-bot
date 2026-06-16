// Validação anti-fabricação de skills + utilitários de limpeza de texto do LLM.
//
// Antes, a lista de tecnologias "suspeitas" e a lógica de detecção estavam
// DUPLICADAS (e divergentes) em cover-letter.ts, mensagem-recrutador.ts e
// curriculo-tailored.ts. Centralizar aqui evita que adicionar uma skill nova ao
// perfil exija editar três listas diferentes — fonte clássica de inconsistência.

import type { Perfil } from './types.js';

// Tecnologias que o candidato pode NÃO possuir. Se o LLM mencionar uma destas
// que não esteja nas skills reais do candidato, consideramos fabricação.
const TECNOLOGIAS_SUSPEITAS = [
  'python', 'django', 'flask', 'fastapi',
  'golang', 'go lang', 'rust',
  'c#', 'c sharp', '.net', 'asp.net',
  'angular', 'vue.js', 'vuejs', 'svelte',
  'kubernetes', 'k8s', 'terraform', 'ansible',
  'aws certified', 'azure certified', 'gcp certified',
  'machine learning', 'deep learning', 'tensorflow', 'pytorch',
  'scala', 'kotlin', 'swift', 'objective-c',
  'php', 'laravel', 'symfony',
  'ruby', 'rails',
  'elasticsearch', 'redis', 'kafka', 'rabbitmq',
  'graphql',
  'spring boot', 'spring cloud', 'spring security',
  'microservices architecture', 'event-driven architecture',
  'clean architecture', 'hexagonal architecture', 'ddd',
];

/** Reúne as skills reais do candidato (stack + bancos + metodologias). */
export function skillsReaisDoPerfil(perfil: Perfil): string[] {
  return [
    ...perfil.stack_principal,
    ...(perfil.bancos_de_dados ?? []),
    ...(perfil.metodologias ?? []),
  ];
}

/**
 * Detecta tecnologias fabricadas num texto: as da lista de suspeitas que
 * aparecem no texto mas NÃO constam nas skills reais do candidato.
 * O match com as skills reais é bidirecional para evitar falsos positivos
 * (ex.: "spring boot" coberto por uma skill real "Spring").
 */
export function detectarSkillsFabricadas(texto: string, skillsReais: string[]): string[] {
  const textoLower = texto.toLowerCase();
  const reais = skillsReais.map((s) => s.toLowerCase()).filter(Boolean);

  const fabricadas: string[] = [];
  for (const tech of TECNOLOGIAS_SUSPEITAS) {
    if (!textoLower.includes(tech)) continue;
    const ehReal = reais.some((s) => s.includes(tech) || tech.includes(s));
    if (!ehReal) fabricadas.push(tech);
  }
  return fabricadas;
}

/** Remove cercas de código markdown (```html ... ```) que o LLM às vezes adiciona. */
export function limparMarkdown(texto: string): string {
  let t = texto.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return t;
}
