/* Attrition simulation layer. Rendering code should only read from this state. */
(function () {
  'use strict';

  const MAP = window.AttritionMapData;
  const STORAGE_KEY = 'attrition-state-v3';

  const RESOURCE_KEYS = ['Food', 'Wood', 'Stone', 'Iron', 'Oil', 'Mana', 'Gold'];

  const RESOURCE_INFO = {
    Food:  { cap: 10000, baseYield: 8, upkeep: 0 },
    Wood:  { cap: 10000, baseYield: 5, upkeep: 0 },
    Stone: { cap: 8000,  baseYield: 3, upkeep: 0 },
    Iron:  { cap: 5000,  baseYield: 2, upkeep: 0 },
    Oil:   { cap: 3000,  baseYield: 1, upkeep: 0 },
    Mana:  { cap: 1500,  baseYield: 1, upkeep: 0 },
    Gold:  { cap: 5000,  baseYield: 1, upkeep: 0 }
  };

  const BUILDINGS = {
    Farm: {
      cost: { Wood: 50, Stone: 15 },
      time: 3,
      desc: '+5 Food/hour and +20 population capacity.'
    },
    LumberMill: {
      cost: { Wood: 70, Stone: 20 },
      time: 4,
      desc: '+5 Wood/hour.'
    },
    Quarry: {
      cost: { Wood: 50, Stone: 40 },
      time: 4,
      desc: '+3 Stone/hour.'
    },
    Mine: {
      cost: { Wood: 80, Stone: 50, Iron: 20 },
      time: 5,
      desc: '+2 Iron/hour.'
    },
    OilWell: {
      cost: { Wood: 100, Stone: 60, Iron: 30 },
      time: 6,
      desc: '+1 Oil/hour.'
    },
    ManaExtractor: {
      cost: { Wood: 100, Stone: 50, Mana: 15 },
      time: 6,
      desc: '+1 Mana/hour.'
    },
    Market: {
      cost: { Wood: 100, Stone: 50, Gold: 30 },
      time: 6,
      desc: '+1 Gold/hour and +10% trade efficiency.'
    },
    Barracks: {
      cost: { Wood: 120, Stone: 80, Iron: 30 },
      time: 7,
      desc: 'Raises recruitment capacity and army recovery.'
    },
    Workshop: {
      cost: { Wood: 150, Stone: 100, Iron: 80 },
      time: 8,
      desc: 'Improves advanced unit production.'
    },
    Fort: {
      cost: { Wood: 80, Stone: 160, Iron: 25 },
      time: 8,
      desc: '+35% defense and slows attacks.'
    }
  };

  const UNIT_TYPES = {
    Militia: { cost: { Food: 10, Gold: 1 }, population: 1, attack: 1.0, defense: 1.0, speed: 1.0, upkeep: 0.04, element: 'none' },
    Riflemen: { cost: { Food: 12, Iron: 2, Gold: 2 }, population: 1, attack: 1.7, defense: 1.3, speed: 1.0, upkeep: 0.05, element: 'gun' },
    AntiTank: { cost: { Food: 16, Iron: 5, Gold: 3 }, population: 1, attack: 2.2, defense: 1.1, speed: 0.8, upkeep: 0.07, element: 'antitank' },
    FireMage: { cost: { Food: 12, Mana: 3, Gold: 3 }, population: 1, attack: 2.0, defense: 0.9, speed: 0.9, upkeep: 0.06, element: 'fire' }
  };

  const COUNTERS = {
    fire:  { gun: 1.12, antitank: 1.05 },
    gun:   { fire: 0.92, antitank: 1.10 },
    antitank: { gun: 0.96 }
  };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function sumUnits(units) {
    return Object.values(units || {}).reduce((a, b) => a + Number(b || 0), 0);
  }

  function mergeCost(a, b) {
    const out = clone(a || {});
    Object.entries(b || {}).forEach(([k, v]) => out[k] = (out[k] || 0) + v);
    return out;
  }

  function canAfford(resources, cost) {
    return Object.entries(cost).every(([k, v]) => (resources[k] || 0) >= v);
  }

  function spend(resources, cost) {
    Object.entries(cost).forEach(([k, v]) => resources[k] -= v);
  }

  function unitPower(units, sideUnits) {
    let total = 0;
    Object.entries(units || {}).forEach(([name, count]) => {
      const type = UNIT_TYPES[name];
      if (!type) return;
      let multiplier = 1;
      Object.entries(sideUnits || {}).forEach(([enemyName]) => {
        const enemy = UNIT_TYPES[enemyName];
        if (!enemy || !COUNTERS[type.element]) return;
        multiplier *= COUNTERS[type.element][enemy.element] || 1;
      });
      total += count * type.attack * multiplier;
    });
    return total;
  }

  function defensePower(units) {
    return Object.entries(units || {}).reduce((total, [name, count]) => {
      const type = UNIT_TYPES[name];
      return total + (type ? count * type.defense : 0);
    }, 0);
  }

  function defaultBuildings(t) {
    const b = {
      Farm: 0,
      LumberMill: 0,
      Quarry: 0,
      Mine: 0,
      OilWell: 0,
      ManaExtractor: 0,
      Market: 0,
      Barracks: 0,
      Workshop: 0,
      Fort: 0
    };
    if (t.resource === 'Food') b.Farm = 1;
    if (t.resource === 'Wood') b.LumberMill = 1;
    if (t.resource === 'Stone') b.Quarry = 1;
    if (t.resource === 'Iron') b.Mine = 1;
    if (t.resource === 'Oil') b.OilWell = 1;
    if (t.resource === 'Mana') b.ManaExtractor = 1;
    if (t.resource === 'Gold') b.Market = 1;
    if (t.settlement === 'fort' || t.settlement === 'capital') b.Fort = 1;
    if (t.settlement === 'town' || t.settlement === 'capital') b.Barracks = 1;
    if (t.settlement === 'capital') {
      b.Market += 1;
      b.Workshop = 1;
    }
    return b;
  }

  function normalizeTerritory(t) {
    return {
      id: t.id,
      index: t.index,
      name: t.name,
      owner: t.owner,
      resource: t.resource,
      col: t.col,
      row: t.row,
      settlement: t.settlement,
      terrain: t.terrain,
      population: t.population,
      populationCap: 120 + (t.settlement === 'town' ? 120 : 0) + (t.settlement === 'capital' ? 220 : 0),
      buildings: defaultBuildings(t),
      construction: [],
      status: 'stable',
      armyId: null
    };
  }

  function initialState() {
    const territories = MAP.territories.map(normalizeTerritory);
    const armies = {};
    const starterPlans = MAP.startingPositions?.armies || [
      { owner: 'you', territoryId: MAP.territories.find(t => t.owner === 'you')?.id, kind: 'field' },
      { owner: 'you', territoryId: MAP.territories.find(t => t.owner === 'you')?.id, kind: 'fort' },
      { owner: 'north', territoryId: MAP.territories.find(t => t.owner === 'north')?.id, kind: 'field' },
      { owner: 'south', territoryId: MAP.territories.find(t => t.owner === 'south')?.id, kind: 'field' },
      { owner: 'neutral', territoryId: MAP.territories.find(t => t.owner === 'neutral')?.id, kind: 'field' }
    ];
    const unitSets = [
      { Militia: 160, Riflemen: 80, FireMage: 20 },
      { Militia: 50, Riflemen: 20 },
      { Militia: 1000, Riflemen: 900, AntiTank: 500, FireMage: 200 },
      { Militia: 900, Riflemen: 700, AntiTank: 350, FireMage: 150 },
      { Militia: 800, Riflemen: 250, FireMage: 150 }
    ];
    starterPlans.forEach((plan, n) => {
      const t = territories.find(x => x.id === Number(plan.territoryId));
      if (!t) return;
      const armyId = 'army-' + n;
      armies[armyId] = {
        id: armyId,
        owner: plan.owner,
        territoryId: t.id,
        units: unitSets[n] || { Militia: 50 },
        order: null,
        supplies: 100,
        wounded: 0,
        morale: 100,
        battleId: null
      };
      t.armyId = armyId;
    });

    return {
      version: 3,
      mapSeed: MAP.seed,
      tick: MAP.seasonElapsedHours || 0,
      lastWallClockMs: Date.now(),
      seasonHour: MAP.seasonElapsedHours || 0,
      year: 1,
      day: 1 + Math.floor((MAP.seasonElapsedHours || 0) / 24),
      hour: (MAP.seasonElapsedHours || 0) % 24,
      resources: { Food: 5000, Wood: 3500, Stone: 2200, Iron: 900, Oil: 200, Mana: 80, Gold: 800 },
      population: 420,
      populationCap: 500,
      territories,
      armies,
      relations: {
        you: 100,
        north: -45,
        south: -20,
        neutral: 0
      },
      battles: {},
      reports: {},
      portals: [],
      events: [
        { tick: 0, text: 'The season has started.' },
        { tick: 0, text: 'Your capital is ready.' }
      ],
      season: { number: MAP.seasonNumber, start: MAP.seasonStart, lengthHours: window.AttritionGameConfig.season.lengthHours, tickLengthHours: 1 }
    };
  }

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return initialState();
      const state = JSON.parse(saved);
      if (!state || state.version !== 3 || state.mapSeed !== MAP.seed || state.season?.number !== MAP.seasonNumber || state.territories?.length !== MAP.territories.length) return initialState();
      return state;
    } catch (_) {
      return initialState();
    }
  }

  let state = load();
  if (!state || !state.territories || !state.armies) state = initialState();
  if (!Number.isFinite(state.lastWallClockMs)) state.lastWallClockMs = Date.now();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function territory(id) {
    return state.territories.find(t => t.id === Number(id)) || null;
  }

  function neighbors(id) {
    const t = territory(id);
    if (!t) return [];
    return state.territories.filter(x => Math.abs(x.col - t.col) + Math.abs(x.row - t.row) === 1);
  }

  function playerTerritories() {
    return state.territories.filter(t => t.owner === 'you');
  }

  function ownedArmyAt(id) {
    const t = territory(id);
    if (!t || !t.armyId) return null;
    const army = state.armies[t.armyId];
    return army && army.owner === 'you' ? army : null;
  }

  function armyAt(id) {
    const t = territory(id);
    return t && t.armyId ? state.armies[t.armyId] || null : null;
  }

  function armyDisplayPower(army) {
    if (!army) return 0;
    const total = unitPower(army.units);
    return Math.round(total * (0.65 + army.morale / 300) * (0.65 + army.supplies / 285));
  }

  function visibleArmy(territoryId) {
    const t = territory(territoryId);
    if (!t || t.owner === 'you') return armyAt(territoryId);
    const report = state.reports[t.id];
    if (!report || report.readyTick > state.tick) {
      return { hidden: true, estimate: 'Unknown' };
    }
    const army = armyAt(territoryId);
    if (!army) return null;
    return {
      hidden: false,
      estimate: armyDisplayPower(army),
      units: clone(army.units),
      morale: army.morale,
      supplies: army.supplies
    };
  }

  function mapView() {
    return state.territories.map(t => {
      const army = armyAt(t.id);
      return {
        id: t.id,
        index: t.index,
        name: t.name,
        owner: t.owner,
        resource: t.resource,
        col: t.col,
        row: t.row,
        settlement: t.settlement,
        terrain: t.terrain,
        population: Math.round(t.population),
        buildings: clone(t.buildings),
        construction: clone(t.construction),
        army: army && t.owner === 'you' ? sumUnits(army.units) : (army && t.owner !== 'neutral' && state.reports[t.id] && state.reports[t.id].readyTick <= state.tick ? sumUnits(army.units) : 0)
      };
    });
  }

  function resourcePerHour() {
    const out = {};
    RESOURCE_KEYS.forEach(k => out[k] = 0);
    playerTerritories().forEach(t => {
      const count = t.buildings[t.resource === 'Food' ? 'Farm' :
        t.resource === 'Wood' ? 'LumberMill' :
        t.resource === 'Stone' ? 'Quarry' :
        t.resource === 'Iron' ? 'Mine' :
        t.resource === 'Oil' ? 'OilWell' :
        t.resource === 'Mana' ? 'ManaExtractor' : 'Market'] || 0;
      out[t.resource] += RESOURCE_INFO[t.resource].baseYield + count * (t.resource === 'Gold' ? 1 : t.resource === 'Stone' ? 3 : 5);
      if (t.resource === 'Food') out.Food += Math.max(0, count) * 2;
      if (t.buildings.Market) out.Gold += t.buildings.Market;
    });
    return out;
  }

  function militaryUpkeep() {
    return Object.values(state.armies)
      .filter(a => a.owner === 'you')
      .reduce((sum, a) => sum + sumUnits(a.units) * 0.02, 0);
  }

  function foodUpkeep() {
    const army = militaryUpkeep();
    return state.population * 0.01 + army;
  }

  function addEvent(text) {
    state.events.unshift({ tick: state.tick, text });
    state.events = state.events.slice(0, 40);
  }

  function claim(id) {
    const t = territory(id);
    if (!t || t.owner !== 'neutral') return { ok: false, message: 'This territory is not neutral.' };
    if (!neighbors(t.id).some(n => n.owner === 'you')) return { ok: false, message: 'Claim from a neighboring territory.' };
    t.owner = 'you';
    t.status = 'stable';
    t.population = 40;
    t.populationCap = Math.max(t.populationCap, 100);
    addEvent('You claimed ' + t.name + '.');
    save();
    return { ok: true, message: t.name + ' claimed.' };
  }

  function queueBuilding(id, building) {
    const t = territory(id);
    const def = BUILDINGS[building];
    if (!t || t.owner !== 'you') return { ok: false, message: 'You do not control this territory.' };
    if (!def) return { ok: false, message: 'Building unavailable.' };
    if (t.construction.length >= 2) return { ok: false, message: 'Construction queue is full.' };
    if (!canAfford(state.resources, def.cost)) return { ok: false, message: 'Not enough resources.' };
    spend(state.resources, def.cost);
    t.construction.push({ building, remaining: def.time });
    addEvent(building + ' construction started in ' + t.name + '.');
    save();
    return { ok: true, message: building + ' started.' };
  }

  function recruit(id, unitName, count) {
    const t = territory(id);
    const type = UNIT_TYPES[unitName];
    const n = Math.max(1, Math.floor(Number(count || 0)));
    const army = ownedArmyAt(id);
    if (!t || !army || !type) return { ok: false, message: 'No recruitable army here.' };
    const populationFree = Math.max(0, t.population - 10);
    if (populationFree < n) return { ok: false, message: 'Not enough available population.' };
    const cost = {};
    Object.entries(type.cost).forEach(([k, v]) => cost[k] = v * n);
    if (!canAfford(state.resources, cost)) return { ok: false, message: 'Not enough resources.' };
    spend(state.resources, cost);
    army.units[unitName] = (army.units[unitName] || 0) + n;
    t.population -= n;
    addEvent(n + ' ' + unitName + ' recruited in ' + t.name + '.');
    save();
    return { ok: true, message: n + ' ' + unitName + ' recruited.' };
  }

  function moveArmy(armyId, targetId) {
    const army = state.armies[armyId];
    const target = territory(targetId);
    const origin = army && territory(army.territoryId);
    if (!army || army.owner !== 'you' || !target || !origin) return { ok: false, message: 'Invalid army order.' };
    if (!neighbors(origin.id).some(t => t.id === target.id)) return { ok: false, message: 'Armies move one territory at a time.' };
    if (target.owner !== 'you' && target.owner !== 'neutral') return { ok: false, message: 'Use Attack against enemy territory.' };
    army.order = { type: 'move', targetId: target.id, remaining: target.terrain === 'hill' ? 2 : 1 };
    addEvent('Army ordered to ' + target.name + '.');
    save();
    return { ok: true, message: 'Army moving to ' + target.name + '.' };
  }

  function chooseAttackArmy(targetId) {
    const target = territory(targetId);
    if (!target || target.owner === 'you') return null;
    const candidates = neighbors(targetId)
      .filter(t => t.owner === 'you')
      .map(t => ownedArmyAt(t.id))
      .filter(Boolean)
      .sort((a, b) => armyDisplayPower(b) - armyDisplayPower(a));
    return candidates[0] || null;
  }

  function attack(id) {
    const target = territory(id);
    const army = chooseAttackArmy(id);
    if (!target || !army) return { ok: false, message: 'No friendly army can attack this territory.' };
    const origin = territory(army.territoryId);
    army.order = { type: 'attack', targetId: target.id, remaining: target.terrain === 'hill' ? 3 : 2 };
    addEvent('Army from ' + origin.name + ' is moving toward ' + target.name + '.');
    save();
    return { ok: true, message: 'Attack ordered.' };
  }

  function scout(id) {
    const t = territory(id);
    if (!t || t.owner === 'you') return { ok: false, message: 'Nothing to scout.' };
    const distance = Math.max(1, Math.abs(t.col - 1) + Math.abs(t.row - 1));
    const delay = clamp(Math.ceil(distance / 2), 1, 4);
    state.reports[t.id] = { requestedTick: state.tick, readyTick: state.tick + delay };
    addEvent('Scout report for ' + t.name + ' will arrive in ' + delay + ' tick' + (delay === 1 ? '' : 's') + '.');
    save();
    return { ok: true, message: 'Scout report queued.' };
  }

  function improveRelation(faction, amount) {
    if (!(faction in state.relations)) return { ok: false, message: 'Unknown faction.' };
    const cost = Math.max(5, Math.abs(amount) * 4);
    if (amount > 0 && state.resources.Gold < cost) return { ok: false, message: 'Not enough Gold.' };
    if (amount > 0) state.resources.Gold -= cost;
    state.relations[faction] = clamp(state.relations[faction] + amount, -100, 100);
    addEvent('Relations with ' + faction + ' changed to ' + state.relations[faction] + '.');
    save();
    return { ok: true, message: 'Relations changed.' };
  }

  function openPortal() {
    const id = 'portal-' + (state.portals.length + 1);
    const territories = [1,2,3,4].map((n, i) => ({
      id: id + '-t' + n,
      index: i,
      name: 'Portal Territory ' + n,
      owner: i === 0 ? 'portal' : 'ai',
      resource: ['Food','Iron','Mana','Gold'][i],
      terrain: ['plain','forest','hill','field'][i],
      army: {
        units: { Militia: 180 + i * 40, Riflemen: 80 + i * 20, FireMage: i === 2 ? 70 : 0 },
        morale: 100,
        supplies: 100
      }
    }));
    const portal = {
      id,
      status: 'open',
      createdTick: state.tick,
      territories,
      defeated: 0,
      reward: { Gold: 350, Mana: 40, Oil: 60 }
    };
    state.portals.unshift(portal);
    state.portals = state.portals.slice(0, 5);
    addEvent('A PvE portal opened.');
    save();
    return { ok: true, message: 'PvE portal opened.' };
  }


  function portalAttack(portalId, portalTerritoryIndex) {
    const portal = state.portals.find(p => p.id === portalId && p.status === 'open');
    const node = portal && portal.territories[portalTerritoryIndex];
    const army = getPlayerArmies().sort((a, b) => armyDisplayPower(b) - armyDisplayPower(a))[0];
    if (!portal || !node || !army) return { ok: false, message: 'No available army for this portal.' };
    if (node.owner === 'you') return { ok: false, message: 'That territory is already cleared.' };

    const atkPower = Math.max(1, armyDisplayPower(army));
    const defPower = unitPower(node.army.units, army.units) * (0.8 + node.army.morale / 250);
    const ratio = atkPower / Math.max(1, defPower);
    const atkLoss = Math.max(1, Math.floor(sumUnits(army.units) * clamp(0.025 + (1 / Math.max(1, ratio)) * 0.02, 0.02, 0.09)));
    removeUnits(army, atkLoss);

    if (ratio >= 1) {
      node.owner = 'you';
      node.army = null;
      portal.defeated += 1;
      addEvent('Your army cleared portal territory ' + (portalTerritoryIndex + 1) + '.');
      if (portal.defeated >= portal.territories.length - 1) {
        Object.entries(portal.reward).forEach(([k, v]) => state.resources[k] = clamp((state.resources[k] || 0) + v, 0, RESOURCE_INFO[k].cap));
        portal.status = 'cleared';
        addEvent('Portal cleared. Rewards collected.');
        portal.reward = {};
      }
      save();
      return { ok: true, message: 'Portal territory cleared.' };
    }

    node.army.morale = clamp(node.army.morale - 12, 0, 100);
    addEvent('Your portal attack was repelled.');
    save();
    return { ok: true, message: 'Portal attack repelled.' };
  }

  function closePortal(id) {
    const portal = state.portals.find(p => p.id === id);
    if (!portal) return { ok: false, message: 'Portal not found.' };
    portal.status = 'closed';
    if (portal.defeated >= portal.territories.length - 1) {
      Object.entries(portal.reward).forEach(([k, v]) => state.resources[k] = clamp((state.resources[k] || 0) + v, 0, RESOURCE_INFO[k].cap));
      addEvent('Portal cleared. Rewards collected.');
      portal.reward = {};
    }
    save();
    return { ok: true, message: 'Portal closed.' };
  }

  function tickConstruction() {
    state.territories.forEach(t => {
      t.construction = t.construction.filter(job => {
        job.remaining -= 1;
        if (job.remaining > 0) return true;
        t.buildings[job.building] = (t.buildings[job.building] || 0) + 1;
        if (job.building === 'Farm') t.populationCap += 20;
        if (job.building === 'Fort') t.status = 'fortified';
        addEvent(job.building + ' completed in ' + t.name + '.');
        return false;
      });
    });
  }

  function tickProduction() {
    const income = resourcePerHour();
    RESOURCE_KEYS.forEach(k => {
      state.resources[k] = clamp((state.resources[k] || 0) + income[k], 0, RESOURCE_INFO[k].cap);
    });

    const upkeep = foodUpkeep();
    if (state.resources.Food >= upkeep) {
      state.resources.Food -= upkeep;
      state.population += Math.min(0.5, state.population * 0.0008);
    } else {
      state.population = Math.max(20, state.population - Math.max(1, upkeep / 4));
      Object.values(state.armies).filter(a => a.owner === 'you').forEach(a => a.morale = Math.max(0, a.morale - 2));
      addEvent('Food shortage reduced population and morale.');
    }

    state.populationCap = playerTerritories().reduce((n, t) => n + t.populationCap, 0);
    if (state.population > state.populationCap) state.population = state.populationCap;
  }

  function applyArmyMovement(army) {
    if (!army.order || army.battleId) return;
    if (army.order.remaining > 0) {
      army.order.remaining -= 1;
      return;
    }
    const target = territory(army.order.targetId);
    const origin = territory(army.territoryId);
    if (!target || !origin) {
      army.order = null;
      return;
    }

    if (army.order.type === 'move') {
      if (target.owner === 'neutral' || target.owner === 'you') {
        origin.armyId = null;
        target.armyId = army.id;
        army.territoryId = target.id;
        army.order = null;
        addEvent('Army arrived at ' + target.name + '.');
      } else {
        army.order = null;
      }
      return;
    }

    if (army.order.type === 'attack') {
      const defender = armyAt(target.id);
      if (!defender && target.owner !== 'you') {
        origin.armyId = null;
        target.armyId = army.id;
        army.territoryId = target.id;
        target.owner = 'you';
        army.order = null;
        addEvent('Army captured ' + target.name + ' without resistance.');
        return;
      }
      if (defender && defender.id !== army.id) {
        const battleId = 'battle-' + state.tick + '-' + target.id;
        state.battles[battleId] = {
          id: battleId,
          attackerId: army.id,
          defenderId: defender.id,
          territoryId: target.id,
          tickStarted: state.tick
        };
        army.battleId = battleId;
        defender.battleId = battleId;
        army.order = null;
        defender.order = null;
        target.status = 'battle';
        addEvent('Battle started in ' + target.name + '.');
      }
    }
  }

  function applyBattle(battle) {
    const atk = state.armies[battle.attackerId];
    const def = state.armies[battle.defenderId];
    const t = territory(battle.territoryId);
    if (!atk || !def || !t) {
      delete state.battles[battle.id];
      return;
    }

    const atkPower = Math.max(1, unitPower(atk.units, def.units)) * (0.65 + atk.morale / 300) * (0.65 + atk.supplies / 285);
    const defPower = Math.max(1, defensePower(def.units)) * (0.65 + def.morale / 300) * (0.65 + def.supplies / 285);
    let fortBonus = t.buildings.Fort ? 1.35 : 1;
    if (t.terrain === 'hill') fortBonus *= 1.12;
    const ratio = atkPower / (defPower * fortBonus);

    const atkLossRate = clamp(0.02 + (1 / Math.max(1, ratio)) * 0.025, 0.02, 0.10);
    const defLossRate = clamp(0.02 + ratio * 0.03, 0.02, 0.10);
    const atkLosses = Math.max(1, Math.floor(sumUnits(atk.units) * atkLossRate));
    const defLosses = Math.max(1, Math.floor(sumUnits(def.units) * defLossRate));

    removeUnits(atk, atkLosses);
    removeUnits(def, defLosses);
    atk.supplies = Math.max(0, atk.supplies - 4);
    def.supplies = Math.max(0, def.supplies - 3);
    atk.morale = clamp(atk.morale + (ratio > 1 ? 1 : -2), 0, 100);
    def.morale = clamp(def.morale + (ratio < 1 ? 1 : -2), 0, 100);

    const elapsed = state.tick - battle.tickStarted;
    if (sumUnits(def.units) <= 0 || (ratio > 1.35 && elapsed >= 3)) {
      finishBattle(battle, 'attacker');
    } else if (sumUnits(atk.units) <= 0 || (ratio < 0.72 && elapsed >= 3)) {
      finishBattle(battle, 'defender');
    } else if (elapsed >= 10) {
      finishBattle(battle, ratio >= 1 ? 'attacker' : 'defender');
    }
  }

  function removeUnits(army, amount) {
    let remaining = amount;
    const priority = Object.keys(army.units).sort((a, b) => UNIT_TYPES[a].attack - UNIT_TYPES[b].attack);
    for (const name of priority) {
      if (remaining <= 0) break;
      const take = Math.min(army.units[name] || 0, remaining);
      army.units[name] -= take;
      army.wounded += take;
      remaining -= take;
    }
  }

  function finishBattle(battle, winner) {
    const atk = state.armies[battle.attackerId];
    const def = state.armies[battle.defenderId];
    const t = territory(battle.territoryId);
    if (!atk || !def || !t) return;

    if (winner === 'attacker') {
      if (t.armyId === def.id) t.armyId = null;
      if (def.owner === 'you') def.owner = t.owner;
      t.owner = atk.owner;
      atk.territoryId = t.id;
      t.armyId = atk.id;
      atk.battleId = null;
      def.battleId = null;
      def.order = null;
      if (sumUnits(def.units) > 0) def.territoryId = t.id;
      t.status = 'occupied';
      addEvent(atk.owner === 'you' ? 'You captured ' + t.name + '.' : t.name + ' changed hands.');
    } else {
      if (winner === 'defender' && sumUnits(atk.units) > 0) {
        const fallback = neighbors(t.id).find(n => n.owner === atk.owner && !n.armyId);
        if (fallback) {
          t.armyId = def.id;
          atk.territoryId = fallback.id;
          fallback.armyId = atk.id;
        }
      }
      atk.battleId = null;
      def.battleId = null;
      addEvent((atk.owner === 'you' ? 'Your attack on ' : 'Attack on ') + t.name + ' failed.');
    }

    delete state.battles[battle.id];
    if (sumUnits(atk.units) <= 0) delete state.armies[atk.id];
    if (sumUnits(def.units) <= 0) delete state.armies[def.id];
  }

  function tickReports() {
    Object.entries(state.reports).forEach(([id, report]) => {
      if (report.readyTick === state.tick) addEvent('Scout report for ' + (territory(id)?.name || 'territory') + ' arrived.');
    });
  }

  function tick() {
    state.tick += 1;
    state.seasonHour = (state.seasonHour || 0) + 1;
    state.hour += 1;
    if (state.hour >= 24) {
      state.hour = 0;
      state.day += 1;
    }
    state.lastWallClockMs = Date.now();

    tickConstruction();
    tickProduction();
    Object.values(state.armies).forEach(applyArmyMovement);
    Object.values(state.battles).forEach(applyBattle);
    tickReports();

    Object.values(state.armies).filter(a => a.owner === 'you').forEach(a => {
      if (a.supplies < 25) a.morale = Math.max(0, a.morale - 1);
      else a.morale = Math.min(100, a.morale + 0.2);
      a.supplies = Math.max(0, a.supplies - 0.4);
    });

    save();
  }

  function syncToClock(now = Date.now()) {
    if (currentSeasonNumber(now) !== state.season.number) return { seasonChanged: true, processed: 0 };
    const last = Number(state.lastWallClockMs || now);
    const elapsedHours = Math.floor(Math.max(0, now - last) / 3600000);
    if (elapsedHours <= 0) return { seasonChanged: false, processed: 0 };

    let processed = 0;
    const remainingSeasonHours = Math.max(0, window.AttritionGameConfig.season.lengthHours - (state.seasonHour || 0));
    const maxHours = Math.min(elapsedHours, remainingSeasonHours);
    while (processed < maxHours) {
      tick();
      processed += 1;
    }
    state.lastWallClockMs = last + processed * 3600000;
    save();
    return { seasonChanged: false, processed };
  }

  function currentSeasonNumber(now = Date.now()) {
    const start = Date.parse(window.AttritionGameConfig.season.start);
    return Math.floor(Math.max(0, now - start) / (window.AttritionGameConfig.season.lengthHours * 3600000)) + 1;
  }

  function seasonProgress(now = Date.now()) {
    const start = Date.parse(state.season.start);
    const hours = Math.max(0, Math.floor((now - start) / 3600000));
    return {
      season: state.season.number,
      elapsedHours: Math.min(hours, state.season.lengthHours),
      remainingHours: Math.max(0, state.season.lengthHours - hours),
      remainingDays: Math.max(0, Math.ceil((state.season.lengthHours - hours) / 24))
    };
  }

  function getState() { return state; }
  function getBuildings() { return BUILDINGS; }
  function getUnitTypes() { return UNIT_TYPES; }
  function getNeighbors(id) { return neighbors(id); }
  function getArmy(id) { return state.armies[id] || null; }
  function getPlayerArmies() { return Object.values(state.armies).filter(a => a.owner === 'you'); }
  function getIncome() { return resourcePerHour(); }
  function getFoodUpkeep() { return foodUpkeep(); }
  function getVisibleArmy(id) { return visibleArmy(id); }
  function getPortal() { return state.portals.find(p => p.status === 'open') || null; }
  function formatTime() { return 'SEASON ' + state.season.number + ' · DAY ' + state.day + ' · ' + String(state.hour).padStart(2,'0') + ':00'; }

  window.AttritionSimulation = {
    RESOURCE_INFO,
    BUILDINGS,
    UNIT_TYPES,
    state,
    getState,
    getBuildings,
    getUnitTypes,
    getNeighbors,
    getArmy,
    getPlayerArmies,
    getIncome,
    getFoodUpkeep,
    getVisibleArmy,
    getPortal,
    mapView,
    formatTime,
    claim,
    queueBuilding,
    recruit,
    moveArmy,
    attack,
    scout,
    improveRelation,
    openPortal,
    portalAttack,
    closePortal,
    tick,
    syncToClock,
    seasonProgress,
    currentSeasonNumber,
    save
  };
})();
