import OpenAI from 'openai';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { customTools, ehToolCustomizada, criarExecutorDeTools } from './tools.js';
import { podarHistorico, type HistoricoChat } from './historico.js';
import { log } from './logger.js';
import { classificarErroAPI, calcularBackoffRateLimit, MAX_TENTATIVAS, MAX_RATE_LIMIT_CONSECUTIVOS } from './erros.js';
import { notificarErro } from './notificacoes.js';
import { registrarUsoTokens, obterCustoTotal } from './token-tracker.js';
import { perfilParaSystemPrompt } from './anonimizacao.js';
import type { AgenteConfig, Perfil, SitesConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_ITERACOES = 100;
// Sliding window: mantém só as últimas N mensagens no histórico.
// Mensagens antigas (vagas já processadas, snapshots antigos) são descartadas
// para evitar estouro de contexto, custo excessivo e degradação de qualidade.
const MAX_HISTORICO = 30;
const RECOVERY_PATH = path.resolve(__dirname, '..', 'data', 'recovery.json');

function buildSystemPrompt(perfil: Perfil, sites: SitesConfig, config: AgenteConfig): string {
  const { limiteDiario, dryRun, scoreMinimo } = config;
  return `
Voce e um agente inteligente de candidatura automatica a vagas de emprego.
Voce controla um navegador real (Chrome do usuario, ja logado nos sites) atraves das browser tools.
${dryRun ? '\n** MODO DRY-RUN ATIVO: faca TODO o processo normalmente (navegar, analisar, preencher formularios) mas NAO envie de verdade. O sistema BLOQUEIA o envio automaticamente quando voce chama confirmar_envio. Registre a candidatura com registrar_candidatura (sera gravada como dry-run). **\n' : ''}

## Seu Objetivo
Navegar pelos sites configurados, buscar vagas relevantes e se candidatar automaticamente.

## Fluxo de Trabalho
Para CADA site da lista:
1. Use browser_navigate para ir ate a URL de busca do site
2. Use browser_snapshot para "enxergar" a pagina
3. Identifique as vagas listadas
4. Para cada vaga relevante:
   a. Use verificar_vaga_ja_vista para checar se ja analisou essa vaga antes
   b. Se ja foi vista, pule para a proxima
   c. Use verificar_ja_aplicou para checar se ja aplicou nessa URL
   d. Se ja aplicou, pule para a proxima
   e. Use contar_candidaturas_hoje para verificar se atingiu o limite (${limiteDiario})
   f. Se atingiu o limite, PARE e informe
   g. Clique na vaga, analise a descricao
   h. Inicie o processo de candidatura
   i. Use obter_perfil_candidato para obter os dados necessarios
   j. Use obter_respostas_predefinidas para consultar respostas-base para perguntas comuns
   k. Preencha o formulario usando browser_fill_form ou browser_type
   l. Use aguardar entre cada acao (2-5 segundos)
   m. ANTES de clicar no botao final de envio/submissao, SEMPRE chame confirmar_envio. Se a resposta bloquear (dry-run ou teto por execucao), NAO clique no botao — siga a instrucao da mensagem.
   n. Apos enviar (ou simular no dry-run), use salvar_screenshot para capturar prova
   o. Use registrar_candidatura para salvar no banco (inclua o score da vaga)
   p. Se a vaga foi PULADA (score baixo, localizacao errada), use registrar_vaga_vista para nao reanalisar
5. Se houver botao de "proxima pagina" ou paginacao, navegue para a proxima pagina e repita os passos 3-4
6. Passe para o proximo site

## REGRA DE PAGINACAO
- SEMPRE verifique se existe um botao de "proxima pagina", "proximo", "next", ">", ou paginacao numerada.
- Se existir, navegue para a proxima pagina apos processar todas as vagas da pagina atual.
- Continue ate: nao haver mais paginas, atingir o limite diario, ou nao encontrar mais vagas relevantes.
- Maximo de 5 paginas por site para evitar loops infinitos.

## FILTRO OBRIGATORIO: pontuar_vaga
Antes de se candidatar a QUALQUER vaga, SEMPRE use a tool "pontuar_vaga" passando os dados da vaga: tecnologias_pedidas, senioridade, localizacao, modelo_trabalho e, se a vaga mencionar exigencia de ingles, idioma_exigido.
- A tool retorna: score (1-10), veredicto (APLICAR/PULAR), motivo e eliminatorios.
- Se veredicto == PULAR (por score < ${scoreMinimo} OU por qualquer eliminatorio): PULE a vaga e va para a proxima. NAO insista.
- Se veredicto == APLICAR: prossiga com a candidatura.
- A tool JA considera a cidade, os modelos de trabalho aceitos e o nivel de ingles do candidato (do perfil). Confie no veredicto dela — NAO aplique regras de localizacao manualmente. Se o perfil tiver uma "regra_localizacao" especifica, respeite-a tambem.
- Ao registrar a candidatura, inclua SEMPRE o score (o sistema recusa registros abaixo do minimo).

## Regras de Ouro para Respostas em Formularios

### VARIACAO OBRIGATORIA
- NUNCA escreva a mesma resposta duas vezes. Cada formulario deve ter respostas UNICAS.
- Varie: estrutura frasal, ordem das informacoes, sinonimos, tom (mais formal vs mais direto).
- Exemplo de variacao para "Fale sobre voce":
  * Vez 1: "Atuo como [titulo] ha [anos] anos, com foco em [stack]..."
  * Vez 2: "Minha trajetoria profissional combina [stack] com experiencia em [area]..."
  * Vez 3: "Com [anos] anos construindo solucoes em [stack], trago experiencia solida em..."

### DADOS REAIS
- Use APENAS os dados reais do candidato. Nunca invente experiencias, skills ou empresas.
- Adapte as respostas ao contexto da vaga (ex: destacar React se a vaga e frontend).

### NATURALIDADE
- Escreva como um profissional humano, nao como um bot.
- Evite cliches como "sou apaixonado por tecnologia" ou "busco novos desafios".
- Seja conciso: 2-4 frases para campos curtos, 1 paragrafo para campos longos.

## Regras de Seguranca
- ENVIO (CRITICO): antes de QUALQUER clique de envio final (candidatar-se, enviar, submeter, finalizar) ou de enviar convite/mensagem ao recrutador, SEMPRE chame confirmar_envio primeiro. O sistema decide se libera (e a trava de seguranca do usuario). NUNCA clique no botao final sem passar por confirmar_envio.
- Se encontrar CAPTCHA ou desafio anti-bot: use resolver_captcha_telegram para pedir resolucao MANUAL do humano. (reCAPTCHA/Turnstile NAO tem "solucao de texto" para digitar — quem resolve e o humano, no proprio Chrome aberto.)
  1. Tire screenshot com browser_take_screenshot
  2. Chame resolver_captcha_telegram passando o base64 e a URL (o humano resolve no Chrome e responde OK ou PULAR)
  3. Se status == RESOLVIDO: use browser_snapshot para REVERIFICAR a pagina e, se o desafio sumiu, continue a candidatura
  4. Se status == PULAR ou TIMEOUT: use reportar_falha com codigo "captcha" (ou "portal_bloqueado" se o bloqueio foi na pagina de busca) para pular
  5. Se Telegram NAO estiver configurado: use reportar_falha com codigo "captcha"/"portal_bloqueado"
- Se encontrar erro de login ou sessao expirada: use reportar_falha com codigo "sessao_expirada"
- Se um formulario pedir informacao que voce NAO tem no perfil: pule o campo ou use "A combinar"
- NUNCA insira dados falsos ou inventados
- Aguarde SEMPRE entre acoes (tool aguardar) para simular comportamento humano

## TOLERANCIA A ERROS DE SELETOR (ANTI-LOOP — LEIA COM ATENCAO)
Erros de seletor/elemento ("ERRO_TOOL", "selector", "locator", "element not found",
"strict mode violation", "not visible", "not attached") significam que a pagina mudou
ou a referencia expirou. Regras duras:
- NUNCA repita a mesma chamada com os mesmos argumentos apos um erro de seletor.
- Ordem de reacao: (1) use browser_snapshot para REVER a pagina e obter referencias
  atualizadas; (2) tente uma estrategia diferente (outro ref/seletor, scroll antes,
  aguardar o carregamento); (3) se falhar 2x no MESMO elemento, DESISTA dele —
  use reportar_falha (codigo "elemento_nao_encontrado") e avance para a proxima
  vaga/acao. Ficar retentando o mesmo elemento queima a cota de requisicoes sem
  nenhum progresso e pode travar a execucao inteira.
- Se varios elementos da mesma pagina falharem em sequencia, a pagina provavelmente
  nao carregou: use browser_navigate para recarregar ou volte para a listagem.

## Regras de Screenshot (IMPORTANTE)
- APOS cada candidatura (enviada ou simulada no dry-run), use browser_take_screenshot para capturar a tela.
- Em seguida, use salvar_screenshot passando o base64, a URL da vaga e o nome da empresa.
- Isso serve como prova de que a candidatura foi feita.

## Respostas Pre-Definidas (IMPORTANTE)
- Use obter_respostas_predefinidas no INICIO da execucao para carregar as respostas-base.
- Para perguntas comuns (pretensao salarial, disponibilidade, pontos fortes, etc.), use essas respostas como BASE.
- VARIE a forma de escrever (sinonimos, estrutura frasal), mas mantenha o conteudo fiel.
- Se o formulario pedir algo que NAO esta nas respostas pre-definidas, use os dados do perfil do candidato.

## Cache de Respostas (ECONOMIZA TOKENS)
Para CADA campo de formulario, siga esta ordem:
1. Use buscar_resposta_cache passando o texto da pergunta e o tipo do campo.
2. Se retornar cache HIT: use a resposta cacheada (pode variar levemente).
3. Se retornar candidatas: verifique se alguma e semanticamente equivalente. Se sim, reutilize.
4. Se cache MISS: gere a resposta normalmente e depois use salvar_resposta_cache para guardar.
- NAO salve no cache: cover letters, respostas que mencionam o nome da empresa, campos de data.
- O cache persiste entre execucoes — quanto mais usar, mais rapido fica.

## Carta de Apresentacao / Cover Letter (IMPORTANTE)
- Se o formulario tiver campo de "carta de apresentacao", "cover letter", "por que voce quer trabalhar aqui" (campo de texto longo), ou "apresente-se":
  - Use gerar_cover_letter passando a descricao da vaga, titulo e empresa.
  - A tool retorna texto personalizado pronto para colar no campo.
  - O texto usa APENAS dados reais do candidato.
- Para campos CURTOS (1-2 linhas), NAO use a cover letter — responda diretamente com base no perfil.

## Filtro de Vagas Ja Vistas
- SEMPRE use verificar_vaga_ja_vista ANTES de analisar uma vaga em detalhe.
- Se a vaga ja foi vista (mesmo que nao tenha sido aplicada), PULE para a proxima.
- Ao PULAR uma vaga (por qualquer motivo), use registrar_vaga_vista para marcar como vista.
- Isso economiza tempo evitando reanalisar vagas ja descartadas em execucoes anteriores.

## Regras de Upload de Curriculo (IMPORTANTE)
O sistema gera um curriculo PERSONALIZADO para cada vaga usando IA.
- ANTES de fazer upload, SEMPRE tente usar "gerar_curriculo_tailored" passando a descricao COMPLETA da vaga.
  - Copie o maximo de detalhes da vaga (requisitos, responsabilidades, tecnologias) para o campo descricao_vaga.
  - A tool gera um PDF otimizado para ATS destacando as skills relevantes para AQUELA vaga.
  - O curriculo so usa dados REAIS do candidato — nunca inventa skills.
- Se gerar_curriculo_tailored FALHAR, use "escolher_curriculo" como fallback (seleciona entre curriculos pre-prontos).
- Use browser_upload_file com o caminho retornado pela tool.
- Se browser_upload_file nao estiver disponivel, informe o caminho para upload manual.

## Dados do Candidato (PII de contato omitido — use obter_perfil_candidato para email, telefone, links)
${JSON.stringify(perfilParaSystemPrompt(perfil), null, 2)}

## Sites para Processar
${JSON.stringify(sites.sites.filter(s => s.ativo), null, 2)}

## Mensagem para Recrutadores (LinkedIn)
APOS se candidatar a uma vaga com score ALTO (>= 8) no LinkedIn, tente contatar o recrutador/hiring manager:

### Quando enviar:
- SOMENTE para vagas com score >= 8 (alta compatibilidade)
- SOMENTE no LinkedIn (onde e possivel ver o recrutador)
- MAXIMO 5 mensagens por dia (a tool controla automaticamente)
- NUNCA enviar para o mesmo recrutador duas vezes

### Como encontrar o recrutador:
1. Na pagina da vaga no LinkedIn, procure "Quem publicou" ou nome do recrutador
2. Se nao aparecer na vaga, procure na pagina da empresa por cargos como "Recruiter", "HR", "Talent Acquisition"
3. Se nao encontrar ninguem, PULE — nao perca tempo buscando

### Fluxo de envio:
1. Use verificar_recrutador_ja_contatado com a URL do perfil
2. Se JA_CONTATADO: pule
3. Use gerar_mensagem_recrutador passando os dados da vaga e do recrutador
4. Navegue ate o perfil do recrutador no LinkedIn
5. Clique em "Conectar" → "Adicionar nota"
6. Cole o texto com browser_type
7. ANTES de clicar em "Enviar", chame confirmar_envio (acao: "mensagem ao recrutador"). Se bloquear (dry-run ou teto), NAO envie o convite e siga.
8. Clique em "Enviar"
9. Use registrar_mensagem_recrutador para salvar no banco

### Prioridade:
- A candidatura TEM PRIORIDADE sobre a mensagem ao recrutador
- Se o tempo estiver curto ou o limite diario de candidaturas proximo, PULE a mensagem
- A mensagem e um BONUS, nao uma obrigacao

## Classificacao de Falhas (IMPORTANTE)
Quando encontrar um problema durante a candidatura, use a tool "reportar_falha" com o codigo apropriado.
O sistema classifica automaticamente e decide se deve pular ou retentar.

### Falhas PERMANENTES (nunca retentar):
- vaga_expirada: A vaga nao esta mais disponivel
- captcha: CAPTCHA detectado na pagina
- sessao_expirada: Sessao expirou, precisa relogar
- localizacao_inelegivel: Vaga presencial/hibrida fora da regra de localizacao do candidato
- ja_aplicou: Candidato ja se candidatou (detectado pelo site, nao pelo banco)
- conta_necessaria: Exige cadastro em plataforma especifica
- nao_e_vaga: A pagina nao e uma vaga de emprego
- sso_obrigatorio: Requer login SSO (Google, Microsoft)
- site_bloqueado: Site bloqueou o acesso
- cloudflare: Protecao anti-bot ativa
- portal_bloqueado: Bloqueio (Cloudflare/CAPTCHA/login) na PAGINA DE BUSCA/LISTAGEM, antes de ver as vagas. O sistema ABANDONA o portal inteiro e voce vai para o proximo site — NAO insista em outras URLs/paginas deste portal. (Se o bloqueio for numa vaga especifica, use o codigo especifico como captcha.)
- formulario_incompativel: Formulario que voce nao consegue preencher
- vaga_interna: Exclusiva para funcionarios
- idioma_incompativel: Exige idioma que o candidato nao tem

### Falhas RETRIAVEIS (tente novamente, max ${MAX_TENTATIVAS}x):
- timeout: Pagina demorou para carregar
- erro_rede: Erro de conexao
- pagina_nao_carregou: Pagina carregou incompleta
- erro_servidor: Erro 500/502/503 do site
- elemento_nao_encontrado: Botao ou campo sumiu da pagina
- erro_upload: Falha ao enviar curriculo/arquivo
- erro_mcp: Erro de comunicacao com o navegador

### Como usar:
1. Encontrou problema → use reportar_falha com url_vaga + codigo_falha + descricao
2. Se a resposta disser PULAR → passe para a proxima vaga
3. Se a resposta disser RETENTAR → tente a mesma acao novamente (backoff ja foi aplicado)
4. NAO tente resolver falhas permanentes — pule e siga em frente

## Ao Finalizar
Quando terminar todos os sites ou atingir o limite diario, faca um resumo:
- Quantas candidaturas foram feitas
- Em quais empresas/vagas
- Se houve algum erro ou bloqueio (inclua os codigos de falha)
`;
}

// ========== CLIENT OPENAI (agnóstico a provedor) ==========

/**
 * Cria o client do LLM de navegação no padrão OpenAI SDK.
 *
 * Funciona com qualquer endpoint OpenAI-compatible — basta configurar:
 * - `AGENT_LLM_BASE_URL` (ex: https://openrouter.ai/api/v1, https://api.openai.com/v1, http://localhost:11434/v1)
 * - `AGENT_LLM_API_KEY` (chave do provedor; Ollama local aceita qualquer valor)
 * - `AGENT_LLM_MODEL` (ex: google/gemini-2.0-flash-001, gpt-4o-mini, llama3.1)
 */
export function criarClientAgente(config: AgenteConfig): OpenAI {
  const baseURL = config.agentLlmBaseUrl || 'https://openrouter.ai/api/v1';
  // OpenRouter recomenda identificar o app — inofensivo para outros provedores.
  const defaultHeaders = baseURL.includes('openrouter.ai')
    ? { 'HTTP-Referer': 'https://github.com/auto-apply-bot', 'X-Title': 'auto-apply-bot' }
    : undefined;
  return new OpenAI({
    baseURL,
    apiKey: config.agentLlmApiKey,
    ...(defaultHeaders ? { defaultHeaders } : {}),
  });
}

// ========== CONVERSÃO DE TOOLS MCP → OPENAI ==========

/** Formato mínimo esperado de uma tool listada via MCP. */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * Converte uma tool do Playwright MCP para `ChatCompletionTool` do OpenAI.
 * O `inputSchema` do MCP já é JSON Schema — é repassado intacto como
 * `parameters`, preservando o payload/contrato original da tool.
 */
export function converterMcpToolParaOpenAI(
  tool: McpToolInfo,
): OpenAI.Chat.Completions.ChatCompletionTool {
  const parameters =
    tool.inputSchema && typeof tool.inputSchema === 'object'
      ? (tool.inputSchema as Record<string, unknown>)
      : { type: 'object', properties: {} };
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters,
    },
  };
}

/**
 * Monta o array completo de `tools` no padrão oficial OpenAI
 * (`{ type: "function", ... }`): tools do navegador (MCP) + tools
 * customizadas do bot. É este array que vai em
 * `openai.chat.completions.create({ tools })`.
 */
export function montarToolsAgente(
  mcpTools: McpToolInfo[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [...mcpTools.map(converterMcpToolParaOpenAI), ...customTools];
}

// ========== RESILIÊNCIA A ERROS DE SELETOR ==========

const PADRAO_ERRO_SELETOR =
  /selector|seletor|locator|strict mode|element.{0,30}not found|no.{0,20}element found|elemento n[aã]o encontrado|invalid selector|not attached|not visible|outside of the viewport/i;

/**
 * Detecta se o resultado de uma tool indica falha de seletor/CSS ou elemento
 * não encontrado — o caso que mais causava loops infinitos de retentativa
 * (queimando a cota diária em minutos). Usado para anexar orientação de
 * recuperação ao resultado reinjetado no histórico.
 */
export function ehErroDeSeletor(texto: string): boolean {
  return PADRAO_ERRO_SELETOR.test(texto);
}

/**
 * Extrai texto do retorno bruto de `mcpClient.callTool`, preservando o
 * payload intacto: partes `text` são concatenadas; partes não-texto viram
 * JSON. Retorna 'OK' quando não há conteúdo.
 */
export function extrairTextoMcp(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (
      content
        .map((c) => {
          if (typeof c === 'string') return c;
          if (c && typeof c === 'object' && 'type' in c) {
            const part = c as { type: string; text?: unknown };
            if (part.type === 'text' && part.text !== undefined) return String(part.text);
          }
          return JSON.stringify(c);
        })
        .join('\n') || 'OK'
    );
  }
  if (content === null || content === undefined) return 'OK';
  return JSON.stringify(content);
}

export async function executarAgente(
  mcpClient: Client,
  perfil: Perfil,
  sites: SitesConfig,
  config: AgenteConfig,
): Promise<string> {
  const client = criarClientAgente(config);
  const executarTool = criarExecutorDeTools(perfil, config);
  const systemPrompt = buildSystemPrompt(perfil, sites, config);

  const sitesAtivos = sites.sites.filter(s => s.ativo);
  if (sitesAtivos.length === 0) {
    return 'Nenhum site ativo configurado em sites.json. Adicione sites e tente novamente.';
  }

  log('AGENTE', `Iniciando com ${sitesAtivos.length} site(s) ativo(s)`);
  log('AGENTE', `Limite diario: ${config.limiteDiario} candidaturas`);
  log('AGENTE', `LLM: ${config.agentLlmModel} via ${config.agentLlmBaseUrl}`);

  // Descobre as tools do Playwright MCP UMA vez e converte para o padrão
  // OpenAI — o loop abaixo só despacha tool_calls contra este array.
  const { tools: mcpTools } = await mcpClient.listTools();
  const tools = montarToolsAgente(mcpTools as McpToolInfo[]);
  log('AGENTE', `${mcpTools.length} tool(s) MCP + ${customTools.length} customizada(s)`);

  // Historico de mensagens para manter contexto entre iteracoes.
  // É `let` porque o sliding window (podarHistorico) substitui o array por uma
  // versão podada e válida quando ele cresce demais.
  let history: HistoricoChat = [
    { role: 'system', content: systemPrompt },
  ];

  // Tentar restaurar estado de uma execucao anterior interrompida.
  // Não reidratamos o histórico bruto (snapshots antigos não ajudam e poderiam
  // quebrar o pareamento de tool calls); em vez disso, avisamos o agente de
  // que houve interrupção. O dedup real vem do banco (vagas_vistas/candidaturas).
  const estadoRecuperado = carregarRecovery();
  let avisoRecovery = '';
  if (estadoRecuperado) {
    log('AGENTE', `Estado anterior encontrado: ${estadoRecuperado.iteracao} iteracao(oes), ultimo site: ${estadoRecuperado.ultimoSite}`);
    avisoRecovery = `\n\nATENCAO: uma execucao anterior foi interrompida (ultimo site: ${estadoRecuperado.ultimoSite}). As vagas ja vistas/aplicadas estao registradas no banco e serao puladas — use verificar_vaga_ja_vista e verificar_ja_aplicou normalmente para continuar de onde parou.`;
  }

  // Mensagem inicial que dispara o agente
  const mensagemInicial = (`
Inicie o processo de candidatura. Comece pelo primeiro site da lista.
Lembre-se: use aguardar entre cada acao, verifique duplicatas, e varie as respostas.
` + avisoRecovery).trim();

  history.push({ role: 'user', content: mensagemInicial });

  // Assinatura (tool+args) → nº de falhas de seletor consecutivas. Evita que o
  // modelo queime a cota retentando o mesmo elemento indefinidamente.
  const falhasSeletor = new Map<string, number>();

  let iteracao = 0;
  let respostaFinal = '';
  let errosConsecutivos = 0;
  let saiuComErroFatal = false;

  while (iteracao < MAX_ITERACOES) {
    iteracao++;
    log('AGENTE', `Iteracao ${iteracao}/${MAX_ITERACOES}`);

    try {
      const completion = await client.chat.completions.create({
        model: config.agentLlmModel,
        messages: history,
        tools,
        tool_choice: 'auto',
      });

      // Reset do contador — iteração bem sucedida
      errosConsecutivos = 0;

      // Registra uso de tokens desta chamada (usage OpenAI → formato interno)
      const usage = completion.usage;
      if (usage) {
        registrarUsoTokens(
          config.agentLlmModel,
          {
            promptTokenCount: usage.prompt_tokens,
            candidatesTokenCount: usage.completion_tokens,
            totalTokenCount: usage.total_tokens,
          },
          'agente',
        );
      }

      // Circuito de parada por custo: limite economico complementar ao
      // MAX_ITERACOES (so ativo se CUSTO_MAX_USD > 0). Evita queimar dezenas de
      // chamadas caras num loop improdutivo. Limite soft (avaliado entre iteracoes).
      if (config.custoMaxUsd > 0 && obterCustoTotal() > config.custoMaxUsd) {
        log('AGENTE', `Custo maximo atingido ($${obterCustoTotal().toFixed(4)} > $${config.custoMaxUsd} USD). Finalizando.`);
        respostaFinal = `Execucao interrompida: custo maximo de $${config.custoMaxUsd} USD atingido.`;
        break;
      }

      const message = completion.choices[0]?.message;
      if (!message) {
        log('AGENTE', 'Resposta vazia do modelo. Finalizando.');
        break;
      }

      // Adiciona resposta do modelo ao historico (preservando tool_calls)
      history.push({
        role: 'assistant',
        content: message.content,
        ...(message.tool_calls && message.tool_calls.length > 0
          ? { tool_calls: message.tool_calls }
          : {}),
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam);

      // Verifica se tem tool calls — resposta só-texto NÃO trava a máquina de
      // estados: encerra normalmente como resposta final do modelo.
      // (Filtra por type === 'function': o SDK também tipa custom tool calls.)
      const toolCalls = (message.tool_calls ?? []).filter(
        (
          tc,
        ): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          tc.type === 'function',
      );

      if (!toolCalls || toolCalls.length === 0) {
        // Sem tool calls = modelo terminou com texto
        const textoFinal = message.content || '';
        log('AGENTE', `Resposta final do modelo:\n${textoFinal}`);
        respostaFinal = textoFinal;
        limparRecovery();
        break;
      }

      // Processa as tool calls SEQUENCIALMENTE.
      // As tools do Playwright MCP (browser_*) operam no MESMO navegador/aba;
      // executá-las em paralelo causaria race conditions (navegar enquanto digita,
      // screenshot de página meio-carregada, elemento sumindo do DOM). A ordem
      // também importa no preenchimento de formulários. O custo de serializar é
      // desprezível perto do risco de estados intercalados.
      log('AGENTE', `Executando ${toolCalls.length} tool(s) em sequencia...`);

      for (const tc of toolCalls) {
        const toolName = tc.function.name ?? 'unknown';
        let toolArgs: Record<string, unknown> = {};
        try {
          toolArgs = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          log('ERRO', `Argumentos invalidos para ${toolName}: ${(tc.function.arguments || '').substring(0, 100)}`);
        }
        log('TOOL', `${toolName}(${JSON.stringify(toolArgs).substring(0, 100)}...)`);

        let resultado: string;

        // try/catch por tool: uma tool que lança NÃO derruba as demais nem o
        // agente — vira um resultado de erro que o modelo consegue tratar.
        try {
          if (ehToolCustomizada(toolName)) {
            resultado = await executarTool(toolName, toolArgs);
          } else {
            // Tool do Playwright MCP — executa via mcpClient
            const mcpResult = await mcpClient.callTool({
              name: toolName,
              arguments: toolArgs,
            });

            const content = (mcpResult as { content?: unknown }).content;
            resultado = extrairTextoMcp(content);
          }
        } catch (toolError) {
          resultado = `ERRO_TOOL: ${toolError instanceof Error ? toolError.message : String(toolError)}`;
          log('ERRO', `Tool ${toolName} falhou: ${resultado}`);
        }

        log('TOOL', `Resultado: ${resultado.substring(0, 150)}...`);

        // Resiliência a seletores: se a tool falhou por seletor/elemento não
        // encontrado, anexa orientação explícita ao resultado para o modelo NÃO
        // retentar o mesmo elemento — e escala o aviso a cada repetição.
        if (ehErroDeSeletor(resultado)) {
          const assinatura = `${toolName}:${JSON.stringify(toolArgs).substring(0, 120)}`;
          const repeticoes = (falhasSeletor.get(assinatura) || 0) + 1;
          falhasSeletor.set(assinatura, repeticoes);
          resultado +=
            `\n\nAVISO_DO_SISTEMA: esta acao falhou por seletor/elemento nao encontrado (${repeticoes}x). ` +
            `NAO repita a mesma chamada. Use browser_snapshot para obter referencias atualizadas e tente outra estrategia. ` +
            `Se falhar de novo, use reportar_falha (codigo "elemento_nao_encontrado") e avance para a proxima vaga.`;
          if (repeticoes >= 3) {
            resultado +=
              ` ATENCAO: ${repeticoes} falhas identicas — DESISTA deste elemento agora ` +
              `(reportar_falha + proxima vaga). Continuar retentando queima a cota de requisicoes sem progresso.`;
          }
        }

        // Reinjeta o retorno no histórico no padrão OpenAI
        // ({ role: "tool", tool_call_id, content })
        history.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultado,
        });
      }

      // Sliding window: poda mensagens antigas preservando a validade do
      // histórico para a API OpenAI (ver src/historico.ts).
      if (history.length > MAX_HISTORICO) {
        const antes = history.length;
        history = podarHistorico(history, MAX_HISTORICO);
        log('AGENTE', `Sliding window: ${antes - history.length} mensagens antigas descartadas (historico: ${history.length})`);
      }

      // Salva estado para recovery a cada 5 iteracoes
      if (iteracao % 5 === 0) {
        salvarRecovery(iteracao, sitesAtivos.map(s => s.nome));
      }

    } catch (error) {
      const mensagemErro = error instanceof Error ? error.message : String(error);
      log('ERRO', `Erro na iteracao ${iteracao}: ${mensagemErro}`);

      const tipoErro = classificarErroAPI(mensagemErro);

      if (tipoErro === 'rate_limit') {
        errosConsecutivos++;
        // Teto anti-espera-infinita: após N rate limits seguidos, a cota
        // provavelmente não vai voltar tão cedo — avisa no Telegram e PARA,
        // em vez de acumular backoffs (30s, 60s, 120s...) indefinidamente.
        if (errosConsecutivos >= MAX_RATE_LIMIT_CONSECUTIVOS) {
          const msg = `Rate limit persistente no LLM do agente (${errosConsecutivos}x consecutivos, modelo ${config.agentLlmModel}). Execucao interrompida na iteracao ${iteracao} para preservar a cota. Verifique o plano/limites do provedor e rode novamente — o progresso foi salvo (vagas vistas/aplicadas estao no banco).`;
          log('AGENTE', msg);
          salvarRecovery(iteracao, sitesAtivos.map(s => s.nome));
          respostaFinal = `Erro durante execucao: ${msg}`;
          saiuComErroFatal = true;
          await notificarErro(`Job Bot parado: rate limit persistente (${errosConsecutivos}x) no modelo ${config.agentLlmModel}. ${respostaFinal}`);
          break;
        }
        const backoff = calcularBackoffRateLimit(errosConsecutivos);
        log('AGENTE', `Rate limit atingido (${errosConsecutivos}x). Aguardando ${Math.round(backoff / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      if (tipoErro === 'rede') {
        errosConsecutivos++;
        if (errosConsecutivos <= MAX_TENTATIVAS) {
          const backoff = 5000 * Math.pow(2, errosConsecutivos - 1);
          log('AGENTE', `Erro de rede (${errosConsecutivos}/${MAX_TENTATIVAS}). Retentando em ${Math.round(backoff / 1000)}s...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        log('AGENTE', `Erro de rede persistente apos ${errosConsecutivos} tentativas. Finalizando.`);
      }

      // Erro fatal ou tentativas esgotadas
      salvarRecovery(iteracao, sitesAtivos.map(s => s.nome));
      respostaFinal = `Erro durante execucao: ${mensagemErro}`;
      saiuComErroFatal = true;
      break;
    }
  }

  if (iteracao >= MAX_ITERACOES) {
    respostaFinal = `Agente atingiu o limite maximo de ${MAX_ITERACOES} iteracoes.`;
  }

  // Só limpa o recovery se NÃO saímos por erro fatal — assim o aviso de
  // "execução anterior interrompida" sobrevive para a próxima execução.
  if (!saiuComErroFatal) {
    limparRecovery();
  }
  log('AGENTE', `Finalizado apos ${iteracao} iteracoes.`);
  return respostaFinal;
}

// ========== RECOVERY (persistencia de estado) ==========

interface RecoveryState {
  iteracao: number;
  ultimoSite: string;
  timestamp: string;
}

function salvarRecovery(iteracao: number, sites: string[]): void {
  try {
    const estado: RecoveryState = {
      iteracao,
      ultimoSite: sites[sites.length - 1] || '',
      timestamp: new Date().toISOString(),
    };
    writeFileSync(RECOVERY_PATH, JSON.stringify(estado, null, 2));
  } catch {
    // Silencioso
  }
}

function carregarRecovery(): RecoveryState | null {
  try {
    if (!existsSync(RECOVERY_PATH)) return null;
    const conteudo = readFileSync(RECOVERY_PATH, 'utf-8');
    return JSON.parse(conteudo) as RecoveryState;
  } catch {
    return null;
  }
}

function limparRecovery(): void {
  try {
    if (existsSync(RECOVERY_PATH)) {
      // Remove o arquivo de fato. Antes era gravada uma string vazia, o que
      // fazia carregarRecovery() sempre lançar em JSON.parse('') e nunca
      // distinguir "sem recovery" de "recovery limpo".
      unlinkSync(RECOVERY_PATH);
    }
  } catch {
    // Silencioso — não quebrar o fluxo por erro de limpeza.
  }
}
