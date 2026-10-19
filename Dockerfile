# auto-apply-bot — imagem completa (bot + Chrome headful + noVNC).
#
# Inclui tudo que o bot precisa para rodar isolado:
# - Node 22 (versão pinada do projeto — better-sqlite3 quebra em outras)
# - google-chrome-stable (o bot pilota um Chrome real via CDP, não headless)
# - Xvfb + x11vnc + noVNC (display virtual; login inicial e CAPTCHAs via browser)
# - @playwright/mcp pré-instalado (sem download via npx em runtime)

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    DISPLAY=:99

# Chrome + display virtual + VNC (camada única para não deixar resíduos de apt).
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget gnupg ca-certificates curl \
      xvfb x11vnc novnc websockify \
      fonts-liberation \
    && wget -qO- https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /usr/share/keyrings/google.gpg \
    && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/google.gpg] http://dl.google.com/linux/chrome/deb/ stable main' \
      > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Deps primeiro (cache de camada): rebuilds só refazem se package.json/yarn.lock mudar.
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# Binário do MCP pré-instalado — o mcp-client.ts prefere este caminho
# (PLAYWRIGHT_MCP_BIN) e só cai para `npx` (download) como fallback.
ENV PLAYWRIGHT_MCP_BIN=/app/node_modules/@playwright/mcp/cli.js

# MODO UI: o container sobe SÓ o control server (dashboard + botões).
# O agente só roda quando o usuário pedir pela interface.
# (defina CONTROL_MODE=false para voltar ao comportamento "roda ao subir")
ENV CONTROL_MODE=true

# Usuário sem privilégios. Usamos o usuário `node` (uid 1000) da imagem base
# DE PROPÓSITO: ele casa com o uid do usuário do host, então os bind-mounts
# (curriculos/, config/) ficam graváveis. Com um uid próprio (ex.: 1001), o
# volume montado do host ficava sem permissão de escrita (EACCES ao gravar o
# currículo tailored).
RUN mkdir -p /home/node/.chrome-profile /app/data /app/logs /app/screenshots \
  && chown -R node:node /app /home/node/.chrome-profile

USER node

# 3000 = dashboard | 5900 = VNC interno | 7900 = noVNC (browser)
EXPOSE 3000 5900 7900

ENTRYPOINT ["/app/docker/entrypoint.sh"]
