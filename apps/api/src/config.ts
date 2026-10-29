import { z } from 'zod';

export const config = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url().default('http://localhost:5173'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DIGEST_TIMEZONE: z.string().default('Europe/Bucharest'),
  EMAIL_MODE: z.enum(['disabled', 'graph']).default('disabled'),
  GRAPH_TENANT_ID: z.string().default(''),
  GRAPH_CLIENT_ID: z.string().default(''),
  GRAPH_CLIENT_SECRET: z.string().default(''),
  GRAPH_SENDER: z.string().default(''),
}).parse(process.env);
new Intl.DateTimeFormat('en', { timeZone: config.DIGEST_TIMEZONE });
if (config.NODE_ENV === 'production' && new URL(config.APP_URL).protocol !== 'https:') {
  throw new Error('Production APP_URL must use HTTPS');
}
