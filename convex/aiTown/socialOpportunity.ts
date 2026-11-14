import type {DecisionWorld} from './actionChoice';
import type {SocialActivity} from './socialActivityTypes';
import {restedness} from '../../data/restedness';
import {WORLD_HOUR_MS} from '../../data/worldTime';
export function sharedMotive(w:DecisionWorld,owner:string,partner:string,activity:SocialActivity['activity']):string|undefined{
 const l=w.livelihood,n=l?.needs.find(n=>n.owner===owner);if(!l||!n||restedness(n)<30||n.energy<30)return;
 const recent=(l.activities??[]).filter(s=>s.participants.includes(owner));
 if(recent.some(s=>!['proposed','scheduled','gathering','active'].includes(s.status)&&l.clock-(s.finishedAt??s.started??s.created)<4*WORLD_HOUR_MS))return;
 if(recent.some(s=>s.activity===activity&&s.participants.includes(partner)&&l.clock-(s.finishedAt??s.started??s.created)<8*WORLD_HOUR_MS))return;
 if(activity==='meal')return n.hunger>=35?'I am hungry and would enjoy company over a meal':undefined;
 if(activity==='help')return n.energy>=45&&w.garden&&[owner,partner].includes(w.garden.owner)&&w.garden.beds.some(b=>b.state==='ready'||b.state==='empty'&&w.garden!.seeds>0)?'There is an actual garden task we could help with':undefined;
 const a=w.awareness,companyDue=!a||a.socialReadiness>=50&&l.clock-(a.lastCompanyClock??0)>=3*WORLD_HOUR_MS;
 if(!companyDue)return;
 return activity==='walk'?'I want some company and a change of scene':'I would like an unhurried visit after time apart';
}
