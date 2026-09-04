import {createHash} from 'node:crypto';

export const DNID_REFERENCE = Object.freeze({
  source_id:'dnid_sales_2024',
  publisher:'Direction Nationale d’Interventions Domaniales',
  dataset_url:'https://www.data.gouv.fr/datasets/donnees-de-ventes-annee-2024',
  download_url:'https://static.data.gouv.fr/resources/donnees-de-ventes-annee-2024/20260220-111324/opendata.csv',
  dataset_updated_at:'2026-02-20T11:13:25.000Z',
  license_id:'etalab-2.0',
  license_url:'https://www.data.gouv.fr/pages/legal/licences/etalab-2.0',
  max_bytes:20*1024*1024,
});

const HEADERS=[
  'ID du Lot','Description du lot','Catégorie','Marque','Modèle',
  'Date de première mise en circulation','Numéro Hermès de la Vente','Date de vente',
  'CAV organisateur','Nom de la vente','Prix adjudication',
];

export function assertDnidDownloadUrl(raw) {
  let url;try{url=new URL(raw);}catch{throw new Error('REFERENCE_URL_INVALID');}
  const expected=new URL(DNID_REFERENCE.download_url);
  if(url.protocol!=='https:' || url.username || url.password || url.port || url.hash || url.search
    || url.origin!==expected.origin || url.pathname!==expected.pathname)throw new Error('REFERENCE_URL_NOT_APPROVED');
  return url.toString();
}

export function parseSemicolonCsv(input) {
  if(typeof input!=='string')throw new Error('REFERENCE_CSV_REQUIRED');
  const text=input.charCodeAt(0)===0xFEFF?input.slice(1):input;
  const rows=[];let row=[],field='',quoted=false,afterQuote=false;
  const endField=()=>{row.push(field);field='';afterQuote=false;};
  const endRow=()=>{endField();if(row.some(value=>value!==''))rows.push(row);row=[];};
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){
      if(char==='"'){
        if(text[i+1]==='"'){field+='"';i++;}
        else{quoted=false;afterQuote=true;}
      }else field+=char==='\r'&&text[i+1]==='\n'?(i++,'\n'):char;
      continue;
    }
    if(afterQuote && ![';','\r','\n'].includes(char))throw new Error('REFERENCE_CSV_MALFORMED');
    if(char==='"'){
      if(field!==''||afterQuote)throw new Error('REFERENCE_CSV_MALFORMED');
      quoted=true;continue;
    }
    if(char===';'){endField();continue;}
    if(char==='\r'||char==='\n'){
      if(char==='\r'&&text[i+1]==='\n')i++;
      endRow();continue;
    }
    field+=char;
  }
  if(quoted)throw new Error('REFERENCE_CSV_UNTERMINATED_QUOTE');
  if(field!==''||row.length)endRow();
  return rows;
}

function clean(value,max=5000){
  if(typeof value!=='string')return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,max);
}

export function minimizeDescription(value){
  return clean(value).replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[contact retiré]')
    .replace(/(?:\+33[ .-]?|0)[1-9](?:[ .-]?\d{2}){4}\b/g,'[contact retiré]')
    .replace(/\b[A-Z]{2}-\d{3}-[A-Z]{2}\b/g,'[immatriculation retirée]');
}

function isoDate(value,{optional=false}={}){
  const text=clean(value,20);
  if(!text&&optional)return null;
  const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if(!match)return optional?null:undefined;
  const [,day,month,year]=match,date=new Date(`${year}-${month}-${day}T00:00:00Z`);
  if(date.getUTCFullYear()!==Number(year)||date.getUTCMonth()+1!==Number(month)||date.getUTCDate()!==Number(day))return optional?null:undefined;
  return `${year}-${month}-${day}`;
}

function euroCents(value){
  const text=clean(value,40).replace(',','.');
  const match=/^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text);
  if(!match)return null;
  const cents=BigInt(match[1])*100n+BigInt((match[2]||'').padEnd(2,'0')||'0');
  if(cents<=0n||cents>100000000000n)return null;
  return Number(cents);
}

export function parseDnidReferenceCsv(text,{sourceUpdatedAt=DNID_REFERENCE.dataset_updated_at}={}){
  const updated=new Date(sourceUpdatedAt);
  if(!Number.isFinite(updated.getTime()))throw new Error('REFERENCE_UPDATED_AT_INVALID');
  const rows=parseSemicolonCsv(text);
  if(!rows.length||rows[0].length!==HEADERS.length||rows[0].some((v,i)=>v!==HEADERS[i]))throw new Error('REFERENCE_CSV_HEADER_MISMATCH');
  const records=[],seen=new Set(),skipped={missing_price:0,invalid:0,duplicate:0};
  for(const values of rows.slice(1)){
    if(values.length!==HEADERS.length){skipped.invalid++;continue;}
    const id=clean(values[0],120),providedDescription=minimizeDescription(values[1]);
    const fallbackDescription=[values[2],values[3],values[4]].map(value=>clean(value,500)).filter(Boolean).join(' — ');
    const description=providedDescription||fallbackDescription,descriptionDerived=!providedDescription;
    const soldAt=isoDate(values[7]),price=euroCents(values[10]);
    if(!clean(values[10],40)){skipped.missing_price++;continue;}
    if(!/^[a-zA-Z0-9_.:-]{1,120}$/.test(id)||!description||!soldAt||price===null){skipped.invalid++;continue;}
    const canonical=values.map(value=>clean(value,20000));
    const rawHash=createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    // DNID reuses a small number of lot identifiers. The hash suffix preserves
    // each distinct official row while exact duplicate rows remain idempotent.
    const sourceRecordId=`${id}:${rawHash.slice(0,16)}`;
    if(seen.has(sourceRecordId)){skipped.duplicate++;continue;}
    seen.add(sourceRecordId);
    records.push({
      source_id:DNID_REFERENCE.source_id,source_record_id:sourceRecordId,official_lot_id:id,description,
      description_derived:descriptionDerived,
      category:clean(values[2],300)||null,brand:clean(values[3],300)||null,model:clean(values[4],500)||null,
      first_registration_date:isoDate(values[5],{optional:true}),sale_number:clean(values[6],300)||null,
      sold_at:soldAt,organizer:clean(values[8],300)||null,sale_name:clean(values[9],1000)||null,
      sold_price_eur_cents:price,verification_ref:DNID_REFERENCE.dataset_url,
      source_updated_at:updated.toISOString(),license_id:DNID_REFERENCE.license_id,raw_hash:rawHash,
    });
  }
  return {records,rows_total:Math.max(0,rows.length-1),skipped};
}

export async function downloadDnidReference({fetchImpl=fetch,timeoutMs=90000}={}){
  const url=assertDnidDownloadUrl(DNID_REFERENCE.download_url);
  const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
    headers:{accept:'text/csv','user-agent':'FLIP-RADAR/0.3 (official open-data importer)'}});
  if(!response?.ok)throw new Error('REFERENCE_DOWNLOAD_FAILED');
  const length=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(length)&&length>DNID_REFERENCE.max_bytes)throw new Error('REFERENCE_FILE_TOO_LARGE');
  const contentType=(response.headers?.get?.('content-type')||'').toLowerCase();
  if(!contentType.includes('text/csv'))throw new Error('REFERENCE_CONTENT_TYPE_INVALID');
  const buffer=Buffer.from(await response.arrayBuffer());
  if(!buffer.length||buffer.length>DNID_REFERENCE.max_bytes)throw new Error('REFERENCE_FILE_SIZE_INVALID');
  const headerDate=response.headers?.get?.('last-modified');
  const sourceUpdatedAt=headerDate&&Number.isFinite(Date.parse(headerDate))?new Date(headerDate).toISOString():DNID_REFERENCE.dataset_updated_at;
  return {...parseDnidReferenceCsv(buffer.toString('utf8'),{sourceUpdatedAt}),bytes:buffer.length,source_updated_at:sourceUpdatedAt};
}

export async function importDnidReferenceSales({store,fetchImpl=fetch}={}){
  if(!store?.upsertReferenceSales)throw new Error('REFERENCE_STORE_REQUIRED');
  const parsed=await downloadDnidReference({fetchImpl});
  const saved=await store.upsertReferenceSales(parsed.records);
  return {source_id:DNID_REFERENCE.source_id,publisher:DNID_REFERENCE.publisher,
    dataset_url:DNID_REFERENCE.dataset_url,license_id:DNID_REFERENCE.license_id,license_url:DNID_REFERENCE.license_url,
    historical_only:true,eligible_as_current_market_proof:false,rows_total:parsed.rows_total,
    rows_processed:saved.rows_processed,skipped:parsed.skipped,bytes:parsed.bytes,source_updated_at:parsed.source_updated_at,
    warning:'Historique 2024 uniquement : ne prouve ni la demande actuelle ni un prix de revente actuel.'};
}
