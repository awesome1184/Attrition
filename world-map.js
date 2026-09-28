(function () {
  const TAU = Math.PI * 2;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hash(n) {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }
  function rgba(hex, alpha) {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const hit = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }

  class AttritionWorldMap {
    constructor(options) {
      this.container = options.container;
      this.data = options.data || window.AttritionMapData;
      this.getState = options.getState || (() => ({}));
      this.onSelect = options.onSelect || (() => {});
      this.onAction = options.onAction || (() => {});
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'attrition-world-canvas';
      this.canvas.setAttribute('aria-label', 'Attrition world map');
      this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
      this.container.style.position = 'relative';
      this.container.appendChild(this.canvas);

      this.camera = { x: 0, y: 0, zoom: 0.72 };
      this.pointer = { active: false, id: null, sx: 0, sy: 0, lx: 0, ly: 0, moved: false };
      this.hover = null;
      this.polygons = [];
      this.centers = [];
      this.gridVertices = [];
      this.actionButtons = [];
      this.raf = 0;
      this.lastWidth = 0;
      this.lastHeight = 0;
      this.anim = { start: 0, duration: 520, previous: null };
      this.destroyed = false;
      this.menuVisible = false;

      this.buildGeometry();
      this.bind();
      this.resize();
      this.home();
    }

    buildGeometry() {
      const w = this.data.world.width;
      const h = this.data.world.height;
      const cols = this.data.world.cols;
      const rows = this.data.world.rows;
      const mx = this.data.world.marginX;
      const my = this.data.world.marginY;
      const cellW = (w - mx * 2) / cols;
      const cellH = (h - my * 2) / rows;
      this.cellW = cellW;
      this.cellH = cellH;

      this.gridVertices = Array.from({ length: rows + 1 }, (_, r) => Array.from({ length: cols + 1 }, (_, c) => {
        const edgeX = c === 0 || c === cols;
        const edgeY = r === 0 || r === rows;
        const key = r * (cols + 1) + c + 1;
        const jitterX = edgeX ? 0 : (hash(key * 1.73) - 0.5) * cellW * 0.15;
        const jitterY = edgeY ? 0 : (hash(key * 2.31) - 0.5) * cellH * 0.13;
        return { x: mx + c * cellW + jitterX, y: my + r * cellH + jitterY };
      }));

      this.data.territories.forEach((territory, i) => {
        const a = this.gridVertices[territory.row][territory.col];
        const b = this.gridVertices[territory.row][territory.col + 1];
        const c = this.gridVertices[territory.row + 1][territory.col + 1];
        const d = this.gridVertices[territory.row + 1][territory.col];
        const cx = (a.x + b.x + c.x + d.x) / 4;
        const cy = (a.y + b.y + c.y + d.y) / 4;
        const inset = Math.min(cellW, cellH) * 0.018;
        const ratio = inset / Math.min(cellW, cellH);
        this.polygons[i] = [a, b, c, d].map(p => ({ x: lerp(p.x, cx, ratio), y: lerp(p.y, cy, ratio) }));
        this.centers[i] = { x: cx, y: cy };
      });
    }

    bind() {
      this.onPointerDown = (event) => {
        if (event.button !== 0 && event.pointerType !== 'touch') return;
        this.pointer.active = true;
        this.pointer.id = event.pointerId;
        this.pointer.sx = event.clientX;
        this.pointer.sy = event.clientY;
        this.pointer.lx = event.clientX;
        this.pointer.ly = event.clientY;
        this.pointer.moved = false;
        this.canvas.setPointerCapture(event.pointerId);
        this.container.classList.add('dragging');
      };

      this.onPointerMove = (event) => {
        if (this.pointer.active && event.pointerId === this.pointer.id) {
          const dx = event.clientX - this.pointer.lx;
          const dy = event.clientY - this.pointer.ly;
          this.pointer.lx = event.clientX;
          this.pointer.ly = event.clientY;
          if (Math.hypot(event.clientX - this.pointer.sx, event.clientY - this.pointer.sy) > 6) this.pointer.moved = true;
          this.camera.x += dx;
          this.camera.y += dy;
          this.queueRender();
          return;
        }
        const world = this.screenToWorld(event.clientX, event.clientY);
        const hit = this.pick(world.x, world.y);
        const action = this.pickAction(event.clientX, event.clientY);
        const nextHover = action ? `a:${action.id}` : hit !== null ? `t:${hit}` : null;
        if (nextHover !== this.hover) {
          this.hover = nextHover;
          this.queueRender();
        }
      };

      this.onPointerUp = (event) => {
        if (!this.pointer.active || event.pointerId !== this.pointer.id) return;
        const moved = this.pointer.moved;
        this.pointer.active = false;
        this.pointer.id = null;
        this.container.classList.remove('dragging');
        try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) {}
        if (moved) return;

        const action = this.pickAction(event.clientX, event.clientY);
        if (action) {
          this.onAction(action.id, action.index);
          return;
        }
        const world = this.screenToWorld(event.clientX, event.clientY);
        const hit = this.pick(world.x, world.y);
        if (hit !== null) this.select(hit);
      };

      this.onPointerCancel = () => {
        this.pointer.active = false;
        this.pointer.id = null;
        this.container.classList.remove('dragging');
      };

      this.onWheel = (event) => {
        event.preventDefault();
        const before = this.screenToWorld(event.clientX, event.clientY);
        const factor = event.deltaY < 0 ? 1.1 : 0.91;
        const old = this.camera.zoom;
        const next = clamp(old * factor, 0.44, 2.0);
        this.camera.zoom = next;
        const after = this.screenToWorld(event.clientX, event.clientY);
        this.camera.x += (after.x - before.x) * this.camera.zoom;
        this.camera.y += (after.y - before.y) * this.camera.zoom;
        void old;
        void before;
        void after;
        this.queueRender();
      };

      this.onResize = () => this.resize();
      this.canvas.addEventListener('pointerdown', this.onPointerDown);
      this.canvas.addEventListener('pointermove', this.onPointerMove);
      this.canvas.addEventListener('pointerup', this.onPointerUp);
      this.canvas.addEventListener('pointercancel', this.onPointerCancel);
      this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
      window.addEventListener('resize', this.onResize);
    }

    resize() {
      if (this.destroyed) return;
      const rect = this.container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.lastWidth = Math.max(1, rect.width);
      this.lastHeight = Math.max(1, rect.height);
      const width = Math.max(1, Math.floor(this.lastWidth * dpr));
      const height = Math.max(1, Math.floor(this.lastHeight * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.queueRender();
    }

    select(index) {
      const state = this.getState() || {};
      const previous = state.selected;
      state.selected = index;
      this.anim.previous = previous;
      this.anim.start = performance.now();
      this.menuVisible = true;
      this.onSelect(index);
      this.queueRender();
    }

    selectedIndex() {
      const state = this.getState() || {};
      return state.selected === undefined ? 0 : state.selected;
    }

    worldToScreenPoint(x, y, z = 0) {
      const p = this.project(x, y, z);
      return { x: this.camera.x + p.x * this.camera.zoom, y: this.camera.y + p.y * this.camera.zoom };
    }

    screenToWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const px = (sx - this.camera.x) / this.camera.zoom;
      const py = (sy - this.camera.y) / this.camera.zoom;
      return this.unproject(px, py);
    }

    project(x, y, z = 0) {
      const cos = 0.84;
      const sin = 0.47;
      return {
        x: (x - y) * cos,
        y: (x + y) * sin - z
      };
    }

    unproject(x, y) {
      const cos = 0.84;
      const sin = 0.47;
      const a = x / cos;
      const b = y / sin;
      return { x: (a + b) / 2, y: (b - a) / 2 };
    }

    pick(x, y) {
      let best = null;
      let dist = Infinity;
      for (let i = 0; i < this.polygons.length; i++) {
        const projected = this.polygons[i].map(p => this.project(p.x, p.y));
        if (pointInPolygon(x, y, projected)) {
          const center = this.project(this.centers[i].x, this.centers[i].y);
          const d = Math.hypot(x - center.x, y - center.y);
          if (d < dist) {
            dist = d;
            best = i;
          }
        }
      }
      return best;
    }

    currentProgress() {
      if (!this.anim.start) return 1;
      const t = clamp((performance.now() - this.anim.start) / this.anim.duration, 0, 1);
      return 1 - Math.pow(1 - t, 3);
    }

    actionDefs(index) {
      const state = this.getState() || {};
      const territory = this.data.territories[index] || {};
      const owner = state.world && state.world[index] && state.world[index].owner ? state.world[index].owner : territory.owner;
      const own = owner === 'you';
      const enemy = owner && owner !== 'you' && owner !== 'neutral';
      return [
        { id: 'details', label: 'Details', glyph: 'i' },
        { id: own ? 'build' : 'scout', label: own ? 'Build' : 'Scout', glyph: own ? '+' : '◎' },
        { id: enemy ? 'attack' : 'move', label: enemy ? 'Attack' : 'Move', glyph: enemy ? '⚔' : '↗' },
        { id: own ? 'army' : 'claim', label: own ? 'Army' : 'Claim', glyph: own ? '⚑' : '◆' },
        { id: 'diplomacy', label: 'Relations', glyph: '◌' },
        { id: 'view', label: 'View', glyph: '◉' }
      ];
    }

    getActionLayout() {
      const index = this.selectedIndex();
      if (index === null || index === undefined || !this.centers[index]) return [];
      const p = this.worldToScreenPoint(this.centers[index].x, this.centers[index].y, 18);
      const radius = Math.min(155, Math.max(104, Math.min(this.lastWidth, this.lastHeight) * 0.135));
      const items = this.actionDefs(index);
      const start = -Math.PI / 2;
      const step = TAU / items.length;
      return items.map((item, i) => ({
        ...item,
        index,
        x: p.x + Math.cos(start + step * i) * radius,
        y: p.y + Math.sin(start + step * i) * radius,
        angle: start + step * i,
        radius: 28
      }));
    }

    pickAction(clientX, clientY) {
      if (!this.menuVisible || (!this.selectedIndex() && this.selectedIndex() !== 0)) return null;
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const p = this.currentProgress();
      if (p < 0.82) return null;
      for (const button of this.getActionLayout()) {
        const d = Math.hypot(x - button.x, y - button.y);
        if (d <= button.radius + 6) return button;
      }
      return null;
    }

    queueRender() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render();
      });
    }

    refresh() { this.queueRender(); }

    home() {
      const bounds = this.projectBounds();
      const scale = Math.min((this.lastWidth - 50) / bounds.width, (this.lastHeight - 50) / bounds.height);
      this.camera.zoom = clamp(scale, 0.36, 0.85);
      this.camera.x = this.lastWidth / 2 - (bounds.minX + bounds.width / 2) * this.camera.zoom;
      this.camera.y = this.lastHeight / 2 - (bounds.minY + bounds.height / 2) * this.camera.zoom;
      this.queueRender();
    }

    zoomBy(factor) {
      const old = this.camera.zoom;
      const next = clamp(old * factor, 0.44, 2.0);
      const cx = this.lastWidth / 2;
      const cy = this.lastHeight / 2;
      this.camera.x = cx - (cx - this.camera.x) * (next / old);
      this.camera.y = cy - (cy - this.camera.y) * (next / old);
      this.camera.zoom = next;
      this.queueRender();
    }

    projectBounds() {
      const corners = [
        this.project(0, 0),
        this.project(this.data.world.width, 0),
        this.project(0, this.data.world.height),
        this.project(this.data.world.width, this.data.world.height)
      ];
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      return { minX, minY, width: maxX - minX, height: maxY - minY };
    }

    render() {
      if (this.destroyed || !this.canvas.width) return;
      const ctx = this.canvas.getContext('2d');
      const dpr = this.canvas.width / this.lastWidth;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(dpr * this.camera.zoom, 0, 0, dpr * this.camera.zoom, dpr * this.camera.x, dpr * this.camera.y);
      ctx.imageSmoothingEnabled = true;

      this.drawWorldBase(ctx);
      this.drawWater(ctx);
      this.drawTerrain(ctx);
      this.drawRivers(ctx);
      this.drawRoads(ctx);
      this.drawTerritories(ctx);
      this.drawSettlements(ctx);
      this.drawArmies(ctx);
      this.drawSelection(ctx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawActionMenu(ctx);

      if (this.anim.start && performance.now() - this.anim.start < this.anim.duration + 80) this.queueRender();
    }

    drawWorldBase(ctx) {
      const w = this.data.world.width, h = this.data.world.height;
      ctx.save();
      ctx.fillStyle = '#415943';
      const p = [this.project(0, 0), this.project(w, 0), this.project(w, h), this.project(0, h)];
      ctx.beginPath(); ctx.moveTo(p[0].x,p[0].y); for (let i=1;i<p.length;i++) ctx.lineTo(p[i].x,p[i].y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 36; ctx.stroke();
      ctx.restore();
    }

    drawWater(ctx) {
      const w = this.data.world.width, h = this.data.world.height;
      const shore = [this.project(0,0),this.project(w,0),this.project(w,250),this.project(2860,220),this.project(2650,320),this.project(2180,235),this.project(1700,300),this.project(1240,240),this.project(820,315),this.project(410,250),this.project(0,300)];
      ctx.fillStyle='#315f6f';ctx.beginPath();ctx.moveTo(shore[0].x,shore[0].y);for(let i=1;i<shore.length;i++)ctx.lineTo(shore[i].x,shore[i].y);ctx.closePath();ctx.fill();
      const south=[this.project(w,1600),this.project(w,h),this.project(3100,h),this.project(3270,1740),this.project(3340,1430)];
      ctx.fillStyle='#35677a';ctx.beginPath();ctx.moveTo(south[0].x,south[0].y);for(let i=1;i<south.length;i++)ctx.lineTo(south[i].x,south[i].y);ctx.closePath();ctx.fill();
    }

    drawTerrain(ctx) {
      for (const t of this.data.territories) {
        const poly = this.polygons[t.index].map(p => this.project(p.x,p.y));
        const c = this.project(this.centers[t.index].x,this.centers[t.index].y);
        ctx.save();ctx.beginPath();ctx.moveTo(poly[0].x,poly[0].y);for(let j=1;j<poly.length;j++)ctx.lineTo(poly[j].x,poly[j].y);ctx.closePath();ctx.clip();
        if(t.terrain==='forest'){
          for(let i=0;i<16;i++)this.drawTree(ctx,c.x-this.cellW*.29+hash(t.index*19+i)*this.cellW*.58,c.y-this.cellH*.23+hash(t.index*31+i)*this.cellH*.45,.42+hash(t.index*47+i)*.35);
        }else if(t.terrain==='field'){
          ctx.strokeStyle='rgba(204,188,113,.33)';ctx.lineWidth=7;for(let y=c.y-this.cellH*.18;y<c.y+this.cellH*.25;y+=22){ctx.beginPath();ctx.moveTo(c.x-this.cellW*.40,y);ctx.lineTo(c.x+this.cellW*.35,y+11);ctx.stroke();}
        }else if(t.terrain==='hill'){
          for(let i=0;i<6;i++)this.drawHill(ctx,c.x-this.cellW*.32+hash(t.index*11+i)*this.cellW*.64,c.y-this.cellH*.12+hash(t.index*17+i)*this.cellH*.22,.7+hash(t.index*23+i)*.25);
        }else{ctx.fillStyle='rgba(81,105,78,.22)';ctx.fillRect(c.x-this.cellW*.5,c.y-this.cellH*.35,this.cellW,this.cellH*.7);}
        ctx.restore();
      }
    }

    drawRivers(ctx) {
      for(const river of this.data.rivers){
        ctx.strokeStyle='rgba(30,58,66,.35)';ctx.lineCap='round';ctx.lineWidth=30;ctx.beginPath();let p=this.project(river[0][0],river[0][1]);ctx.moveTo(p.x,p.y);for(let i=1;i<river.length;i++){p=this.project(river[i][0],river[i][1]);ctx.lineTo(p.x,p.y);}ctx.stroke();
        ctx.strokeStyle='#4f8ba0';ctx.lineWidth=17;ctx.beginPath();p=this.project(river[0][0],river[0][1]);ctx.moveTo(p.x,p.y);for(let i=1;i<river.length;i++){p=this.project(river[i][0],river[i][1]);ctx.lineTo(p.x,p.y);}ctx.stroke();
      }
    }

    drawRoads(ctx) {
      for(const[a,b]of this.data.roadLinks){
        const p=this.project(this.centers[a].x,this.centers[a].y),q=this.project(this.centers[b].x,this.centers[b].y);
        const mx=(p.x+q.x)/2,my=(p.y+q.y)/2,curveX=mx+(hash(a*7+b)-.5)*90,curveY=my+(hash(a*11+b)-.5)*50;
        ctx.strokeStyle='rgba(46,39,29,.55)';ctx.lineCap='round';ctx.lineWidth=26;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.quadraticCurveTo(curveX,curveY,q.x,q.y);ctx.stroke();
        ctx.strokeStyle='#9a865e';ctx.lineWidth=12;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.quadraticCurveTo(curveX,curveY,q.x,q.y);ctx.stroke();
      }
    }

    territoryOwner(i) {
      const state=this.getState()||{};
      return state.world&&state.world[i]&&state.world[i].owner?state.world[i].owner:this.data.territories[i].owner;
    }

    drawTerritories(ctx) {
      const selected=this.selectedIndex();
      this.data.territories.forEach((t,i)=>{
        const owner=this.territoryOwner(i), faction=this.data.factions[owner]||this.data.factions.neutral;
        const poly=this.polygons[i].map(p=>this.project(p.x,p.y));
        const lift=selected===i?this.currentProgress()*18:0;
        const raised=this.polygons[i].map(p=>this.project(p.x,p.y,lift));
        if(selected===i){this.drawTileShadow(ctx,raised,30);this.drawTileSide(ctx,poly,raised,'rgba(18,23,19,.66)');}
        ctx.fillStyle=owner==='neutral'?'rgba(115,125,86,.16)':rgba(faction.fill,owner==='you'?.27:.20);
        ctx.beginPath();ctx.moveTo(raised[0].x,raised[0].y);for(let j=1;j<raised.length;j++)ctx.lineTo(raised[j].x,raised[j].y);ctx.closePath();ctx.fill();
        ctx.strokeStyle=owner==='neutral'?'rgba(197,202,167,.22)':rgba(faction.line,.62);ctx.lineWidth=selected===i?5:3;
        ctx.beginPath();ctx.moveTo(raised[0].x,raised[0].y);for(let j=1;j<raised.length;j++)ctx.lineTo(raised[j].x,raised[j].y);ctx.closePath();ctx.stroke();
        if(selected!==i&&owner!=='neutral')this.drawTerritoryFlag(ctx,i,faction);
        if(this.camera.zoom>.56&&t.resource)this.drawResourceMarker(ctx,i,t.resource,lift);
      });
    }

    drawTileShadow(ctx,poly,amount){const c=poly.reduce((a,p)=>({x:a.x+p.x/poly.length,y:a.y+p.y/poly.length}),{x:0,y:0});ctx.save();ctx.fillStyle='rgba(0,0,0,.35)';ctx.filter=`blur(${amount}px)`;ctx.beginPath();ctx.ellipse(c.x,c.y+amount*.75,this.cellW*.42,this.cellH*.17,0,0,TAU);ctx.fill();ctx.restore();}
    drawTileSide(ctx,bottom,top,fill){ctx.save();ctx.fillStyle=fill;for(let i=0;i<top.length;i++){const j=(i+1)%top.length;ctx.beginPath();ctx.moveTo(top[i].x,top[i].y);ctx.lineTo(top[j].x,top[j].y);ctx.lineTo(bottom[j].x,bottom[j].y);ctx.lineTo(bottom[i].x,bottom[i].y);ctx.closePath();ctx.fill();}ctx.restore();}
    drawTerritoryFlag(ctx,i,faction){const c=this.project(this.centers[i].x+this.cellW*.28,this.centers[i].y-this.cellH*.23,34);ctx.strokeStyle=faction.line;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(c.x,c.y);ctx.lineTo(c.x,c.y+27);ctx.stroke();ctx.fillStyle=faction.fill;ctx.beginPath();ctx.moveTo(c.x+1,c.y);ctx.lineTo(c.x+24,c.y+7);ctx.lineTo(c.x+1,c.y+15);ctx.closePath();ctx.fill();}

    drawSettlements(ctx) {
      const state=this.getState()||{};
      for(const t of this.data.territories){
        const runtime=state.world&&state.world[t.index]?state.world[t.index]:null;
        const owner=runtime?.owner||t.owner;
        const s=runtime?.settlement===false?null:(runtime?.settlement||t.settlement);
        if(!s)continue;
        const p=this.project(this.centers[t.index].x,this.centers[t.index].y,this.selectedIndex()===t.index?this.currentProgress()*18:0);
        this.drawSettlement(ctx,p.x-14,p.y+20,s,owner,t.index);
      }
    }

    drawSettlement(ctx,x,y,type,owner,seed){
      const faction=this.data.factions[owner]||this.data.factions.neutral,accent=faction.line;ctx.save();
      ctx.fillStyle='rgba(0,0,0,.30)';ctx.beginPath();ctx.ellipse(x+4,y+40,60,15,0,0,TAU);ctx.fill();
      const building=(bx,by,bw,bh,wall,roof)=>{ctx.fillStyle=wall;ctx.fillRect(bx-bw/2,by-bh,bw,bh);ctx.fillStyle=roof;ctx.beginPath();ctx.moveTo(bx-bw/2-3,by-bh);ctx.lineTo(bx,by-bh-15);ctx.lineTo(bx+bw/2+3,by-bh);ctx.closePath();ctx.fill();ctx.fillStyle='#51432f';ctx.fillRect(bx-4,by-15,8,15);};
      const wall=type==='fort'||type==='capital'?'#b7a582':'#a99673';
      building(x,y+24,type==='fort'?70:52,type==='capital'?48:34,wall,type==='port'?'#65544a':'#7a443c');
      ctx.fillStyle=accent;ctx.fillRect(x-3,y-6,6,20);
      if(type==='fort'){ctx.fillStyle='#858982';ctx.fillRect(x-52,y+16,18,35);ctx.fillRect(x+34,y+16,18,35);ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.strokeRect(x-56,y+10,112,40);}
      else if(type==='port'){ctx.fillStyle='#7d674e';ctx.fillRect(x+32,y+13,75,9);ctx.fillStyle='#416c79';ctx.fillRect(x+48,y+22,70,20);}
      else if(type==='ruins'){ctx.fillStyle='#6f706d';ctx.fillRect(x-40,y+12,32,26);ctx.fillRect(x+5,y+6,40,32);}
      else if(type==='village'){building(x-32,y+34,28,22,'#bba57d','#74413a');building(x+32,y+36,30,24,'#b59e76','#74413a');}
      else if(type==='capital'){building(x-35,y+42,32,32,'#c2ad85','#653b35');building(x+35,y+38,30,29,'#c0aa80','#653b35');ctx.fillStyle='#d8c89b';ctx.fillRect(x-4,y-38,8,33);}
      for(let i=0;i<3;i++)this.drawTree(ctx,x-58+i*56,y+52+i%2*7,.34+hash(seed*3+i)*.12);ctx.restore();
    }

    drawArmies(ctx){
      const state=this.getState()||{},byProvince=new Map();
      for(const army of(state.worldArmies||[]))byProvince.set(army.province,army);
      for(const t of this.data.territories){
        const army=byProvince.get(t.index)||t.army;if(!army||!army.size)continue;
        const lift=this.selectedIndex()===t.index?this.currentProgress()*18:0;
        const p=this.project(this.centers[t.index].x+this.cellW*.22,this.centers[t.index].y-this.cellH*.20,62+lift);
        this.drawArmy(ctx,p.x,p.y,army);
      }
    }

    drawArmy(ctx,x,y,army){
      const faction=this.data.factions[army.owner]||this.data.factions.neutral,count=clamp(Math.round(Math.log10(Math.max(10,army.size))*1.7),3,8);ctx.save();
      ctx.fillStyle='rgba(0,0,0,.32)';ctx.beginPath();ctx.ellipse(x,y+17,38,11,0,0,TAU);ctx.fill();
      for(let i=0;i<count;i++){const ox=(i-(count-1)/2)*10,oy=i%2*6;ctx.fillStyle=faction.line;ctx.beginPath();ctx.arc(x+ox,y+oy,7,0,TAU);ctx.fill();ctx.fillStyle=faction.fill;ctx.beginPath();ctx.arc(x+ox,y-7+oy,7,0,TAU);ctx.fill();}
      ctx.strokeStyle=faction.line;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x+28,y-8);ctx.lineTo(x+28,y+28);ctx.stroke();ctx.fillStyle=faction.fill;ctx.beginPath();ctx.moveTo(x+30,y-8);ctx.lineTo(x+48,y-2);ctx.lineTo(x+30,y+5);ctx.closePath();ctx.fill();ctx.restore();
    }

    drawSelection(ctx){
      const index=this.selectedIndex();if(index===null||index===undefined||!this.polygons[index])return;
      const lift=this.currentProgress()*18,p=this.polygons[index].map(v=>this.project(v.x,v.y,lift)),c=this.project(this.centers[index].x,this.centers[index].y,lift),pulse=1+Math.sin(performance.now()/240)*.045;ctx.save();
      ctx.strokeStyle='#f0d47a';ctx.lineWidth=10*pulse;ctx.globalAlpha=.86;ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);for(let i=1;i<p.length;i++)ctx.lineTo(p[i].x,p[i].y);ctx.closePath();ctx.stroke();
      ctx.strokeStyle='rgba(255,246,196,.55)';ctx.lineWidth=3;ctx.globalAlpha=.95;ctx.beginPath();ctx.arc(c.x,c.y,55+performance.now()%1000/18,0,TAU);ctx.stroke();ctx.restore();
    }

    drawActionMenu(ctx){
      const index=this.selectedIndex();if(index===null||index===undefined)return;const buttons=this.getActionLayout();if(!buttons.length)return;
      const progress=this.currentProgress(),selectedPoint=this.worldToScreenPoint(this.centers[index].x,this.centers[index].y,28*progress),baseRadius=Math.min(155,Math.max(104,Math.min(this.lastWidth,this.lastHeight)*.135)),hoverAction=this.hover&&this.hover.startsWith('a:')?this.hover.slice(2):null;
      ctx.save();ctx.globalAlpha=.36*progress;ctx.strokeStyle='rgba(240,212,122,.65)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(selectedPoint.x,selectedPoint.y,baseRadius*progress,0,TAU);ctx.stroke();ctx.restore();
      ctx.save();
      for(const button of buttons){
        const phase=button.angle+performance.now()/900+button.index*.1,drift=Math.sin(performance.now()/480+button.index)*2,bx=selectedPoint.x+Math.cos(button.angle)*baseRadius*progress,by=selectedPoint.y+Math.sin(button.angle)*baseRadius*progress+drift,active=hoverAction===button.id,startX=selectedPoint.x+Math.cos(button.angle)*36,startY=selectedPoint.y+Math.sin(button.angle)*36;
        ctx.strokeStyle=active?'rgba(244,222,135,.8)':'rgba(215,221,201,.32)';ctx.lineWidth=active?5:2;ctx.beginPath();ctx.moveTo(startX,startY);ctx.lineTo(bx,by);ctx.stroke();
        const r=button.radius+(active?4:0)+Math.sin(phase)*1.5;ctx.fillStyle=active?'#26392f':'rgba(16,23,20,.94)';ctx.strokeStyle=active?'#f0d47a':'rgba(191,203,187,.65)';ctx.lineWidth=active?3:2;ctx.beginPath();ctx.arc(bx,by,r,0,TAU);ctx.fill();ctx.stroke();
        ctx.fillStyle='#f0d47a';ctx.font='700 20px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(button.glyph,bx,by-5);ctx.fillStyle='#f1f4ef';ctx.font='600 11px system-ui';ctx.fillText(button.label,bx,by+14);
      }
      ctx.restore();
      if(progress>0.05){ctx.save();ctx.globalAlpha=.25*(1-progress);for(let i=0;i<8;i++){const a=TAU*i/8+performance.now()/1200,rr=28+(baseRadius-28)*progress*(.45+hash(i*8.3)*.4),p={x:selectedPoint.x+Math.cos(a)*rr,y:selectedPoint.y+Math.sin(a)*rr};ctx.fillStyle=i%2?'#f0d47a':'#d8e0cf';ctx.beginPath();ctx.arc(p.x,p.y,2.4,0,TAU);ctx.fill();}ctx.restore();}
    }

    drawResourceMarker(ctx,index,resource,lifted=0){
      const c=this.project(this.centers[index].x+this.cellW*.28,this.centers[index].y+this.cellH*.16,20+lifted),color=this.data.resources[resource]||'#aaa';ctx.save();ctx.fillStyle='rgba(24,28,25,.52)';ctx.beginPath();ctx.ellipse(c.x,c.y+14,26,9,0,0,TAU);ctx.fill();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=5;
      if(resource==='Food'){for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(c.x+i*8,c.y+7);ctx.lineTo(c.x+i*10,c.y-13);ctx.stroke();}}
      else if(resource==='Wood'){for(let i=0;i<3;i++){ctx.save();ctx.translate(c.x-16+i*15,c.y+3+i*2);ctx.rotate(-.25);ctx.fillRect(-8,-4,20,8);ctx.restore();}}
      else if(resource==='Stone'||resource==='Iron'){ctx.beginPath();ctx.moveTo(c.x-19,c.y+9);ctx.lineTo(c.x-9,c.y-10);ctx.lineTo(c.x+6,c.y-15);ctx.lineTo(c.x+20,c.y+7);ctx.lineTo(c.x+11,c.y+15);ctx.closePath();ctx.fill();if(resource==='Iron'){ctx.fillStyle='#c6c9c7';ctx.fillRect(c.x-6,c.y-2,12,7);}}
      else if(resource==='Oil'){ctx.beginPath();ctx.moveTo(c.x-17,c.y+9);ctx.lineTo(c.x,c.y-16);ctx.lineTo(c.x+17,c.y+9);ctx.stroke();ctx.fillRect(c.x-7,c.y+1,14,13);}
      else if(resource==='Mana'){ctx.beginPath();ctx.moveTo(c.x,c.y-20);ctx.lineTo(c.x+13,c.y-2);ctx.lineTo(c.x+7,c.y+16);ctx.lineTo(c.x-8,c.y+16);ctx.lineTo(c.x-14,c.y-2);ctx.closePath();ctx.fill();ctx.fillStyle='rgba(255,255,255,.42)';ctx.fillRect(c.x-2,c.y-11,4,17);}
      else if(resource==='Gold'){ctx.beginPath();ctx.arc(c.x-7,c.y+2,9,0,TAU);ctx.fill();ctx.beginPath();ctx.arc(c.x+7,c.y+8,8,0,TAU);ctx.fill();}
      ctx.restore();
    }

    drawTree(ctx,x,y,scale){ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.fillStyle='#5c472d';ctx.fillRect(-4,6,8,23);ctx.fillStyle='#33553a';ctx.beginPath();ctx.arc(0,-4,17,0,TAU);ctx.fill();ctx.beginPath();ctx.arc(-8,5,12,0,TAU);ctx.fill();ctx.beginPath();ctx.arc(9,7,13,0,TAU);ctx.fill();ctx.fillStyle='#4f7045';ctx.beginPath();ctx.arc(0,-12,11,0,TAU);ctx.fill();ctx.restore();}
    drawHill(ctx,x,y,scale){ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.fillStyle='rgba(78,91,61,.82)';ctx.beginPath();ctx.ellipse(0,0,52,25,0,0,TAU);ctx.fill();ctx.fillStyle='rgba(113,125,82,.72)';ctx.beginPath();ctx.ellipse(-12,-9,31,17,-.08,0,TAU);ctx.fill();ctx.restore();}

    destroy(){if(this.destroyed)return;this.destroyed=true;if(this.raf)cancelAnimationFrame(this.raf);this.canvas.removeEventListener('pointerdown',this.onPointerDown);this.canvas.removeEventListener('pointermove',this.onPointerMove);this.canvas.removeEventListener('pointerup',this.onPointerUp);this.canvas.removeEventListener('pointercancel',this.onPointerCancel);this.canvas.removeEventListener('wheel',this.onWheel);window.removeEventListener('resize',this.onResize);this.canvas.remove();}
  }

  window.AttritionWorldMap = AttritionWorldMap;
})();