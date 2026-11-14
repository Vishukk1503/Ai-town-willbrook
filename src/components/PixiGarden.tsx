import {Container,Graphics,Text} from '@pixi/react';
import * as PIXI from 'pixi.js';
import {Garden} from '../../convex/aiTown/gardenState';
export default function PixiGarden({garden,tile,onSelect}:{garden:Garden;tile:number;onSelect?:()=>void}){
  const g=garden,x=g.home.x*tile,y=g.home.y*tile,w=tile*3;
  return <Container>
    <Graphics eventMode="static" cursor="pointer" pointertap={e=>{e.stopPropagation();onSelect?.();}} draw={p=>{
      p.clear();
      p.beginFill(0x957450,.65);p.drawRect((g.origin.x+2)*tile,(g.origin.y+3)*tile,tile,tile*3);p.drawRect(g.origin.x*tile,(g.origin.y+4)*tile,tile*7,tile*.5);p.endFill();
      p.beginFill(0x203124,.3);p.drawRect(x+5,y+w-8,w+6,15);p.endFill();
      p.beginFill(0x5b4935);p.drawRect(x,y,w,w);p.endFill();p.beginFill(0xc5ad72);p.drawRect(x+5,y+35,w-10,w-40);p.endFill();
      p.beginFill(0x6d4e37);p.drawRect(x-5,y+24,w+10,18);p.drawRect(x+5,y+12,w-10,12);p.drawRect(x+17,y+2,w-34,10);p.endFill();
      p.beginFill(0x9b7249);for(let i=0;i<3;i++)p.drawRect(x+6+i*28,y+27,22,5);p.endFill();
      p.beginFill(0x384c40);p.drawRect(x+14,y+50,18,20);p.drawRect(x+65,y+50,18,20);p.endFill();p.beginFill(0xddda9c);p.drawRect(x+18,y+53,10,13);p.drawRect(x+69,y+53,10,13);p.endFill();
      p.beginFill(0x493b2c);p.drawRect(x+40,y+57,20,39);p.endFill();p.beginFill(0xc4a569);p.drawRect(x+53,y+77,3,3);p.endFill();
      for(const b of g.beds){const bx=b.x*tile,by=b.y*tile;p.beginFill(0x48382b);p.drawRect(bx-10,by-10,30,30);p.endFill();p.beginFill(0x76583a);for(let i=0;i<3;i++)p.drawRect(bx-7,by-7+i*9,24,3);p.endFill();
        if(b.state!=='empty'){p.beginFill(b.state==='ready'?0xa8bb67:0x63894c);for(const [dx,dy] of [[0,0],[12,0],[0,12],[12,12]]){p.drawRect(bx-4+dx,by-4+dy,5,12);p.drawRect(bx-7+dx,by-1+dy,11,4);}p.endFill();if(b.state==='ready'){p.beginFill(0xe6d6a5);p.drawRect(bx-3,by+4,6,5);p.drawRect(bx+9,by+16,6,5);p.endFill();}}
      }
    }}/>
    <Text text="BOB’S HOME" x={x+w/2} y={y+w+4} anchor={.5} style={new PIXI.TextStyle({fontFamily:'Arial',fontSize:9,fontWeight:'bold',fill:0xf5e5bd,stroke:0x203825,strokeThickness:3})}/>
    <Text text="TURNIP GARDEN" x={(g.origin.x+3)*tile} y={(g.origin.y+6.4)*tile} anchor={.5} eventMode="static" cursor="pointer" pointertap={e=>{e.stopPropagation();onSelect?.();}} style={new PIXI.TextStyle({fontFamily:'Arial',fontSize:9,fontWeight:'bold',fill:0xdce5b2,stroke:0x203825,strokeThickness:3})}/>
  </Container>;
}
