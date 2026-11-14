// Gameplay tuning, not a medical model. One village hour is one real minute.
export const AWAKE_RESTEDNESS_DRAIN=100/17;
export const SLEEP_RESTEDNESS_GAIN=12.5;
export const restedness=(n?:{restedness?:number})=>n?.restedness??65;
export const sleepDescription=(value:number)=>value<15?'Severely sleep deprived':value<30?'Sleepy':value<60?'Some sleep debt':'Well rested';
export const demandingAction=(kind:string)=>['fish','garden','forage','cook','market','trade','deposit','offer','activityOffer'].includes(kind);
