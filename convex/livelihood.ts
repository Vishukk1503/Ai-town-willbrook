import {internalMutation} from './_generated/server';
import {livelihood as initialState} from './aiTown/livelihoodState';
import {stopEngine,startEngine} from './aiTown/main';
import {richProfiles} from '../data/worldContext';

export const initialize=internalMutation({args:{},handler:async ctx=>{
  const status=await ctx.db.query('worldStatus').filter(q=>q.eq(q.field('isDefault'),true)).unique();if(!status)throw new Error('No town.');
  const w=await ctx.db.get(status.worldId);if(!w?.economy||!w.garden)throw new Error('Garden and fishing economy required.');
  if(w.livelihood)return {alreadyInitialized:true};
  const running=status.status==='running';if(running)await stopEngine(ctx,w._id);
  const e=w.economy,l=initialState(w.agents.map(a=>a.playerId),w.garden.time);
  for(const bag of e.bags){bag.items.meals=bag.items.meals??1;l.produced.meals+=bag.items.meals;}
  // Existing stall goods become the merchant's owned inventory, never duplicate stock.
  const merchant=e.bags.find(b=>b.owner===e.merchant)!;
  merchant.items.fish+=e.marketStock.fish;merchant.items.turnips+=e.marketStock.turnips;
  e.marketStock.fish=0;e.marketStock.turnips=0;e.jobs=e.jobs.filter(j=>j.kind!=='trade');
  const garden={...w.garden,renewableSeeds:true,seeds:Math.max(1,w.garden.seeds)};
  const village=w.village;
  if(village){const tavern=village.places.find(p=>p.kind==='tavern');if(tavern)tavern.description='A timber tavern with a courtyard hearth. Stella prepares village meals here and neighbors can share ingredients and supper.';}
  await ctx.db.patch(w._id,{livelihood:l,economy:e,garden,village});
  const agent=w.agents.find(a=>a.playerId===e.merchant);
  if(agent){
    const description=await ctx.db.query('agentDescriptions').withIndex('worldId',q=>q.eq('worldId',w._id).eq('agentId',agent.id)).first();
    if(description)await ctx.db.patch(description._id,richProfiles.Stella);
    const person=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',w._id).eq('playerId',agent.playerId)).first();
    if(person)await ctx.db.patch(person._id,{description:richProfiles.Stella.identity});
  }
  const lore=await ctx.db.query('worldLore').withIndex('world',q=>q.eq('worldId',w._id)).first();
  if(lore)await ctx.db.patch(lore._id,{background:lore.background.replace('No interiors, food service or overnight lodging are simulated yet.','The courtyard hearth supports cooking. Interiors and overnight lodging are unavailable.')+'\nCURRENT LIVELIHOODS: Bob grows turnips and retains planting seed. Lucky fishes. Stella runs the market and cooks at Hearth & Reed. All three need food and rest. Gifts, negotiated barter and cooking commissions require explicit acceptance; only completed world events prove transfers or meals. Fixed fish-for-seeds prices are retired. Nobody knows a neighbor’s inventory unless shared. Coins, debt and wages are not active mechanics. Basic food gathering and simple cooking are available to everyone.'});
  if(running)await startEngine(ctx,w._id);
  return {residents:l.needs.length,startingMeals:l.produced.meals,needsFreezeWhenPaused:true,fixedSeedBarterRetired:true};
}});
