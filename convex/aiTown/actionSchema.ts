import type {Option} from './actionChoice';

export function actionSchema(options:Option[]){
 return {type:'object',properties:{
  action:{type:'string',enum:[...new Set(options.map(o=>o.id))]},
  reason:{type:'string'},
  plan:{anyOf:[{type:'null'},{type:'object',properties:{label:{type:'string'},steps:{type:'array',minItems:2,maxItems:4,items:{type:'string',enum:['fish','garden','forage','collect-food','rest','eat:meals','eat:turnips','cook:vegetable','cook:fish','cook:mixed','walk:river','walk:garden',...options.filter(o=>o.id.startsWith('place:')).map(o=>o.id)]}}},required:['label','steps'],additionalProperties:false}]},
  abandonPlan:{type:'boolean'},
 },required:['action','reason','plan','abandonPlan'],additionalProperties:false};
}
