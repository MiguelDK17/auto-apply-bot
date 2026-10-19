# Atalhos para o ciclo de vida do bot (Docker).
# Todos delegam para ./bin/jobbot — a logica mora no script, nao aqui.

.PHONY: up up-local down logs status shell rebuild ui chrome watch watch-install test build

chrome:    ## abre o Chrome nativo (janela real, teclado real)
	@./bin/jobbot chrome

watch:     ## watcher: abre o Chrome quando o container sobe (Ctrl+C sai)
	@./bin/jobbot-watch

watch-install:  ## instala o watcher como serviço do systemd (uma vez)
	@mkdir -p ~/.config/systemd/user
	@cp bin/jobbot-watch.service ~/.config/systemd/user/
	@systemctl --user daemon-reload
	@systemctl --user enable --now jobbot-watch
	@echo "watcher instalado e ativo (systemctl --user status jobbot-watch)"

up:        ## sobe o bot (usa o Chrome do host se existir)
	@./bin/jobbot up

up-local:  ## sobe forçando o Chrome dentro do container (noVNC)
	@./bin/jobbot up --local

down:      ## derruba os containers (preserva volumes e banco)
	@./bin/jobbot down

logs:      ## segue o log
	@./bin/jobbot logs

status:    ## mostra estado, portas e se a UI responde
	@./bin/jobbot status

shell:     ## abre um shell no container
	@./bin/jobbot shell

rebuild:   ## reconstrói a imagem e sobe
	@./bin/jobbot rebuild

ui:        ## imprime a URL da UI
	@./bin/jobbot ui

test:      ## roda os testes
	@yarn test:run

build:     ## compila o TypeScript
	@yarn build
