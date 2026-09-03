import {readFile} from 'node:fs/promises';
import {createPool} from '../src/db.mjs';
import {assertSource} from '../src/policy.mjs';
const path=process.argv[2];
if(!path)throw new Error('Pass the reviewed sources JSON path: npm run seed -- config/sources.json');
const sources=JSON.parse(await readFile(path,'utf8'));
if(!Array.isArray(sources)||!sources.length||sources.length>50)throw new Error('INVALID_SOURCE_LIST');
for(const s of sources){if(s.enabled)assertSource(s);else if(!/^[a-z0-9_-]{2,64}$/.test(s.id||''))throw new Error('INVALID_SOURCE_ID');}
const pool=await createPool();
const client=await pool.connect();
try{
  await client.query('BEGIN');
  for(const source of sources)await client.query(`INSERT INTO flip_radar.sources(id,config) VALUES($1,$2::jsonb)
    ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config,updated_at=now()`,[source.id,JSON.stringify(source)]);
  await client.query('COMMIT');
  console.log(JSON.stringify({sources_imported:sources.length,enabled:sources.filter(s=>s.enabled).length}));
}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
