import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  DNID_REFERENCE,assertDnidDownloadUrl,downloadDnidReference,
  importDnidReferenceSales,minimizeDescription,parseDnidReferenceCsv,parseSemicolonCsv,
} from '../src/reference-data.mjs';

const header='ID du Lot;Description du lot;Catégorie;Marque;Modèle;Date de première mise en circulation;Numéro Hermès de la Vente;Date de vente;CAV organisateur;Nom de la vente;Prix adjudication';
const line=values=>values.map(value=>{
  const text=String(value??'');
  return /[;"\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
}).join(';');

test('semicolon CSV parser preserves quoted separators, quotes and line breaks',()=>{
  const rows=parseSemicolonCsv('\uFEFFa;b\r\n"x;y";"deux ""mots""\nligne"\r\n');
  assert.deepEqual(rows,[['a','b'],['x;y','deux "mots"\nligne']]);
  assert.throws(()=>parseSemicolonCsv('a;"incomplet'),/UNTERMINATED_QUOTE/);
});

test('DNID parser keeps reused lot IDs distinct and removes exact duplicates',()=>{
  const a=line(['LOT-1','Téléphone; excellent\nContact: test@example.fr ou 06 12 34 56 78','Téléphonie','Apple','iPhone 13','','V1','02/01/2024','PARIS','Vente 1','350,50']);
  const b=line(['LOT-1','Téléphone seconde vente','Téléphonie','Apple','iPhone 13','','V2','03/01/2024','LYON','Vente 2','375']);
  const parsed=parseDnidReferenceCsv([header,a,a,b].join('\n'));
  assert.equal(parsed.records.length,2);
  assert.equal(parsed.skipped.duplicate,1);
  assert.equal(new Set(parsed.records.map(row=>row.source_record_id)).size,2);
  assert.ok(parsed.records.every(row=>row.official_lot_id==='LOT-1'));
  assert.equal(parsed.records[0].sold_price_eur_cents,35050);
  assert.match(parsed.records[0].description,/\[contact retiré\]/);
  assert.doesNotMatch(parsed.records[0].description,/example|06 12/);
});

test('blank descriptions get a transparent product fallback',()=>{
  const parsed=parseDnidReferenceCsv([header,line(['42','','Véhicules de tourisme','Renault','Clio','','V42','04/01/2024','LILLE','Vente 42','4200'])].join('\n'));
  assert.equal(parsed.records[0].description,'Véhicules de tourisme — Renault — Clio');
  assert.equal(parsed.records[0].description_derived,true);
});

test('invalid or missing prices are skipped and the header is strict',()=>{
  const missing=line(['1','Objet','Autre','','','','V1','01/01/2024','PARIS','Vente','']);
  const invalid=line(['2','Objet','Autre','','','','V2','01/01/2024','PARIS','Vente','gratuit']);
  const parsed=parseDnidReferenceCsv([header,missing,invalid].join('\n'));
  assert.deepEqual(parsed.skipped,{missing_price:1,invalid:1,duplicate:0});
  assert.throws(()=>parseDnidReferenceCsv('bad;header'),/HEADER_MISMATCH/);
});

test('only the exact approved HTTPS resource URL is accepted',()=>{
  assert.equal(assertDnidDownloadUrl(DNID_REFERENCE.download_url),DNID_REFERENCE.download_url);
  assert.throws(()=>assertDnidDownloadUrl(DNID_REFERENCE.download_url+'?redirect=https://evil.example'),/NOT_APPROVED/);
  assert.throws(()=>assertDnidDownloadUrl('https://evil.example/opendata.csv'),/NOT_APPROVED/);
});

test('download validates media type and import labels the dataset historical-only',async()=>{
  const csv=[header,line(['9','Console','Jeux vidéo','Nintendo','Switch','','V9','05/01/2024','PARIS','Vente 9','120'])].join('\n');
  const headers=new Headers({'content-type':'text/csv; charset=utf-8','content-length':String(Buffer.byteLength(csv))});
  const fetchImpl=async()=>new Response(csv,{status:200,headers});
  const downloaded=await downloadDnidReference({fetchImpl});
  assert.equal(downloaded.records.length,1);
  const saved=[];
  const result=await importDnidReferenceSales({fetchImpl,store:{upsertReferenceSales:async rows=>{saved.push(...rows);return {rows_processed:rows.length};}}});
  assert.equal(saved.length,1);
  assert.equal(result.historical_only,true);
  assert.equal(result.eligible_as_current_market_proof,false);
  assert.match(result.warning,/Historique 2024/);
  await assert.rejects(()=>downloadDnidReference({fetchImpl:async()=>new Response(csv,{headers:{'content-type':'text/html'}})}),/CONTENT_TYPE_INVALID/);
});

test('description minimization redacts contact details and French registration plates',()=>{
  const value=minimizeDescription('Mail x@y.fr, tél +33 6 12 34 56 78, plaque AB-123-CD');
  assert.equal(value,'Mail [contact retiré], tél [contact retiré], plaque [immatriculation retirée]');
});
