import { readFile } from 'node:fs/promises';
export async function createPool(env=process.env) {
  if(!env.FLIP_RADAR_DATABASE_URL)throw new Error('DATABASE_CONFIG_REQUIRED');
  const {Pool}=await import('pg');
  const ssl=env.FLIP_RADAR_DB_SSL==='false'?false:{rejectUnauthorized:true,
    ...(env.FLIP_RADAR_DB_CA_FILE?{ca:await readFile(env.FLIP_RADAR_DB_CA_FILE,'utf8')}:{})};
  return new Pool({connectionString:env.FLIP_RADAR_DATABASE_URL,ssl,max:4,
    connectionTimeoutMillis:10000,idleTimeoutMillis:30000,statement_timeout:30000});
}
