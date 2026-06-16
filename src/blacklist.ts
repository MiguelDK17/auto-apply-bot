// Filtro declarativo de empresas/títulos que o candidato NUNCA quer ver
// (ex.: ex-empregador, concorrente). É uma regra determinística — mais robusta
// do que confiar no LLM "lembrar" de evitar uma empresa via prompt.
//
// Função pura e isolada (não acoplada ao scoring): exclusão dura é um conceito
// distinto de compatibilidade. Usa borda de palavra para evitar falsos
// positivos (ex.: "Globo" não deve casar com "Globant").

function normalizar(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Casa `termo` como palavra(s) inteira(s) dentro de `texto` (ambos normalizados). */
function contemPalavra(texto: string, termo: string): boolean {
  const t = normalizar(termo);
  if (!t) return false;
  return new RegExp(`\\b${escaparRegex(t)}\\b`).test(normalizar(texto));
}

export interface ResultadoBlacklist {
  bloqueado: boolean;
  motivo: string;
}

/**
 * Verifica se uma vaga deve ser bloqueada pela blacklist do candidato.
 * @param empresa          Nome da empresa da vaga
 * @param titulo           Título da vaga
 * @param blacklistEmpresas Nomes de empresa a bloquear
 * @param blacklistTermos   Termos no título a bloquear (ex.: "estagio", "pleno")
 */
export function estaNaBlacklist(
  empresa: string,
  titulo: string,
  blacklistEmpresas: string[] = [],
  blacklistTermos: string[] = [],
): ResultadoBlacklist {
  for (const e of blacklistEmpresas) {
    if (contemPalavra(empresa, e)) {
      return { bloqueado: true, motivo: `Empresa "${empresa}" esta na blacklist (regra: "${e}")` };
    }
  }
  for (const termo of blacklistTermos) {
    if (contemPalavra(titulo, termo)) {
      return { bloqueado: true, motivo: `Titulo "${titulo}" contem termo bloqueado "${termo}"` };
    }
  }
  return { bloqueado: false, motivo: '' };
}
