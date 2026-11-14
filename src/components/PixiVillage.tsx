import {Container,Graphics,Text} from '@pixi/react';
import * as PIXI from 'pixi.js';
import type {Village} from '../../convex/aiTown/villageState';
export default function PixiVillage({village,tile,onSelect}:{village:Village;tile:number;onSelect?:(id:string)=>void}){
  return <Container>
    <Graphics draw={p=>{p.clear();p.beginFill(0x9b8054,.8);for(const route of village.paths)for(const n of route)p.drawRect((n.x+.12)*tile,(n.y+.12)*tile,tile*.76,tile*.76);p.endFill();}}/>
    {village.places.filter(b=>b.id!=='bob-home').map(b=>{
      const x=b.footprint.x*tile,y=b.footprint.y*tile,w=b.footprint.w*tile,h=b.footprint.h*tile,tavern=b.kind==='tavern',roof=tavern?0x914f43:b.id==='lucky-home'?0x9d813f:0x6d647e;
      return <Container key={b.id}>
        <Graphics eventMode="static" cursor="pointer" pointertap={e=>{e.stopPropagation();onSelect?.(b.id);}} draw={p=>{
          p.clear();p.beginFill(0x12291d,.35);p.drawRect(x+5,y+h-5,w+5,14);p.endFill();
          p.beginFill(0x4c3b2d);p.drawRect(x,y,w,h);p.endFill();
          p.beginFill(0xd2bd89);p.drawRect(x+4,y+tile,w-8,h-tile-4);p.endFill();
          p.beginFill(roof);p.drawRect(x-3,y+tile*.75,w+6,tile*.4);p.drawRect(x+4,y+tile*.4,w-8,tile*.35);p.drawRect(x+15,y+5,w-30,tile*.3);p.endFill();
          p.beginFill(0x674631);for(let i=0;i<3;i++)p.drawRect(x+4+i*(w-12)/2,y+tile,5,h-tile);p.drawRect(x+3,y+h-9,w-6,5);p.endFill();
          p.beginFill(0x514335);p.drawRect(x+w/2-10,y+h-30,20,30);p.endFill();p.beginFill(0xe3b777);p.drawRect(x+w/2+4,y+h-16,3,3);p.endFill();
          for(const wx of [x+12,x+w-29]){p.beginFill(0x3e4d44);p.drawRect(wx,y+tile+13,18,20);p.endFill();p.beginFill(0xf1d599);p.drawRect(wx+3,y+tile+16,12,14);p.endFill();p.beginFill(0x73553c);p.drawRect(wx+8,y+tile+14,2,18);p.drawRect(wx+1,y+tile+22,17,2);p.endFill();}
          p.beginFill(0x7d765e);p.drawRect(x+w-26,y+3,10,19);p.endFill();
          if(tavern){p.beginFill(0x584333);p.drawRect(x+w+3,y+tile+3,3,30);p.drawRect(x+w-8,y+tile+6,22,3);p.endFill();p.beginFill(0xccad68);p.drawRect(x+w+4,y+tile+10,19,17);p.endFill();p.beginFill(0x704b30);p.drawRect(x+10,y+h+16,26,8);p.drawRect(x+14,y+h+12,18,4);p.drawRect(x+w-36,y+h+16,26,8);p.endFill();}
        }}/>
        <Text text={tavern?'HEARTH & REED':b.id==='lucky-home'?'LUCKY’S COTTAGE':'STELLA’S COTTAGE'} x={x+w/2} y={y+h+tile*.85} anchor={.5} style={new PIXI.TextStyle({fontFamily:'Arial',fontSize:9,fontWeight:'bold',fill:0xf2dfae,stroke:0x213225,strokeThickness:3})}/>
      </Container>;
    })}
  </Container>;
}
