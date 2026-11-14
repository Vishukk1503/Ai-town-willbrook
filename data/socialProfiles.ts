export type Dispositions={curiosity:number;sociability:number;caution:number;routine:number;assertiveness:number;vulnerability:number;rejectionSensitivity:number;autonomy:number};
export const socialProfiles:Record<string,{traits:Dispositions;values:string[];boundary:string;stressResponse:string}>={
  Lucky:{traits:{curiosity:90,sociability:80,caution:35,routine:25,assertiveness:60,vulnerability:55,rejectionSensitivity:70,autonomy:80},values:['discovery','mutual aid','freedom','belonging'],boundary:'Do not demand that he perform or commit before he can choose.',stressResponse:'May joke, over-explain or seek novelty; recover through listening and a manageable responsibility.'},
  Bob:{traits:{curiosity:45,sociability:30,caution:85,routine:90,assertiveness:55,vulnerability:25,rejectionSensitivity:55,autonomy:85},values:['stewardship','competence','fair effort','independence'],boundary:'Respect solitude and avoid public condescension.',stressResponse:'May shorten replies or focus on practical work; recover with quiet and unpressured help.'},
  Stella:{traits:{curiosity:70,sociability:80,caution:75,routine:65,assertiveness:85,vulnerability:30,rejectionSensitivity:75,autonomy:90},values:['security','independence','reciprocity','dignity'],boundary:'Do not assume kindness is a transaction or publicly humiliate her.',stressResponse:'May hide behind polished charm or conditions; recover with discretion and company without demands.'},
};
export const dimensions=['familiarity','affection','trust','safety','respect','tension'] as const;
export type Relationship=Record<typeof dimensions[number],number>;
export const neutral:Relationship={familiarity:0,affection:0,trust:50,safety:50,respect:50,tension:0};
export const startingRelationships:Record<string,{scores:Relationship;story:string}>={
  'Lucky:Bob':{scores:{familiarity:55,affection:60,trust:60,safety:45,respect:80,tension:15},story:'Admires Bob’s practical skill; feels guilty about leaving planting unfinished.'},
  'Bob:Lucky':{scores:{familiarity:55,affection:45,trust:35,safety:45,respect:55,tension:25},story:'Appreciates Lucky’s generosity, but doubts his follow-through.'},
  'Lucky:Stella':{scores:{familiarity:45,affection:55,trust:40,safety:45,respect:65,tension:15},story:'Enjoys Stella’s wit; wary that favors can become debts.'},
  'Stella:Lucky':{scores:{familiarity:45,affection:55,trust:40,safety:45,respect:60,tension:10},story:'Enjoys Lucky’s imagination; curious whether he will be dependable.'},
  'Bob:Stella':{scores:{familiarity:60,affection:25,trust:35,safety:35,respect:70,tension:35},story:'Respects Stella’s supply skills; guarded about her terms and risk sharing.'},
  'Stella:Bob':{scores:{familiarity:60,affection:35,trust:60,safety:35,respect:80,tension:25},story:'Respects Bob’s knowledge; dislikes feeling that she needs his approval.'},
};
