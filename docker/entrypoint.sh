#!/bin/bash
# Entrypoint do container: sobe a stack gráfica + Chrome e depois o bot.
#
# Dois modos (START_LOCAL_CHROME):
#   true/auto → Chrome DENTRO do container (padrão): Xvfb → noVNC → Chrome
#              headful com perfil persistente (volume) → CDP em 127.0.0.1:9222
#   false     → usa o Chrome do HOST: não sobe Chrome local; apenas espera o
#              CDP de $CDP_ENDPOINT responder. Exige `network_mode: host`
#              (Linux) para alcançar o 127.0.0.1 do host.
#
# Ordem (importa — cada camada depende da anterior):
#   1. Xvfb (display virtual :99)          [só no modo local]
#   2. x11vnc + noVNC (login/CAPTCHA)      [só no modo local]
#   3. Chrome headful + perfil persistente  [só no modo local]
#   4. Aguarda o CDP responder (verificarChromeCDP)
#   5. Bot (exec → vira PID 1, recebe o SIGTERM do `docker stop`)
set -e

CHROME_PROFILE="${CHROME_PROFILE:-/home/node/.chrome-profile}"
CDP_ENDPOINT="${CDP_ENDPOINT:-http://127.0.0.1:9222}"
CDP_PORT="${CDP_PORT:-9222}"
START_LOCAL_CHROME="${START_LOCAL_CHROME:-auto}"

# "auto": sobe Chrome local só se o endpoint for loopback. Um endpoint remoto
# (host.docker.internal, IP do host) já é outro navegador.
if [ "$START_LOCAL_CHROME" = "auto" ]; then
  case "$CDP_ENDPOINT" in
    http://127.0.0.1:*|http://localhost:*) MODO_CHROME="local" ;;
    *) MODO_CHROME="remoto" ;;
  esac
else
  [ "$START_LOCAL_CHROME" = "true" ] && MODO_CHROME="local" || MODO_CHROME="remoto"
fi

iniciar_chrome_local() {
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

  echo "[entrypoint] Chrome headful (perfil: $CHROME_PROFILE)..."
  mkdir -p "$CHROME_PROFILE"
  # Singleton obsoleto: o Chrome trava o perfil com SingletonLock/Socket e, se o
  # container anterior morreu sem limpar, o novo Chrome recusa abrir ("profile
  # appears to be in use by another Google Chrome process"). Como o perfil
  # pertence só ao Chrome do container, removemos os arquivos órfãos.
  if ! pgrep -f "user-data-dir=$CHROME_PROFILE" >/dev/null 2>&1; then
    rm -f "$CHROME_PROFILE"/SingletonLock "$CHROME_PROFILE"/SingletonCookie "$CHROME_PROFILE"/SingletonSocket
  fi
  google-chrome-stable \
    --remote-debugging-port="$CDP_PORT" \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir="$CHROME_PROFILE" \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --window-size=1280,1024 \
    --no-first-run \
    --no-default-browser-check \
    about:blank >/tmp/chrome.log 2>&1 &
}

cdp_responde() {
  curl -sf "${CDP_ENDPOINT%/}/json/version" -o /dev/null
}

if [ "$MODO_CHROME" = "local" ]; then
  iniciar_chrome_local
else
  # Modo remoto: espera o Chrome do host. Se ele não responder, cai para o
  # Chrome local em vez de deixar o container morto (degrada, mas funciona).
  echo "[entrypoint] usando o Chrome EXTERNO (CDP: $CDP_ENDPOINT) — sem Chrome local"
  echo "[entrypoint] aguardando CDP externo por 20s..."
  for i in $(seq 1 20); do
    cdp_responde && break
    sleep 1
  done
  if cdp_responde; then
    echo "[entrypoint] Chrome externo conectado"
  else
    echo "[entrypoint] AVISO: Chrome externo nao respondeu em 20s — iniciando Chrome LOCAL (perfil proprio, sem seus logins)"
    MODO_CHROME="local"
    iniciar_chrome_local
    CDP_ENDPOINT="http://127.0.0.1:$CDP_PORT"
    export CDP_ENDPOINT   # o app (bot + UI) precisa apontar para o Chrome local
  fi
fi

echo "[entrypoint] aguardando CDP em $CDP_ENDPOINT..."
for i in $(seq 1 60); do
  if cdp_responde; then
    echo "[entrypoint] CDP ok"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[entrypoint] ERRO: CDP nao respondeu em 60s ($CDP_ENDPOINT)"
    [ -f /tmp/chrome.log ] && tail -20 /tmp/chrome.log
    exit 1
  fi
  sleep 1
done

echo "[entrypoint] iniciando o bot..."
exec node dist/index.js
