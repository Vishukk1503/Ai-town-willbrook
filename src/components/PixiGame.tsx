import PixiAtmosphere from './PixiAtmosphere';
import PixiEconomy from './PixiEconomy';
import PixiVillage from './PixiVillage';
import PixiGarden from './PixiGarden';
import * as PIXI from 'pixi.js';
import { useApp } from '@pixi/react';
import { Player, SelectElement } from './Player.tsx';
import { useEffect, useRef, useState } from 'react';
import { PixiStaticMap } from './PixiStaticMap.tsx';
import PixiViewport from './PixiViewport.tsx';
import { Viewport } from 'pixi-viewport';
import { Id } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api.js';
import { useSendInput } from '../hooks/sendInput.ts';
import { toast } from 'react-toastify';
import { GameId } from '../../convex/aiTown/ids';
import { toastOnError } from '../toasts.ts';
import { DebugPath } from './DebugPath.tsx';
import { PositionIndicator } from './PositionIndicator.tsx';
import { SHOW_DEBUG_UI } from './Game.tsx';
import { ServerGame } from '../hooks/serverGame.ts';

export const PixiGame = (props: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  historicalTime: number | undefined;
  width: number;
  height: number;
  setSelectedElement: SelectElement;
  cameraRequest?: {id:number;type:string;x?:number;y?:number};
  showLabels?: boolean;
  selectedResidentId?: GameId<'players'>;
  running?: boolean;
  lightingHour?: number;
  animateAtmosphere?: boolean;
  onSelectPlace?:()=>void;
  onSelectVillage?:(id:string)=>void;
  onSelectEconomy?:(place:'market'|'river')=>void;
}) => {
  // PIXI setup.
  const pixiApp = useApp();
  const viewportRef = useRef<Viewport | undefined>();
  const townFeed=useQuery(api.council.townFeed);
  useEffect(()=>{
    const viewport=viewportRef.current,request=props.cameraRequest;
    if(!viewport||!request)return;
    const map=props.game.worldMap;
    if(request.type==='overview'||request.type==='home'){
      const fit=request.type==='home'?Math.max:Math.min;
      const scale=fit(props.width/(map.width*map.tileDim),props.height/(map.height*map.tileDim))*1.06;
      viewport.animate({position:new PIXI.Point(map.width*map.tileDim/2,map.height*map.tileDim/2),scale,time:450});
    }else if(request.type==='focus'&&request.x!==undefined&&request.y!==undefined){
      viewport.animate({position:new PIXI.Point((request.x+.5)*map.tileDim,(request.y+.5)*map.tileDim),scale:Math.max(1.8,viewport.scale.x),time:450});
    }else{
      viewport.animate({scale:Math.min(3.5,Math.max(.2,viewport.scale.x*(request.type==='zoomIn'?1.25:.8))),time:220});
    }
  },[props.cameraRequest?.id]);

  const humanTokenIdentifier = useQuery(api.world.userStatus, { worldId: props.worldId }) ?? null;
  const humanPlayerId = [...props.game.world.players.values()].find(
    (p) => p.human === humanTokenIdentifier,
  )?.id;

  const moveTo = useSendInput(props.engineId, 'moveTo');
  const moveResidentTo = useSendInput(props.engineId, 'moveResidentTo');
  useEffect(() => {
    const canvas=pixiApp.view as HTMLCanvasElement;
    const direct=(event:MouseEvent) => {
      if(!props.selectedResidentId)return;
      event.preventDefault();
      if(!props.running){toast.info('Press Live before directing a walk.');return;}
      const viewport=viewportRef.current;
      if(!viewport)return;
      const rect=canvas.getBoundingClientRect();
      const position=viewport.toWorld((event.clientX-rect.left)*props.width/rect.width,(event.clientY-rect.top)*props.height/rect.height);
      const destination={x:Math.floor(position.x/props.game.worldMap.tileDim),y:Math.floor(position.y/props.game.worldMap.tileDim)};
      void moveResidentTo({playerId:props.selectedResidentId,destination}).then(()=>setLastDestination({...destination,t:Date.now()})).catch(error=>toast.error(error.message));
    };
    canvas.addEventListener('contextmenu',direct);
    return ()=>canvas.removeEventListener('contextmenu',direct);
  },[props.selectedResidentId,props.running,props.width,props.height,props.engineId,pixiApp]);

  // Interaction for clicking on the world to navigate.
  const dragStart = useRef<{ screenX: number; screenY: number } | null>(null);
  const onMapPointerDown = (e: any) => {
    if(e.button!==0)return;
    // https://pixijs.download/dev/docs/PIXI.FederatedPointerEvent.html
    dragStart.current = { screenX: e.screenX, screenY: e.screenY };
  };

  const [lastDestination, setLastDestination] = useState<{
    x: number;
    y: number;
    t: number;
  } | null>(null);
  const onMapPointerUp = async (e: any) => {
    if(e.button!==0)return;
    if (dragStart.current) {
      const { screenX, screenY } = dragStart.current;
      dragStart.current = null;
      const [dx, dy] = [screenX - e.screenX, screenY - e.screenY];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 10) {
        console.log(`Skipping navigation on drag event (${dist}px)`);
        return;
      }
    }
    if (!humanPlayerId) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const gameSpacePx = viewport.toWorld(e.screenX, e.screenY);
    const tileDim = props.game.worldMap.tileDim;
    const gameSpaceTiles = {
      x: gameSpacePx.x / tileDim,
      y: gameSpacePx.y / tileDim,
    };
    setLastDestination({ t: Date.now(), ...gameSpaceTiles });
    const roundedTiles = {
      x: Math.floor(gameSpaceTiles.x),
      y: Math.floor(gameSpaceTiles.y),
    };
    console.log(`Moving to ${JSON.stringify(roundedTiles)}`);
    await toastOnError(moveTo({ playerId: humanPlayerId, destination: roundedTiles }));
  };
  const { width, height, tileDim } = props.game.worldMap;
  const players = [...props.game.world.players.values()];

  // Zoom on the user’s avatar when it is created
  useEffect(() => {
    if (!viewportRef.current || humanPlayerId === undefined || props.cameraRequest) return;

    const humanPlayer = props.game.world.players.get(humanPlayerId)!;
    viewportRef.current.animate({
      position: new PIXI.Point(humanPlayer.position.x * tileDim, humanPlayer.position.y * tileDim),
      scale: 1.5,
    });
  }, [humanPlayerId]);

  return (
    <PixiViewport
      app={pixiApp}
      screenWidth={props.width}
      screenHeight={props.height}
      worldWidth={width * tileDim}
      worldHeight={height * tileDim}
      viewportRef={viewportRef}
    >
      <PixiStaticMap
        map={props.game.worldMap}
        onpointerup={onMapPointerUp}
        onpointerdown={onMapPointerDown}
      />
      {props.game.world.village&&<PixiVillage village={props.game.world.village} tile={tileDim} onSelect={props.onSelectVillage}/>}
      {props.game.world.garden&&<PixiGarden garden={props.game.world.garden} tile={tileDim} onSelect={props.onSelectPlace}/>}
      {props.game.world.economy&&<PixiEconomy economy={props.game.world.economy} tile={tileDim} onSelect={props.onSelectEconomy}/>}
      {players.map(
        (p) =>
          // Only show the path for the human player in non-debug mode.
          (SHOW_DEBUG_UI || p.id === humanPlayerId || p.id === props.selectedResidentId) && (
            <DebugPath key={`path-${p.id}`} player={p} tileDim={tileDim} />
          ),
      )}
      {lastDestination && <PositionIndicator destination={lastDestination} tileDim={tileDim} />}
      <PixiAtmosphere game={props.game} hour={props.lightingHour??12} animate={props.animateAtmosphere??false}/>
      {players.map((p) => (
        <Player
          key={`player-${p.id}`}
          game={props.game}
          player={p}
          isViewer={p.id === humanPlayerId || p.id === props.selectedResidentId}
          onClick={props.setSelectedElement}
          historicalTime={props.historicalTime}
          showLabel={props.showLabels}
          spokenLine={townFeed?.messages.filter(m=>m.author===p.id).at(-1)}
        />
      ))}
    </PixiViewport>
  );
};
export default PixiGame;
