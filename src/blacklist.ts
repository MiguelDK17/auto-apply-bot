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

/** Casa `termo` como palavra(s) inteira(s) dentro de `texto` (ambos normalizados).
 *  Usa bordas condicionais (início/fim ou caractere não-alfanumérico) em vez de
 *  \b, para também funcionar com termos que contêm símbolos (c++, .net, c#). */
function contemPalavra(texto: string, termo: string): boolean {
  const t = normalizar(termo);
  if (!t) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escaparRegex(t)}([^a-z0-9]|$)`);
  return re.test(normalizar(texto));
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
