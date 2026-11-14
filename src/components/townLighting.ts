// Keyframes blend continuously across midnight; colors are authored for this map.
export const LIGHTING_PREVIEWS={Dawn:5.8,Day:12,Dusk:18.7,Night:22} as const;
const frames=[
 {hour:0,color:[12,21,54],dark:.68,warm:0,lamps:1},
 {hour:5,color:[32,34,65],dark:.60,warm:.05,lamps:.9},
 {hour:6,color:[82,61,91],dark:.28,warm:.16,lamps:.55},
 {hour:7,color:[222,170,112],dark:0,warm:.07,lamps:0},
 {hour:12,color:[222,170,112],dark:0,warm:0,lamps:0},
 {hour:17,color:[222,170,112],dark:0,warm:.06,lamps:0},
 {hour:18,color:[105,62,90],dark:.13,warm:.19,lamps:.25},
 {hour:19,color:[52,37,79],dark:.38,warm:.10,lamps:.8},
 {hour:20,color:[16,25,58],dark:.62,warm:0,lamps:1},
 {hour:22,color:[12,21,54],dark:.68,warm:0,lamps:1},
 {hour:24,color:[12,21,54],dark:.68,warm:0,lamps:1},
];
export function townLighting(hour:number){
 const h=((hour%24)+24)%24,index=frames.findIndex((f,i)=>i>0&&h<=f.hour),b=frames[index],a=frames[index-1];
 const t=(h-a.hour)/(b.hour-a.hour),s=t*t*(3-2*t),mix=(x:number,y:number)=>x+(y-x)*s;
 const c=a.color.map((v,i)=>Math.round(mix(v,b.color[i])));
 return {color:(c[0]<<16)|(c[1]<<8)|c[2],dark:mix(a.dark,b.dark),warm:mix(a.warm,b.warm),lamps:mix(a.lamps,b.lamps)};
}
