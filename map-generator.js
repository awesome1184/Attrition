(function () {
  'use strict';

  function hashSeed(input) {
    let h = 2166136261 >>> 0;
    const text = String(input);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h += h << 13; h ^= h >>> 7;
    h += h << 3; h ^= h >>> 17;
    h += h << 5;
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function valueNoise(x, y, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const xf = x - x0, yf = y - y0;
    function corner(ix, iy) {
      const n = hashSeed(seed + ':' + ix + ':' + iy);
      return (n % 100000) / 100000;
    }
    const sx = smooth(xf), sy = smooth(yf);
    const a = corner(x0, y0), b = corner(x0 + 1, y0);
    const c = corner(x0, y0 + 1), d = corner(x0 + 1, y0 + 1);
    const ab = a + (b - a) * sx;
    const cd = c + (d - c) * sx;
    return ab + (cd - ab) * sy;
  }

  function fbm(x, y, seed) {
    let value = 0, amplitude = 0.5, frequency = 1, total = 0;
    for (let i = 0; i < 4; i++) {
      value += valueNoise(x * frequency, y * frequency, seed + i * 7919) * amplitude;
      total += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return value / total;
  }

  function dist(a, b, c, d) {
    return Math.hypot(a - c, b - d);
  }

  function nearest(territories, col, row, owner, count) {
    return territories
      .filter(t => t.owner === owner)
      .sort((a, b) => dist(a.col, a.row, col, row) - dist(b.col, b.row, col, row))
      .slice(0, count);
  }

  function chooseResource(terrain, rng, spice) {
    const options = {
      forest: [['Wood', 58], ['Food', 24], ['Mana', 18]],
      hill: [['Stone', 42], ['Iron', 35], ['Mana', 23]],
      field: [['Food', 60], ['Gold', 22], ['Iron', 18]],
      plain: [['Food', 38], ['Gold', 24], ['Iron', 20], ['Oil', 18]],
      coast: [['Food', 30], ['Oil', 42], ['Gold', 28]]
    };
    const pool = options[terrain] || options.plain;
    const bonus = spice;
    let roll = rng() * 100;
    if (bonus > 0.72 && terrain !== 'coast' && rng() < 0.18) return 'Mana';
    for (const [resource, weight] of pool) {
      roll -= weight;
      if (roll <= 0) return resource;
    }
    return pool[pool.length - 1][0];
  }

  function terrainFor(col, row, cols, rows, seed) {
    const elevation = fbm(col / 4.2, row / 4.2, seed + ':elevation');
    const moisture = fbm((col + 17) / 3.5, (row - 11) / 3.5, seed + ':moisture');
    const coastNoise = fbm((col - 31) / 2.4, (row + 9) / 2.4, seed + ':coast');
    const edge = Math.min(col, row, cols - 1 - col, rows - 1 - row);

    if (edge === 0 && elevation < 0.45 && coastNoise > 0.48) return 'coast';
    if (elevation > 0.66) return 'hill';
    if (moisture > 0.55) return 'forest';
    if (moisture > 0.36) return 'field';
    return 'plain';
  }

  function ownerFor(col, row, cols, rows, seed, start) {
    const jitter = fbm(col / 2.7 + 40, row / 2.7 - 20, seed + ':owners');
    const playerDistance = dist(col, row, start.col, start.row);

    if (playerDistance <= 1.45) return 'you';

    const northScore = ((rows - 1 - row) / Math.max(1, rows - 1)) + (jitter - 0.5) * 0.26;
    const southScore = (row / Math.max(1, rows - 1)) + (jitter - 0.5) * 0.26;

    if (row <= Math.floor(rows * 0.43) && northScore > 0.69) return 'north';
    if (row >= Math.ceil(rows * 0.57) && southScore > 0.69) return 'south';
    return 'neutral';
  }

  function makeRoadLinks(territories, cols, rows, rng) {
    const edges = [];
    territories.forEach(t => {
      const right = territories.find(n => n.col === t.col + 1 && n.row === t.row);
      const down = territories.find(n => n.col === t.col && n.row === t.row + 1);
      if (right) edges.push({ a: t.id, b: right.id, weight: rng() });
      if (down) edges.push({ a: t.id, b: down.id, weight: rng() });
    });

    const parent = new Map(territories.map(t => [t.id, t.id]));
    function find(x) {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    }
    function join(a, b) {
      const ra = find(a), rb = find(b);
      if (ra === rb) return false;
      parent.set(ra, rb);
      return true;
    }

    const links = [];
    edges.sort((a, b) => a.weight - b.weight);
    edges.forEach(edge => {
      if (join(edge.a, edge.b)) links.push([edge.a, edge.b]);
    });

    edges.forEach(edge => {
      const duplicate = links.some(link => (link[0] === edge.a && link[1] === edge.b) || (link[0] === edge.b && link[1] === edge.a));
      if (!duplicate && edge.weight > 0.58 && rng() < 0.42) links.push([edge.a, edge.b]);
    });
    return links;
  }

  function makeRivers(world, cols, rows, tileSize, rng) {
    const rivers = [];
    const riverCount = 1 + (rng() < 0.55 ? 1 : 0);
    for (let r = 0; r < riverCount; r++) {
      const points = [];
      let x = world.width * (0.20 + rng() * 0.60);
      const steps = rows * 2 + 3;
      for (let i = 0; i < steps; i++) {
        const y = (world.height / (steps - 1)) * i;
        x += (rng() - 0.5) * tileSize * 1.1;
        x += Math.sin(i * 0.9 + r) * tileSize * 0.24;
        x = Math.max(tileSize * 0.35, Math.min(world.width - tileSize * 0.35, x));
        points.push([Math.round(x), Math.round(y)]);
      }
      rivers.push(points);
    }
    return rivers;
  }

  function generate(options) {
    const seed = String(options.seed);
    const cols = options.cols || 8;
    const rows = options.rows || 6;
    const tileSize = options.tileSize || 180;
    const world = {
      width: options.width || 2200,
      height: options.height || 2200,
      cols,
      rows,
      tileSize
    };
    const rng = mulberry32(hashSeed(seed));

    const start = {
      col: 1 + Math.floor(rng() * Math.max(1, cols - 2)),
      row: Math.floor(rows * 0.35) + Math.floor(rng() * Math.max(1, Math.ceil(rows * 0.30))),
    };
    start.col = Math.max(1, Math.min(cols - 2, start.col));
    start.row = Math.max(1, Math.min(rows - 2, start.row));

    const territories = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        const terrain = terrainFor(col, row, cols, rows, seed);
        const owner = ownerFor(col, row, cols, rows, seed, start);
        const spice = fbm(col / 3.1 + 90, row / 3.1 + 12, seed + ':resources');
        const resource = chooseResource(terrain, rng, spice);

        territories.push({
          index,
          id: index + 1,
          name: 'Territory ' + (index + 1),
          owner,
          resource,
          col,
          row,
          terrain,
          settlement: null,
          buildings: {},
          level: 1 + Math.floor(spice * 2),
          population: 100 + Math.floor(spice * 320) + (owner === 'you' ? 80 : 0),
          roads: [],
          army: null
        });
      }
    }

    const byPos = (col, row) => territories.find(t => t.col === col && t.row === row);
    const capital = byPos(start.col, start.row);
    capital.owner = 'you';
    capital.settlement = 'capital';
    capital.population = 420;

    territories.forEach(t => {
      if (t === capital) return;
      const chance = rng();
      if (t.terrain === 'coast' && chance < 0.72) t.settlement = 'port';
      else if (t.owner !== 'neutral' && chance < 0.34) t.settlement = chance < 0.12 ? 'fort' : 'town';
      else if (t.owner === 'neutral' && chance < 0.22) t.settlement = chance < 0.07 ? 'ruins' : 'village';
    });

    const playerNeighbors = territories.filter(t => t.owner === 'you' && t !== capital);
    if (playerNeighbors.length) playerNeighbors[0].settlement = playerNeighbors[0].settlement || 'town';

    const northStart = nearest(territories, Math.floor(cols * 0.50), 0, 'north', 1)[0];
    const southStart = nearest(territories, Math.floor(cols * 0.62), rows - 1, 'south', 1)[0];
    const neutralStart = nearest(territories, Math.floor(cols * 0.52), Math.floor(rows * 0.52), 'neutral', 1)[0];

    const startingPositions = {
      capitalId: capital.id,
      armies: []
    };
    const playerArmy = nearest(territories, start.col, start.row, 'you', 1)[0];
    const playerSecond = nearest(territories, start.col + 1, start.row, 'you', 3).find(t => !playerArmy || t.id !== playerArmy.id);
    const candidates = [
      { owner: 'you', territoryId: (playerArmy || capital).id, kind: 'field' },
      { owner: 'you', territoryId: (playerSecond || capital).id, kind: 'fort' },
      { owner: 'north', territoryId: northStart ? northStart.id : territories[0].id, kind: 'field' },
      { owner: 'south', territoryId: southStart ? southStart.id : territories[territories.length - 1].id, kind: 'field' },
      { owner: 'neutral', territoryId: neutralStart ? neutralStart.id : capital.id, kind: 'field' }
    ];
    candidates.forEach((army, i) => startingPositions.armies.push({ ...army, slot: i }));

    territories.forEach(t => {
      const hasRoad = rng() < 0.35;
      if (hasRoad) t.roads.push('local');
    });

    const roadLinks = makeRoadLinks(territories, cols, rows, rng);
    const rivers = makeRivers(world, cols, rows, tileSize, rng);

    const required = ['Food', 'Wood', 'Stone', 'Iron', 'Oil', 'Mana', 'Gold'];
    const present = new Set(territories.map(t => t.resource));
    const repairCandidates = territories
      .filter(t => t.owner === 'neutral' && t !== capital)
      .sort((a, b) => (a.index % 7) - (b.index % 7));
    required.filter(r => !present.has(r)).forEach(resource => {
      const target = repairCandidates.shift();
      if (target) target.resource = resource;
    });

    return {
      version: 3,
      seed,
      world,
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
      territories,
      roadLinks,
      rivers,
      startingPositions
    };
  }

  const api = { generate };\n  if (typeof module !== 'undefined' && module.exports) module.exports = api;\n  if (typeof window !== 'undefined') window.AttritionMapGenerator = api;
})();