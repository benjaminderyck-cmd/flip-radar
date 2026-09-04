export const NOW='2026-09-03T12:00:00.000Z';
export const source={id:'fixture_market',label:'MARCHÉ FICTIF DE TEST',enabled:true,status:'approved',
  policy_url:'https://market.example/terms',reviewed_at:'2026-09-01T00:00:00Z',countries:['FR','DE','BE'],
  currencies:['EUR','GBP'],navigation_hosts:['market.example'],resource_hosts:['market.example'],
  search_url_template:'https://market.example/search?q={query}',listing_path_prefixes:['/item/']};
export function goodAssessment(){
  const product_key='fixture-model-a',condition_key='used_good';
  const comps=Array.from({length:10},(_,i)=>({id:'comp-'+i,url:`https://sold.example/item/${i}`,status:'sold',
    price:210+i*2,currency:'EUR',price_confirmed:true,verified_by:'human',verification_ref:`https://sold.example/item/${i}`,
    product_key,condition_key,channel:'vinted',market_country:'FR',listed_at:`2026-08-${String(10+i).padStart(2,'0')}T12:00:00Z`,
    sold_at:`2026-08-${String(20+i).padStart(2,'0')}T12:00:00Z`}));
  return {listing:{source_id:source.id,source_listing_id:'fixture-one',mode:'test',title:'[FICTIF] Objet de test modèle A',
    url:'https://market.example/item/fixture-one',price:100,currency:'EUR',country:'DE',availability:'active',product_key,condition_key,
    identity_confidence:0.96,observed_at:NOW,costs_eur:{inbound_shipping:7,buyer_fee:2,refurbishment:0,import_reserve:0,handling:1}},
    quotes:[{channel:'vinted',country:'FR',enabled:true,market_accessible:true,category_allowed:true,comps,
      fees_reviewed_at:NOW,fees_eur:{fixed_fee:0,seller_shipping:0,packaging:2,return_reserve:5,customer_acquisition:0,other_reserve:0},
      // FICTITIOUS test provisions, NOT actual Vinted fees or tax rates.
      fees_bps:{platform:200,business_reserve:1000},
      market:{verified_by:'human',verification_ref:'https://sold.example/market-snapshot',scope:'complete_window',
        window_days:30,sold_count:45,active_count:20,observed_at:NOW,product_key,condition_key,channel:'vinted',market_country:'FR'}}],
    risk:{reviewed_by:'human',score:15,evidence_ref:'https://market.example/item/fixture-one',reviewed_at:NOW,flags:[]},fx:{}};
}
export function mission(){return {objective:'Rechercher des objets en Europe avec référence identifiable et demande à vérifier.',countries:['FR','DE','BE'],languages:['fr','de','en'],source_ids:[source.id]};}
export const searchSnapshot={url:'https://market.example/search?q=appareil',text:'Résultats : un objet intéressant.',links:[{id:0,url:'https://market.example/item/fixture-one',text:'Objet de test modèle A'}]};
export const listingSnapshot={url:'https://market.example/item/fixture-one',text:'Objet de test modèle A\n100,00 €\nBon état',links:[]};
export const listingFields={title:'Objet de test modèle A',price:100,price_text:'100,00 €',currency:'EUR',product_key:'fixture-model-a',condition_key:'used_good',country:'DE',identity_confidence:0.99};
export class FakeBrowser{
  constructor(){this.visits=[];this.closed=false;}
  async navigate(url){this.visits.push(url);return url.includes('/search')?{...searchSnapshot,url}:structuredClone(listingSnapshot);}
  async scroll(){return structuredClone(listingSnapshot);}
  async close(){this.closed=true;}
}
export class ScriptedModel{
  constructor(actions){this.actions=structuredClone(actions);this.contexts=[];this.usage={calls:0};}
  async next(context){this.contexts.push(context);this.usage.calls++;return this.actions.shift()||{action:'finish'};}
}
export const normalActions=[{action:'search',source_id:source.id,query:'appareil mal orthographié'},
  {action:'open_link',link_id:0},{action:'save_listing',listing:listingFields},{action:'finish',reason:'test complet'}];
