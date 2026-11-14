import {RECIPES,RecipeId} from './livelihoodState';
import type {LifeOption} from './livelihoodActions';
export const actionFactInstructions='The menu effects and recipe inputs are authoritative. Walking only changes position; it does not gather water, fish, or goods. This world has no water, fuel, or cookware collection requirement. Choose scenery or solitude as a preference if desired, without inventing a physical need. Recipes consume only their listed ingredients. Proposing a trade does not transfer goods. Planned actions and personal motives are not verified events and must never be remembered as completed work.';
export function actionFacts(o:LifeOption){
 const recipe=o.recipe??o.id.split(':')[1] as RecipeId;
 if(o.kind==='cook'&&Object.hasOwn(RECIPES,recipe)){
  const r=RECIPES[recipe];return {requires:{turnips:r.turnips,fish:r.fish},effect:'Consume listed ingredients on successful cooking; create recipe portions according to cooking skill. Does not eat the meal.'};
 }
 if(o.kind==='walk'||o.kind==='wander'||o.kind==='visit'||o.kind==='place')return {effect:'Travel to a location. No gathering, transfer, meeting or completion of work is guaranteed.'};
 if(o.kind==='fish')return {requires:'Fishing role, rod, stock and cooldown checked by engine',effect:'Attempt a catch at the river; a catch is not guaranteed.'};
 if(o.kind==='garden')return {effect:'Plant an empty bed using a seed, or harvest a ready bed. Harvesting does not consume seeds.'};
 if(o.kind==='eat')return {requires:'One owned edible portion and sufficient appetite',effect:'Consume the portion and reduce hunger only after execution.'};
 if(o.kind==='offer'||o.kind==='activityOffer')return {effect:'Make a proposal. Other participants must agree. No goods or work change yet.'};
 if(o.kind==='rest')return {effect:'Recover energy; does not refill restedness.'};
 if(o.kind==='sleep')return {effect:'Go home, then recover restedness while actually asleep.'};
 return {effect:o.label+'; completion and any resource change require engine confirmation.'};
}
// Bounded semantic checks, not a claim to detect every possible invented motive.
export function actionMotiveIssue(reason:string,needs?:{hunger:number;energy:number}){
 if(/\b(?:need|require|fetch|collect|gather)\b.{0,35}\b(?:water|firewood|fuel|cookware)\b/i.test(reason))return 'unsupported_recipe_requirement';
 if(needs&&needs.energy>=60&&/\b(?:low energy|exhausted|out of energy)\b/i.test(reason))return 'unsupported_energy_claim';
 if(needs&&needs.hunger<40&&/\b(?:starving|famished|hungry)\b/i.test(reason))return 'unsupported_hunger_claim';
}
