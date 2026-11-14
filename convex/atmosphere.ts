import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { medievalSetting } from '../data/dialogue';
import { richProfiles, richWorld } from '../data/worldContext';
import { townContext } from './councilContext';
import { stopEngine } from './aiTown/main';
import { parseGameId } from './aiTown/ids';

export const enrich = mutation({args:{profilesOnly:v.optional(v.boolean()),medieval:v.optional(v.boolean())},handler:async(ctx,args)=>{
  const town=await townContext(ctx);
  for(const actor of town.cast){
    const profile=richProfiles[actor.name];
    if(!profile)continue;
    const agent=town.world.agents.find(a=>a.playerId===actor.playerId)!;
    const description=await ctx.db.query('agentDescriptions').withIndex('worldId',q=>q.eq('worldId',town.world._id).eq('agentId',agent.id)).unique();
    if(description)await ctx.db.patch(description._id,profile);
    const player=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',town.world._id).eq('playerId',agent.playerId)).unique();
    if(player)await ctx.db.patch(player._id,{description:profile.identity});
  }
  if(args.medieval){
    const prior=town.lore?.background??richWorld;
    const background=prior.startsWith(medievalSetting)?prior:medievalSetting+'\n\n'+prior;
    if(town.lore)await ctx.db.patch(town.lore._id,{background});
    else await ctx.db.insert('worldLore',{worldId:town.world._id,background});
  }
  if(args.profilesOnly)return {characters:town.cast.map(a=>a.name),memoriesPreserved:true};
  const prior=town.lore?.background;
  const background=richWorld+(prior&&!prior.startsWith('A small riverside town called Willowbrook.')&&!prior.startsWith('WILLOWBROOK —')?`\n\nUSER WORLD DETAILS (take precedence where they conflict):\n${prior}`:'');
  if(town.lore)await ctx.db.patch(town.lore._id,{background});
  else await ctx.db.insert('worldLore',{worldId:town.world._id,background});
  return {characters:town.cast.map(a=>a.name),memoriesPreserved:true};
}});

export const freshConversation = mutation({args:{},handler:async ctx=>{
  const town=await townContext(ctx);
  const previous=await ctx.db.query('councilSessions').order('desc').first();
  if(previous?.status==='running')await ctx.db.patch(previous._id,{status:'paused'});
  if(town.status.status==='running'){
    await stopEngine(ctx,town.world._id);
    await ctx.db.patch(town.status._id,{status:'stoppedByDeveloper'});
  }
  let retired=0;
  for(const actor of town.cast){
    const memories=await ctx.db.query('memories').withIndex('playerId',q=>q.eq('playerId',parseGameId('players',actor.playerId))).collect();
    for(const memory of memories)if(!memory.inactive&&/storm|flood|bridge|forest.{0,12}lease|lease.{0,12}offer|library.{0,12}roof|240.{0,10}coin|ten volunteer shifts/i.test(memory.description)){
      await ctx.db.patch(memory._id,{inactive:true});retired++;
    }
  }
  const id=await ctx.db.insert('councilSessions',{worldId:town.world._id,participants:town.cast,background:town.lore?.background??richWorld,topic:'What is a small thing you enjoyed recently? Talk casually about your interests and everyday life.',rounds:1,status:'paused',nextTurn:0});
  return {retiredScenarioMemories:retired,historyPreserved:true,newSession:id};
}});
