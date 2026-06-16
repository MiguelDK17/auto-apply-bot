import 'dotenv/config';
import {
  inicializarBanco,
  fecharBanco,
  atualizarResultado,
  listarCandidaturas,
  RESULTADOS_VALIDOS,
} from './database.js';

// CLI minimo para marcar o desfecho de uma candidatura — fecha o loop de
// feedback sem exigir um processo daemon. Uso:
//   npm run resultado                 -> lista candidaturas recentes com seus ids
//   npm run resultado <id> <resultado>-> marca o desfecho

function main(): void {
  const [, , idArg, resultado] = process.argv;

  // Sem argumentos: lista as candidaturas recentes para o usuário achar o id.
  if (!idArg) {
    inicializarBanco();
    const candidaturas = listarCandidaturas(30);
    fecharBanco();
    console.log('Uso: npm run resultado <id> <resultado>');
    console.log(`Resultados validos: ${RESULTADOS_VALIDOS.join(', ')}\n`);
    console.log('Candidaturas recentes:');
    for (const c of candidaturas) {
      console.log(`  [${c.id}] ${c.empresa} — ${c.titulo_vaga}  (${c.resultado ?? 'aguardando'})`);
    }
    return;
  }

  const id = parseInt(idArg, 10);
  if (Number.isNaN(id)) {
    console.error(`Id invalido: "${idArg}". Use um numero (veja "npm run resultado" sem argumentos).`);
    process.exit(1);
  }

  if (!resultado || !RESULTADOS_VALIDOS.includes(resultado as (typeof RESULTADOS_VALIDOS)[number])) {
    console.error(`Resultado invalido: "${resultado ?? ''}".`);
    console.error(`Validos: ${RESULTADOS_VALIDOS.join(', ')}`);
    process.exit(1);
  }

  inicializarBanco();
  const ok = atualizarResultado(id, resultado);
  fecharBanco();

  if (ok) {
    console.log(`OK: candidatura ${id} marcada como "${resultado}".`);
  } else {
    console.error(`Falha: candidatura ${id} nao encontrada.`);
    process.exit(1);
  }
}

main();
