import { MongoClient, Db } from 'mongodb';
import { createClient, RedisClientType } from 'redis';
import { config } from './config';

let mongoClient: MongoClient | null = null;
let db: Db | null = null;
let redisClient: RedisClientType | null = null;

/**
 * Conecta ao MongoDB
 */
export async function connectMongo(): Promise<Db> {
  if (db) {
    return db;
  }

  try {
    mongoClient = new MongoClient(config.MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(config.MONGO_DB_NAME);

    console.log('[Database] ✅ Conectado ao MongoDB:', config.MONGO_DB_NAME);
    return db;
  } catch (error) {
    console.error('[Database] ❌ Erro ao conectar ao MongoDB:', error);
    throw error;
  }
}

/**
 * Conecta ao Redis
 */
export async function connectRedis(): Promise<RedisClientType> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  try {
    redisClient = createClient({
      socket: {
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
      },
      username: config.REDIS_USERNAME,
      password: config.REDIS_PASSWORD,
    });

    redisClient.on('error', (error) => {
      console.error('[Redis] Erro:', error);
    });

    await redisClient.connect();
    console.log('[Database] ✅ Conectado ao Redis');

    return redisClient;
  } catch (error) {
    console.error('[Database] ❌ Erro ao conectar ao Redis:', error);
    throw error;
  }
}

/**
 * Retorna a instância do banco de dados MongoDB
 */
export function getDb(): Db {
  if (!db) {
    throw new Error('Banco de dados não conectado. Chame connectMongo() primeiro.');
  }
  return db;
}

/**
 * Retorna a instância do cliente Redis
 */
export function getRedis(): RedisClientType {
  if (!redisClient || !redisClient.isOpen) {
    throw new Error('Redis não conectado. Chame connectRedis() primeiro.');
  }
  return redisClient;
}

/**
 * Fecha todas as conexões
 */
export async function closeConnections(): Promise<void> {
  try {
    if (mongoClient) {
      await mongoClient.close();
      console.log('[Database] MongoDB desconectado');
    }

    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      console.log('[Database] Redis desconectado');
    }
  } catch (error) {
    console.error('[Database] Erro ao fechar conexões:', error);
  }
}
