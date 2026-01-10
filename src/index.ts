import { connectMongo, connectRedis, closeConnections } from './database';
import { BetProcessor } from './bet-processor';
import { config } from './config';

/**
 * Serviço de Finalização de Apostas
 *
 * Este serviço é responsável por:
 * 1. Buscar apostas pendentes em mercados já resolvidos
 * 2. Validar o resultado de cada aposta baseado nos eventos ocorridos
 * 3. Creditar/debitar saldos via API externa
 * 4. Marcar apostas como finalizadas
 * 5. Atualizar status dos mercados para 'completed'
 */

let isProcessing = false;
let processor: BetProcessor;

/**
 * Loop principal de processamento
 */
async function processLoop(): Promise<void> {
  if (isProcessing) {
    console.log('[Main] Processamento já em andamento, pulando ciclo');
    return;
  }

  isProcessing = true;

  try {
    console.log('\n[Main] ========================================');
    console.log('[Main] 🔄 Iniciando ciclo de processamento');
    console.log('[Main] ========================================\n');

    await processor.processPendingBets();

    console.log('\n[Main] ========================================');
    console.log('[Main] ✅ Ciclo de processamento concluído');
    console.log('[Main] ========================================\n');
  } catch (error) {
    console.error('[Main] ❌ Erro no ciclo de processamento:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Inicializa o serviço
 */
async function main(): Promise<void> {
  console.log('\n');
  console.log('=========================================');
  console.log('  SERVIÇO DE FINALIZAÇÃO DE APOSTAS');
  console.log('=========================================\n');

  try {
    // Conectar ao banco de dados
    console.log('[Main] 🔌 Conectando ao MongoDB...');
    await connectMongo();

    console.log('[Main] 🔌 Conectando ao Redis...');
    await connectRedis();

    // Criar processador
    processor = new BetProcessor();

    console.log(`[Main] ⏱️  Intervalo de processamento: ${config.PROCESS_INTERVAL_MS}ms`);
    console.log('[Main] ✅ Serviço inicializado com sucesso\n');

    // Executar primeiro ciclo imediatamente
    await processLoop();

    // Configurar loop periódico
    setInterval(processLoop, config.PROCESS_INTERVAL_MS);

    console.log('[Main] 🚀 Serviço em execução. Pressione Ctrl+C para encerrar.\n');
  } catch (error) {
    console.error('[Main] ❌ Erro fatal ao inicializar serviço:', error);
    process.exit(1);
  }
}

/**
 * Tratamento de sinais de encerramento
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Main] 🛑 Recebido sinal ${signal}, encerrando serviço...`);

  try {
    await closeConnections();
    console.log('[Main] ✅ Serviço encerrado com sucesso');
    process.exit(0);
  } catch (error) {
    console.error('[Main] ❌ Erro ao encerrar serviço:', error);
    process.exit(1);
  }
}

// Registrar handlers de sinais
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Tratamento de erros não capturados
process.on('unhandledRejection', (error) => {
  console.error('[Main] ❌ Erro não tratado:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[Main] ❌ Exceção não capturada:', error);
  shutdown('EXCEPTION');
});

// Iniciar serviço
main();
