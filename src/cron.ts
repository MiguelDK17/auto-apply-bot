import { log } from './logger.js';

// ============================================================
// AGENDAMENTO (CRON)
// Desativado por padrão. Para ativar:
// 1. No .env, defina: CRON_ATIVO=true
// 2. Configure o horário: CRON_HORARIO=09:00 (formato HH:MM)
// 3. O bot executará automaticamente no horário configurado
// ============================================================

let cronTimer: ReturnType<typeof setInterval> | null = null;
let executando = false;
let ultimaDataExecutada = '';

export function iniciarCron(horario: string, executar: () => Promise<void>): void {
  const [hora, minuto] = horario.split(':').map(Number);

  if (isNaN(hora) || isNaN(minuto) || hora < 0 || hora > 23 || minuto < 0 || minuto > 59) {
    log('ERRO', `Cron: Horário inválido "${horario}". Use formato HH:MM (ex: 09:00)`);
    return;
  }

  log('INFO', `Cron: Agendado para executar diariamente às ${horario}`);

  // Verifica a cada minuto se é hora de executar
  cronTimer = setInterval(async () => {
    const agora = new Date();
    const dataHoje = agora.toISOString().slice(0, 10);
    const ehHorario = agora.getHours() === hora && agora.getMinutes() === minuto;

    // Guardas contra: (a) reentrância (a execução anterior ainda roda); e
    // (b) disparo duplicado no mesmo dia (vários ticks de 60s podem cair no
    // mesmo minuto-alvo por drift do event loop).
    if (!ehHorario || executando || ultimaDataExecutada === dataHoje) return;

    executando = true;
    ultimaDataExecutada = dataHoje;
    log('INFO', 'Cron: Iniciando execução agendada...');
    try {
      await executar();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log('ERRO', `Cron: Erro na execução agendada — ${msg}`);
    } finally {
      executando = false;
    }
  }, 60_000); // Verifica a cada 60 segundos
}

export function pararCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
    log('INFO', 'Cron: Agendamento parado.');
  }
}
