#!/bin/bash
# Entrypoint do container: sobe a stack gráfica + Chrome persistente e a UI.
#
# FILOSOFIA: o navegador é PARTE do container, não parte do run.
# Ele sobe junto com o container e FICA ESPERANDO (perfil persistente em
# volume), pronto para qualquer execução. Assim:
#   - o login não se perde entre runs (o Chrome nunca é fechado/reaberto);
#   - um run não paga o custo de subir navegador;
#   - se o Chrome cair, um watchdog o reinicia sem intervenção.
#
# Modos (START_LOCAL_CHROME):
#   true  → Chrome DENTRO do container (padrão): Xvfb → noVNC → Chrome headful
#   auto  → tenta o Chrome de $CDP_ENDPOINT; se não responder, cai pro local
#   false → só espera o Chrome externo (sem Chrome local)
#
# Ordem:
#   1. Xvfb + noVNC                     [modo local]
#   2. Chrome headful + perfil persist. [modo local]  ← sobe UMA vez
#   3. Watchdog: reinicia o Chrome se ele cair
#   4. Aguarda o CDP responder
#   5. Bot/UI (exec → vira PID 1, recebe o SIGTERM do `docker stop`)
set -e

CHROME_PROFILE="${CHROME_PROFILE:-/home/node/.chrome-profile}"
CDP_ENDPOINT="${CDP_ENDPOINT:-http://127.0.0.1:9222}"
CDP_PORT="${CDP_PORT:-9222}"
# Porta do Chrome PROPRIO do container. Diferente da do host de propósito:
# no modo host (network_mode: host) o 127.0.0.1 é compartilhado, e o Chrome do
# container não pode roubar a porta do Chrome do usuário.
CDP_LOCAL_PORT="${CDP_LOCAL_PORT:-9223}"
START_LOCAL_CHROME="${START_LOCAL_CHROME:-auto}"

if [ "$START_LOCAL_CHROME" = "true" ]; then
  MODO_CHROME="local"
elif [ "$START_LOCAL_CHROME" = "false" ]; then
  MODO_CHROME="remoto"
else
  # "auto": tenta o Chrome de $CDP_ENDPOINT primeiro (pode ser o do host via
  # network_mode: host) e só sobe o próprio se ele não responder.
  MODO_CHROME="auto"
fi

cdp_responde() {
  curl -sf "${CDP_ENDPOINT%/}/json/version" -o /dev/null
}

# Sobe o Chrome headful. O perfil fica num volume: o lock de sessão (cookies,
# logins) sobrevive a reinícios do container — é o que garante não deslogar.
start_chrome() {
  echo "[entrypoint] Chrome headful (perfil: $CHROME_PROFILE, porta $CDP_LOCAL_PORT)..."
  mkdir -p "$CHROME_PROFILE"
  # Singleton obsoleto: o Chrome trava o perfil com SingletonLock/Socket e, se o
  # container anterior morreu sem limpar, o novo Chrome recusa abrir ("profile
  # appears to be in use by another Google Chrome process"). Como o perfil
  # pertence só ao Chrome do container, removemos os arquivos órfãos.
  rm -f "$CHROME_PROFILE"/SingletonLock "$CHROME_PROFILE"/SingletonCookie "$CHROME_PROFILE"/SingletonSocket
  google-chrome-stable \
    --remote-debugging-port="$CDP_LOCAL_PORT" \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir="$CHROME_PROFILE" \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --window-size=1280,1024 \
    --no-first-run \
    --no-default-browser-check \
    --test-type \
    --hide-crash-restore-bubble \
    about:blank >>/tmp/chrome.log 2>&1 &
}

# Watchdog: se o Chrome morrer (crash/OOM), reinicia. Sem isso, o próximo run
# falharia com "Not connected" e o usuário teria que reiniciar o container.
watchdog_chrome() {
  while true; do
    sleep 5
    if ! pgrep -f "user-data-dir=$CHROME_PROFILE" >/dev/null 2>&1; then
      echo "[entrypoint] WATCHDOG: Chrome caiu — reiniciando (perfil preservado)"
      start_chrome
      for i in $(seq 1 30); do
        cdp_responde && break
        sleep 1
      done
    fi
  done
}

# Sobe a stack gráfica local (display virtual + noVNC) e o Chrome próprio.
iniciar_stack_local() {
  echo "[entrypoint] display virtual :99..."
  Xvfb :99 -screen 0 1280x1024x24 >/tmp/xvfb.log 2>&1 &

  echo "[entrypoint] VNC (noVNC em 0.0.0.0:7900)..."
  x11vnc -display :99 -forever -shared -rfbport 5900 -nopw -quiet -bg -o /tmp/x11vnc.log \
    || echo "[entrypoint] AVISO: x11vnc indisponivel"
  if [ -x /usr/share/novnc/utils/novnc_proxy ]; then
    /usr/share/novnc/utils/novnc_proxy --vnc localhost:5900 --listen 0.0.0.0:7900 >/tmp/novnc.log 2>&1 &
  elif command -v websockify >/dev/null 2>&1; then
    websockify --web /usr/share/novnc 0.0.0.0:7900 localhost:5900 >/tmp/novnc.log 2>&1 &
  else
    echo "[entrypoint] AVISO: noVNC indisponivel (login remoto desativado)"
  fi

  CDP_ENDPOINT="http://127.0.0.1:$CDP_LOCAL_PORT"
  export CDP_ENDPOINT   # o app (bot + UI) aponta para o Chrome local
  export BOT_HAS_LOCAL_CHROME=true

  start_chrome
  watchdog_chrome &
}

case "$MODO_CHROME" in
  local)
    iniciar_stack_local
    ;;
  remoto)
    # Modo remoto: exige o Chrome externo (CDP de $CDP_ENDPOINT).
    echo "[entrypoint] usando o Chrome EXTERNO (CDP: $CDP_ENDPOINT) — sem Chrome local"
    echo "[entrypoint] aguardando CDP externo por 20s..."
    for i in $(seq 1 20); do
      cdp_responde && break
      sleep 1
    done
    if ! cdp_responde; then
      echo "[entrypoint] ERRO: Chrome externo nao respondeu em 20s ($CDP_ENDPOINT)"
      exit 1
    fi
    echo "[entrypoint] Chrome externo conectado"
    ;;
  auto)
    # Preferência: o Chrome de $CDP_ENDPOINT (pode ser o do host, com janela
    # real). Se não responder, sobe o Chrome próprio do container.
    echo "[entrypoint] verificando Chrome externo (CDP: $CDP_ENDPOINT)..."
    for i in $(seq 1 5); do
      cdp_responde && break
      sleep 1
    done
    if cdp_responde; then
      echo "[entrypoint] usando o Chrome EXTERNO (CDP: $CDP_ENDPOINT)"
    else
      echo "[entrypoint] Chrome externo indisponivel — iniciando o Chrome LOCAL (perfil proprio, sem seus logins)"
      iniciar_stack_local
    fi
    ;;
esac

echo "[entrypoint] aguardando CDP em $CDP_ENDPOINT..."
for i in $(seq 1 60); do
  if cdp_responde; then
    echo "[entrypoint] CDP ok — navegador pronto e aguardando execucoes"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[entrypoint] ERRO: CDP nao respondeu em 60s ($CDP_ENDPOINT)"
    [ -f /tmp/chrome.log ] && tail -20 /tmp/chrome.log
    exit 1
  fi
  sleep 1
done

echo "[entrypoint] iniciando o bot (UI)..."
exec node dist/index.js
