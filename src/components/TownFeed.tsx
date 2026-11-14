import { useState } from 'react';
import { useMutation,useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

export default function TownFeed(){
  const feed=useQuery(api.council.townFeed),resume=useMutation(api.testing.resume);
  const [error,setError]=useState('');
  if(!feed)return null;
  return <section className="town-live-feed font-system"><h2>Town conversations</h2>
    <p>{feed.status==='running'?'● Town is running':feed.councilRunning?'Town paused while the council meets.':'Town is paused.'}</p>
    {feed.status!=='running'&&<button disabled={feed.councilRunning} onClick={()=>{setError('');void resume({}).catch(e=>setError(String(e)));}}>Resume town interactions</button>}
    <p className="town-feed-hint">New replies appear here automatically. 💬 on the map means an agent is composing a reply. Select a character below for their full conversation.</p>
    {error&&<p role="alert">{error}</p>}
    <div className="town-feed-messages" aria-live="polite">{feed.messages.length?feed.messages.slice(-12).reverse().map(m=><article key={m._id}><strong>{m.speaker}</strong><time>{new Date(m._creationTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time><p>{m.text}</p></article>):<p>No dialogue yet. Agents talk when they meet.</p>}</div>
  </section>;
}
