/* Multiplayer client bridge. The server is authoritative; this file caches the
   latest server snapshot and turns UI actions into API requests. */
(function(){
  'use strict';
  const BASE=window.AttritionSimulation;
  const CONFIG=window.AttritionGameConfig||{};
  const configured=(CONFIG.server&&CONFIG.server.url)||'';
  const BASE_URL=configured.replace(/\/$/,'')||window.location.origin;
  const TOKEN_KEY='attrition-session-token-v1';
  let snapshot=null,online=false,booted=false;

  async function request(path,options={}){
    const headers=Object.assign({'Content-Type':'application/json'},options.headers||{});
    const token=localStorage.getItem(TOKEN_KEY);
    if(token)headers.Authorization='Bearer '+token;
    const res=await fetch(BASE_URL+path,Object.assign({},options,{headers}));
    let body={};try{body=await res.json();}catch(_){}
    if(!res.ok){const error=new Error(body.error||body.result?.message||('Request failed: '+res.status));error.status=res.status;throw error;}
    return body;
  }
  function hydrate(body){
    snapshot=body.state||body;online=true;
    window.AttritionOnline={online:true,player:snapshot.player};
    window.dispatchEvent(new CustomEvent('attrition-state',{detail:snapshot}));
    return snapshot;
  }
  async function createOrRestoreSession(){
    const saved=localStorage.getItem(TOKEN_KEY);
    const body=await request('/api/session',{method:'POST',body:JSON.stringify(saved?{token:saved}:{})});
    localStorage.setItem(TOKEN_KEY,body.token);hydrate(body.state);booted=true;return body;
  }
  async function sync(){
    const oldSeason=snapshot?.season?.number;
    try{
      const body=await request('/api/state');hydrate(body);
    }catch(err){
      if(err.status!==401)throw err;
      localStorage.removeItem(TOKEN_KEY);await createOrRestoreSession();
    }
    return {seasonChanged:oldSeason!==undefined&&oldSeason!==snapshot.season.number,processed:0};
  }
  async function action(name,args){
    try{
      const body=await request('/api/action',{method:'POST',body:JSON.stringify({action:name,args})});
      hydrate(body.state);return body.result;
    }catch(err){
      if(err.status===401){localStorage.removeItem(TOKEN_KEY);await createOrRestoreSession();return {ok:false,message:'Your session was refreshed.'};}
      return {ok:false,message:err.message};
    }
  }
  function mapView(){return snapshot?.map||BASE.mapView();}
  function getState(){
    if(!snapshot)return BASE.getState();
    const armies=Object.fromEntries((snapshot.armies||[]).map(a=>[a.id,a]));
    return {resources:snapshot.resources,population:snapshot.player.population,populationCap:snapshot.player.populationCap,
      relations:snapshot.relations,territories:snapshot.map,armies,battles:{},events:snapshot.events,portals:snapshot.portals,
      season:snapshot.season,tick:snapshot.tick,day:snapshot.day,hour:snapshot.hour};
  }
  function getNeighbors(id){const t=mapView().find(x=>x.id===Number(id));if(!t)return [];return mapView().filter(x=>Math.abs(x.col-t.col)+Math.abs(x.row-t.row)===1);}
  function getArmy(id){return (snapshot?.armies||[]).find(a=>a.id===id)||null;}
  function getPlayerArmies(){return snapshot?.armies||BASE.getPlayerArmies();}
  function getVisibleArmy(id){
    const t=mapView().find(x=>x.id===Number(id));if(!t)return null;
    if(t.owner==='you')return (snapshot?.armies||[]).find(a=>a.territoryId===t.id)||null;
    if(t.army===0)return {hidden:true,estimate:'Unknown'};
    return {hidden:false,estimate:t.army,units:{},morale:null,supplies:null};
  }
  function getIncome(){return snapshot?.income||BASE.getIncome();}
  function getFoodUpkeep(){return snapshot?.foodUpkeep??BASE.getFoodUpkeep();}
  function getPortal(){return (snapshot?.portals||[]).find(p=>p.status==='open')||null;}
  function seasonProgress(){
    if(!snapshot)return BASE.seasonProgress();
    const elapsed=(snapshot.day-1)*24+snapshot.hour,remaining=Math.max(0,snapshot.season.lengthHours-elapsed);
    return {season:snapshot.season.number,elapsedHours:elapsed,remainingHours:remaining,remainingDays:Math.max(0,Math.ceil(remaining/24))};
  }
  function formatTime(){return snapshot?'SEASON '+snapshot.season.number+' · DAY '+snapshot.day+' · '+String(snapshot.hour).padStart(2,'0')+':00':BASE.formatTime();}
  const API={
    get RESOURCE_INFO(){return snapshot?.resourceInfo||BASE.RESOURCE_INFO;},
    get BUILDINGS(){return snapshot?.buildings||BASE.BUILDINGS;},
    get UNIT_TYPES(){return snapshot?.unitTypes||BASE.UNIT_TYPES;},
    get state(){return getState();},mapView,getState,getNeighbors,getArmy,getPlayerArmies,getIncome,getFoodUpkeep,getVisibleArmy,getPortal,formatTime,seasonProgress,
    currentSeasonNumber:BASE.currentSeasonNumber,syncToClock:sync,
    claim:id=>action('claim',{id}),queueBuilding:(id,building)=>action('queueBuilding',{id,building}),
    recruit:(id,unit,count)=>action('recruit',{id,unit,count}),moveArmy:(armyId,targetId)=>action('moveArmy',{armyId,targetId}),
    attack:id=>action('attack',{id}),scout:id=>action('scout',{id}),improveRelation:(faction,amount)=>action('improveRelation',{faction,amount}),
    openPortal:()=>action('openPortal',{}),portalAttack:(portalId,index)=>action('portalAttack',{portalId,index}),
    closePortal:id=>action('closePortal',{portalId:id}),tick:async()=>sync(),save:()=>{}
  };
  window.AttritionSimulation=API;
  window.AttritionMultiplayerReady=(async function(){
    try{
      await createOrRestoreSession();
    }catch(err){
      console.warn('Attrition server unavailable:',err.message);online=false;window.AttritionOnline={online:false,error:err.message};
    }
    return {online,booted};
  })();
})();