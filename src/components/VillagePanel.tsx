import type {Village,Place} from '../../convex/aiTown/villageState';
export default function VillagePanel({village,onFocus}:{village:Village;onFocus:(place:Place)=>void}){
  return <section aria-label="Village places"><span className="hud-eyebrow">A PLACE TO BELONG</span><h3>Homes & gathering places</h3><p className="inspector-note">Residents can choose to visit a doorstep or the tavern courtyard. Select a place to find it on the map.</p>
    {village.places.map(place=><article className="world-memory" key={place.id}><span>{place.kind==='tavern'?'PUBLIC GATHERING PLACE':'RESIDENT’S HOME'}</span><h3>{place.name}</h3><p>{place.description}</p><small>{village.visits.filter(v=>v.placeId===place.id).length} visits in progress</small><p><button className="resident-sheet-link" onClick={()=>onFocus(place)}>Find on map →</button></p></article>)}
    <h3>Recent visits</h3>{village.events.length?village.events.slice(-6).reverse().map(e=><article className="world-memory" key={e.id}><p>{e.text}</p><small>{new Date(e.at).toLocaleTimeString()} · completed visit</small></article>):<p className="inspector-note">Completed visits will appear here as residents spend time in the village.</p>}
  </section>;
}
