(function () {
  const regions = [
    ['Territory 1','north','Iron',0,0,'fort'],['Territory 2','north','Wood',1,0,'town'],['Territory 3','north','Food',2,0,'town'],['Territory 4','north','Stone',3,0,'fort'],['Territory 5','north','Iron',4,0,'fort'],['Territory 6','north','Food',5,0,'town'],['Territory 7','neutral','Oil',6,0,'port'],['Territory 8','neutral','Food',7,0,''],
    ['Territory 9','neutral','Food',0,1,'village'],['Territory 10','you','Gold',1,1,'capital'],['Territory 11','you','Wood',2,1,'town'],['Territory 12','you','Iron',3,1,'fort'],['Territory 13','you','Oil',4,1,'port'],['Territory 14','south','Mana',5,1,'town'],['Territory 15','south','Mana',6,1,'fort'],['Territory 16','south','Food',7,1,'town'],
    ['Territory 17','south','Stone',0,2,'village'],['Territory 18','south','Mana',1,2,'town'],['Territory 19','neutral','Food',2,2,'port'],['Territory 20','neutral','Oil',3,2,''],['Territory 21','neutral','Iron',4,2,'ruins'],['Territory 22','neutral','Mana',5,2,'town'],['Territory 23','neutral','Oil',6,2,'fort'],['Territory 24','neutral','Wood',7,2,'forest'],
    ['Territory 25','neutral','Stone',0,3,'village'],['Territory 26','neutral','Wood',1,3,'village'],['Territory 27','neutral','Food',2,3,'town'],['Territory 28','neutral','Iron',3,3,'town'],['Territory 29','neutral','Oil',4,3,'port'],['Territory 30','neutral','Gold',5,3,'ruins'],['Territory 31','south','Mana',6,3,'fort'],['Territory 32','south','Stone',7,3,'town']
  ];

  const terrainByCell = [
    'forest','forest','field','hill','hill','field','field','coast',
    'forest','plain','field','plain','plain','hill','forest','coast',
    'hill','forest','field','plain','hill','plain','forest','forest',
    'plain','forest','field','plain','plain','hill','forest','coast'
  ];

  const startingArmies = {
    9: { owner: 'you', size: 330, kind: 'field' },
    12: { owner: 'you', size: 80, kind: 'fort' },
    3: { owner: 'north', size: 2600, kind: 'field' },
    20: { owner: 'neutral', size: 1200, kind: 'field' },
    14: { owner: 'south', size: 2100, kind: 'field' }
  };

  const roads = [
    [9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,16],
    [9,17],[10,18],[11,19],[12,20],[13,21],[14,22],[15,23],[16,24],
    [17,18],[18,19],[19,20],[20,21],[21,22],[22,23],[23,24],
    [17,25],[18,26],[19,27],[20,28],[21,29],[22,30],[23,31],[24,32]
  ];

  const rivers = [
    [[260,0],[350,260],[320,510],[430,770],[390,1030],[520,1320],[500,1820]],
    [[3050,120],[2860,320],[2910,620],[2750,900],[2820,1180],[2640,1490],[2720,1920]]
  ];

  window.AttritionMapData = {
    version: 2,
    world: { width: 3600, height: 2200, cols: 8, rows: 4, marginX: 140, marginY: 120 },
    factions: {
      you: { fill: '#3f88b0', line: '#8fd2ef' },
      north: { fill: '#9b5b53', line: '#e0a29a' },
      south: { fill: '#775c97', line: '#cbb2e5' },
      neutral: { fill: '#707b5c', line: '#aab49b' }
    },
    resources: {
      Food: '#a5a75d',
      Wood: '#8e6b46',
      Stone: '#8a9090',
      Iron: '#616b74',
      Oil: '#2e3133',
      Mana: '#9e7ec6',
      Gold: '#bd9948'
    },
    territories: regions.map((r, i) => ({
      index: i,
      id: i + 1,
      name: r[0],
      owner: r[1],
      resource: r[2],
      col: r[3],
      row: r[4],
      settlement: r[5] || null,
      terrain: terrainByCell[i],
      buildings: Math.max(0, 2 + ((i * 7) % 5)),
      level: 1 + (i % 3),
      population: 90 + ((i * 47) % 420),
      roads: [],
      army: startingArmies[i] || null
    })),
    roadLinks: roads,
    rivers
  };
})();