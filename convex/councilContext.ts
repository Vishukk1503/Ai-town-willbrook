import { DatabaseReader } from './_generated/server';
import { Id } from './_generated/dataModel';
import { parseGameId } from './aiTown/ids';

export async function townContext(ctx:{db:DatabaseReader}, worldId?:Id<'worlds'>) {
  const status = worldId ? await ctx.db.query('worldStatus').withIndex('worldId',q=>q.eq('worldId',worldId)).first() : await ctx.db.query('worldStatus').filter(q=>q.eq(q.field('isDefault'),true)).unique();
  if(!status) throw new Error('No town is available.');
  const world=await ctx.db.get(status.worldId);
  if(!world) throw new Error('Town not found.');
  const descriptions=await ctx.db.query('playerDescriptions').withIndex('worldId',q=>q.eq('worldId',world._id)).collect();
  const identities=await ctx.db.query('agentDescriptions').withIndex('worldId',q=>q.eq('worldId',world._id)).collect();
  const cast=world.agents.map(a=>{
    const p=descriptions.find(d=>d.playerId===a.playerId),identity=identities.find(d=>d.agentId===a.id);
    return {playerId:a.playerId as string,name:p?.name??a.playerId,persona:identity?.identity??p?.description??'',plan:identity?.plan??''};
  });
  const messages=await ctx.db.query('messages').filter(q=>q.eq(q.field('worldId'),world._id)).order('desc').take(100);
  const memories=await Promise.all(cast.map(async a=>({
    playerId:a.playerId,items:await ctx.db.query('memories').withIndex('playerId',q=>q.eq('playerId',parseGameId('players',a.playerId))).filter(q=>q.neq(q.field('inactive'),true)).order('desc').take(8),
  })));
  const archived=await ctx.db.query('archivedConversations').withIndex('worldId',q=>q.eq('worldId',world._id)).order('desc').take(50);
  const lore=await ctx.db.query('worldLore').withIndex('world',q=>q.eq('worldId',world._id)).first();
  return {status,world,cast,messages,memories,archived,lore};
}
