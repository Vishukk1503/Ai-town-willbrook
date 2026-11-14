import {Container,Graphics} from '@pixi/react';
import {Economy} from '../../convex/aiTown/economyState';
export default function PixiEconomy({economy:e,tile,onSelect}:{economy:Economy;tile:number;onSelect?:(place:'market'|'river')=>void}){
  const x=e.market.x*tile,y=e.market.y*tile,bx=e.bank.x*tile,by=e.bank.y*tile;
  return <Container><Graphics eventMode="static" cursor="pointer" pointertap={event=>{event.stopPropagation();onSelect?.('market');}} draw={p=>{
    p.clear();p.beginFill(0x26382a,.3);p.drawRect(x-5,y+tile*2,tile*3+10,12);p.endFill();
    p.beginFill(0x5a4432);p.drawRect(x,y,tile*3,tile);p.drawRect(x+5,y,5,tile*2.2);p.drawRect(x+tile*3-10,y,5,tile*2.2);p.endFill();
    p.beginFill(0xa18150);p.drawRect(x-4,y+tile*.65,tile*3+8,12);p.endFill();
    for(let i=0;i<6;i++){p.beginFill(i%2?0xd5c38c:0x597957);p.drawRect(x+i*16-3,y-24,16,27);p.drawRect(x+i*16-3,y,16,6);p.endFill();}
    p.beginFill(0x98714c);p.drawRect(x-4,y-28,tile*3+8,5);p.endFill();
    p.beginFill(0x79934f);for(let i=0;i<Math.min(e.marketStock.seeds,6);i++)p.drawRect(x+12+i*11,y+12,7,10);p.endFill();
  }}/><Graphics eventMode="static" cursor="pointer" pointertap={event=>{event.stopPropagation();onSelect?.('river');}} draw={p=>{
    p.clear();p.beginFill(0x876948);p.drawRect(bx-12,by-12,30,30);p.endFill();p.lineStyle(2,0x4c3e2d);for(let i=0;i<4;i++){p.moveTo(bx-12,by-10+i*8);p.lineTo(bx+18,by-10+i*8);}p.lineStyle();
    p.beginFill(0x5c4934);p.drawRect(bx-20,by-25,4,35);p.endFill();p.beginFill(0xcbbb87);p.drawRect(bx-29,by-36,25,16);p.endFill();
    if(e.jobs.some(j=>j.kind==='fish'&&j.started!==undefined)){p.lineStyle(1,0xc3d2a3);p.moveTo(bx,by);p.lineTo(e.water.x*tile+8,e.water.y*tile+8);p.beginFill(0xddb47c);p.drawCircle(e.water.x*tile+8,e.water.y*tile+8,3);p.endFill();}
  }}/></Container>;
}
