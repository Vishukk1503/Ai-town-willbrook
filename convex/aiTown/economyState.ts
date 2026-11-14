import {v,Infer} from 'convex/values';
const point=v.object({x:v.number(),y:v.number()});
export const items=v.object({turnips:v.number(),seeds:v.number(),fish:v.number(),rod:v.number(),meals:v.optional(v.number())});
export const economyState=v.object({
  merchant:v.string(),fisher:v.string(),market:point,bank:point,water:point,
  bags:v.array(v.object({owner:v.string(),items})),marketStock:items,
  population:v.number(),lastRecovery:v.number(),rng:v.number(),
  jobs:v.array(v.object({owner:v.string(),kind:v.union(v.literal('trade'),v.literal('deposit'),v.literal('fish')),started:v.optional(v.number()),requested:v.number()})),
  nextFish:v.number(),events:v.array(v.object({id:v.number(),text:v.string(),at:v.number(),witnesses:v.array(v.string()),kind:v.string()})),nextEvent:v.number(),
});
export type Economy=Infer<typeof economyState>;export type Items=Infer<typeof items>;
export const emptyItems=():Items=>({turnips:0,seeds:0,fish:0,rod:0,meals:0});
export const near=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y)<1.6;
export function transfer(bags:Economy['bags'],from:string,to:string,item:keyof Items,quantity:number){
  const a=bags.find(b=>b.owner===from),b=bags.find(b=>b.owner===to);
  if(!a||!b||a===b||!Number.isSafeInteger(quantity)||quantity<=0||(a.items[item]??0)<quantity) return false;
  a.items[item]=(a.items[item]??0)-quantity;b.items[item]=(b.items[item]??0)+quantity;return true;
}
export function barter(e:Economy,owner:string,item:'turnips'|'fish',quantity:number){
  const bag=e.bags.find(b=>b.owner===owner);const seeds=item==='turnips'?quantity:Math.floor(quantity/2);
  if(!bag||quantity!==2||bag.items[item]<quantity||e.marketStock.seeds<seeds)return false;
  bag.items[item]-=quantity;e.marketStock[item]+=quantity;e.marketStock.seeds-=seeds;bag.items.seeds+=seeds;return true;
}
export function catchFish(e:Economy,owner:string){
  const bag=e.bags.find(b=>b.owner===owner);if(!bag||bag.items.rod<1||e.population<=0)return false;
  e.rng=(Math.imul(e.rng,1664525)+1013904223)>>>0;
  if(e.rng/4294967296>=.65)return false;
  e.population--;bag.items.fish++;return true;
}
