import ModelsPanel from './components/ModelsPanel';
import { useState } from 'react';
import WorldGame from './components/WorldGame';
import Council from './components/Council';
import './components/WorldExperience.css';
import './components/WorldRefinements.css';
export default function WorldApp(){
  const [view,setView]=useState<'town'|'council'|'models'>('town');
  return <div className={`world-app ${view==='town'?'world-app-game':''}`}><header className="world-topbar"><button className="world-brand" onClick={()=>setView('town')}><span className="brand-mark">W</span><span>WILLOWBROOK<small>A world with a life of its own</small></span></button><nav aria-label="Simulation view"><button aria-pressed={view==='town'} onClick={()=>setView('town')}>◈ <span>Explore town</span></button><button aria-pressed={view==='council'} onClick={()=>setView('council')}>◌ <span>Council room</span></button><button aria-pressed={view==='models'} onClick={()=>setView('models')}>⚙ <span>Models & usage</span></button></nav><div className="world-topbar-note"><i/> Local world</div></header>{view==='town'?<WorldGame/>:view==='council'?<Council/>:<ModelsPanel/>}</div>;
}
