type Needs={hunger:number;energy:number;restedness?:number};
export function emergencyNeed(needs:Needs|undefined){
 if(!needs)return undefined;
 if(needs.hunger>=90)return 'food';
 if(needs.energy<15)return 'energy';
 if((needs.restedness??65)<=0)return 'sleep';
}
export function priorityActions<T extends {id:string;kind:string}>(options:T[],needs:Needs|undefined):T[]{
 switch(emergencyNeed(needs)){
  case 'food':{
   const ready=options.filter(o=>o.kind==='eat');
   return ready.length?ready:options.filter(o=>['collect','cook','forage'].includes(o.kind));
  }
  case 'energy':return options.filter(o=>o.kind==='rest'||o.kind==='sleep');
  case 'sleep':return options.filter(o=>o.kind==='sleep');
  default:return options;
 }
}
