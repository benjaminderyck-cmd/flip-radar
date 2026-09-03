import {readFile} from 'node:fs/promises';
import {createPool} from '../src/db.mjs';
const pool=await createPool();
try {
  await pool.query(await readFile(new URL('../sql/001_foundation.sql',import.meta.url),'utf8'));
  console.log(JSON.stringify({migration:'001_foundation',status:'applied',schema:'flip_radar'}));
} finally {await pool.end();}
