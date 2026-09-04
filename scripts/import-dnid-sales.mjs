import {createPool} from '../src/db.mjs';
import {importDnidReferenceSales} from '../src/reference-data.mjs';
import {PgStore} from '../src/store.mjs';

const pool=await createPool();
try{
  const migration=(await pool.query('SELECT version FROM flip_radar.schema_migrations WHERE version=$1',['002_reference_sales'])).rows[0];
  if(!migration)throw new Error('REFERENCE_SALES_MIGRATION_REQUIRED');
  const result=await importDnidReferenceSales({store:new PgStore(pool)});
  console.log(JSON.stringify(result,null,2));
}finally{await pool.end();}
