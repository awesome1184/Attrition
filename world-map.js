(function () {
  const TAU = Math.PI * 2;

  function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return x - Math.floor(x);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
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

  function rgba(hex, alpha) {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  class AttritionWorldMap {
    constructor(options) {
      this.container = options.container;
      this.data = options.data || window.AttritionMapData;
      this.getState = options.getState || (() => ({}));
      this.onSelect = options.onSelect || (() => {});
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'attrition-world-canvas';
      this.canvas.setAttribute('aria-label', 'World map');
      this.canvas.style.display = 'block';
      this.canvas.style.position = 'absolute';
      this.canvas.style.inset = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.touchAction = 'none';
      this.container.style.position = 'relative';
      this.container.appendChild(this.canvas);

      this.camera = { x: -410, y: -120, zoom: 0.72 };
      this.pointer = { active: false, id: null, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false };
      this.polygons = [];
      this.centers = [];
      this.gridVertices = [];
      this.raf = 0;
      this.destroyed = false;
      this.lastWidth = 0;
      this.lastHeight = 0;

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
        const jitterX = edgeX ? 0 : (hash(key * 1.73) - 0.5) * cellW * 0.16;
        const jitterY = edgeY ? 0 : (hash(key * 2.31) - 0.5) * cellH * 0.14;
        return { x: mx + c * cellW + jitterX, y: my + r * cellH + jitterY };
      }));

      this.data.territories.forEach((territory, i) => {
        const a = this.gridVertices[territory.row][territory.col];
        const b = this.gridVertices[territory.row][territory.col + 1];
        const c = this.gridVertices[territory.row + 1][territory.col + 1];
        const d = this.gridVertices[territory.row + 1][territory.col];
        const inset = Math.min(cellW, cellH) * 0.012;
        const cx = (a.x + b.x + c.x + d.x) / 4;
        const cy = (a.y + b.y + c.y + d.y) / 4;
        const ratio = inset / Math.min(cellW, cellH);
        this.polygons[i] = [a, b, c, d].map((p) => ({
          x: lerp(p.x, cx, ratio),
          y: lerp(p.y, cy, ratio)
        }));
        this.centers[i] = { x: cx, y: cy };
      });
    }

    bind() {
      this.onPointerDown = (event) => {
        if (event.button !== 0 && event.pointerType !== 'touch') return;
        this.pointer.active = true;
        this.pointer.id = event.pointerId;
        this.pointer.startX = event.clientX;
        this.pointer.startY = event.clientY;
        this.pointer.lastX = event.clientX;
        this.pointer.lastY = event.clientY;
        this.pointer.moved = false;
        this.canvas.setPointerCapture(event.pointerId);
        this.container.classList.add('dragging');
      };

      this.onPointerMove = (event) => {
        if (!this.pointer.active || event.pointerId !== this.pointer.id) return;
        const dx = event.clientX - this.pointer.lastX;
        const dy = event.clientY - this.pointer.lastY;
        this.pointer.lastX = event.clientX;
        this.pointer.lastY = event.clientY;
        if (Math.hypot(event.clientX - this.pointer.startX, event.clientY - this.pointer.startY) > 5) this.pointer.moved = true;
        this.camera.x += dx;
        this.camera.y += dy;
        this.queueRender();
      };

      this.onPointerUp = (event) => {
        if (!this.pointer.active || event.pointerId !== this.pointer.id) return;
        const moved = this.pointer.moved;
        this.pointer.active = false;
        this.pointer.id = null;
        this.container.classList.remove('dragging');
        try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) {}
        if (!moved) {
          const world = this.screenToWorld(event.clientX, event.clientY);
          const hit = this.pick(world.x, world.y);
          if (hit !== null) this.onSelect(hit);
        }
      };

      this.onPointerCancel = () => {
        this.pointer.active = false;
        this.pointer.id = null;
        this.container.classList.remove('dragging');
      };

      this.onWheel = (event) => {
        event.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const before = this.screenToWorld(event.clientX, event.clientY);
        const factor = event.deltaY < 0 ? 1.12 : 0.89;
        this.camera.zoom = clamp(this.camera.zoom * factor, 0.42, 1.9);
        const after = this.screenToWorld(event.clientX, event.clientY);
        this.camera.x += (after.x - before.x) * this.camera.zoom;
        this.camera.y += (after.y - before.y) * this.camera.zoom;
        void rect;
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
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (width !== this.canvas.width || height !== this.canvas.height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
      }
      this.lastWidth = rect.width;
      this.lastHeight = rect.height;
      this.queueRender();
    }

    screenToWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - this.camera.x) / this.camera.zoom,
        y: (clientY - rect.top - this.camera.y) / this.camera.zoom
      };
    }

    pick(x, y) {
      let closest = null;
      let best = Infinity;
      for (let i = 0; i < this.polygons.length; i += 1) {
        if (pointInPolygon(x, y, this.polygons[i])) {
          const c = this.centers[i];
          const d = Math.hypot(x - c.x, y - c.y);
          if (d < best) {
            best = d;
            closest = i;
          }
        }
      }
      return closest;
    }

    queueRender() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render();
      });
    }

    refresh() {
      if (!this.destroyed) this.queueRender();
    }

    home() {
      const scale = Math.min((this.lastWidth - 36) / this.data.world.width, (this.lastHeight - 36) / this.data.world.height);
      this.camera.zoom = clamp(scale, 0.52, 0.82);
      this.camera.x = (this.lastWidth - this.data.world.width * this.camera.zoom) / 2;
      this.camera.y = (this.lastHeight - this.data.world.height * this.camera.zoom) / 2;
      this.queueRender();
    }

    zoomBy(factor) {
      const old = this.camera.zoom;
      const next = clamp(old * factor, 0.42, 1.9);
      const cx = this.lastWidth / 2;
      const cy = this.lastHeight / 2;
      this.camera.x = cx - (cx - this.camera.x) * (next / old);
      this.camera.y = cy - (cy - this.camera.y) * (next / old);
      this.camera.zoom = next;
      this.queueRender();
    }

    render() {
      if (this.destroyed || !this.canvas.width || !this.canvas.height) return;
      const ctx = this.canvas.getContext('2d');
      const dpr = this.canvas.width / Math.max(1, this.lastWidth);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(dpr * this.camera.zoom, 0, 0, dpr * this.camera.zoom, dpr * this.camera.x, dpr * this.camera.y);
      ctx.imageSmoothingEnabled = true;

      this.drawGround(ctx);
      this.drawWater(ctx);
      this.drawTerrain(ctx);
      this.drawRivers(ctx);
      this.drawRoads(ctx);
      this.drawTerritories(ctx);
      this.drawSettlements(ctx);
      this.drawArmies(ctx);
      this.drawSelection(ctx);
    }

    drawGround(ctx) {
      const w = this.data.world.width;
      const h = this.data.world.height;
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, '#738c60');
      gradient.addColorStop(0.48, '#71855d');
      gradient.addColorStop(1, '#687b54');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      ctx.globalAlpha = 0.11;
      for (let i = 0; i < 34; i += 1) {
        const x = 80 + hash(i * 9.17) * (w - 160);
        const y = 80 + hash(i * 13.41) * (h - 160);
        const rx = 100 + hash(i * 5.83) * 260;
        const ry = 60 + hash(i * 7.29) * 170;
        ctx.fillStyle = i % 2 ? '#a0aa70' : '#556b4c';
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, hash(i * 3.33) * TAU, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    drawWater(ctx) {
      const w = this.data.world.width;
      const h = this.data.world.height;
      ctx.fillStyle = '#3e697c';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, 170);
      ctx.bezierCurveTo(w - 340, 100, w - 520, 250, w - 800, 175);
      ctx.bezierCurveTo(w - 1080, 110, w - 1260, 225, w - 1510, 180);
      ctx.bezierCurveTo(900, 130, 640, 260, 420, 180);
      ctx.bezierCurveTo(250, 120, 150, 175, 0, 125);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#456f82';
      ctx.beginPath();
      ctx.moveTo(w, 1530);
      ctx.lineTo(w, h);
      ctx.lineTo(w - 370, h);
      ctx.bezierCurveTo(w - 300, h - 250, w - 420, h - 320, w - 330, h - 520);
      ctx.bezierCurveTo(w - 250, h - 710, w - 450, h - 780, w - 370, h - 930);
      ctx.bezierCurveTo(w - 300, h - 1060, w - 210, h - 1130, w, h - 1160);
      ctx.closePath();
      ctx.fill();
    }

    drawTerrain(ctx) {
      for (const t of this.data.territories) {
        const poly = this.polygons[t.index];
        const c = this.centers[t.index];
        ctx.save();
        this.pathPolygon(ctx, poly);
        ctx.clip();
        if (t.terrain === 'forest') {
          for (let i = 0; i < 18; i += 1) {
            const x = c.x - this.cellW * 0.43 + hash(t.index * 31 + i * 1.7) * this.cellW * 0.86;
            const y = c.y - this.cellH * 0.36 + hash(t.index * 41 + i * 2.1) * this.cellH * 0.72;
            this.drawTree(ctx, x, y, 0.6 + hash(t.index * 51 + i) * 0.45);
          }
        } else if (t.terrain === 'field') {
          ctx.strokeStyle = 'rgba(180,168,101,.35)';
          ctx.lineWidth = 7;
          for (let y = c.y - this.cellH * 0.22; y < c.y + this.cellH * 0.30; y += 24) {
            ctx.beginPath();
            ctx.moveTo(c.x - this.cellW * 0.42, y);
            ctx.lineTo(c.x + this.cellW * 0.38, y + 8);
            ctx.stroke();
          }
        } else if (t.terrain === 'hill') {
          ctx.fillStyle = 'rgba(112,101,71,.16)';
          for (let i = 0; i < 6; i += 1) {
            const x = c.x - this.cellW * 0.38 + hash(t.index * 17 + i) * this.cellW * 0.76;
            const y = c.y - this.cellH * 0.22 + hash(t.index * 23 + i) * this.cellH * 0.44;
            ctx.beginPath();
            ctx.ellipse(x, y, 80, 45, -0.12, 0, TAU);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }

    drawRivers(ctx) {
      ctx.strokeStyle = '#4f8aa0';
      ctx.lineCap = 'round';
      for (const river of this.data.rivers) {
        ctx.lineWidth = 22;
        ctx.beginPath();
        ctx.moveTo(river[0][0], river[0][1]);
        for (let i = 1; i < river.length; i += 1) ctx.lineTo(river[i][0], river[i][1]);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(132,190,202,.34)';
        ctx.lineWidth = 8;
        ctx.stroke();
        ctx.strokeStyle = '#4f8aa0';
      }
    }

    drawRoads(ctx) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(91,76,53,.34)';
      ctx.lineWidth = 23;
      for (const [a, b] of this.data.roadLinks) {
        const p = this.centers[a];
        const q = this.centers[b];
        if (!p || !q) continue;
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(mx + (hash(a * 9 + b) - 0.5) * 90, my + (hash(a * 13 + b) - 0.5) * 70, q.x, q.y);
        ctx.stroke();
      }
      ctx.strokeStyle = '#9e8e68';
      ctx.lineWidth = 13;
      for (const [a, b] of this.data.roadLinks) {
        const p = this.centers[a];
        const q = this.centers[b];
        if (!p || !q) continue;
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(mx + (hash(a * 9 + b) - 0.5) * 90, my + (hash(a * 13 + b) - 0.5) * 70, q.x, q.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawTerritories(ctx) {
      const state = this.getState() || {};
      const zoom = this.camera.zoom;
      this.data.territories.forEach((t, i) => {
        const owner = state.world && state.world[i] && state.world[i].owner ? state.world[i].owner : t.owner;
        const faction = this.data.factions[owner] || this.data.factions.neutral;
        const poly = this.polygons[i];
        ctx.fillStyle = rgba(faction.fill, owner === 'neutral' ? 0.045 : 0.13);
        this.pathPolygon(ctx, poly, true);
        ctx.fill();
        ctx.strokeStyle = owner === 'neutral' ? 'rgba(47,61,48,.26)' : rgba(faction.line, zoom > 0.9 ? 0.68 : 0.48);
        ctx.lineWidth = zoom > 1.05 ? 5 : 3;
        this.pathPolygon(ctx, poly, true);
        ctx.stroke();
        if (zoom > 0.88 && t.resource) this.drawResourceMarker(ctx, i, t.resource);
      });
    }

    drawResourceMarker(ctx, index, resource) {
      const c = this.centers[index];
      const color = this.data.resources[resource] || '#aaa';
      const x = c.x + this.cellW * 0.28;
      const y = c.y + this.cellH * 0.18;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = 'rgba(32,39,31,.65)';
      ctx.beginPath();
      ctx.ellipse(x, y + 18, 28, 10, 0, 0, TAU);
      ctx.fill();

      if (resource === 'Food') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        for (let i = -2; i <= 2; i += 1) {
          ctx.beginPath();
          ctx.moveTo(x + i * 9, y + 8);
          ctx.lineTo(x + i * 11, y - 12);
          ctx.stroke();
        }
      } else if (resource === 'Wood') {
        ctx.fillStyle = color;
        for (let i = 0; i < 3; i += 1) {
          ctx.save();
          ctx.translate(x - 18 + i * 17, y + 4 + i * 2);
          ctx.rotate(-0.22);
          ctx.fillRect(-9, -4, 22, 8);
          ctx.restore();
        }
      } else if (resource === 'Stone' || resource === 'Iron') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - 21, y + 9); ctx.lineTo(x - 10, y - 10); ctx.lineTo(x + 5, y - 15); ctx.lineTo(x + 22, y + 7); ctx.lineTo(x + 12, y + 15); ctx.closePath(); ctx.fill();
        if (resource === 'Iron') { ctx.fillStyle = '#a7b0b5'; ctx.fillRect(x - 6, y - 2, 14, 8); }
      } else if (resource === 'Oil') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x - 18, y + 12); ctx.lineTo(x, y - 18); ctx.lineTo(x + 18, y + 12); ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y); ctx.stroke();
        ctx.fillStyle = '#222'; ctx.fillRect(x - 8, y + 2, 16, 14);
      } else if (resource === 'Mana') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y - 22); ctx.lineTo(x + 13, y - 3); ctx.lineTo(x + 7, y + 18); ctx.lineTo(x - 9, y + 18); ctx.lineTo(x - 15, y - 3); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(235,222,255,.7)';
        ctx.fillRect(x - 3, y - 12, 5, 19);
      } else if (resource === 'Gold') {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x - 8, y + 3, 10, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 7, y + 9, 9, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    drawSettlements(ctx) {
      const state = this.getState() || {};
      for (const t of this.data.territories) {
        const runtime = state.world && state.world[t.index] ? state.world[t.index] : null;
        const owner = runtime?.owner || t.owner;
        const settlement = runtime?.settled === false ? null : (runtime?.settlement || t.settlement);
        const c = this.centers[t.index];
        if (settlement) this.drawSettlement(ctx, c.x, c.y - 26, settlement, owner, t.index);
      }
    }

    drawSettlement(ctx, x, y, type, owner, seed) {
      const faction = this.data.factions[owner] || this.data.factions.neutral;
      const accent = faction.line;
      ctx.save();
      ctx.fillStyle = 'rgba(48,42,32,.45)';
      ctx.beginPath(); ctx.ellipse(x, y + 74, 78, 20, 0, 0, TAU); ctx.fill();

      const building = (bx, by, bw, bh, wall, roof) => {
        ctx.fillStyle = wall;
        ctx.fillRect(bx - bw / 2, by - bh, bw, bh);
        ctx.fillStyle = roof;
        ctx.beginPath();
        ctx.moveTo(bx - bw / 2 - 4, by - bh);
        ctx.lineTo(bx, by - bh - 18);
        ctx.lineTo(bx + bw / 2 + 4, by - bh);
        ctx.closePath();
        ctx.fill();
      };

      const wall = type === 'capital' ? '#bca87e' : '#a99673';
      const roof = '#7f4339';
      building(x, y + 30, type === 'fort' ? 82 : 58, type === 'capital' ? 52 : 38, wall, roof);
      ctx.fillStyle = accent;
      ctx.fillRect(x - 3, y - 2, 7, 17);

      if (type === 'fort') {
        for (let i = -1; i <= 1; i += 1) building(x + i * 33, y + 52, 22, 48, '#888b85', '#686d68');
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.strokeRect(x - 60, y + 34, 120, 42);
      } else if (type === 'port') {
        ctx.fillStyle = '#8c7657';
        ctx.fillRect(x + 48, y + 25, 75, 12);
        ctx.fillStyle = '#4f8090';
        ctx.fillRect(x + 30, y + 37, 100, 26);
        ctx.fillStyle = '#6f4f34';
        ctx.fillRect(x + 92, y + 10, 6, 45);
      } else if (type === 'ruins') {
        ctx.fillStyle = '#777971';
        ctx.fillRect(x - 55, y + 28, 44, 30);
        ctx.fillRect(x + 10, y + 18, 52, 40);
        ctx.fillStyle = '#555951';
        ctx.fillRect(x - 48, y + 15, 12, 20);
        ctx.fillRect(x + 36, y + 2, 12, 22);
      } else if (type === 'village') {
        building(x - 37, y + 55, 34, 24, '#c0aa82', '#7f443b');
        building(x + 37, y + 58, 36, 27, '#b39e78', '#7f443b');
      } else if (type === 'capital') {
        building(x - 45, y + 60, 36, 42, '#bda984', '#6f3c35');
        building(x + 45, y + 56, 34, 38, '#b8a47e', '#6f3c35');
        ctx.fillStyle = '#d8c89c';
        ctx.fillRect(x - 5, y - 42, 10, 34);
      }

      ctx.fillStyle = '#61714f';
      for (let i = 0; i < 4; i += 1) this.drawTree(ctx, x - 72 + i * 50, y + 78 + (i % 2) * 8, 0.42 + hash(seed * 3 + i) * 0.15);
      ctx.restore();
    }

    drawArmies(ctx) {
      const state = this.getState() || {};
      const byProvince = new Map();
      for (const army of (state.worldArmies || [])) byProvince.set(army.province, army);
      for (const t of this.data.territories) {
        const army = byProvince.get(t.index) || t.army;
        if (!army || !army.size) continue;
        const c = this.centers[t.index];
        this.drawArmy(ctx, c.x + this.cellW * 0.23, c.y - this.cellH * 0.18, army);
      }
    }

    drawArmy(ctx, x, y, army) {
      const faction = this.data.factions[army.owner] || this.data.factions.neutral;
      const count = clamp(Math.round(Math.log10(Math.max(10, army.size)) * 1.8), 3, 8);
      ctx.save();
      ctx.fillStyle = 'rgba(28,32,27,.58)';
      ctx.beginPath(); ctx.ellipse(x, y + 20, 42, 14, 0, 0, TAU); ctx.fill();
      for (let i = 0; i < count; i += 1) {
        const ox = (i - (count - 1) / 2) * 11;
        const oy = (i % 2) * 7;
        ctx.fillStyle = faction.line;
        ctx.beginPath(); ctx.arc(x + ox, y + oy, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = faction.fill;
        ctx.beginPath(); ctx.arc(x + ox, y - 7 + oy, 7, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = faction.line;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x + 33, y - 6); ctx.lineTo(x + 33, y + 31); ctx.stroke();
      ctx.fillStyle = faction.fill;
      ctx.beginPath(); ctx.moveTo(x + 35, y - 6); ctx.lineTo(x + 56, y); ctx.lineTo(x + 35, y + 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    drawSelection(ctx) {
      const state = this.getState() || {};
      const selected = state.selected;
      if (selected === null || selected === undefined || !this.polygons[selected]) return;
      ctx.save();
      ctx.strokeStyle = '#f0cc67';
      ctx.lineWidth = 9;
      ctx.globalAlpha = 0.9;
      this.pathPolygon(ctx, this.polygons[selected], true);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,245,190,.62)';
      ctx.lineWidth = 3;
      this.pathPolygon(ctx, this.polygons[selected], true);
      ctx.stroke();
      ctx.restore();
    }

    drawTree(ctx, x, y, scale) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.fillStyle = '#5b472d';
      ctx.fillRect(-5, 8, 10, 28);
      ctx.fillStyle = '#355839';
      ctx.beginPath(); ctx.arc(0, -3, 20, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-9, 7, 14, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(10, 8, 15, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4c7041';
      ctx.beginPath(); ctx.arc(0, -13, 13, 0, TAU); ctx.fill();
      ctx.restore();
    }

    pathPolygon(ctx, poly, close = false) {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i += 1) ctx.lineTo(poly[i].x, poly[i].y);
      if (close) ctx.closePath();
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.canvas.removeEventListener('pointerup', this.onPointerUp);
      this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
      this.canvas.removeEventListener('wheel', this.onWheel);
      window.removeEventListener('resize', this.onResize);
      this.canvas.remove();
    }
  }

  window.AttritionWorldMap = AttritionWorldMap;
})();