import {readFile} from 'node:fs/promises';
import {createPool} from '../src/db.mjs';
const pool=await createPool();
try {
  const migrations=['001_foundation.sql','002_reference_sales.sql'];
  for(const migration of migrations)await pool.query(await readFile(new URL('../sql/'+migration,import.meta.url),'utf8'));
  console.log(JSON.stringify({migrations:migrations.map(name=>name.replace(/\.sql$/,'')),status:'applied',schema:'flip_radar'}));
} finally {await pool.end();}
