# Atalhos para o ciclo de vida do bot (Docker).
# Todos delegam para ./bin/jobbot — a logica mora no script, nao aqui.

.PHONY: up up-host up-local down logs status shell rebuild ui test build

up:        ## sobe o bot (escolhe o modo sozinho)
	@./bin/jobbot up

up-host:   ## sobe forçando o Chrome do host (ja logado)
	@./bin/jobbot up --host

up-local:  ## sobe forçando o Chrome dentro do container
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
