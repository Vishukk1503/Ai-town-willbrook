// Conservative explicit-language extraction; guesses and generic future tense are not promises.
export function speechSignals(text:string) {
  const sentences=text.replace(/[’]/g,"'").split(/\n+|(?<=[.!?])\s+/);
  const beliefs:{statement:string; previous?:string}[]=[];
  const promises:string[]=[];
  const resolutions:{task:string;kind:'reported_done'|'withdrawn'}[]=[];
  for(const sentence of sentences){
    const correction=sentence.match(/^I used to (?:think|believe) (.+?),? but now I (?:think|believe) (.+?)[.!?]?$/i);
    if(correction) beliefs.push({previous:clean(correction[1]),statement:clean(correction[2])});
    else {
      const belief=sentence.match(/^I (?:think|believe) (.+?)[.!?]?$/i);
      if(belief) beliefs.push({statement:clean(belief[1])});
    }
    const promise=sentence.match(/^I promise (?:you )?to (.+?)[.!?]?$/i);
    if(promise) promises.push(clean(promise[1]));
    const done=sentence.match(/^I (?:kept|fulfilled) my promise to (.+?)[.!?]?$/i);
    if(done) resolutions.push({task:clean(done[1]),kind:'reported_done'});
    const withdrawn=sentence.match(/^I (?:withdraw|take back) my promise to (.+?)[.!?]?$/i);
    if(withdrawn) resolutions.push({task:clean(withdrawn[1]),kind:'withdrawn'});
  }
  return {beliefs:beliefs.slice(0,3),promises:promises.slice(0,2),resolutions:resolutions.slice(0,2)};
}
function clean(s:string){return s.trim().replace(/[.!?]+$/,'').slice(0,300);}
export function sameStatement(a:string,b:string){return a.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()===b.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
