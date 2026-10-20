# 🤖 Office Boy — AI-Powered Job Application Agent

**Agente inteligente que automatiza candidaturas a vagas de emprego usando IA (OpenRouter) + Browser Automation (Playwright MCP).**

O bot navega por portais de vagas (Gupy, Vagas.com, LinkedIn, Indeed), analisa cada vaga, preenche formulários automaticamente com respostas variadas e naturais, e gerencia todo o processo de candidatura — tudo usando seu navegador Chrome já logado.

---

## ⚠️ Status do Projeto: Em Desenvolvimento

> **Este projeto ainda não funciona de ponta a ponta de forma totalmente autônoma.** O principal obstáculo são os **sistemas anti-bot** (Cloudflare, reCAPTCHA, Turnstile, hCaptcha) que portais como Gupy e LinkedIn usam para bloquear automação — muitas vezes já na página de busca, antes de chegar às vagas.
>
> O bot **não tenta "resolver" CAPTCHA automaticamente** (isso não é possível para reCAPTCHA/Turnstile, cujo token depende do contexto do navegador). Quando encontra um, ele te avisa no **Telegram** e **você resolve manualmente** no Chrome aberto, respondendo **OK** para continuar. O caminho com mais chance é o **LinkedIn Easy Apply** e formulários simples; portais com muro anti-bot logo na entrada continuam inviáveis.
>
> Mesmo com o CAPTCHA resolvido à mão, o fluxo completo (preencher e enviar candidaturas reais em cada portal) **ainda não foi validado de ponta a ponta**. Use sempre o modo `DRY_RUN=true` primeiro. Contribuições e testes são bem-vindos.

---

## ✨ Features

| Feature | Descrição |
|---|---|
| **AI Agent (OpenRouter)** | Modelo configurável via OpenRouter (DeepSeek, Llama, Gemini Flash, Qwen...) — sem lock-in de provedor |
| **Playwright MCP** | Controla o Chrome real do usuário via CDP — reaproveita a sessão já logada |
| **Tailored Resume** | Gera currículo personalizado por vaga via IA — destaca skills relevantes, converte HTML→PDF |
| **Cover Letter** | Gera carta de apresentação personalizada por vaga com validação anti-fabricação |
| **Answer Cache** | Cacheia respostas de formulário no SQLite — economiza tokens e acelera execuções futuras |
| **Multi-Curriculum** | Fallback: seleciona entre currículos pré-prontos se o tailored falhar |
| **Smart Scoring** | Pontua vagas de 1-10 antes de aplicar — só aplica em vagas compatíveis |
| **Dry-Run Mode** | Testa todo o fluxo sem enviar candidaturas de verdade |
| **Location Filter** | Filtra por localização e modelo de trabalho (remoto/híbrido/presencial) |
| **Anti-Duplicate** | Banco de dados SQLite rastreia vagas já vistas e candidaturas feitas |
| **Auto Pagination** | Navega automaticamente pelas páginas de resultados |
| **Screenshots** | Captura screenshot como prova de cada candidatura |
| **Web Dashboard** | Dashboard em tempo real para acompanhar candidaturas |
| **Telegram Notifications** | Receba notificações no Telegram a cada candidatura |
| **Email Reports** | Relatório HTML por email ao final de cada execução |
| **File Logging** | Log completo de cada execução salvo em arquivo |
| **Cron Scheduling** | Agende execuções automáticas diárias |
| **Recovery** | Detecta execução anterior interrompida e avisa o agente; o anti-duplicata (SQLite) evita refazer o trabalho já concluído |
| **Sliding Window** | Gerencia o contexto descartando histórico antigo — evita estouro de tokens |
| **Pre-defined Q&A** | Respostas base para perguntas comuns em formulários |
| **Response Variation** | Varia respostas automaticamente para parecer humano |
| **Error Classification** | Classifica falhas como permanentes (pula) ou retriáveis (retenta com backoff) |
| **CAPTCHA via Telegram** | Envia screenshot do CAPTCHA pro Telegram — humano resolve, bot continua |
| **Recruiter Messaging** | Envia mensagem personalizada para recrutadores no LinkedIn (nota de conexão) |
| **Token Cost Tracking** | Registra tokens de cada chamada e calcula custo em USD — com o **custo real** reportado pelo provedor quando disponível |
| **Multi-LLM** | Adapter pattern: **OpenRouter** (principal), **Ollama** (local/grátis) ou **Gemini** (auxiliar/secundário) |
| **PII Anonymization** | Anonimiza nome, email, telefone e links antes de enviar ao LLM — restaura no resultado final |
| **Docker Ready** | Imagem completa (bot + Chrome headful) e **control server**: o container sobe a UI e o agente só roda quando você pedir |
| **Web Dashboard** | Dashboard em tempo real com botões de iniciar/parar, log ao vivo e tema claro/escuro |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│            index.ts / control-server.ts          │
│        (orquestrador + UI de comando)            │
├──────────┬──────────┬──────────┬────────────────┤
│ agente   │ dashboard│ telegram │ email / cron   │
│(OpenRouter)│ (HTTP)  │ (HTTPS)  │ (SMTP)         │
├──────────┴──────────┴──────────┴────────────────┤
│                   tools.ts                       │
│  pontuar_vaga | gerar_curriculo_tailored         │
│  gerar_cover_letter | buscar_resposta_cache      │
│  registrar_candidatura | reportar_falha          │
├─────────────────────────────────────────────────┤
│              Playwright MCP                      │
│        (browser automation via CDP)              │
├─────────────────────────────────────────────────┤
│          Chrome (--remote-debugging-port)        │
│         Já logado nos sites de vagas             │
└─────────────────────────────────────────────────┘
```

**Stack:** TypeScript · OpenRouter (SDK OpenAI) · Playwright MCP · SQLite · Node.js · Docker · Multi-LLM (Ollama/Gemini)

---

## 🚀 Quick Start

### 1. Pré-requisitos

- **Node.js** 22 (o `better-sqlite3` tem prebuild só para versões específicas — use o 22)
- **Google Chrome** instalado (ou use a imagem Docker, que já traz o Chrome)
- **Chave da API do OpenRouter** ([openrouter.ai/keys](https://openrouter.ai/keys)) — ou de qualquer provedor OpenAI-compatible

> **💡 Sobre custo:** com OpenRouter você paga **por token, só pelo que usar** — não existe cota diária nem tier para "ativar". O bot consome ~1 request por iteração (cada iteração = 1 chamada), então o custo é previsível e você escolhe o ponto do curva custo × desempenho mudando `AGENT_LLM_MODEL`. Modelos gratuitos (`:free`) rodam o bot inteiro sem custo nenhum — o dashboard mostra o valor real de cada chamada.

### 2. Instalação

```bash
git clone https://github.com/MiguelDK17/officeboy.git
cd officeboy
npm install
```

### 3. Configuração

```bash
# Copie os arquivos de exemplo
cp .env.example .env
cp config/perfil.example.json config/perfil.json
cp config/curriculos.example.json config/curriculos.json
cp config/respostas.example.json config/respostas.json

# Edite com seus dados
nano .env                    # Chave do OpenRouter (AGENT_LLM_API_KEY) + configs
nano config/perfil.json      # Seus dados pessoais/profissionais
nano config/sites.json       # Sites e URLs de busca
nano config/respostas.json   # Respostas pré-definidas para formulários
```

### 4. Prepare o Chrome

```bash
# Abra o Chrome com porta de debug habilitada (requer --user-data-dir separado)
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-debug-profile"

# Faça login manualmente nos sites de vagas (Gupy, LinkedIn, etc.)
# Na primeira vez o Chrome abrirá "limpo" — as sessões ficam salvas nesse perfil separado
```

### 5. Execute

```bash
# Modo dry-run (recomendado para testar)
DRY_RUN=true npm start

# Modo produção
npm start
```

Com `CONTROL_MODE=true` no `.env`, o processo sobe **só a UI** (dashboard) e o agente espera você apertar "Iniciar bot" — nenhuma cota é gasta até lá. É o padrão do Docker.

### 5b. Via Docker (alternativa — pilha completa)

```bash
cp .env.example .env   # e preencha (AGENT_LLM_*, Telegram...)
# config/*.json precisam existir (mesmo passo 3 acima)

./bin/officeboy chrome    # abre o Chrome NATIVO (janela real, teclado real)
./bin/officeboy up        # sobe o container — ele usa aquele Chrome
# UI em http://localhost:1717
```

> **Quer o Chrome abrindo junto com o container, sem comando extra?** Instale o watcher (uma vez só):
> ```bash
> ./bin/officeboy watch install   # serviço systemd do usuário
> ```
> A partir daí, **`docker compose up -d` já abre o Chrome na sua tela**: o watcher (que roda no host) vê o container subir e abre o navegador com a porta de CDP liberada. Sem o watcher, use `./bin/officeboy up`, que faz o mesmo na hora.
>
> Gerenciar o watcher: `./bin/officeboy watch start|stop|status|logs|uninstall`.
>
> *Por que é preciso um processo do host:* o Chrome dentro do container roda num display virtual (Xvfb) e **não** aparece no seu desktop — o compositor (KWin/Wayland) não aceita janelas remotas (testado: o Chrome conecta no Wayland, mas a janela não é mapeada). Para a janela existir de verdade, o Chrome precisa ser um processo do host, conectado ao container via CDP.

O atalho `./bin/officeboy` resolve o resto: escolhe o modo do navegador, sobe o container certo e te imprime a URL. Sem ele, o equivalente é:

```bash
docker compose build
docker compose up -d              # usa o Chrome do host (se estiver no ar)
```

**Por que o Chrome do host e não o do container:** o Chrome do container vive num display virtual (Xvfb) e não aparece no seu desktop — sem teclado, sem ergonomia. No host, é o **Chrome de verdade**: janela nativa, teclado, mouse, Extensões, seu bookmarks.

> ⚠️ **O profile do Chrome precisa ser dedicado** (`~/.chrome-debug-profile`): desde o Chrome 136, o navegador recusa depuração remota no profile padrão (o do seu dia a dia) — e ele já fica travado pelo Chrome aberto normalmente. O `./bin/officeboy chrome` cria esse profile na primeira vez; os logins ficam salvos nele para sempre.

Os dois modos de navegador:

| Modo | Comando | Navegador | Login |
|---|---|---|---|
| **host** (padrão) | `./bin/officeboy up` | o Chrome **que você tem aberto** (janela real) | o seu, no profile dedicado |
| **container** | `./bin/officeboy up --local` | Chrome **dentro** do container | no navegador do container (`http://localhost:7900`) |

`./bin/officeboy up` (sem flag) **detecta sozinho**: se houver um Chrome com CDP na `BOT_CDP_PORT`, usa o do host; senão sobe o do container — nunca fica sem navegador.

**Modo UI (padrão no Docker):** o container sobe **só o dashboard** — o agente **não** roda sozinho (zero cota gasta até você pedir). Em `http://localhost:1717` você tem os botões **▶ Iniciar bot** / **⏹ Parar**, o checkbox de dry-run e o log ao vivo. O run acontece em um processo filho, então dá para parar no meio.

**Modo automático (opcional):** `CONTROL_MODE=false` no `.env` volta ao comportamento antigo — o agente roda assim que o container sobe (útil para cron).

**Portas:** as principais ficam no `.env` (`BOT_UI_PORT`, `BOT_CDP_PORT`) — se algo estiver ocupado, mude lá e o compose/atualizador acompanha. A porta CDP do container (9223) é interna e separada da do host (9222), para não disputar a mesma porta.

---

## 🐳 Docker & UI de comando

O projeto é **docker-first**: uma imagem com Node 22, Chrome headful e Xvfb, e um **control server** que transforma o container em uma UI de comando.

```bash
./bin/officeboy chrome     # abre o Chrome nativo (janela real, teclado real)
./bin/officeboy up         # sobe o container (usa o Chrome do host se existir)
./bin/officeboy status     # estado, portas e se a UI responde
./bin/officeboy logs       # segue o log
./bin/officeboy down       # derruba (preserva volumes e banco)
```

Atalhos equivalentes via `make`: `make up`, `make status`, `make logs`, `make down`, `make shell`, `make rebuild`.

### Atalhos no PATH (sem digitar `./bin/...`)

```bash
./bin/officeboy alias install officeboy   # cria os atalhos (uma vez)
```

Cria em `~/.local/bin`:

| Comando | O que faz |
|---|---|
| `officeboy up` / `officeboy-up` | sobe o container (+ Chrome) |
| `officeboy down` / `officeboy-down` | derruba |
| `officeboy logs` / `officeboy-logs` | segue o log |
| `officeboy status` / `officeboy-status` | estado, portas, navegador |
| `officeboy chrome` / `officeboy-chrome` | abre o Chrome nativo |
| `officeboy watch install` | instala o watcher (systemd) |
| `officeboy shell` / `officeboy-ui` | shell no container / URL da UI |

Trocar o nome do projeto é só rodar de novo: `./bin/officeboy alias install novonome` (o `alias uninstall` remove os antigos).

| Peça | O que faz |
|---|---|
| `bin/officeboy` | **Atalho único**: abre o Chrome nativo, escolhe o modo (host/container), sobe, derruba, logs, status. Lê as portas do `.env` |
| `bin/officeboy-watch` | **Watcher host-side**: abre o Chrome nativo quando o container sobe (é o que faz `docker compose up -d` abrir o navegador). `make watch-install` instala como serviço systemd |
| `Makefile` | Atalhos `make up` / `make down` / `make logs` / `make watch`… delegando para os scripts |
| `Dockerfile` | Imagem única: `node:22-bookworm-slim` + `google-chrome-stable` + `xvfb`/`x11vnc` + `@playwright/mcp` pré-instalado |
| `docker/entrypoint.sh` | Escolhe o navegador (externo → local), sobe Xvfb/Chrome quando preciso, **watchdog** mantém o Chrome vivo, e executa o bot/UI |
| `docker-compose.yml` | Um arquivo só, com os dois serviços: `bot` (host, padrão) e `bot-container` (Chrome no container, via `profiles`). Portas vindas do `.env` |
| `src/control-server.ts` | UI de comando: `POST /api/start`, `POST /api/stop`, `GET /api/status`, `GET /api/logs` |

Detalhes que importam:
- **Navegador persistente**: o Chrome fica de pé entre runs (perfil em volume) — o login nunca se perde e nenhum run paga o custo de subir navegador.
- **Watchdog**: se o Chrome cair, ele volta sozinho em ~5s.
- **Gate de run**: sem navegador respondendo, o run é recusado com motivo — nenhum token gasto com execução fadada.
- **uid alinhado**: o container roda como `node` (uid 1000) — o mesmo do host — então os bind-mounts (`curriculos/`, `config/`) continuam graváveis.
- **Custo dinâmico**: quando o provedor reporta o custo real (OpenRouter), o dashboard mostra o valor exato, não uma estimativa.
- **`CONTROL_MODE=false`** volta ao auto-run, para uso com cron.

> ⚠️ **`docker compose run`** (o do Docker puro) **não publica as portas** do serviço e cria um container *paralelo*, sem derrubar o que já está de pé — por isso o atalho `officeboy` usa `up`/`down`.

---

## ⚙️ Configuração Detalhada

### `.env` — Variáveis de Ambiente

| Variável | Descrição | Padrão |
|---|---|---|
| `AGENT_LLM_BASE_URL` | Base URL do LLM do agente (OpenRouter, OpenAI, Ollama, vLLM...) | `https://openrouter.ai/api/v1` |
| `AGENT_LLM_API_KEY` | Chave do provedor do agente | *obrigatório* |
| `AGENT_LLM_MODEL` | Modelo do agente (qualquer um do OpenRouter com tool calling) | `deepseek/deepseek-v4-flash-0731` |
| `CDP_ENDPOINT` | Endpoint CDP do Chrome (use `127.0.0.1`, não `localhost`, p/ evitar `ECONNREFUSED ::1`) | `http://127.0.0.1:9222` |
| `BOT_UI_PORT` | Porta da UI/control server no host (Docker) | `1717` |
| `BOT_CDP_PORT` | Porta CDP do Chrome do host (usada pelo modo host) | `9222` |
| `CONTROL_MODE` | `true` = container sobe só a UI (o agente roda sob demanda) | `true` |
| `DASHBOARD_PORT` | Porta do dashboard web | `3000` |
| `DASHBOARD_HOST` | Bind do dashboard (`0.0.0.0` no Docker p/ port-mapping) | `127.0.0.1` |
| `LIMITE_DIARIO` | Max candidaturas por dia | `10` |
| `MAX_POR_EXECUCAO` | Teto de envios reais por execução (anti-rajada) | `5` |
| `DELAY_MIN` | Delay mínimo entre ações (ms) | `2000` |
| `DELAY_MAX` | Delay máximo entre ações (ms) | `5000` |
| `SCORE_MINIMO` | Score mínimo para aplicar (1-10) | `6` |
| `CUSTO_MAX_USD` | Teto de custo por execução em USD (0 = desativado) | `0` |
| `DRY_RUN` | Modo teste — checkpoint bloqueia envio e registro grava como `dry-run` | `true` |
| `TELEGRAM_BOT_TOKEN` | Token do bot Telegram | *opcional* |
| `TELEGRAM_CHAT_ID` | Chat ID do Telegram | *opcional* |
| `SMTP_HOST` | Servidor SMTP | `smtp.gmail.com` |
| `SMTP_USER` | Email SMTP | *opcional* |
| `SMTP_PASS` | Senha de app SMTP | *opcional* |
| `EMAIL_DESTINATARIO` | Email para relatórios | *opcional* |
| `CRON_ATIVO` | Ativar agendamento | `false` |
| `CRON_HORARIO` | Horário da execução | `09:00` |
| `LLM_AUX_PROVIDER` | Provider auxiliar: `openai` (OpenRouter), `ollama` (local), `gemini` | `openai` |
| `LLM_AUX_MODEL` | Modelo do provider auxiliar | `deepseek/deepseek-chat` |
| `OPENAI_API_KEY` | Chave do provider auxiliar OpenAI-compatible | *opcional* |
| `OPENAI_BASE_URL` | Base URL do provider auxiliar OpenAI-compatible | `https://api.openai.com/v1` |
| `OLLAMA_URL` | URL do servidor Ollama | `http://localhost:11434` |
| `GEMINI_API_KEY` | Chave do Google Gemini (só p/ provider auxiliar/fallback) | *opcional* |
| `GEMINI_MODEL` | Modelo Gemini do provider auxiliar | `gemini-2.5-flash` |

### `config/perfil.json` — Perfil do Candidato

Seus dados pessoais e profissionais que o agente usa para preencher formulários. Veja `perfil.example.json` para a estrutura completa.

### `config/sites.json` — Sites de Vagas

Configure quais sites o bot deve navegar e quais URLs de busca usar. Cada site pode ter múltiplas URLs de busca.

### `config/respostas.json` — Respostas Pré-definidas

Respostas base para perguntas comuns (pretensão salarial, pontos fortes, etc.). O agente usa como base e varia a forma de escrever.

### `config/curriculos.json` — Mapeamento de Currículos

Configure múltiplos currículos otimizados para diferentes tipos de vaga. O agente escolhe automaticamente o mais adequado.

---

## 📊 Dashboard & UI de comando

A UI fica em `http://localhost:1717` (Docker) ou `http://localhost:3000` (local). Ela é o **control server**: o container sobe a interface e o agente **só roda quando você manda** — zero cota gasta até você clicar.

- **▶ Iniciar bot** / **⏹ Parar** — o run acontece em processo filho, dá para interromper no meio
- **Checkbox dry-run** — simula o fluxo sem enviar nada (marcado por padrão)
- **Log ao vivo** — colorizado por nível, com scroll que respeita sua posição de leitura
- **Navegador conectado?** — mostra o título e a URL da aba que o bot está usando
- **Custo real** — o valor reportado pelo provedor no último run
- **Tema claro/escuro** — botão "◐ Tema" (preferência salva no navegador)
- Estatísticas: candidaturas de hoje/total, por plataforma, score médio e funil de resultados

API para automação: `POST /api/start` (`{ dryRun }`), `POST /api/stop`, `GET /api/status`, `GET /api/logs`.

---

## 🔧 Sistema de Scoring

O bot avalia cada vaga antes de aplicar:

| Critério | Impacto |
|---|---|
| Tech match (cada tecnologia) | +1 |
| Senioridade júnior/pleno | +1 |
| Senioridade sênior | -2 |
| Localização na sua cidade | +1 |
| Modelo remoto | +1 |
| Presencial/híbrido fora da cidade | -3 |

Score final entre 1-10. Só aplica se `score >= SCORE_MINIMO`.

**Critérios eliminatórios** (forçam PULAR, independente do score):
- **Idioma** — a vaga exige inglês acima do seu `nivel_ingles` do perfil.
- **Localização** — vaga presencial/híbrida fora da sua cidade quando você só aceita remoto.
- **Blacklist** — empresa ou termo de título que você listou em `blacklist_empresas` / `blacklist_termos_titulo`.

---

## 🎛️ Controle e Segurança (copiloto, não autopiloto)

A filosofia: o **código** garante o que a arquitetura permite garantir (a gravação), e os demais pontos de risco passam por checkpoints explícitos — em vez de deixar tudo na "boa vontade" de um prompt de 200 linhas.

- **Gate de registro (garantia real, determinística)** — `registrar_candidatura` recusa **no código** qualquer vaga abaixo do `SCORE_MINIMO` ou em blacklist, e em `DRY_RUN=true` grava sempre como `dry-run` (nunca `aplicado`), aconteça o que acontecer com o LLM. Essa é a salvaguarda final.
- **Checkpoint de envio (`confirmar_envio`)** — o agente passa por ele antes de cada clique de envio; em dry-run responde "bloqueado" e aplica o `MAX_POR_EXECUCAO`. É **cooperativo**: o clique em si é uma ação de browser que o agente controla, então o checkpoint reduz risco e conta envios, mas não é uma barreira física. (Reforçá-lo com mais código não ajudaria — a arquitetura LLM+browser não permite uma trava física do clique; por isso o gate de registro é o que de fato protege.)
- **Teto de custo** — `CUSTO_MAX_USD` interrompe o loop se o gasto passar do limite.
- **Abandono de portal** — se um portal bloqueia na entrada (Cloudflare), o bot abandona aquele portal e segue para o próximo, em vez de insistir.

> ⚠️ **Risco de conta**: o bot usa seu Chrome **logado** e automatizar portais viola os ToS (especialmente o LinkedIn). Comece em `DRY_RUN=true`, use volumes baixos e, de preferência, uma conta não-principal.

---

## 📈 Acompanhamento de Resultados

A candidatura não morre em "aplicado": você registra o desfecho e o dashboard mostra **métricas de retorno** (taxa de resposta, entrevistas) em vez de só volume.

```bash
npm run resultado                      # lista candidaturas com seus ids
npm run resultado 42 entrevista        # marca o desfecho da candidatura 42
```

Resultados válidos: `aguardando`, `respondido`, `entrevista`, `oferta`, `rejeitado`, `sem_resposta`.

---

## 📄 Currículo Tailored + Cover Letter

Diferente de outros bots que enviam o mesmo currículo para todas as vagas, o Office Boy **gera um currículo e carta de apresentação personalizados para cada vaga**:

1. O agente lê a descrição completa da vaga
2. Faz uma chamada separada ao **provider auxiliar** (`LLM_AUX_*`) com prompt ultra-restritivo
3. O modelo **reorganiza e reescreve** o currículo destacando skills relevantes
4. **Validação anti-fabricação**: escaneia o HTML gerado buscando tecnologias que o candidato não possui — rejeita se encontrar
5. Converte HTML → PDF via Chrome headless (`--print-to-pdf`)
6. Cache por hash da descrição — vagas similares reutilizam o mesmo PDF

A cover letter segue a mesma lógica: personalizada por vaga, máximo 150 palavras, sem clichês, com validação + retry se fabricar skills.

Se a geração falhar, cai automaticamente nos currículos pré-prontos (fallback).

---

## 💾 Cache de Respostas

Inspirado no AIHawk (29k stars), o bot cacheia respostas de formulário no SQLite:

- **Primeira execução**: gera respostas via provider auxiliar e salva no cache
- **Execuções seguintes**: busca no cache antes de gerar — economiza tokens
- **Matching**: exact match (sanitizado) + substring match para dropdowns
- **Regra inteligente**: respostas que mencionam o nome da empresa não são cacheadas (são específicas demais)
- Cover letters nunca são cacheadas (sempre personalizadas)

---

## 🛡️ Classificação de Falhas

Adaptado do [ApplyPilot](https://github.com/nicognaW/ApplyPilot), o bot classifica erros automaticamente para decidir se deve pular ou retentar:

### Falhas Permanentes (nunca retenta)
| Código | Descrição |
|---|---|
| `vaga_expirada` | Vaga não está mais disponível |
| `captcha` | CAPTCHA detectado na página |
| `sessao_expirada` | Sessão expirou, precisa relogar |
| `ja_aplicou` | Candidato já se candidatou (detectado pelo site) |
| `sso_obrigatorio` | Requer login SSO |
| `site_bloqueado` | Site bloqueou acesso |
| `cloudflare` | Proteção anti-bot ativa |
| `formulario_incompativel` | Formulário não suportado |

### Falhas Retriáveis (max 3 tentativas com backoff exponencial)
| Código | Descrição |
|---|---|
| `timeout` | Página demorou para carregar |
| `erro_rede` | Erro de conexão |
| `erro_servidor` | HTTP 500/502/503 |
| `elemento_nao_encontrado` | Elemento sumiu da página |
| `erro_upload` | Falha no upload de arquivo |

**Melhoria sobre o ApplyPilot**: backoff exponencial (5s → 15s → 45s) em vez de retry imediato.

---

## 🔒 CAPTCHA: checkpoint humano (não "resolução automática")

Seja realista: reCAPTCHA, Turnstile e hCaptcha **não têm "solução de texto"** que alguém possa digitar remotamente — o token é gerado no contexto do navegador a partir de sinais comportamentais. Então o bot **não resolve** CAPTCHA; ele te chama para resolver:

1. O agente detecta o CAPTCHA/desafio e tira screenshot
2. Envia a foto para o Telegram pedindo que você resolva **manualmente no Chrome aberto**
3. Você resolve no Chrome e responde **OK** (ou **PULAR**) — polling, timeout 5 min
4. Em `OK`, o bot **reverifica a página** (browser_snapshot) e só continua se o desafio sumiu
5. Em `PULAR`/timeout, a vaga é pulada (`captcha`); se o bloqueio foi na página de busca, o portal inteiro é abandonado (`portal_bloqueado`)

**Requisitos**: `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` no `.env`. Sem Telegram, o bot pula a vaga.

---

## 💬 Mensagem para Recrutadores

Adaptado do [beatwad](https://medium.com/@beatwad): após se candidatar a uma vaga com **score alto (>= 8)** no LinkedIn, o bot tenta contatar o recrutador/hiring manager:

1. Identifica o recrutador na página da vaga
2. Verifica se já foi contatado anteriormente (banco SQLite)
3. Gera mensagem personalizada via provider auxiliar (max 280 chars — limite do LinkedIn)
4. Navega até o perfil do recrutador
5. Envia convite de conexão com nota personalizada
6. Registra no banco para não recontatar

**Limites**: máximo 5 mensagens/dia. Candidatura sempre tem prioridade — a mensagem é um bônus.

---

## 🔐 Anonimização de PII

Adaptado do [beatwad](https://medium.com/@beatwad): antes de enviar dados ao LLM, o bot substitui informações pessoais por placeholders. Após receber a resposta, restaura os dados reais.

| Campo | Placeholder |
|---|---|
| Nome completo | `[CANDIDATO]` |
| Email | `candidato@email.example` |
| Telefone | `(00) 00000-0000` |
| LinkedIn | `https://linkedin.com/in/candidato` |
| GitHub | `https://github.com/candidato` |
| Portfolio | `https://candidato.dev` |

**Onde é aplicado:**
- Cover letter (prompt + de-anonimização do resultado)
- Currículo tailored (HTML template + prompt + de-anonimização antes de gerar PDF)
- Mensagem para recrutadores (prompt + de-anonimização)
- System prompt do agente principal (PII de contato removido, disponível via tool sob demanda)

**Dados profissionais** (stack, experiências, resumo) continuam visíveis no prompt — são necessários para gerar conteúdo relevante.

> **Limitação importante (seja realista):** a anonimização cobre os **módulos auxiliares** (cover letter, currículo, mensagem ao recrutador). O **agente principal** recebe o nome real no system prompt e, ao preencher formulários, obtém email/telefone/links via a tool `obter_perfil_candidato` — ou seja, esses dados de contato chegam ao LLM principal (o modelo do OpenRouter). Se quiser manter os módulos auxiliares 100% locais (sem enviar nada a provedores externos), use o provider **Ollama**.

---

## 🔀 Multi-LLM (Adapter Pattern)

O projeto tem **dois níveis** de LLM, independentes entre si:

| Nível | Provider padrão | Config | Custo | Para quê |
|---|---|---|---|---|
| **Agente** (navegação) | **OpenRouter** | `AGENT_LLM_*` | Varia por modelo | Loop de decisão, tool calling, navegação |
| **Auxiliar** (tarefas pesada) | **OpenRouter** | `LLM_AUX_PROVIDER=openai` | Varia por modelo | Currículo tailored, cover letter, mensagem ao recrutador |
| **Auxiliar local** | **Ollama** | `LLM_AUX_PROVIDER=ollama` | **Grátis** | Tarefas sem PII, 100% offline |
| **Auxiliar secundário** | **Gemini** | `LLM_AUX_PROVIDER=gemini` | Pago | Provider alternativo + fallback automático |

Ou seja: **OpenRouter é o padrão em tudo**, Ollama é a rota local (custo zero, privacidade), e o Gemini ficou como provider auxiliar/secundário — útil quando um modelo específico do Google faz sentido para o currículo, ou como fallback automático quando o provider principal falha.

O agente usa o **SDK oficial da OpenAI** (`openai`), então qualquer endpoint compatível funciona — não há lock-in de provedor em nenhuma linha do código.

### Setup OpenRouter (padrão)

```bash
# Em https://openrouter.ai/keys gere uma chave
AGENT_LLM_BASE_URL=https://openrouter.ai/api/v1
AGENT_LLM_API_KEY=sk-or-v1-...
AGENT_LLM_MODEL=deepseek/deepseek-v4-flash-0731   # ou o que preferir

# Auxiliar no mesmo provider
LLM_AUX_PROVIDER=openai
LLM_AUX_MODEL=deepseek/deepseek-chat
OPENAI_API_KEY=sk-or-v1-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

### Setup Ollama (custo zero, local)

```bash
# Instale: https://ollama.com
curl -fsSL https://ollama.com/install.sh | sh

# Baixe um modelo
ollama pull llama3

# Configure no .env
LLM_AUX_PROVIDER=ollama
LLM_AUX_MODEL=llama3
OLLAMA_URL=http://localhost:11434
```

### Setup Gemini (auxiliar/secundário)

```bash
LLM_AUX_PROVIDER=gemini
LLM_AUX_MODEL=gemini-2.5-flash
GEMINI_API_KEY=...
```

**Fallback automático**: se o provider auxiliar falhar, o bot retenta com o Gemini (quando configurado).

---

## 📁 Estrutura do Projeto

```
officeboy/
├── src/
│   ├── index.ts          # Entry point + orquestração
│   ├── agente.ts         # Loop do agente (SDK OpenAI / OpenRouter)
│   ├── control-server.ts # Control server: UI de comando (start/stop/status/logs)
│   ├── tools.ts          # Custom tools (scoring, CV, screenshot, cache...)
│   ├── curriculo-tailored.ts  # Geração de currículo personalizado por vaga
│   ├── cover-letter.ts   # Geração de carta de apresentação por vaga
│   ├── erros.ts          # Classificação de falhas (permanentes vs retriáveis)
│   ├── mensagem-recrutador.ts  # Mensagem personalizada para recrutadores
│   ├── token-tracker.ts  # Tracking de custo de tokens (USD, custo real quando houver)
│   ├── llm-adapter.ts   # Multi-LLM adapter (OpenRouter/Ollama/Gemini)
│   ├── anonimizacao.ts  # Anonimização de PII (nome, email, telefone, links)
│   ├── database.ts       # SQLite (candidaturas, vagas vistas, cache, mensagens)
│   ├── dashboard.ts      # Dashboard web (UI + painel de controle)
│   ├── mcp-client.ts     # Conexão Playwright MCP
│   ├── historico.ts      # Sliding window + compactação de snapshots
│   ├── logger.ts         # Log em arquivo
│   ├── notificacoes.ts   # Telegram
│   ├── email.ts          # Relatórios por email
│   ├── cron.ts           # Agendamento
│   └── types.ts          # Interfaces TypeScript
├── config/
│   ├── perfil.example.json       # Template do perfil
│   ├── curriculos.example.json   # Template dos currículos
│   ├── sites.json                # Sites de vagas
│   └── respostas.json            # Respostas pré-definidas
├── docker/
│   └── entrypoint.sh     # Xvfb + Chrome headful → sobe o bot
├── bin/
│   └── officeboy            # Atalho único: up/down/logs/status (auto-detecta o modo)
├── Dockerfile            # Imagem: node:22 + Chrome + Xvfb
├── docker-compose.yml    # Dois serviços: bot (Chrome no container) e bot-host (Chrome do host)
├── Makefile              # Atalhos: make up / make down / make logs
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 🔐 Segurança

- **Seus dados pessoais NUNCA são commitados** (protegidos pelo `.gitignore`)
- O bot usa **seu Chrome já logado** — nenhuma senha é armazenada no código
- Modo **dry-run** para testar com segurança antes de ativar
- Screenshots salvos apenas localmente
- Notificações via HTTPS (Telegram API)

---

## 🛣️ Roadmap

- [ ] Suporte a mais plataformas (Catho, Trampos, etc.)
- [x] ~~CAPTCHA handling via Telegram (humano resolve, bot continua)~~
- [x] ~~Blacklist de empresas/títulos~~
- [x] ~~Loop de feedback de resultados (entrevista/oferta/rejeição) + métricas de funil~~
- [x] ~~Critérios eliminatórios de fit (idioma, localização)~~
- [x] ~~Mensagem automática para recrutadores~~
- [x] ~~Multi-LLM (OpenRouter principal + Ollama local + Gemini auxiliar)~~
- [x] ~~Anonimização de dados antes de enviar ao LLM~~
- [x] ~~Docker support (bot + Chrome headful via compose)~~
- [x] ~~Tracking de custo de tokens~~

---

## 🤝 Contributing

Contribuições são bem-vindas! Abra uma issue ou pull request.

1. Fork o repositório
2. Crie uma branch (`git checkout -b feature/minha-feature`)
3. Commit suas mudanças (`git commit -m 'feat: adiciona minha feature'`)
4. Push (`git push origin feature/minha-feature`)
5. Abra um Pull Request

---

## ⚠️ Disclaimer

Este projeto é para fins educacionais e de automação pessoal. Use com responsabilidade:
- Respeite os termos de serviço de cada plataforma
- Não faça spam ou candidaturas em massa sem critério
- Use o modo dry-run para testar antes
- O autor não se responsabiliza pelo uso indevido

---

## 📜 Créditos

OfficeBoy é um fork de [auto-apply-bot](https://github.com/LuisMIguelFurlanettoSousa/auto-apply-bot),
criado por Luis Miguel Furlanetto Sousa e licenciado sob MIT.


## 📄 License

MIT License — veja [LICENSE](LICENSE) para detalhes.
