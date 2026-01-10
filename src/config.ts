import { env } from './env';
import { Config } from './types';

/**
 * Configurações do serviço de finalização de apostas
 */
export const config: Config = {
  // MongoDB
  MONGO_URI: env.MONGO_URI || 'mongodb://localhost:27017',
  MONGO_DB_NAME: env.MONGO_DB_NAME || 'bets',

  // Redis
  REDIS_HOST: env.REDIS_HOST || 'localhost',
  REDIS_PORT: env.REDIS_PORT,
  REDIS_USERNAME: env.REDIS_USERNAME,
  REDIS_PASSWORD: env.REDIS_PASSWORD,

  // Processamento
  PROCESS_INTERVAL_MS: parseInt(String(env.PROCESS_INTERVAL_MS) || '5000'), // 5 segundos

  // API Externa (opcional - para creditar/debitar saldo em sistema externo)
  EXTERNAL_API_URL: env.EXTERNAL_API_URL,
};
