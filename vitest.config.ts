import { defineConfig } from 'vitest/config';

// Configuração do Vitest.
// Os testes ficam em `tests/` e seguem o padrão Triple A (Arrange/Act/Assert)
// com comentários em português: // Cenário, // Ação e // Validação.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Sem mocks de I/O: os testes exercitam comportamento real (ex.: SQLite :memory:).
    clearMocks: true,
  },
});
