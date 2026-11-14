import {useState} from 'react';
import {usePaginatedQuery,useQuery,useConvex} from 'convex/react';
import {api} from '../../convex/_generated/api';
import type {Id} from '../../convex/_generated/dataModel';
import {worldTime} from '../../data/worldTime';
const parse=(value?:string)=>{try{return value?JSON.parse(value):undefined;}catch{return undefined;}};
const number=(value:unknown)=>typeof value==='number'?Math.round(value):'—';
export default function DecisionHistory({worldId,playerId,needsNow}:{worldId:Id<'worlds'>;playerId:string;needsNow?:{hunger:number;energy:number;restedness?:number}}){
 const {results,status,loadMore}=usePaginatedQuery(api.decisionHistory.list,{worldId,playerId},{initialNumItems:8});
 const [selected,setSelected]=useState<string>(),[exporting,setExporting]=useState(false),[error,setError]=useState('');
 const detail=useQuery(api.decisionHistory.detail,selected?{worldId,operationId:selected}:'skip'),convex=useConvex();
 const context=parse(detail?.row.contextJson),body=parse(detail?.row.bodyJson),menu=context?.options??[];
 async function download(){setExporting(true);setError('');try{
  const records=await Promise.all(results.map(r=>convex.query(api.decisionHistory.detail,{worldId,operationId:r.operationId})));
  const url=URL.createObjectURL(new Blob([JSON.stringify({worldId,playerId,exportedAt:new Date().toISOString(),records},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='resident-'+playerId.replaceAll(':','-')+'-decisions.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch{setError('Could not export the loaded records. Please try again.');}finally{setExporting(false);}}
 return <section className="decision-history" aria-label="Permanent decision history"><div className="decision-history-heading"><div><h4>Decision history</h4><p>Recorded choices and their actual outcomes.</p></div><button disabled={!results.length||exporting} onClick={()=>void download()}>{exporting?'Exporting…':'Export loaded'}</button></div>
  <p className="inspector-note">Records are retained until explicitly deleted with the world or database. Older observation snapshots are separate. A stated motive is not proof of completion.</p>
  {error&&<p role="alert">{error}</p>}
  {status==='LoadingFirstPage'&&<p>Loading decisions…</p>}
  {status!=='LoadingFirstPage'&&!results.length&&<p className="inspector-note">Permanent logging begins with new decisions. Let the town run to record them.</p>}
  {results.map(row=><article key={row._id} className="decision-history-entry"><button className="decision-history-select" aria-expanded={selected===row.operationId} onClick={()=>setSelected(selected===row.operationId?undefined:row.operationId)}><span>Day {worldTime(row.clock).day} · {worldTime(row.clock).time}<i className={'decision-status is-'+row.status}>{row.status.replaceAll('_',' ')}</i></span><strong>{row.label??'Choosing an activity'}</strong><small>{row.reason??'Request context captured; no selection recorded yet.'}</small></button>
   {selected===row.operationId&&(detail===undefined?<p>Loading the record…</p>:detail&&<div className="decision-history-detail"><p><strong>Outcome:</strong> {detail.row.outcome??'No completion has been confirmed yet.'}</p><table aria-label="Needs when asked, when chosen, and now"><thead><tr><th>Needs</th><th>Asked</th><th>Chosen</th><th>Now</th></tr></thead><tbody>{(['hunger','energy','restedness'] as const).map(key=><tr key={key}><th>{key==='restedness'?'Restedness':key==='hunger'?'Hunger':'Energy'}</th><td>{number(context?.needs?.[key])}</td><td>{number(body?.needs?.[key])}</td><td>{number(needsNow?.[key])}</td></tr>)}</tbody></table>
    <small>Hunger rises as they need food. A dash means it was not captured.</small>
    <ol className="decision-event-timeline">{detail.events.map(e=><li key={e._id}><span>{worldTime(e.clock).time} · {e.phase.replaceAll('_',' ')}</span><p>{e.summary}</p>{e.dataJson&&<details><summary>Recorded evidence</summary><pre>{JSON.stringify(parse(e.dataJson),null,2)}</pre></details>}</li>)}</ol>
    {detail.eventsCapped&&<p>Showing the first 200 events for this decision.</p>}
    <details><summary>Exact menu when asked ({menu.length})</summary>{menu.map((o:any)=><p key={o.id}><strong>{o.label}</strong><small>{o.id} · priority {Math.round(o.score)}</small></p>)}{!menu.length&&<p>No model menu was captured for this engine or older intention.</p>}</details>
    <details><summary>Menu revalidated at execution</summary><pre>{JSON.stringify(parse(detail.row.menuJson),null,2)}</pre></details>
    <details><summary>Model request & usage</summary>{detail.requests.length?detail.requests.map((r,i)=><p key={i}>{r.provider} · {r.model}<small>{r.status} · {r.inputTokens??'—'} input / {r.outputTokens??'—'} output tokens · {r.ms??'—'} ms · $ {((r.chargedMicros??0)/1000000).toFixed(6)}</small>{r.error&&<small>{r.error}</small>}</p>):<p>No model request is linked to this record.</p>}<small>Decision ID: {row.operationId}<br/>Source: {row.source??'Not selected'}{row.parentKey&&<><br/>Prior intention: {row.parentKey}</>}</small></details>
    <details><summary>Full captured context</summary><pre>{JSON.stringify(context,null,2)}</pre></details>
   </div>)}
  </article>)}
  {status==='CanLoadMore'&&<button className="decision-load-more" onClick={()=>loadMore(8)}>Load older decisions</button>}{status==='LoadingMore'&&<p>Loading older decisions…</p>}
 </section>;
}
