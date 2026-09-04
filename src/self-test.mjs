import {evaluateAssessment} from './core.mjs';
import {NOW,goodAssessment} from '../test/fixtures.mjs';

export function runOfflineSelfTest(){
  const cases=[
    ['Marge et demande suffisantes',()=>{},'GO'],
    ['Transport inconnu',x=>{x.listing.costs_eur.inbound_shipping=null;},'REVUE'],
    ['Provision entreprise inconnue',x=>{x.quotes[0].fees_bps.business_reserve=null;},'REVUE'],
    ['Annonces disparues, pas ventes',x=>{x.quotes[0].comps.forEach(c=>c.status='removed');},'REVUE'],
    ['Prix demandes, pas prix vendus',x=>{x.quotes[0].comps.forEach(c=>c.status='active');},'REVUE'],
    ['Preuve inventee par un LLM',x=>{x.quotes[0].comps.forEach(c=>c.verified_by='llm');},'REVUE'],
    ['Comparables autre modele',x=>{x.quotes[0].comps.forEach(c=>c.product_key='other');},'REVUE'],
    ['Comparables autre etat',x=>{x.quotes[0].comps.forEach(c=>c.condition_key='broken');},'REVUE'],
    ['Favoris sans preuve de demande',x=>{x.quotes[0].market={favourites:999};},'REVUE'],
    ['Forte saturation',x=>{x.quotes[0].market.sold_count=10;x.quotes[0].market.active_count=1000;},'SURVEILLER'],
    ['Risque trop eleve',x=>{x.risk.score=80;},'NON'],
    ['Contrefacon signalee',x=>{x.risk.flags=['counterfeit'];},'NON'],
    ['Transport annule la marge',x=>{x.listing.costs_eur.inbound_shipping=200;},'NON'],
    ['Disponibilite inconnue',x=>{x.listing.availability='unknown';},'REVUE'],
    ['Identite produit incertaine',x=>{x.listing.identity_confidence=0.6;},'REVUE'],
    ['Taux GBP EUR absent',x=>{x.listing.currency='GBP';},'REVUE'],
    ['Prix eleve autorise si preuves suffisantes',x=>{x.listing.price=3000;x.quotes[0].comps.forEach(c=>c.price=6000);},'GO'],
    ['Comparables repetes ne renforcent pas la preuve',x=>{x.quotes[0].comps=x.quotes[0].comps.map(()=>x.quotes[0].comps[0]);},'REVUE'],
  ];
  const checks=cases.map(([name,mutate,expected])=>{
    const input=goodAssessment();mutate(input);
    const result=evaluateAssessment(input,{now:NOW});
    return {name,expected,actual:result.would_verdict,ok:result.would_verdict===expected&&result.simulated===true&&result.notification_allowed===false};
  });
  const example=evaluateAssessment(goodAssessment(),{now:NOW});
  checks.push({name:'Calcul monetaire en centimes',expected:71.32,actual:example.best.estimated_contribution_eur,ok:example.best.estimated_contribution_eur===71.32});
  const output={project:'FLIP RADAR',version:'0.2.0',mode:'offline',all_ok:checks.every(x=>x.ok),tests_total:checks.length,
    external_calls:0,telegram_sent:0,purchases_executed:0,
    warning:'DONNEES FICTIVES. Aucun tarif reel, aucune annonce reelle, aucun gain promis.',
    fixture_date:NOW,checks,example};
  if(!output.all_ok)throw new Error('SELF_TEST_FAILED: '+JSON.stringify(checks.filter(x=>!x.ok)));
  return output;
}
