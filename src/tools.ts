import type OpenAI from 'openai';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  verificarJaAplicou,
  registrarCandidatura,
  contarCandidaturasHoje,
  listarCandidaturas,
  registrarVagaVista,
  verificarVagaJaVista,
  atualizarScreenshot,
  buscarRespostaCache,
  buscarCandidatasCache,
  salvarRespostaCache,
  sanitizarPergunta,
  verificarRecrutadorJaContatado,
  registrarMensagemRecrutador,
  contarMensagensHoje,
} from './database.js';
import { log } from './logger.js';
import { notificarCandidatura, solicitarResolucaoCaptcha } from './notificacoes.js';
import { gerarCurriculoTailored } from './curriculo-tailored.js';
import { gerarCoverLetter } from './cover-letter.js';
import { gerarMensagemRecrutador } from './mensagem-recrutador.js';
import {
  ehFalhaPermanente,
  ehFalhaRetriavel,
  calcularBackoff,
  MAX_TENTATIVAS,
} from './erros.js';
import { pontuarVaga } from './scoring.js';
import { estaNaBlacklist } from './blacklist.js';
import type { Perfil, RespostasPredefinidas, AgenteConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Deriva o domínio registrável de uma URL (ex.: portal.gupy.io -> gupy.io,
 * www.vagas.com.br -> vagas.com.br). Usado para agrupar URLs do mesmo portal e
 * abandonar o portal inteiro quando ele bloqueia na entrada. Retorna '' se a URL
 * for inválida.
 */
export function dominioDe(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    // Endereço IP (v4/v6): a heurística de SLD não se aplica — retorna o host inteiro.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host;
    const p = host.split('.');
    if (p.length <= 2) return host;
    // Trata TLDs de 2 níveis (com.br, etc.): pega 3 rótulos quando o penúltimo é SLD.
    const slds = new Set(['com', 'net', 'org', 'gov', 'edu', 'co']);
    return slds.has(p[p.length - 2]) ? p.slice(-3).join('.') : p.slice(-2).join('.');
  } catch {
    return '';
  }
}

interface CurriculoEntry {
  id: string;
  arquivo: string;
  foco: string;
  usar_quando: string;
}

interface CurriculosConfig {
  fallback: CurriculoEntry;
  curriculos: CurriculoEntry[];
}

function carregarCurriculos(): CurriculosConfig {
  const caminho = path.resolve(__dirname, '..', 'config', 'curriculos.json');
  return JSON.parse(readFileSync(caminho, 'utf-8'));
}

// ========== DEFINICAO DAS TOOLS (padrão OpenAI Function Calling) ==========
// As definições abaixo usam JSON Schema puro — agnósticas a provedor. Qualquer
// SDK compatível com a API OpenAI (OpenAI, OpenRouter, Ollama, vLLM, etc.)
// aceita este formato via `tools: [{ type: "function", function: {...} }]`.

interface CustomToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const customToolDefs: CustomToolDef[] = [
  {
    name: 'obter_perfil_candidato',
    description:
      'Retorna todos os dados pessoais e profissionais do candidato para preencher formularios e gerar respostas personalizadas.',
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: 'verificar_ja_aplicou',
    description:
      'Verifica no banco de dados se o candidato ja se candidatou a uma vaga especifica pela URL. Retorna verdadeiro ou falso.',
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: 'URL completa da vaga para verificar',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'registrar_candidatura',
    description:
      'Registra no banco de dados que uma candidatura foi realizada com sucesso. Chamar APOS preencher e enviar o formulario.',
    parameters: {
      type: "object",
      properties: {
        plataforma: {
          type: "string",
          description: 'Nome da plataforma (ex: Gupy, LinkedIn, Vagas.com)',
        },
        titulo_vaga: {
          type: "string",
          description: 'Titulo da vaga',
        },
        empresa: {
          type: "string",
          description: 'Nome da empresa',
        },
        url: {
          type: "string",
          description: 'URL da vaga',
        },
        mensagem_enviada: {
          type: "boolean",
          description: 'Se uma mensagem personalizada foi enviada ao recrutador',
        },
        score: {
          type: "number",
          description: 'Score da vaga (1-10) calculado por pontuar_vaga. Inclua sempre — alimenta o dashboard e as estatisticas.',
        },
      },
      required: ['plataforma', 'titulo_vaga', 'empresa', 'url'],
    },
  },
  {
    name: 'confirmar_envio',
    description:
      'OBRIGATORIA antes de QUALQUER clique de envio final: botao "Candidatar-se"/"Quero me candidatar"/"Enviar"/"Submeter"/"Finalizar", ou envio de convite/mensagem ao recrutador. Chame esta tool IMEDIATAMENTE antes do clique terminal. Em modo dry-run o sistema BLOQUEIA o envio (nao clique; registre como dry-run e siga). Em producao o sistema libera o clique. E a trava de seguranca que protege o usuario de envios indevidos.',
    parameters: {
      type: "object",
      properties: {
        url_vaga: {
          type: "string",
          description: 'URL da vaga/pagina onde o envio ocorreria',
        },
        acao: {
          type: "string",
          description: 'O que sera enviado (ex: "candidatura", "mensagem ao recrutador")',
        },
      },
      required: ['url_vaga'],
    },
  },
  {
    name: 'contar_candidaturas_hoje',
    description:
      'Retorna quantas candidaturas ja foram feitas hoje. Use para verificar se atingiu o limite diario.',
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: 'listar_candidaturas_recentes',
    description:
      'Lista as ultimas candidaturas feitas para referencia e evitar duplicatas.',
    parameters: {
      type: "object",
      properties: {
        limite: {
          type: "number",
          description: 'Quantidade de candidaturas para retornar (padrao: 20)',
        },
      },
    },
  },
  {
    name: 'pontuar_vaga',
    description:
      'Avalia o quanto uma vaga combina com o perfil do candidato (score de 1 a 10). SEMPRE use ANTES de decidir se vai aplicar. Se o score for menor que o minimo configurado, PULE a vaga.',
    parameters: {
      type: "object",
      properties: {
        titulo_vaga: {
          type: "string",
          description: 'Titulo da vaga',
        },
        empresa: {
          type: "string",
          description: 'Nome da empresa',
        },
        tecnologias_pedidas: {
          type: "string",
          description: 'Lista de tecnologias/requisitos que a vaga pede',
        },
        senioridade: {
          type: "string",
          description: 'Nivel de senioridade pedido (junior, pleno, senior, etc.)',
        },
        modelo_trabalho: {
          type: "string",
          description: 'Modelo de trabalho (remoto, hibrido, presencial)',
        },
        localizacao: {
          type: "string",
          description: 'Cidade/estado da vaga',
        },
        idioma_exigido: {
          type: "string",
          description: 'Nivel de ingles que a vaga EXIGE, se mencionado na descricao: nenhum, basico, intermediario, avancado ou fluente. Deixe vazio se a vaga nao exige ingles.',
        },
      },
      required: ['titulo_vaga', 'tecnologias_pedidas'],
    },
  },
  {
    name: 'escolher_curriculo',
    description:
      'Escolhe o curriculo mais adequado para a vaga com base na descricao. Retorna o caminho do PDF correto para upload. SEMPRE use esta tool ANTES de fazer upload de curriculo.',
    parameters: {
      type: "object",
      properties: {
        descricao_vaga: {
          type: "string",
          description: 'Resumo da descricao da vaga (tecnologias pedidas, tipo de cargo, area de atuacao)',
        },
      },
      required: ['descricao_vaga'],
    },
  },
  {
    name: 'aguardar',
    description:
      'Aguarda um tempo aleatorio entre acoes para simular comportamento humano. SEMPRE use entre acoes de navegacao.',
    parameters: {
      type: "object",
      properties: {
        min_ms: {
          type: "number",
          description: 'Tempo minimo em milissegundos (padrao: 2000)',
        },
        max_ms: {
          type: "number",
          description: 'Tempo maximo em milissegundos (padrao: 5000)',
        },
      },
    },
  },
  {
    name: 'salvar_screenshot',
    description:
      'Salva o screenshot atual da pagina como prova da candidatura. Use APOS submeter (ou simular no dry-run) a candidatura. Passe os dados base64 do screenshot obtido via browser_take_screenshot.',
    parameters: {
      type: "object",
      properties: {
        url_vaga: {
          type: "string",
          description: 'URL da vaga para associar o screenshot',
        },
        screenshot_base64: {
          type: "string",
          description: 'Dados base64 do screenshot (obtido via browser_take_screenshot)',
        },
        empresa: {
          type: "string",
          description: 'Nome da empresa (para nomear o arquivo)',
        },
      },
      required: ['url_vaga', 'screenshot_base64', 'empresa'],
    },
  },
  {
    name: 'verificar_vaga_ja_vista',
    description:
      'Verifica se uma vaga ja foi vista/analisada anteriormente (mesmo que nao tenha sido aplicada). Evita perder tempo reanalisando vagas ja descartadas. Use ANTES de analisar uma vaga em detalhe.',
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: 'URL da vaga para verificar',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'registrar_vaga_vista',
    description:
      'Registra que uma vaga foi vista/analisada. Use para vagas que foram PULADAS (score baixo, localizacao errada, etc.) para nao reanalisar no futuro.',
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: 'URL da vaga',
        },
        titulo_vaga: {
          type: "string",
          description: 'Titulo da vaga',
        },
        empresa: {
          type: "string",
          description: 'Nome da empresa',
        },
        plataforma: {
          type: "string",
          description: 'Plataforma (Gupy, Vagas.com, etc.)',
        },
        score: {
          type: "number",
          description: 'Score calculado da vaga',
        },
        motivo_pulo: {
          type: "string",
          description: 'Motivo pelo qual a vaga foi pulada',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'obter_respostas_predefinidas',
    description:
      'Retorna as respostas pre-definidas do candidato para perguntas comuns em formularios (pretensao salarial, disponibilidade, pontos fortes, etc.). Use como BASE para variar as respostas.',
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: 'gerar_curriculo_tailored',
    description:
      'Gera um curriculo PDF personalizado para a vaga especifica. O curriculo e reescrito por IA para destacar as skills relevantes para ESTA vaga, mantendo APENAS dados reais do candidato. Use ANTES de fazer upload do curriculo. Se falhar, faca fallback para escolher_curriculo.',
    parameters: {
      type: "object",
      properties: {
        descricao_vaga: {
          type: "string",
          description: 'Descricao COMPLETA da vaga (copie o maximo de detalhes: requisitos, responsabilidades, tecnologias, senioridade)',
        },
        titulo_vaga: {
          type: "string",
          description: 'Titulo da vaga (ex: Desenvolvedor Backend Java)',
        },
        empresa: {
          type: "string",
          description: 'Nome da empresa',
        },
      },
      required: ['descricao_vaga'],
    },
  },
  {
    name: 'gerar_cover_letter',
    description:
      'Gera uma carta de apresentacao personalizada para a vaga. Retorna texto pronto para colar no campo do formulario. Use quando o formulario pedir "carta de apresentacao", "cover letter", "por que voce quer trabalhar aqui" (campo longo), ou "apresente-se".',
    parameters: {
      type: "object",
      properties: {
        descricao_vaga: {
          type: "string",
          description: 'Descricao da vaga (requisitos, responsabilidades)',
        },
        titulo_vaga: {
          type: "string",
          description: 'Titulo da vaga',
        },
        empresa: {
          type: "string",
          description: 'Nome da empresa',
        },
      },
      required: ['descricao_vaga', 'empresa', 'titulo_vaga'],
    },
  },
  {
    name: 'buscar_resposta_cache',
    description:
      'Busca no cache se essa pergunta de formulario ja foi respondida antes. Use ANTES de gerar uma resposta nova. Se retornar um cache hit, use a resposta cacheada (pode variar levemente a forma). Economiza tokens e garante consistencia.',
    parameters: {
      type: "object",
      properties: {
        pergunta: {
          type: "string",
          description: 'Texto da pergunta/label do campo do formulario',
        },
        tipo_campo: {
          type: "string",
          description: 'Tipo do campo: textbox, numeric, dropdown, radio, date, textarea',
        },
      },
      required: ['pergunta', 'tipo_campo'],
    },
  },
  {
    name: 'salvar_resposta_cache',
    description:
      'Salva uma resposta no cache para reutilizar em formularios futuros. Use APOS preencher um campo com uma resposta gerada. NAO salve: cover letters, respostas que mencionam o nome da empresa, ou campos de data especificos.',
    parameters: {
      type: "object",
      properties: {
        pergunta: {
          type: "string",
          description: 'Texto da pergunta/label do campo',
        },
        tipo_campo: {
          type: "string",
          description: 'Tipo do campo: textbox, numeric, dropdown, radio, date, textarea',
        },
        resposta: {
          type: "string",
          description: 'Resposta que foi usada no campo',
        },
        empresa_atual: {
          type: "string",
          description: 'Nome da empresa da vaga atual (para validar se a resposta e generica o suficiente para cachear)',
        },
      },
      required: ['pergunta', 'tipo_campo', 'resposta'],
    },
  },
  {
    name: 'reportar_falha',
    description:
      'Reporta uma falha encontrada durante o processo de candidatura. Classifica automaticamente como PERMANENTE (nunca retentar) ou RETRIAVEL (tentar novamente). Use quando encontrar erros como: vaga expirada, CAPTCHA, timeout, erro de rede, formulario incompativel, etc. Codigos permanentes: vaga_expirada, captcha, sessao_expirada, localizacao_inelegivel, ja_aplicou, conta_necessaria, nao_e_vaga, sso_obrigatorio, site_bloqueado, cloudflare, portal_bloqueado (bloqueio na pagina de busca — abandona o portal inteiro), formulario_incompativel, vaga_interna, idioma_incompativel. Codigos retriaveis: timeout, erro_rede, pagina_nao_carregou, erro_servidor, elemento_nao_encontrado, erro_upload, erro_mcp.',
    parameters: {
      type: "object",
      properties: {
        url_vaga: {
          type: "string",
          description: 'URL da vaga onde ocorreu a falha',
        },
        codigo_falha: {
          type: "string",
          description: 'Codigo da falha (ex: vaga_expirada, captcha, timeout, erro_rede)',
        },
        descricao: {
          type: "string",
          description: 'Descricao livre do que aconteceu',
        },
        titulo_vaga: {
          type: "string",
          description: 'Titulo da vaga (se disponivel)',
        },
        empresa: {
          type: "string",
          description: 'Nome da empresa (se disponivel)',
        },
        plataforma: {
          type: "string",
          description: 'Plataforma (Gupy, Vagas.com, etc.)',
        },
      },
      required: ['url_vaga', 'codigo_falha', 'descricao'],
    },
  },
  {
    name: 'resolver_captcha_telegram',
    description:
      'Envia screenshot de um CAPTCHA/desafio anti-bot para o Telegram e pede que o usuario o resolva MANUALMENTE no Chrome aberto, respondendo OK ou PULAR. Retorna status RESOLVIDO / PULAR / TIMEOUT (NAO retorna texto para digitar — reCAPTCHA/Turnstile nao funcionam por digitacao). Apos RESOLVIDO, reverifique a pagina com browser_snapshot. REQUER: Telegram configurado (.env). Timeout: 5 minutos.',
    parameters: {
      type: "object",
      properties: {
        screenshot_base64: {
          type: "string",
          description: 'Screenshot do CAPTCHA em base64 (obtido via browser_take_screenshot)',
        },
        url_vaga: {
          type: "string",
          description: 'URL da pagina onde o CAPTCHA apareceu',
        },
      },
      required: ['screenshot_base64', 'url_vaga'],
    },
  },
  {
    name: 'gerar_mensagem_recrutador',
    description:
      'Gera uma mensagem personalizada para enviar ao recrutador/hiring manager da vaga via LinkedIn. A mensagem tem no maximo 280 caracteres (nota de conexao). Use SOMENTE quando: (1) a vaga tem score alto (>= 8), (2) voce identificou o recrutador na pagina da vaga, e (3) o recrutador NAO foi contatado antes. A mensagem usa dados REAIS do candidato e destaca intersecoes com a vaga.',
    parameters: {
      type: "object",
      properties: {
        nome_recrutador: {
          type: "string",
          description: 'Nome do recrutador/hiring manager (encontrado na pagina da vaga ou perfil LinkedIn)',
        },
        cargo_recrutador: {
          type: "string",
          description: 'Cargo do recrutador (Recruiter, HR Manager, Tech Lead, etc.)',
        },
        empresa: {
          type: "string",
          description: 'Nome da empresa',
        },
        titulo_vaga: {
          type: "string",
          description: 'Titulo da vaga',
        },
        descricao_vaga: {
          type: "string",
          description: 'Descricao da vaga (requisitos, responsabilidades)',
        },
      },
      required: ['nome_recrutador', 'empresa', 'titulo_vaga', 'descricao_vaga'],
    },
  },
  {
    name: 'verificar_recrutador_ja_contatado',
    description:
      'Verifica se um recrutador ja foi contatado anteriormente (pelo URL do perfil LinkedIn). Use ANTES de gerar mensagem para evitar enviar mensagem duplicada.',
    parameters: {
      type: "object",
      properties: {
        url_perfil: {
          type: "string",
          description: 'URL do perfil LinkedIn do recrutador',
        },
      },
      required: ['url_perfil'],
    },
  },
  {
    name: 'registrar_mensagem_recrutador',
    description:
      'Registra no banco que uma mensagem foi enviada para um recrutador. Use APOS enviar o convite de conexao com sucesso no LinkedIn.',
    parameters: {
      type: "object",
      properties: {
        nome_recrutador: {
          type: "string",
          description: 'Nome do recrutador',
        },
        cargo_recrutador: {
          type: "string",
          description: 'Cargo do recrutador',
        },
        empresa: {
          type: "string",
          description: 'Nome da empresa',
        },
        url_perfil: {
          type: "string",
          description: 'URL do perfil LinkedIn do recrutador',
        },
        url_vaga: {
          type: "string",
          description: 'URL da vaga associada',
        },
        titulo_vaga: {
          type: "string",
          description: 'Titulo da vaga',
        },
        mensagem: {
          type: "string",
          description: 'Texto da mensagem que foi enviada',
        },
        score_vaga: {
          type: "number",
          description: 'Score da vaga (1-10)',
        },
      },
      required: ['nome_recrutador', 'empresa', 'url_perfil', 'mensagem'],
    },
  },
];

/**
 * Definições no formato oficial OpenAI `ChatCompletionTool`
 * (`{ type: "function", function: { name, description, parameters } }`).
 * É este array que o loop do agente envia em
 * `openai.chat.completions.create({ tools })` — funciona com qualquer
 * provedor OpenAI-compatible (OpenAI, OpenRouter, Ollama, vLLM, ...).
 */
export const customTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  customToolDefs.map((d) => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description,
      parameters: {
        type: 'object',
        properties: d.parameters.properties,
        ...(d.parameters.required ? { required: d.parameters.required } : {}),
      },
    },
  }));

/** Nomes das tools customizadas — para o dispatcher saber o que é local vs MCP. */
export const customToolNames: ReadonlySet<string> = new Set(
  customToolDefs.map((d) => d.name),
);

/** Retorna true se `name` é uma tool customizada (executada localmente). */
export function ehToolCustomizada(name: string): boolean {
  return customToolNames.has(name);
}

// ========== EXECUTOR DAS TOOLS ==========

export function criarExecutorDeTools(perfil: Perfil, config: AgenteConfig) {
  // Config injetada (não mais globais mutáveis): permite dry-run autoritativo e
  // scoring configurável, e torna o executor previsível para testes.
  // NOTA: o executor NÃO depende de nenhum LLM de navegação — as tarefas
  // pesadas (cover letter, currículo, mensagem) usam o provider auxiliar
  // isolado em src/llm-adapter.ts (LLM_AUX_*), que pode ser um provedor
  // totalmente diferente do agente.
  // Tentativas por URL (controle de retry, adaptado do ApplyPilot): escopo por
  // execução — recriado a cada chamada. No modo cron isso evita carregar
  // contadores de retry de execuções anteriores.
  const tentativasPorUrl = new Map<string, number>();
  // Teto de envios confirmados NESTA execução (anti-rajada). Aplicado quando o
  // agente passa pelo checkpoint confirmar_envio; a trava 100% determinística
  // de gravação é o gate em registrar_candidatura.
  let enviosConfirmados = 0;
  // Portais que bloquearam na entrada NESTA execução — abandonados por completo
  // (não adianta tentar outras URLs/páginas; só queima iterações e risco de ban).
  const portaisBloqueados = new Set<string>();
  return async function executarTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'obter_perfil_candidato': {
        return JSON.stringify(perfil, null, 2);
      }

      case 'verificar_ja_aplicou': {
        const url = args.url as string;
        const jaAplicou = verificarJaAplicou(url);
        return jaAplicou
          ? 'JA_APLICOU: O candidato ja se candidatou a esta vaga. Pule para a proxima.'
          : 'NOVA_VAGA: O candidato ainda nao se candidatou. Pode prosseguir.';
      }

      case 'registrar_candidatura': {
        const score = (args.score as number) || 0;
        const empresa = args.empresa as string;
        const tituloVaga = args.titulo_vaga as string;

        // Guard de blacklist (garantia por construcao, mesmo se o agente furar o pre-filtro).
        const blReg = estaNaBlacklist(empresa, tituloVaga, perfil.blacklist_empresas, perfil.blacklist_termos_titulo);
        if (blReg.bloqueado) {
          log('AGENTE', `Candidatura BLOQUEADA (blacklist): ${tituloVaga} — ${empresa}`);
          return JSON.stringify({
            registrado: false,
            motivo: 'BLACKLIST',
            mensagem: `${blReg.motivo}. Candidatura NAO registrada. Pule para a proxima vaga.`,
          });
        }

        // GATE DETERMINISTICO: o codigo garante por construcao que vagas abaixo
        // do score minimo NUNCA sejam registradas, independente do que o LLM
        // decida. Sem isso, o gate de score era apenas uma instrucao no prompt.
        if (score < config.scoreMinimo) {
          log('AGENTE', `Candidatura BLOQUEADA (score ${score} < minimo ${config.scoreMinimo}): ${tituloVaga} — ${empresa}`);
          return JSON.stringify({
            registrado: false,
            motivo: 'SCORE_ABAIXO_DO_MINIMO',
            mensagem: `Score ${score} abaixo do minimo ${config.scoreMinimo}. Candidatura NAO registrada. Se ainda nao pontuou esta vaga com pontuar_vaga, faca isso; se ja pontuou e ficou abaixo do minimo, PULE para a proxima vaga.`,
          });
        }

        // Dry-run é autoritativo via config — não depende mais de o LLM lembrar
        // de passar um argumento (que sequer era declarado na tool).
        const isDryRun = config.dryRun;
        const sucesso = registrarCandidatura({
          plataforma: args.plataforma as string,
          titulo_vaga: tituloVaga,
          empresa,
          url: args.url as string,
          mensagem_enviada: args.mensagem_enviada ? 1 : 0,
          status: isDryRun ? 'dry-run' : 'aplicado',
          score,
        });
        if (sucesso) {
          log('AGENTE', `Candidatura registrada: ${tituloVaga} — ${empresa} (score: ${score})`);
          notificarCandidatura(empresa, tituloVaga, score, isDryRun).catch(() => {});
        }
        return sucesso
          ? 'REGISTRADO: Candidatura salva no banco de dados com sucesso.'
          : 'ERRO: Falha ao registrar candidatura (possivelmente duplicada).';
      }

      case 'confirmar_envio': {
        const urlVaga = (args.url_vaga as string) || '';
        const acao = (args.acao as string) || 'envio';

        // CHECKPOINT DE ENVIO (cooperativo): o agente é instruído a chamar esta
        // tool antes do clique de envio. Em dry-run respondemos "bloqueado" e
        // aplicamos o teto, mas o clique em si é uma browser tool do MCP que o
        // LLM controla — então isto reduz risco e conta os envios, NÃO é uma
        // barreira física. A garantia 100% determinística de que nada vira
        // candidatura "aplicada" está no gate de registrar_candidatura.
        if (config.dryRun) {
          log('AGENTE', `DRY-RUN: envio bloqueado pelo sistema (${acao}) — ${urlVaga}`);
          return JSON.stringify({
            permitido: false,
            modo: 'dry-run',
            mensagem: `DRY-RUN: o envio (${acao}) foi BLOQUEADO pelo sistema. NAO clique no botao de envio final. Registre a candidatura com registrar_candidatura (sera gravada como dry-run) e siga para a proxima vaga.`,
          });
        }

        // Teto por execução: trava determinística contra rajada de envios reais.
        if (enviosConfirmados >= config.maxPorExecucao) {
          log('AGENTE', `Teto por execucao atingido (${config.maxPorExecucao}). Envio bloqueado — ${urlVaga}`);
          return JSON.stringify({
            permitido: false,
            modo: 'producao',
            motivo: 'TETO_POR_EXECUCAO',
            mensagem: `Limite de ${config.maxPorExecucao} envios por execucao atingido. NAO envie mais. Finalize a execucao com um resumo.`,
          });
        }

        enviosConfirmados += 1;
        log('AGENTE', `Envio liberado (${acao}) ${enviosConfirmados}/${config.maxPorExecucao} — ${urlVaga}`);
        return JSON.stringify({
          permitido: true,
          modo: 'producao',
          mensagem: 'PODE_ENVIAR: envio liberado pelo sistema. Pode clicar no botao de envio final agora.',
        });
      }

      case 'contar_candidaturas_hoje': {
        const total = contarCandidaturasHoje();
        return `Total de candidaturas hoje: ${total}`;
      }

      case 'listar_candidaturas_recentes': {
        const limite = (args.limite as number) || 20;
        const candidaturas = listarCandidaturas(limite);
        return JSON.stringify(candidaturas, null, 2);
      }

      case 'pontuar_vaga': {
        // Lógica pura extraída para src/scoring.ts: usa a cidade do perfil e o
        // SCORE_MINIMO configurável (antes "uberlandia" e 6 estavam hardcoded).
        const resultado = pontuarVaga(
          {
            tecnologias_pedidas: args.tecnologias_pedidas as string | undefined,
            senioridade: args.senioridade as string | undefined,
            localizacao: args.localizacao as string | undefined,
            modelo_trabalho: args.modelo_trabalho as string | undefined,
            idioma_exigido: args.idioma_exigido as string | undefined,
          },
          {
            stackPrincipal: perfil.stack_principal,
            cidade: perfil.cidade,
            modelosAceitos: perfil.modelo_trabalho,
            nivelIngles: perfil.nivel_ingles,
          },
          config.scoreMinimo,
        );

        // Blacklist declarativa do candidato (exclusão dura, separada do score):
        // mais robusta que confiar no LLM lembrar de evitar uma empresa.
        const blPontuar = estaNaBlacklist(
          (args.empresa as string) || '',
          (args.titulo_vaga as string) || '',
          perfil.blacklist_empresas,
          perfil.blacklist_termos_titulo,
        );
        if (blPontuar.bloqueado) {
          return JSON.stringify({
            score: resultado.score,
            veredicto: 'PULAR',
            motivo: blPontuar.motivo,
            eliminatorios: [blPontuar.motivo],
          });
        }
        return JSON.stringify(resultado);
      }

      case 'escolher_curriculo': {
        const descricao = ((args.descricao_vaga as string) || '').toLowerCase();
        // Nome próprio (não 'config') para não sombrear o AgenteConfig do executor.
        const curriculosConfig = carregarCurriculos();

        // Mapeamento de palavras-chave para cada curriculo
        const mapeamento: Record<string, string[]> = {
          'backend-java': ['backend', 'back-end', 'back end', 'java', 'api rest', 'apis rest', 'microsservico', 'microservico', 'servidor'],
          'java-enterprise': ['corporativo', 'camunda', 'automacao de processos', 'integracao de sistemas', 'consultoria', 'gestao'],
          'full-stack-backend': ['full stack', 'fullstack', 'full-stack', 'backend', 'java', 'react'],
          'full-stack': ['full stack', 'fullstack', 'full-stack', 'ponta a ponta', 'end to end'],
          'mobile-react-native': ['mobile', 'react native', 'expo', 'ios', 'android', 'aplicativo', 'app mobile'],
        };

        let melhorMatch = '';
        let maiorScore = 0;

        for (const [id, keywords] of Object.entries(mapeamento)) {
          const score = keywords.reduce((acc, kw) => acc + (descricao.includes(kw) ? 1 : 0), 0);
          if (score > maiorScore) {
            maiorScore = score;
            melhorMatch = id;
          }
        }

        // Fallback: se nenhum score ou score muito baixo, usa o curriculo original
        if (maiorScore === 0) {
          const fallbackPath = path.resolve(__dirname, '..', curriculosConfig.fallback.arquivo);
          return JSON.stringify({
            curriculo_escolhido: 'original',
            foco: curriculosConfig.fallback.foco,
            caminho: fallbackPath,
            motivo: 'Nenhum curriculo especifico se encaixou. Usando curriculo original como fallback.',
          });
        }

        const curriculo = curriculosConfig.curriculos.find(c => c.id === melhorMatch);
        if (!curriculo) {
          const fallbackPath = path.resolve(__dirname, '..', curriculosConfig.fallback.arquivo);
          return JSON.stringify({
            curriculo_escolhido: 'original',
            foco: curriculosConfig.fallback.foco,
            caminho: fallbackPath,
            motivo: 'Curriculo especifico nao encontrado. Usando curriculo original como fallback.',
          });
        }

        const caminhoAbsoluto = path.resolve(__dirname, '..', curriculo.arquivo);
        return JSON.stringify({
          curriculo_escolhido: curriculo.id,
          foco: curriculo.foco,
          caminho: caminhoAbsoluto,
          motivo: `Escolhido "${curriculo.foco}" com score ${maiorScore} para a vaga descrita.`,
        });
      }

      case 'aguardar': {
        // Usa os defaults de config (DELAY_MIN/DELAY_MAX do .env) quando o LLM
        // não especifica — antes essas variáveis eram lidas mas nunca usadas.
        const min = (args.min_ms as number) || config.delayMin;
        const max = (args.max_ms as number) || config.delayMax;
        const tempo = Math.floor(Math.random() * (max - min + 1)) + min;
        await new Promise((resolve) => setTimeout(resolve, tempo));
        return `Aguardou ${tempo}ms com sucesso.`;
      }

      case 'salvar_screenshot': {
        const screenshotsDir = path.resolve(__dirname, '..', 'screenshots');
        if (!existsSync(screenshotsDir)) {
          mkdirSync(screenshotsDir, { recursive: true });
        }

        const empresaNome = (args.empresa as string).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const nomeArquivo = `${timestamp}_${empresaNome}.png`;
        const caminhoCompleto = path.join(screenshotsDir, nomeArquivo);

        try {
          const base64Data = args.screenshot_base64 as string;
          const buffer = Buffer.from(base64Data, 'base64');
          writeFileSync(caminhoCompleto, buffer);
          atualizarScreenshot(args.url_vaga as string, caminhoCompleto);
          log('TOOL', `Screenshot salvo: ${nomeArquivo}`);
          return `Screenshot salvo com sucesso em: ${caminhoCompleto}`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log('ERRO', `Falha ao salvar screenshot: ${msg}`);
          return `ERRO ao salvar screenshot: ${msg}`;
        }
      }

      case 'verificar_vaga_ja_vista': {
        const url = args.url as string;
        const jaVista = verificarVagaJaVista(url);
        return jaVista
          ? 'JA_VISTA: Esta vaga ja foi analisada anteriormente. Pule para a proxima.'
          : 'NOVA: Esta vaga ainda nao foi vista. Pode analisar.';
      }

      case 'registrar_vaga_vista': {
        const sucesso = registrarVagaVista({
          url: args.url as string,
          titulo_vaga: args.titulo_vaga as string | undefined,
          empresa: args.empresa as string | undefined,
          plataforma: args.plataforma as string | undefined,
          score: args.score as number | undefined,
          motivo_pulo: args.motivo_pulo as string | undefined,
        });
        return sucesso
          ? 'REGISTRADO: Vaga marcada como vista.'
          : 'ERRO: Falha ao registrar vaga vista.';
      }

      case 'obter_respostas_predefinidas': {
        try {
          const caminho = path.resolve(__dirname, '..', 'config', 'respostas.json');
          const conteudo = readFileSync(caminho, 'utf-8');
          const respostas = JSON.parse(conteudo) as RespostasPredefinidas;
          // Remove campos internos
          const { _comentario, _todo_preencher, ...respostasUteis } = respostas as Record<string, unknown>;
          return JSON.stringify(respostasUteis, null, 2);
        } catch {
          return 'ERRO: Arquivo config/respostas.json nao encontrado.';
        }
      }

      case 'buscar_resposta_cache': {
        const pergunta = args.pergunta as string;
        const tipoCampo = args.tipo_campo as string;

        // 1. Busca exact match / substring match
        const cacheHit = buscarRespostaCache(pergunta, tipoCampo);
        if (cacheHit) {
          log('TOOL', `Cache HIT (exact): "${pergunta.substring(0, 50)}..." → "${cacheHit.resposta.substring(0, 50)}..." (usada ${cacheHit.vezes_usada}x)`);
          return JSON.stringify({
            encontrado: true,
            metodo: 'exact',
            resposta: cacheHit.resposta,
            vezes_usada: cacheHit.vezes_usada,
            instrucao: 'Use esta resposta. Pode variar levemente a forma de escrever mas mantenha o conteudo.',
          });
        }

        // 2. Busca candidatas por palavras-chave para matching semântico
        const candidatas = buscarCandidatasCache(pergunta);
        if (candidatas.length > 0) {
          log('TOOL', `Cache: ${candidatas.length} candidata(s) encontrada(s) para matching semantico`);
          return JSON.stringify({
            encontrado: false,
            candidatas: candidatas.map(c => ({
              pergunta_original: c.pergunta_sanitizada,
              resposta: c.resposta,
              tipo: c.tipo_campo,
            })),
            instrucao: 'Nenhum match exato. Verifique se alguma candidata e semanticamente equivalente. Se sim, reutilize a resposta (variando a forma). Se nao, gere uma resposta nova e salve no cache.',
          });
        }

        log('TOOL', `Cache MISS: "${pergunta.substring(0, 50)}..."`);
        return JSON.stringify({
          encontrado: false,
          candidatas: [],
          instrucao: 'Nenhuma resposta no cache. Gere uma resposta nova e salve no cache apos preencher o campo.',
        });
      }

      case 'salvar_resposta_cache': {
        const pergunta = args.pergunta as string;
        const tipoCampo = args.tipo_campo as string;
        const resposta = args.resposta as string;
        const empresaAtual = (args.empresa_atual as string) || '';

        // Regra do AIHawk: não cachear respostas que mencionam o nome da empresa
        if (empresaAtual && resposta.toLowerCase().includes(empresaAtual.toLowerCase())) {
          log('TOOL', `Cache SKIP: resposta menciona "${empresaAtual}" (especifica demais para cachear)`);
          return 'NAO_CACHEADO: Resposta menciona o nome da empresa e e especifica demais para reutilizar em outras vagas.';
        }

        const sucesso = salvarRespostaCache(pergunta, tipoCampo, resposta);
        if (sucesso) {
          log('TOOL', `Cache SAVE: "${sanitizarPergunta(pergunta).substring(0, 50)}..." → "${resposta.substring(0, 50)}..."`);
          return 'CACHEADO: Resposta salva no cache para reutilizacao futura.';
        }
        return 'JA_EXISTE: Essa pergunta ja existe no cache.';
      }

      case 'reportar_falha': {
        const urlVaga = args.url_vaga as string;
        const codigoFalha = args.codigo_falha as string;
        const descricaoFalha = args.descricao as string;
        const dominio = dominioDe(urlVaga);

        // P7: portal já bloqueado nesta execução — nem tenta, manda pular o site.
        if (dominio && portaisBloqueados.has(dominio)) {
          return JSON.stringify({
            tipo: 'PORTAL_BLOQUEADO',
            acao: 'PULAR_PORTAL',
            mensagem: `O portal ${dominio} ja foi bloqueado nesta execucao. Va direto para o PROXIMO SITE.`,
          });
        }

        // Bloqueio explícito na ENTRADA do portal: abandona o portal inteiro.
        if (codigoFalha === 'portal_bloqueado') {
          if (dominio) portaisBloqueados.add(dominio);
          log('FALHA', `PORTAL BLOQUEADO: ${dominio || urlVaga} — abandonando o portal nesta execucao`);
          if (!config.dryRun) await new Promise(r => setTimeout(r, 30_000)); // pausa pós-bloqueio
          return JSON.stringify({
            tipo: 'PORTAL_BLOQUEADO',
            acao: 'PULAR_PORTAL',
            mensagem: `Bloqueio na entrada do portal ${dominio || urlVaga}. NAO tente outras URLs nem pagine aqui. Va para o PROXIMO SITE da lista.`,
          });
        }

        // Pausa pós-bloqueio (só produção) para sinais de anti-bot numa vaga:
        // protege a conta sem abandonar o portal inteiro (evita falso positivo).
        if (!config.dryRun && (codigoFalha === 'cloudflare' || codigoFalha === 'site_bloqueado')) {
          await new Promise(r => setTimeout(r, 30_000));
        }

        if (ehFalhaPermanente(codigoFalha)) {
          // Falha permanente: registra como vista e nunca mais tenta
          // (ApplyPilot usa attempts=99 como sentinela; nós registramos em vagas_vistas)
          registrarVagaVista({
            url: urlVaga,
            titulo_vaga: (args.titulo_vaga as string) || undefined,
            empresa: (args.empresa as string) || undefined,
            plataforma: (args.plataforma as string) || undefined,
            motivo_pulo: `PERMANENTE:${codigoFalha} — ${descricaoFalha}`,
          });
          tentativasPorUrl.delete(urlVaga);
          log('FALHA', `PERMANENTE [${codigoFalha}]: ${descricaoFalha} — ${urlVaga}`);

          return JSON.stringify({
            tipo: 'PERMANENTE',
            acao: 'PULAR',
            codigo: codigoFalha,
            mensagem: `Falha permanente (${codigoFalha}). Vaga registrada como vista — nunca sera retentada. Passe para a proxima vaga.`,
          });
        }

        if (ehFalhaRetriavel(codigoFalha)) {
          const tentativasAtuais = (tentativasPorUrl.get(urlVaga) || 0) + 1;
          tentativasPorUrl.set(urlVaga, tentativasAtuais);

          if (tentativasAtuais >= MAX_TENTATIVAS) {
            // Esgotou tentativas — trata como permanente
            registrarVagaVista({
              url: urlVaga,
              titulo_vaga: (args.titulo_vaga as string) || undefined,
              empresa: (args.empresa as string) || undefined,
              plataforma: (args.plataforma as string) || undefined,
              motivo_pulo: `ESGOTADO:${codigoFalha} — ${tentativasAtuais} tentativas — ${descricaoFalha}`,
            });
            tentativasPorUrl.delete(urlVaga);
            log('FALHA', `ESGOTADO [${codigoFalha}]: ${tentativasAtuais}/${MAX_TENTATIVAS} tentativas — ${urlVaga}`);

            return JSON.stringify({
              tipo: 'ESGOTADO',
              acao: 'PULAR',
              codigo: codigoFalha,
              tentativas: tentativasAtuais,
              mensagem: `Maximo de ${MAX_TENTATIVAS} tentativas atingido para esta vaga. Passe para a proxima.`,
            });
          }

          const backoffMs = calcularBackoff(tentativasAtuais);
          log('FALHA', `RETRIAVEL [${codigoFalha}]: tentativa ${tentativasAtuais}/${MAX_TENTATIVAS}, backoff ${backoffMs}ms — ${urlVaga}`);

          // Aguarda backoff antes de liberar o agente para retentar
          await new Promise(resolve => setTimeout(resolve, backoffMs));

          return JSON.stringify({
            tipo: 'RETRIAVEL',
            acao: 'RETENTAR',
            codigo: codigoFalha,
            tentativa_atual: tentativasAtuais,
            max_tentativas: MAX_TENTATIVAS,
            backoff_aplicado_ms: backoffMs,
            mensagem: `Falha retriavel (${codigoFalha}). Tentativa ${tentativasAtuais}/${MAX_TENTATIVAS}. Backoff de ${Math.round(backoffMs / 1000)}s ja aplicado. Tente novamente agora.`,
          });
        }

        // Código desconhecido — trata como permanente por segurança
        log('FALHA', `DESCONHECIDO [${codigoFalha}]: ${descricaoFalha} — ${urlVaga}`);
        registrarVagaVista({
          url: urlVaga,
          motivo_pulo: `DESCONHECIDO:${codigoFalha} — ${descricaoFalha}`,
        });

        return JSON.stringify({
          tipo: 'DESCONHECIDO',
          acao: 'PULAR',
          codigo: codigoFalha,
          mensagem: `Codigo de falha desconhecido (${codigoFalha}). Pule esta vaga por seguranca.`,
        });
      }

      case 'gerar_mensagem_recrutador': {
        const nomeRecrutador = args.nome_recrutador as string;
        const cargoRecrutador = (args.cargo_recrutador as string) || '';
        const empresa = args.empresa as string;
        const tituloVaga = args.titulo_vaga as string;
        const descricaoVaga = args.descricao_vaga as string;

        // Verifica limite diário de mensagens (max 5 por dia)
        const mensagensHoje = contarMensagensHoje();
        if (mensagensHoje >= 5) {
          return JSON.stringify({
            sucesso: false,
            motivo: 'LIMITE_DIARIO',
            mensagem: `Limite diario de mensagens a recrutadores atingido (${mensagensHoje}/5). Nao envie mais mensagens hoje.`,
          });
        }

        try {
          const resultado = await gerarMensagemRecrutador(
            perfil,
            nomeRecrutador,
            cargoRecrutador,
            empresa,
            tituloVaga,
            descricaoVaga,
          );

          log('TOOL', `Mensagem recrutador ${resultado.fonte === 'cache' ? '(cache)' : '(nova)'}: ${nomeRecrutador} — ${empresa}`);

          return JSON.stringify({
            sucesso: true,
            texto: resultado.texto,
            caracteres: resultado.texto.length,
            fonte: resultado.fonte,
            instrucao: 'Use este texto como nota ao enviar convite de conexao no LinkedIn. Passos: (1) va ao perfil do recrutador, (2) clique em "Conectar", (3) clique em "Adicionar nota", (4) cole o texto com browser_type, (5) clique em "Enviar". Apos sucesso, use registrar_mensagem_recrutador.',
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          log('ERRO', `Falha na mensagem recrutador: ${msg}`);
          return `ERRO: ${msg}. Pule o envio de mensagem para este recrutador.`;
        }
      }

      case 'verificar_recrutador_ja_contatado': {
        const urlPerfil = args.url_perfil as string;
        const jaContatado = verificarRecrutadorJaContatado(urlPerfil);
        return jaContatado
          ? 'JA_CONTATADO: Este recrutador ja recebeu uma mensagem anteriormente. Pule.'
          : 'NOVO: Este recrutador ainda nao foi contatado. Pode prosseguir.';
      }

      case 'registrar_mensagem_recrutador': {
        const sucesso = registrarMensagemRecrutador({
          nome_recrutador: args.nome_recrutador as string,
          cargo_recrutador: (args.cargo_recrutador as string) || undefined,
          empresa: args.empresa as string,
          url_perfil: args.url_perfil as string,
          url_vaga: (args.url_vaga as string) || undefined,
          titulo_vaga: (args.titulo_vaga as string) || undefined,
          mensagem: args.mensagem as string,
          score_vaga: (args.score_vaga as number) || undefined,
        });

        if (sucesso) {
          log('AGENTE', `Mensagem registrada: ${args.nome_recrutador} — ${args.empresa}`);
          return 'REGISTRADO: Mensagem para recrutador salva no banco de dados.';
        }
        return 'ERRO: Falha ao registrar (recrutador possivelmente ja contatado).';
      }

      case 'resolver_captcha_telegram': {
        const screenshotB64 = args.screenshot_base64 as string;
        const urlCaptcha = args.url_vaga as string;

        log('FALHA', `CAPTCHA detectado em: ${urlCaptcha}. Pedindo resolucao MANUAL via Telegram...`);

        try {
          const status = await solicitarResolucaoCaptcha(screenshotB64, urlCaptcha);

          if (status === 'resolvido') {
            return JSON.stringify({
              status: 'RESOLVIDO',
              instrucao: 'O usuario resolveu o CAPTCHA MANUALMENTE no Chrome. Use browser_snapshot para REVERIFICAR a pagina: se o desafio sumiu e a pagina avancou, continue a candidatura normalmente. Se ainda houver bloqueio, use reportar_falha (codigo "captcha", ou "portal_bloqueado" se for na pagina de listagem).',
            });
          }

          return JSON.stringify({
            status: status === 'pular' ? 'PULAR' : 'TIMEOUT',
            instrucao: 'O CAPTCHA nao foi resolvido. Use reportar_falha com codigo "captcha" (ou "portal_bloqueado" se o bloqueio for na pagina de busca) para pular.',
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          log('ERRO', `CAPTCHA resolver: ${msg}`);
          return JSON.stringify({
            status: 'ERRO',
            motivo: msg,
            instrucao: 'Falha ao solicitar resolucao. Use reportar_falha com codigo "captcha" para pular esta vaga.',
          });
        }
      }

      case 'gerar_cover_letter': {
        const descricao = args.descricao_vaga as string;
        const empresa = args.empresa as string;
        const titulo = args.titulo_vaga as string;

        try {
          const resultado = await gerarCoverLetter(
            perfil,
            descricao,
            empresa,
            titulo,
          );

          log('TOOL', `Cover letter ${resultado.fonte === 'cache' ? '(cache)' : '(nova)'} para ${titulo} — ${empresa}`);

          return JSON.stringify({
            sucesso: true,
            texto: resultado.texto,
            fonte: resultado.fonte,
            instrucao: 'Cole este texto no campo de carta de apresentacao do formulario. Voce pode fazer pequenos ajustes de tom se necessario.',
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          log('ERRO', `Falha na cover letter: ${msg}`);
          return `ERRO: ${msg}. Escreva uma resposta curta baseada no perfil do candidato como fallback.`;
        }
      }

      case 'gerar_curriculo_tailored': {
        const descricao = args.descricao_vaga as string;
        const titulo = (args.titulo_vaga as string) || '';
        const empresa = (args.empresa as string) || '';

        try {
          const resultado = await gerarCurriculoTailored(
            perfil,
            descricao,
          );

          log('TOOL', `Curriculo tailored ${resultado.fonte === 'cache' ? '(cache)' : '(novo)'}: ${resultado.caminhoPDF}`);

          return JSON.stringify({
            sucesso: true,
            caminho: resultado.caminhoPDF,
            caminho_html: resultado.caminhoHTML,
            fonte: resultado.fonte,
            motivo: `Curriculo personalizado ${resultado.fonte === 'cache' ? 'recuperado do cache' : 'gerado com sucesso'} para: ${titulo || 'vaga'} ${empresa ? `na ${empresa}` : ''}.`,
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          log('ERRO', `Falha no curriculo tailored: ${msg}`);
          return `ERRO: ${msg}. Use escolher_curriculo como fallback.`;
        }
      }

      default:
        return `ERRO: Tool "${name}" nao reconhecida.`;
    }
  };
}
