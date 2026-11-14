import {Container,Graphics,Sprite,useTick} from '@pixi/react';
import * as PIXI from 'pixi.js';
import {useEffect,useMemo,useRef} from 'react';
import type {ServerGame} from '../hooks/serverGame';
import {townLighting} from './townLighting';
type Light={x:number;y:number;radius:number;window?:boolean};
// Canvas masks are built only when the map/buildings change, never each frame.
export default function PixiAtmosphere({game,hour,animate}:{game:ServerGame;hour:number;animate:boolean}){
 const tile=game.worldMap.tileDim,w=game.worldMap.width*tile,h=game.worldMap.height*tile;
 const layout=JSON.stringify({places:game.world.village?.places,garden:game.world.garden?.home,market:game.world.economy?.market,bank:game.world.economy?.bank});
 const lights=useMemo(()=>{
  const out:Light[]=[];
  for(const b of game.world.village?.places??[]){
   if(b.id==='bob-home')continue;
   const x=b.footprint.x*tile,y=b.footprint.y*tile,bw=b.footprint.w*tile,bh=b.footprint.h*tile;
   for(const wx of [x+21,x+bw-20])out.push({x:wx,y:y+tile+23,radius:tile*1.8,window:true});
   out.push({x:x+bw/2+20,y:y+bh-21,radius:tile*(b.kind==='tavern'?3.2:2.1)});
  }
  const home=game.world.garden?.home;
  if(home){for(const dx of [23,74])out.push({x:home.x*tile+dx,y:home.y*tile+60,radius:tile*1.8,window:true});out.push({x:home.x*tile+71,y:home.y*tile+80,radius:tile*2.1});}
  const market=game.world.economy?.market,bank=game.world.economy?.bank;
  if(market)out.push({x:market.x*tile+tile*2.7,y:market.y*tile+tile*.8,radius:tile*2.3});
  if(bank)out.push({x:bank.x*tile-18,y:bank.y*tile-13,radius:tile*1.8});
  return out;
 },[layout,tile]);
 const textures=useMemo(()=>{
  const scale=.5,mask=document.createElement('canvas'),glow=document.createElement('canvas');
  mask.width=glow.width=Math.ceil(w*scale);mask.height=glow.height=Math.ceil(h*scale);
  const m=mask.getContext('2d')!,g=glow.getContext('2d')!;m.scale(scale,scale);g.scale(scale,scale);
  m.fillStyle='#ffffff';m.fillRect(0,0,w,h);m.globalCompositeOperation='destination-out';
  for(const l of lights){
   const hole=m.createRadialGradient(l.x,l.y,2,l.x,l.y,l.radius);hole.addColorStop(0,'rgba(0,0,0,.90)');hole.addColorStop(.28,'rgba(0,0,0,.65)');hole.addColorStop(1,'rgba(0,0,0,0)');m.fillStyle=hole;m.fillRect(l.x-l.radius,l.y-l.radius,l.radius*2,l.radius*2);
   const halo=g.createRadialGradient(l.x,l.y,0,l.x,l.y,l.radius);halo.addColorStop(0,'rgba(255,188,86,.34)');halo.addColorStop(.25,'rgba(255,153,57,.16)');halo.addColorStop(1,'rgba(255,137,38,0)');g.fillStyle=halo;g.fillRect(l.x-l.radius,l.y-l.radius,l.radius*2,l.radius*2);
  }
  return {mask:PIXI.Texture.from(mask),glow:PIXI.Texture.from(glow)};
 },[lights,w,h]);
 useEffect(()=>()=>{textures.mask.destroy(true);textures.glow.destroy(true);},[textures]);
 const sky=townLighting(hour),current=useRef(sky),darkness=useRef<PIXI.Sprite>(null),sunset=useRef<PIXI.Graphics>(null),flicker=useRef<PIXI.Container>(null),particles=useRef<PIXI.Graphics>(null),time=useRef(0);
 const reducedMotion=useMemo(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches,[]);
 useTick(delta=>{
  const k=reducedMotion?1:1-Math.exp(-Math.min(delta,3)/18),c=current.current;
  c.dark+=(sky.dark-c.dark)*k;c.warm+=(sky.warm-c.warm)*k;c.lamps+=(sky.lamps-c.lamps)*k;
  const rgb=(color:number,shift:number)=>(color>>shift)&255;
  c.color=[16,8,0].reduce((color,shift)=>color|(Math.round(rgb(c.color,shift)+(rgb(sky.color,shift)-rgb(c.color,shift))*k)<<shift),0);
  if(darkness.current){darkness.current.alpha=c.dark;darkness.current.tint=c.color;}
  if(sunset.current)sunset.current.alpha=c.warm;
  if(animate&&!reducedMotion)time.current+=Math.min(delta,3)/60;
  const t=time.current;if(flicker.current)flicker.current.alpha=c.lamps*(reducedMotion?1:.95+.025*Math.sin(t*3.1)+.025*Math.sin(t*7.7));
  const p=particles.current;if(!p)return;p.clear();
  const bank=game.world.economy?.bank;if(!bank||c.lamps<.2||reducedMotion)return;
  // Sparse fireflies by the water, not a full-screen particle fog.
  for(let i=0;i<9;i++){const a=.13+.55*Math.pow(Math.max(0,Math.sin(t*.8+i*2.3)),3);p.beginFill(0xe4e8a3,a*c.lamps);p.drawRect(bank.x*tile+Math.sin(t*.18+i*9)*tile*2.8,bank.y*tile+Math.cos(t*.15+i*4)*tile*1.6,2,2);p.endFill();}
 });
 return <Container eventMode="none">
  <Graphics ref={sunset} alpha={sky.warm} draw={p=>{p.clear();p.beginFill(0xf4aa67);p.drawRect(0,0,w,h);p.endFill();}}/>
  <Sprite ref={darkness} texture={textures.mask} width={w} height={h} tint={sky.color} alpha={sky.dark}/>
  <Container ref={flicker} alpha={sky.lamps}>
   <Sprite texture={textures.glow} width={w} height={h} blendMode={PIXI.BLEND_MODES.ADD}/>
   <Graphics draw={p=>{p.clear();for(const l of lights){
    // A small stepped pool on the ground below each lantern.
    if(!l.window){p.beginFill(0xe8b65e,.09);p.drawPolygon([l.x-2,l.y+6,l.x+2,l.y+6,l.x+24,l.y+31,l.x-24,l.y+31]);p.endFill();}

    if(l.window){p.beginFill(0xffd78c,.96);p.drawRect(l.x-5,l.y-7,10,13);p.endFill();p.beginFill(0x75502e);p.drawRect(l.x-1,l.y-7,2,13);p.drawRect(l.x-5,l.y-1,10,2);p.endFill();}
    else{p.beginFill(0x392e2b);p.drawRect(l.x-4,l.y-7,8,13);p.drawRect(l.x-6,l.y-8,12,3);p.drawRect(l.x-3,l.y+6,6,2);p.endFill();p.beginFill(0xffc76d);p.drawRect(l.x-2,l.y-4,4,8);p.endFill();p.beginFill(0xffefb9);p.drawRect(l.x-1,l.y-2,2,4);p.endFill();}
   }}}/>
  </Container>
  <Graphics ref={particles} draw={()=>{}}/>
 </Container>;
}
