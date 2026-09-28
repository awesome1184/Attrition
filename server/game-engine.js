'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAP = require('../map-generator.js').generate;
const CONFIG = require('../game-config.js');

const RESOURCE_KEYS = ['Food','Wood','Stone','Iron','Oil','Mana','Gold'];
const RESOURCE_INFO = {
  Food:{cap:10000,baseYield:8}, Wood:{cap:10000,baseYield:5}, Stone:{cap:8000,baseYield:3},
  Iron:{cap:5000,baseYield:2}, Oil:{cap:3000,baseYield:1}, Mana:{cap:1500,baseYield:1}, Gold:{cap:5000,baseYield:1}
};
const BUILDINGS = {
  Farm:{cost:{Wood:50,Stone:15},time:3,desc:'+5 Food/hour and +20 population capacity.'},
  LumberMill:{cost:{Wood:70,Stone:20},time:4,desc:'+5 Wood/hour.'},
  Quarry:{cost:{Wood:50,Stone:40},time:4,desc:'+3 Stone/hour.'},
  Mine:{cost:{Wood:80,Stone:50,Iron:20},time:5,desc:'+2 Iron/hour.'},
  OilWell:{cost:{Wood:100,Stone:60,Iron:30},time:6,desc:'+1 Oil/hour.'},
  ManaExtractor:{cost:{Wood:100,Stone:50,Mana:15},time:6,desc:'+1 Mana/hour.'},
  Market:{cost:{Wood:100,Stone:50,Gold:30},time:6,desc:'+1 Gold/hour and +10% trade efficiency.'},
  Barracks:{cost:{Wood:120,Stone:80,Iron:30},time:7,desc:'Raises recruitment capacity and army recovery.'},
  Workshop:{cost:{Wood:150,Stone:100,Iron:80},time:8,desc:'Improves advanced unit production.'},
  Fort:{cost:{Wood:80,Stone:160,Iron:25},time:8,desc:'+35% defense and slows attacks.'}
};
const UNIT_TYPES = {
  Militia:{cost:{Food:10,Gold:1},population:1,attack:1.0,defense:1.0,speed:1.0,upkeep:0.04,element:'none'},
  Riflemen:{cost:{Food:12,Iron:2,Gold:2},population:1,attack:1.7,defense:1.3,speed:1.0,upkeep:0.05,element:'gun'},
  AntiTank:{cost:{Food:16,Iron:5,Gold:3},population:1,attack:2.2,defense:1.1,speed:0.8,upkeep:0.07,element:'antitank'},
  FireMage:{cost:{Food:12,Mana:3,Gold:3},population:1,attack:2.0,defense:0.9,speed:0.9,upkeep:0.06,element:'fire'}
};
const COUNTERS = {
  fire:{gun:1.12,antitank:1.05},
  gun:{fire:0.92,antitank:1.10},
  antitank:{gun:0.96}
};

function clone(v){return JSON.parse(JSON.stringify(v));}
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function sumUnits(units){return Object.values(units||{}).reduce((a,b)=>a+Number(b||0),0);}
function canAfford(resources,cost){return Object.entries(cost).every(([k,v])=>(resources[k]||0)>=v);}
function spend(resources,cost){Object.entries(cost).forEach(([k,v])=>{resources[k]-=v;});}
function unitPower(units,sideUnits){
  let total=0;
  Object.entries(units||{}).forEach(([name,count])=>{
    const type=UNIT_TYPES[name]; if(!type)return;
    let multiplier=1;
    Object.entries(sideUnits||{}).forEach(([enemyName])=>{
      const enemy=UNIT_TYPES[enemyName]; if(!enemy||!COUNTERS[type.element])return;
      multiplier*=COUNTERS[type.element][enemy.element]||1;
    });
    total+=count*type.attack*multiplier;
  });
  return total;
}
function defensePower(units){
  return Object.entries(units||{}).reduce((total,[name,count])=>{
    const type=UNIT_TYPES[name]; return total+(type?count*type.defense:0);
  },0);
}
function defaultBuildings(t){
  const b={Farm:0,LumberMill:0,Quarry:0,Mine:0,OilWell:0,ManaExtractor:0,Market:0,Barracks:0,Workshop:0,Fort:0};
  if(t.resource==='Food')b.Farm=1;
  if(t.resource==='Wood')b.LumberMill=1;
  if(t.resource==='Stone')b.Quarry=1;
  if(t.resource==='Iron')b.Mine=1;
  if(t.resource==='Oil')b.OilWell=1;
  if(t.resource==='Mana')b.ManaExtractor=1;
  if(t.resource==='Gold')b.Market=1;
  if(t.settlement==='fort'||t.settlement==='capital')b.Fort=1;
  if(t.settlement==='town'||t.settlement==='capital')b.Barracks=1;
  if(t.settlement==='capital'){b.Market+=1;b.Workshop=1;}
  return b;
}
function normalizeTerritory(t){
  return {id:t.id,index:t.index,name:t.name,owner:t.owner==='you'?'__UNASSIGNED__':t.owner,resource:t.resource,
    col:t.col,row:t.row,settlement:t.settlement,terrain:t.terrain,population:t.population,
    populationCap:120+(t.settlement==='town'?120:0)+(t.settlement==='capital'?220:0),
    buildings:defaultBuildings(t),construction:[],status:'stable',armyId:null};
}
function initialWorld(map){
  const territories=map.territories.map(normalizeTerritory);
  const armies={};
  const starts=(map.startingPositions?.armies||[]).filter(p=>p.owner!=='you');
  const unitSets=[
    {Militia:1000,Riflemen:900,AntiTank:500,FireMage:200},
    {Militia:900,Riflemen:700,AntiTank:350,FireMage:150},
    {Militia:800,Riflemen:250,FireMage:150}
  ];
  starts.forEach((plan,n)=>{
    const t=territories.find(x=>x.id===Number(plan.territoryId)); if(!t||t.armyId)return;
    const id='army-ai-'+n;
    armies[id]={id,owner:plan.owner,territoryId:t.id,units:unitSets[n]||{Militia:50},order:null,supplies:100,wounded:0,morale:100,battleId:null};
    t.armyId=id;
  });
  return {version:1,mapSeed:map.seed,tick:map.seasonElapsedHours||0,lastWallClockMs:Date.now(),
    seasonHour:map.seasonElapsedHours||0,day:1+Math.floor((map.seasonElapsedHours||0)/24),hour:(map.seasonElapsedHours||0)%24,
    territories,armies,battles:{},reports:{},portals:{},players:{},sessions:{},
    events:[{tick:map.seasonElapsedHours||0,text:'The season has started.',playerId:null}],
    revision:0,season:{number:map.seasonNumber,start:map.seasonStart,lengthHours:CONFIG.season.lengthHours,tickLengthHours:1}};
}

class GameEngine{
  constructor(dataDir){
    this.dataDir=dataDir;
    fs.mkdirSync(dataDir,{recursive:true});
    this.path=path.join(dataDir,'world.json');
    this.map=this.generateMap();
    this.state=this.load();
    this.ensureSeason();
  }
  generateMap(){
    const start=Date.parse(CONFIG.season.start);
    const elapsed=Math.max(0,Math.floor((Date.now()-start)/3600000));
    const seasonNumber=Math.floor(elapsed/CONFIG.season.lengthHours)+1;
    return MAP({seed:CONFIG.season.worldSeedPrefix+seasonNumber,seasonNumber,cols:8,rows:6,tileSize:180,width:2200,height:2200});
  }
  load(){
    if(!fs.existsSync(this.path))return initialWorld(this.map);
    try{
      const parsed=JSON.parse(fs.readFileSync(this.path,'utf8'));
      if(parsed.mapSeed!==this.map.seed||parsed.season?.number!==this.map.seasonNumber||parsed.version!==1)return initialWorld(this.map);
      return parsed;
    }catch(_){return initialWorld(this.map);}
  }
  save(){
    this.state.revision++;
    const tmp=this.path+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(this.state));
    fs.renameSync(tmp,this.path);
  }
  ensureSeason(){
    if(this.state.season.number!==this.map.seasonNumber){
      this.map=this.generateMap();
      this.state=initialWorld(this.map);
      this.save();
    }
  }
  territory(id){return this.state.territories.find(t=>t.id===Number(id))||null;}
  neighbors(id){
    const t=this.territory(id); if(!t)return [];
    return this.state.territories.filter(x=>Math.abs(x.col-t.col)+Math.abs(x.row-t.row)===1);
  }
  player(pid){return this.state.players[pid]||null;}
  playerTerritories(pid){return this.state.territories.filter(t=>t.owner===pid);}
  armyAt(id){const t=this.territory(id);return t?.armyId?this.state.armies[t.armyId]||null:null;}
  ownedArmyAt(pid,id){const a=this.armyAt(id);return a&&a.owner===pid?a:null;}
  playerArmies(pid){return Object.values(this.state.armies).filter(a=>a.owner===pid);}
  armyDisplayPower(a){
    if(!a)return 0;
    return Math.round(unitPower(a.units)*(0.65+a.morale/300)*(0.65+a.supplies/285));
  }
  visibleArmy(pid,id){
    const t=this.territory(id);if(!t)return null;
    const a=this.armyAt(id);
    if(!a)return null;
    if(a.owner===pid)return a;
    const reports=this.state.reports[pid]||{};
    const r=reports[t.id];
    if(!r||r.readyTick>this.state.tick)return {hidden:true,estimate:'Unknown'};
    return {hidden:false,estimate:this.armyDisplayPower(a),units:clone(a.units),morale:a.morale,supplies:a.supplies};
  }
  resourcePerHour(pid){
    const out=Object.fromEntries(RESOURCE_KEYS.map(k=>[k,0]));
    this.playerTerritories(pid).forEach(t=>{
      const key=t.resource==='Food'?'Farm':t.resource==='Wood'?'LumberMill':t.resource==='Stone'?'Quarry':
        t.resource==='Iron'?'Mine':t.resource==='Oil'?'OilWell':t.resource==='Mana'?'ManaExtractor':'Market';
      const count=t.buildings[key]||0;
      out[t.resource]+=RESOURCE_INFO[t.resource].baseYield+count*(t.resource==='Gold'?1:t.resource==='Stone'?3:5);
      if(t.resource==='Food')out.Food+=count*2;
      if(t.buildings.Market)out.Gold+=t.buildings.Market;
    });
    return out;
  }
  militaryUpkeep(pid){return this.playerArmies(pid).reduce((s,a)=>s+sumUnits(a.units)*0.02,0);}
  foodUpkeep(pid){const p=this.player(pid);return (p?.population||0)*0.01+this.militaryUpkeep(pid);}
  addEvent(text,playerId=null){
    this.state.events.unshift({tick:this.state.tick,text,playerId});
    this.state.events=this.state.events.slice(0,100);
  }
  spawnForPlayer(pid){
    const existing=this.playerTerritories(pid);
    if(existing.length)return existing.find(t=>t.settlement==='capital')||existing[0];
    const players=Object.keys(this.state.players).filter(id=>id!==pid);
    const occupiedPlayerIds=new Set(players.flatMap(id=>this.playerTerritories(id).map(t=>t.id)));
    const neutral=this.state.territories.filter(t=>t.owner==='__UNASSIGNED__'&&!occupiedPlayerIds.has(t.id)&&!t.armyId&&t.settlement!=='ruins');
    if(!neutral.length)throw new Error('The world has no available starting territory.');
    const existingPlayerTerritories=players.flatMap(id=>this.playerTerritories(id));
    let target;
    if(!players.length){
      target=this.territory(this.map.startingPositions.capitalId)||neutral[0];
    }else{
      target=neutral.slice().sort((a,b)=>{
        const da=Math.min(...existingPlayerTerritories.map(t=>Math.abs(t.col-a.col)+Math.abs(t.row-a.row)));
        const db=Math.min(...existingPlayerTerritories.map(t=>Math.abs(t.col-b.col)+Math.abs(t.row-b.row)));
        return db-da;
      })[0];
    }
    target.owner=pid;
    target.settlement='capital';
    target.population=420;
    target.populationCap=340;
    target.buildings=defaultBuildings(target);
    target.buildings.Fort=1;target.buildings.Barracks=1;target.buildings.Market=Math.max(1,target.buildings.Market);target.buildings.Workshop=1;
    const plans=[
      {units:{Militia:160,Riflemen:80,FireMage:20},settlementTarget:target.id},
      {units:{Militia:50,Riflemen:20},settlementTarget:null}
    ];
    for(const plan of plans){
      let at=target;
      if(plan.settlementTarget===null){
        at=this.neighbors(target.id).find(t=>t.owner==='__UNASSIGNED__'&&!t.armyId)||target;
      }
      if(at.armyId)continue;
      const id='army-'+pid+'-'+crypto.randomBytes(4).toString('hex');
      this.state.armies[id]={id,owner:pid,territoryId:at.id,units:clone(plan.units),order:null,supplies:100,wounded:0,morale:100,battleId:null};
      at.armyId=id;
    }
    return target;
  }
  addPlayer(pid,name){
    if(this.state.players[pid])return this.state.players[pid];
    const capital=this.spawnForPlayer(pid);
    const colors=['#3f88b0','#c99445','#7b9dce','#8b6ca8','#65a37b','#bd6e6e'];
    const playerCount=Object.keys(this.state.players).length+1;
    this.state.players[pid]={id:pid,name:name||('Player '+playerCount),color:colors[(playerCount-1)%colors.length],
      resources:{Food:5000,Wood:3500,Stone:2200,Iron:900,Oil:200,Mana:80,Gold:800},
      population:420,populationCap:500,relations:{north:-45,south:-20,neutral:0},capitalId:capital.id,
      createdAt:new Date().toISOString()};
    this.state.reports[pid]={};
    this.state.portals[pid]=[];
    this.addEvent(this.state.players[pid].name+' entered the season.',pid);
    this.save();
    return this.state.players[pid];
  }
  createSession(existingToken,name){
    if(existingToken&&this.state.sessions[existingToken]&&this.state.players[this.state.sessions[existingToken]])return {token:existingToken,player:this.state.players[this.state.sessions[existingToken]]};
    const token=crypto.randomBytes(24).toString('hex');
    const pid='player-'+crypto.randomUUID();
    this.state.sessions[token]=pid;
    const player=this.addPlayer(pid,name);
    this.save();
    return {token,player};
  }
  authenticate(token){const pid=this.state.sessions[token];return pid&&this.state.players[pid]?pid:null;}
  claim(pid,id){
    const t=this.territory(id);
    if(!t||t.owner!=='__UNASSIGNED__')return {ok:false,message:'This territory is not neutral.'};
    if(!this.neighbors(t.id).some(n=>n.owner===pid))return {ok:false,message:'Claim from a neighboring territory.'};
    t.owner=pid;t.status='stable';t.population=40;t.populationCap=Math.max(t.populationCap,100);
    this.addEvent(this.player(pid).name+' claimed '+t.name+'.',pid);this.save();return {ok:true,message:t.name+' claimed.'};
  }
  queueBuilding(pid,id,building){
    const t=this.territory(id),def=BUILDINGS[building],p=this.player(pid);
    if(!t||t.owner!==pid)return {ok:false,message:'You do not control this territory.'};
    if(!def)return {ok:false,message:'Building unavailable.'};
    if(t.construction.length>=2)return {ok:false,message:'Construction queue is full.'};
    if(!canAfford(p.resources,def.cost))return {ok:false,message:'Not enough resources.'};
    spend(p.resources,def.cost);t.construction.push({building,remaining:def.time});
    this.addEvent(building+' construction started in '+t.name+'.',pid);this.save();return {ok:true,message:building+' started.'};
  }
  recruit(pid,id,unitName,count){
    const t=this.territory(id),type=UNIT_TYPES[unitName],n=Math.max(1,Math.floor(Number(count||0))),army=this.ownedArmyAt(pid,id),p=this.player(pid);
    if(!t||!army||!type)return {ok:false,message:'No recruitable army here.'};
    const free=Math.max(0,t.population-10);
    if(free<n)return {ok:false,message:'Not enough available population.'};
    const cost=Object.fromEntries(Object.entries(type.cost).map(([k,v])=>[k,v*n]));
    if(!canAfford(p.resources,cost))return {ok:false,message:'Not enough resources.'};
    spend(p.resources,cost);army.units[unitName]=(army.units[unitName]||0)+n;t.population-=n;
    this.addEvent(n+' '+unitName+' recruited in '+t.name+'.',pid);this.save();return {ok:true,message:n+' '+unitName+' recruited.'};
  }
  moveArmy(pid,armyId,targetId){
    const army=this.state.armies[armyId],target=this.territory(targetId),origin=army&&this.territory(army.territoryId);
    if(!army||army.owner!==pid||!target||!origin)return {ok:false,message:'Invalid army order.'};
    if(!this.neighbors(origin.id).some(t=>t.id===target.id))return {ok:false,message:'Armies move one territory at a time.'};
    if(target.owner!==pid&&target.owner!=='__UNASSIGNED__')return {ok:false,message:'Use Attack against enemy territory.'};
    army.order={type:'move',targetId:target.id,remaining:target.terrain==='hill'?2:1};
    this.addEvent('Army ordered to '+target.name+'.',pid);this.save();return {ok:true,message:'Army moving to '+target.name+'.'};
  }
  chooseAttackArmy(pid,targetId){
    const target=this.territory(targetId);if(!target||target.owner===pid)return null;
    return this.neighbors(targetId).filter(t=>t.owner===pid).map(t=>this.ownedArmyAt(pid,t.id)).filter(Boolean)
      .sort((a,b)=>this.armyDisplayPower(b)-this.armyDisplayPower(a))[0]||null;
  }
  attack(pid,id){
    const target=this.territory(id),army=this.chooseAttackArmy(pid,id);
    if(!target||!army)return {ok:false,message:'No friendly army can attack this territory.'};
    const origin=this.territory(army.territoryId);
    army.order={type:'attack',targetId:target.id,remaining:target.terrain==='hill'?3:2};
    this.addEvent('Army from '+origin.name+' is moving toward '+target.name+'.',pid);this.save();return {ok:true,message:'Attack ordered.'};
  }
  scout(pid,id){
    const t=this.territory(id),p=this.player(pid);if(!t||t.owner===pid)return {ok:false,message:'Nothing to scout.'};
    const capital=this.territory(p.capitalId)||t;
    const distance=Math.max(1,Math.abs(t.col-capital.col)+Math.abs(t.row-capital.row));
    const delay=clamp(Math.ceil(distance/2),1,4);
    this.state.reports[pid][t.id]={requestedTick:this.state.tick,readyTick:this.state.tick+delay};
    this.addEvent('Scout report for '+t.name+' will arrive in '+delay+' tick'+(delay===1?'':'s')+'.',pid);
    this.save();return {ok:true,message:'Scout report queued.'};
  }
  improveRelation(pid,faction,amount){
    const p=this.player(pid),n=Number(amount);
    if(!(faction in p.relations))return {ok:false,message:'Unknown faction.'};
    const cost=Math.max(5,Math.abs(n)*4);
    if(n>0&&p.resources.Gold<cost)return {ok:false,message:'Not enough Gold.'};
    if(n>0)p.resources.Gold-=cost;
    p.relations[faction]=clamp(p.relations[faction]+n,-100,100);
    this.addEvent('Relations with '+faction+' changed to '+p.relations[faction]+'.',pid);
    this.save();return {ok:true,message:'Relations changed.'};
  }
  openPortal(pid){
    const p=this.player(pid),list=this.state.portals[pid]||[],id='portal-'+pid+'-'+(list.length+1);
    const territories=[1,2,3,4].map((n,i)=>({id:id+'-t'+n,index:i,name:'Portal Territory '+n,owner:i===0?'portal':'ai',
      resource:['Food','Iron','Mana','Gold'][i],terrain:['plain','forest','hill','field'][i],
      army:{units:{Militia:180+i*40,Riflemen:80+i*20,FireMage:i===2?70:0},morale:100,supplies:100}}));
    const portal={id,status:'open',createdTick:this.state.tick,territories,defeated:0,reward:{Gold:350,Mana:40,Oil:60}};
    list.unshift(portal);this.state.portals[pid]=list.slice(0,5);this.addEvent('A PvE portal opened.',pid);this.save();return {ok:true,message:'PvE portal opened.'};
  }
  portalAttack(pid,portalId,index){
    const portal=(this.state.portals[pid]||[]).find(p=>p.id===portalId&&p.status==='open'),node=portal&&portal.territories[index];
    const army=this.playerArmies(pid).sort((a,b)=>this.armyDisplayPower(b)-this.armyDisplayPower(a))[0],p=this.player(pid);
    if(!portal||!node||!army)return {ok:false,message:'No available army for this portal.'};
    if(node.owner===pid||node.owner==='you')return {ok:false,message:'That territory is already cleared.'};
    const atkPower=Math.max(1,this.armyDisplayPower(army));
    const defPower=unitPower(node.army.units,army.units)*(0.8+node.army.morale/250);
    const ratio=atkPower/Math.max(1,defPower);
    const losses=Math.max(1,Math.floor(sumUnits(army.units)*clamp(0.025+(1/Math.max(1,ratio))*0.02,0.02,0.09)));
    this.removeUnits(army,losses);
    if(ratio>=1){
      node.owner=pid;node.army=null;portal.defeated++;
      this.addEvent('Your army cleared portal territory '+(index+1)+'.',pid);
      if(portal.defeated>=portal.territories.length-1){
        Object.entries(portal.reward).forEach(([k,v])=>p.resources[k]=clamp((p.resources[k]||0)+v,0,RESOURCE_INFO[k].cap));
        portal.status='cleared';portal.reward={};this.addEvent('Portal cleared. Rewards collected.',pid);
      }
      this.save();return {ok:true,message:'Portal territory cleared.'};
    }
    node.army.morale=clamp(node.army.morale-12,0,100);this.addEvent('Your portal attack was repelled.',pid);this.save();
    return {ok:true,message:'Portal attack repelled.'};
  }
  removeUnits(army,amount){
    let remaining=amount;
    const names=Object.keys(army.units).sort((a,b)=>UNIT_TYPES[a].attack-UNIT_TYPES[b].attack);
    for(const name of names){if(remaining<=0)break;const take=Math.min(army.units[name]||0,remaining);army.units[name]-=take;army.wounded+=take;remaining-=take;}
  }
  closePortal(pid,id){
    const p=this.player(pid),portal=(this.state.portals[pid]||[]).find(x=>x.id===id);if(!portal)return {ok:false,message:'Portal not found.'};
    portal.status='closed';this.addEvent('Portal closed.',pid);this.save();return {ok:true,message:'Portal closed.'};
  }
  tickConstruction(){
    this.state.territories.forEach(t=>t.construction=t.construction.filter(job=>{
      job.remaining--;if(job.remaining>0)return true;
      t.buildings[job.building]=(t.buildings[job.building]||0)+1;
      if(job.building==='Farm')t.populationCap+=20;if(job.building==='Fort')t.status='fortified';
      this.addEvent(job.building+' completed in '+t.name+'.',t.owner.startsWith?.('player-')?t.owner:null);return false;
    }));
  }
  tickProduction(){
    Object.values(this.state.players).forEach(p=>{
      const income=this.resourcePerHour(p.id);
      RESOURCE_KEYS.forEach(k=>{p.resources[k]=clamp((p.resources[k]||0)+income[k],0,RESOURCE_INFO[k].cap);});
      const upkeep=this.foodUpkeep(p.id);
      if(p.resources.Food>=upkeep){p.resources.Food-=upkeep;p.population+=Math.min(0.5,p.population*0.0008);}
      else{
        p.population=Math.max(20,p.population-Math.max(1,upkeep/4));
        this.playerArmies(p.id).forEach(a=>a.morale=Math.max(0,a.morale-2));
        this.addEvent('Food shortage reduced population and morale.',p.id);
      }
      p.populationCap=this.playerTerritories(p.id).reduce((n,t)=>n+t.populationCap,0);
      if(p.population>p.populationCap)p.population=p.populationCap;
    });
  }
  applyArmyMovement(army){
    if(!army.order||army.battleId)return;
    if(army.order.remaining>0){army.order.remaining--;return;}
    const target=this.territory(army.order.targetId),origin=this.territory(army.territoryId);if(!target||!origin){army.order=null;return;}
    if(army.order.type==='move'){
      if(target.owner==='__UNASSIGNED__'||target.owner===army.owner){
        if(target.armyId&&target.armyId!==army.id){army.order=null;return;}
        origin.armyId=null;target.armyId=army.id;army.territoryId=target.id;army.order=null;
        if(army.owner.startsWith('player-'))this.addEvent('Army arrived at '+target.name+'.',army.owner);
      }else army.order=null;
      return;
    }
    if(army.order.type==='attack'){
      const defender=this.armyAt(target.id);
      if(!defender&&target.owner!==army.owner){
        origin.armyId=null;target.armyId=army.id;army.territoryId=target.id;target.owner=army.owner;army.order=null;
        this.addEvent((army.owner.startsWith('player-')?this.player(army.owner).name:'An army')+' captured '+target.name+'.',army.owner.startsWith('player-')?army.owner:null);return;
      }
      if(defender&&defender.id!==army.id){
        const battleId='battle-'+this.state.tick+'-'+target.id+'-'+crypto.randomBytes(2).toString('hex');
        this.state.battles[battleId]={id:battleId,attackerId:army.id,defenderId:defender.id,territoryId:target.id,tickStarted:this.state.tick};
        army.battleId=battleId;defender.battleId=battleId;army.order=null;defender.order=null;target.status='battle';
        this.addEvent('Battle started in '+target.name+'.',army.owner.startsWith('player-')?army.owner:(defender.owner.startsWith('player-')?defender.owner:null));
      }
    }
  }
  applyBattle(battle){
    const atk=this.state.armies[battle.attackerId],def=this.state.armies[battle.defenderId],t=this.territory(battle.territoryId);
    if(!atk||!def||!t){delete this.state.battles[battle.id];return;}
    const atkPower=Math.max(1,unitPower(atk.units,def.units))*(0.65+atk.morale/300)*(0.65+atk.supplies/285);
    const defPower=Math.max(1,defensePower(def.units))*(0.65+def.morale/300)*(0.65+def.supplies/285);
    let fort=t.buildings.Fort?1.35:1;if(t.terrain==='hill')fort*=1.12;
    const ratio=atkPower/(defPower*fort);
    const atkLossRate=clamp(0.02+(1/Math.max(1,ratio))*0.025,0.02,0.10);
    const defLossRate=clamp(0.02+ratio*0.03,0.02,0.10);
    this.removeUnits(atk,Math.max(1,Math.floor(sumUnits(atk.units)*atkLossRate)));
    this.removeUnits(def,Math.max(1,Math.floor(sumUnits(def.units)*defLossRate)));
    atk.supplies=Math.max(0,atk.supplies-4);def.supplies=Math.max(0,def.supplies-3);
    atk.morale=clamp(atk.morale+(ratio>1?1:-2),0,100);def.morale=clamp(def.morale+(ratio<1?1:-2),0,100);
    const elapsed=this.state.tick-battle.tickStarted;
    if(sumUnits(def.units)<=0||(ratio>1.35&&elapsed>=3))this.finishBattle(battle,'attacker');
    else if(sumUnits(atk.units)<=0||(ratio<0.72&&elapsed>=3))this.finishBattle(battle,'defender');
    else if(elapsed>=10)this.finishBattle(battle,ratio>=1?'attacker':'defender');
  }
  finishBattle(battle,winner){
    const atk=this.state.armies[battle.attackerId],def=this.state.armies[battle.defenderId],t=this.territory(battle.territoryId);if(!atk||!def||!t)return;
    const actor=atk.owner.startsWith('player-')?atk.owner:(def.owner.startsWith('player-')?def.owner:null);
    if(winner==='attacker'){
      if(t.armyId===def.id)t.armyId=null;
      if(def.owner.startsWith('player-')&&def.owner!==atk.owner)this.addEvent('Your territory at '+t.name+' was lost.',def.owner);
      t.owner=atk.owner;atk.territoryId=t.id;t.armyId=atk.id;atk.battleId=null;def.battleId=null;def.order=null;t.status='occupied';
      this.addEvent('Battle ended. '+t.name+' changed hands.',actor);
    }else{
      const fallback=this.neighbors(t.id).find(n=>n.owner===atk.owner&&!n.armyId);
      if(fallback&&sumUnits(atk.units)>0){atk.territoryId=fallback.id;fallback.armyId=atk.id;}
      atk.battleId=null;def.battleId=null;this.addEvent('Attack on '+t.name+' failed.',actor);
    }
    delete this.state.battles[battle.id];
    if(sumUnits(atk.units)<=0)delete this.state.armies[atk.id];
    if(sumUnits(def.units)<=0)delete this.state.armies[def.id];
  }
  tickReports(){
    Object.entries(this.state.reports).forEach(([pid,reports])=>Object.entries(reports).forEach(([id,r)=>{
      if(r.readyTick===this.state.tick)this.addEvent('Scout report for '+(this.territory(id)?.name||'territory')+' arrived.',pid);
    })));
  }
  tick(){
    this.state.tick++;this.state.seasonHour=(this.state.seasonHour||0)+1;this.state.hour++;
    if(this.state.hour>=24){this.state.hour=0;this.state.day++;}
    this.tickConstruction();this.tickProduction();
    Object.values(this.state.armies).forEach(a=>this.applyArmyMovement(a));
    Object.values(this.state.battles).forEach(b=>this.applyBattle(b));this.tickReports();
    Object.values(this.state.armies).filter(a=>a.owner.startsWith('player-')).forEach(a=>{
      if(a.supplies<25)a.morale=Math.max(0,a.morale-1);else a.morale=Math.min(100,a.morale+0.2);
      a.supplies=Math.max(0,a.supplies-0.4);
    });
  }
  syncToClock(now=Date.now()){
    if(this.currentSeasonNumber(now)!==this.state.season.number)return {seasonChanged:true,processed:0};
    const last=Number(this.state.lastWallClockMs||now),hours=Math.floor(Math.max(0,now-last)/3600000);
    if(hours<=0)return {seasonChanged:false,processed:0};
    const remaining=Math.max(0,CONFIG.season.lengthHours-(this.state.seasonHour||0)),max=Math.min(hours,remaining);
    for(let i=0;i<max;i++)this.tick();
    this.state.lastWallClockMs=last+max*3600000;
    this.save();return {seasonChanged:false,processed:max};
  }
  currentSeasonNumber(now=Date.now()){
    const start=Date.parse(CONFIG.season.start);
    return Math.floor(Math.max(0,now-start)/(CONFIG.season.lengthHours*3600000))+1;
  }
  snapshot(pid){
    const p=this.player(pid);if(!p)throw new Error('Unknown player.');
    const reports=this.state.reports[pid]||{};
    const map=this.state.territories.map(t=>{
      const a=this.armyAt(t.id);
      const visible=this.visibleArmy(pid,t.id);
      return {id:t.id,index:t.index,name:t.name,owner:t.owner===pid?'you':t.owner==='__UNASSIGNED__'?'neutral':(t.owner.startsWith('player-')?'player':t.owner),
        resource:t.resource,col:t.col,row:t.row,settlement:t.settlement,terrain:t.terrain,population:Math.round(t.population),
        buildings:clone(t.buildings),construction:clone(t.construction),
        army:visible&&!visible.hidden?sumUnits(visible.units||a?.units):0};
    });
    const armies=this.playerArmies(pid).map(clone);
    const events=this.state.events.filter(e=>!e.playerId||e.playerId===pid).slice(0,30);
    return {version:1,revision:this.state.revision,serverTime:Date.now(),mapSeed:this.state.mapSeed,season:this.state.season,tick:this.state.tick,day:this.state.day,hour:this.state.hour,
      player:clone(p),resources:clone(p.resources),resourceInfo:RESOURCE_INFO,buildings:BUILDINGS,unitTypes:UNIT_TYPES,
      map,armies,relations:clone(p.relations),events,portals:clone(this.state.portals[pid]||[])};
  }
  action(pid,action,args={}){
    this.syncToClock();
    switch(action){
      case 'claim':return this.claim(pid,args.id);
      case 'queueBuilding':return this.queueBuilding(pid,args.id,args.building);
      case 'recruit':return this.recruit(pid,args.id,args.unit,args.count);
      case 'moveArmy':return this.moveArmy(pid,args.armyId,args.targetId);
      case 'attack':return this.attack(pid,args.id);
      case 'scout':return this.scout(pid,args.id);
      case 'improveRelation':return this.improveRelation(pid,args.faction,args.amount);
      case 'openPortal':return this.openPortal(pid);
      case 'portalAttack':return this.portalAttack(pid,args.portalId,args.index);
      case 'closePortal':return this.closePortal(pid,args.portalId);
      default:return {ok:false,message:'Unknown action.'};
    }
  }
}
module.exports={GameEngine,RESOURCE_INFO,BUILDINGS,UNIT_TYPES};
