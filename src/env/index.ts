import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  MONGO_URI: z.string(),
  MONGO_DB_NAME: z.string(),
  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number(),
  REDIS_USERNAME: z.string(),
  REDIS_PASSWORD: z.string(),
  PROCESS_INTERVAL_MS: z.coerce.number(),
  EXTERNAL_API_URL: z.string(),
  EXTERNAL_API_KEY: z.string()
});

const _env = envSchema.safeParse(process.env);

if (_env.success === false) {
  console.error('Invalid enviroment variables', _env.error.format());
  throw new Error('Invalid enviroment variables');
}

export const env = _env.data;
