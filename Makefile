# Atalhos para o ciclo de vida do bot (Docker).
# Todos delegam para ./bin/officeboy — a logica mora no script, nao aqui.

.PHONY: up up-local down logs status shell rebuild ui chrome watch watch-install test build

chrome:    ## abre o Chrome nativo (janela real, teclado real)
	@./bin/officeboy chrome

watch:     ## watcher: abre o Chrome quando o container sobe (Ctrl+C sai)
	@./bin/officeboy-watch

watch-install:  ## instala o watcher como serviço do systemd (uma vez)
	@./bin/officeboy watch install

up:        ## sobe o bot (usa o Chrome do host se existir)
	@./bin/officeboy up

up-local:  ## sobe forçando o Chrome dentro do container (noVNC)
	@./bin/officeboy up --local

down:      ## derruba os containers (preserva volumes e banco)
	@./bin/officeboy down

logs:      ## segue o log
	@./bin/officeboy logs

status:    ## mostra estado, portas e se a UI responde
	@./bin/officeboy status

shell:     ## abre um shell no container
	@./bin/officeboy shell

rebuild:   ## reconstrói a imagem e sobe
	@./bin/officeboy rebuild

ui:        ## imprime a URL da UI
	@./bin/officeboy ui

test:      ## roda os testes
	@yarn test:run

build:     ## compila o TypeScript
	@yarn build
