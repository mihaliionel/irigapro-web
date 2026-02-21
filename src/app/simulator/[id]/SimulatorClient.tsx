'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { DbProject, DbSprinklerModel, PlacedSprinkler, Pipe, Point, Circuit, ManualPipe } from '@/types';

interface Props {
  project:     DbProject;
  sprinklerDb: DbSprinklerModel[];
  isOwner:     boolean;
}

// ── Geometry helpers ─────────────────────────────────────────
function pip(pt: Point, poly: {x:number,y:number}[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length-1; i < poly.length; j = i++) {
    const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    if (((yi>pt.y)!==(yj>pt.y)) && (pt.x < (xj-xi)*(pt.y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function bbox(pts: {x:number,y:number}[]) {
  return {
    minX:Math.min(...pts.map(p=>p.x)), maxX:Math.max(...pts.map(p=>p.x)),
    minY:Math.min(...pts.map(p=>p.y)), maxY:Math.max(...pts.map(p=>p.y)),
  };
}
function polyArea(pts: {x:number,y:number}[]): number {
  let a=0; for(let i=0,j=pts.length-1;i<pts.length;j=i++) a+=pts[j].x*pts[i].y-pts[i].x*pts[j].y;
  return Math.abs(a/2);
}

// ── MST (Prim's algorithm) ───────────────────────────────────
function buildMST(nodes: {x:number,y:number}[], circIdx: number, type0: 'main'|'branch'): Pipe[] {
  if (nodes.length < 2) return [];
  const visited = new Set([0]);
  const edges: Pipe[] = [];
  while (visited.size < nodes.length) {
    let best: Pipe|null = null, bestD = Infinity;
    visited.forEach(vi => {
      nodes.forEach((n, j) => {
        if (visited.has(j)) return;
        const d = Math.hypot(nodes[vi].x - n.x, nodes[vi].y - n.y);
        if (d < bestD) {
          bestD = d;
          best = { from: nodes[vi], to: n, type: vi===0 ? type0 : 'branch', circIdx, lengthM: d };
        }
      });
    });
    if (!best) break;
    edges.push(best); visited.add(nodes.findIndex(n => n===((best as Pipe).to)));
  }
  return edges;
}

export default function SimulatorClient({ project, sprinklerDb, isOwner }: Props) {
  const router  = useRouter();
  const cvRef   = useRef<HTMLCanvasElement>(null);
  const wRef    = useRef<HTMLCanvasElement>(null); // wet layer
  const animRef = useRef<number|null>(null);

  // ── Transform state ─────────────────────────────────────────
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 600 });
  const m2px  = useRef(1);
  const ox    = useRef(0);
  const oy    = useRef(0);

  // ── App state ────────────────────────────────────────────────
  const [polygon,     setPolygon]     = useState<{x:number,y:number}[]>([]);
  const [polyM,       setPolyM]       = useState<Point[]>(project.polygon ?? []);
  const [polyClosed,  setPolyClosed]  = useState(project.polygon?.length >= 3);
  const [sprinklers,  setSprinklers]  = useState<PlacedSprinkler[]>(
    (project.sprinklers as PlacedSprinkler[]) ?? []
  );
  const [pipes,       setPipes]       = useState<Pipe[]>([]);
  const [manualPipes, setManualPipes] = useState<ManualPipe[]>([]);
  const [pipeMode,    setPipeMode]    = useState<'auto'|'manual'>('auto');
  const [mode,        setMode]        = useState<'draw'|'add'|'move'|'delete'|'pipe'>('add');
  const [selCirc,     setSelCirc]     = useState(0);
  const [curRadius,   setCurRadius]   = useState(6);
  const [selSp,       setSelSp]       = useState('');
  const [hovSp,       setHovSp]       = useState<number|null>(null);
  const [dragging,    setDragging]    = useState<{i:number,ox:number,oy:number}|null>(null);
  const [animOn,      setAnimOn]      = useState(false);
  const [activeCircs, setActiveCircs] = useState<Set<number>>(new Set());
  const [speed,       setSpeed]       = useState(1);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [activeTab,   setActiveTab]   = useState<'sim'|'pipes'|'report'>('sim');
  const [msg,         setMsg]         = useState('Apasă "⚡ Plasează automat" sau adaugă aspersoare manual');
  const [pipePts,     setPipePts]     = useState<{x:number,y:number}[]>([]);

  // Refs for animation
  const sprRef    = useRef(sprinklers);
  const circRef   = useRef(project.circuits);
  const animT0    = useRef<number|null>(null);
  const lastSecT  = useRef<number|null>(null);
  const totalSec  = useRef(0);
  const particles = useRef<any[]>([]);

  useEffect(() => { sprRef.current = sprinklers; }, [sprinklers]);

  // ── Scale computation ────────────────────────────────────────
  const computeScale = useCallback((w: number, h: number) => {
    const L = project.length_m, W = project.width_m;
    const sx = (w * 0.78) / Math.max(L, 0.1);
    const sy = (h * 0.80) / Math.max(W, 0.1);
    m2px.current = Math.min(sx, sy);
    ox.current = (w - L * m2px.current) / 2;
    oy.current = (h - W * m2px.current) / 2;
  }, [project.length_m, project.width_m]);

  function toCanvas(xm: number, ym: number) {
    return { x: ox.current + xm * m2px.current, y: oy.current + ym * m2px.current };
  }
  function toMeters(xc: number, yc: number): Point {
    return { x: (xc - ox.current) / m2px.current, y: (yc - oy.current) / m2px.current };
  }

  // ── Resize observer ──────────────────────────────────────────
  useEffect(() => {
    const el = cvRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      const h = e.contentRect.height;
      setCanvasSize({ w, h });
      computeScale(w, h);
    });
    ro.observe(el);
    computeScale(el.clientWidth, el.clientHeight);
    setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [computeScale]);

  // ── Sync polygon canvas↔meters ───────────────────────────────
  useEffect(() => {
    setPolygon(polyM.map(p => toCanvas(p.x, p.y)));
  }, [polyM, canvasSize]);

  // Also sync sprinkler canvas positions when scale changes
  useEffect(() => {
    setSprinklers(prev => prev.map(s => {
      const c = toCanvas(s.xm, s.ym);
      return { ...s, x: c.x, y: c.y };
    }));
  }, [canvasSize]);

  // ── Pipe calculation ─────────────────────────────────────────
  const calcPipes = useCallback((sps: PlacedSprinkler[]) => {
    if (pipeMode === 'manual' || sps.length === 0) { setPipes([]); return; }
    const centX = polygon.reduce((s,p)=>s+p.x,0)/Math.max(polygon.length,1);
    const centY = polygon.reduce((s,p)=>s+p.y,0)/Math.max(polygon.length,1);
    const centM = toMeters(centX, centY);
    const allPipes: Pipe[] = [];
    project.circuits.forEach((_, ci) => {
      const group = sps.filter(s => s.circIdx === ci);
      if (!group.length) return;
      const nodes = [centM, ...group.map(s=>({x:s.xm, y:s.ym}))];
      allPipes.push(...buildMST(nodes, ci, 'main'));
    });
    setPipes(allPipes);
  }, [pipeMode, polygon, project.circuits]);

  // ── Draw ─────────────────────────────────────────────────────
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const { w, h } = canvasSize;
    ctx.clearRect(0, 0, w, h);
    drawGrid(ctx, w, h);
    if (polygon.length > 0) drawPoly(ctx);
    drawPipesLayer(ctx);
    drawSprinklersLayer(ctx);
  }, [polygon, polyClosed, sprinklers, pipes, manualPipes, hovSp, canvasSize, animOn]);

  function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.save();
    const step = m2px.current;
    if (step < 6) { ctx.restore(); return; }
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
    for (let x = ox.current % step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for (let y = oy.current % step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    ctx.restore();
  }

  function drawPoly(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.beginPath();
    polygon.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
    if (polyClosed) {
      ctx.closePath();
      const bb = bbox(polygon);
      const gr = ctx.createLinearGradient(0, bb.minY, 0, bb.maxY);
      gr.addColorStop(0, 'rgba(46,125,50,0.7)'); gr.addColorStop(1, 'rgba(27,94,32,0.7)');
      ctx.fillStyle = gr; ctx.fill();
      ctx.strokeStyle = '#5cb85c'; ctx.lineWidth = 2; ctx.stroke();
      // Dimension labels
      const centX = (bb.minX+bb.maxX)/2, centY = (bb.minY+bb.maxY)/2;
      const wM = ((bb.maxX-bb.minX)/m2px.current).toFixed(1);
      const hM = ((bb.maxY-bb.minY)/m2px.current).toFixed(1);
      ctx.fillStyle = 'rgba(168,216,170,0.7)'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${wM}m`, centX, bb.minY - 8);
      ctx.save(); ctx.translate(bb.minX - 14, centY); ctx.rotate(-Math.PI/2);
      ctx.fillText(`${hM}m`, 0, 0); ctx.restore();
    } else {
      ctx.strokeStyle = 'rgba(92,184,92,0.5)'; ctx.lineWidth = 2;
      ctx.setLineDash([8,5]); ctx.stroke(); ctx.setLineDash([]);
    }
    polygon.forEach((p,i) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2);
      ctx.fillStyle = i===0 && polygon.length>2 ? '#FF9800' : '#5cb85c';
      ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    });
    ctx.restore();
  }

  function drawPipesLayer(ctx: CanvasRenderingContext2D) {
    if (activeTab === 'sim') return;
    pipes.forEach(p => {
      const circ = project.circuits[p.circIdx];
      const color = p.type==='main' ? '#f0c040' : (circ?.color ?? '#e07020');
      const from = toCanvas(p.from.x, p.from.y);
      const to   = toCanvas(p.to.x,   p.to.y);
      ctx.save();
      ctx.strokeStyle = color + 'aa'; ctx.lineWidth = p.type==='main' ? 3 : 2;
      ctx.setLineDash(p.type==='main' ? [] : [5,3]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      ctx.setLineDash([]);
      if (p.lengthM > 0.5) {
        const mx = (from.x+to.x)/2, my = (from.y+to.y)/2;
        ctx.fillStyle = 'rgba(200,240,160,0.7)'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
        ctx.fillText(p.lengthM.toFixed(1)+'m', mx, my-4);
      }
      ctx.restore();
    });
    // Supply point
    if (pipes.length > 0) {
      const cx = polygon.reduce((s,p)=>s+p.x,0)/Math.max(polygon.length,1);
      const cy = polygon.reduce((s,p)=>s+p.y,0)/Math.max(polygon.length,1);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI*2);
      ctx.fillStyle = '#f0c040'; ctx.fill();
      ctx.strokeStyle = 'white'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }
  }

  function drawSprinklersLayer(ctx: CanvasRenderingContext2D) {
    sprinklers.forEach((sp, i) => {
      const circ = project.circuits[sp.circIdx];
      if (!circ) return;
      const r = sp.radius * m2px.current;
      const isHov = hovSp === i;
      // Coverage arc (static)
      if (!animOn) {
        const span = ((sp.endA - sp.startA) + 360) % 360 || 360;
        ctx.save();
        ctx.beginPath(); ctx.moveTo(sp.x, sp.y);
        ctx.arc(sp.x, sp.y, r, sp.startA*Math.PI/180, (sp.startA+span)*Math.PI/180);
        ctx.closePath();
        ctx.fillStyle = circ.color + '22'; ctx.fill();
        ctx.strokeStyle = circ.color + '55'; ctx.lineWidth = 1;
        ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();
      }
      // Head
      const sz = isHov ? 12 : 9;
      ctx.save();
      ctx.beginPath(); ctx.arc(sp.x, sp.y, sz, 0, Math.PI*2);
      ctx.fillStyle = '#0a1f0a'; ctx.fill();
      ctx.strokeStyle = circ.color; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(sp.x, sp.y, sz/2.5, 0, Math.PI*2);
      ctx.fillStyle = circ.color; ctx.fill();
      ctx.fillStyle = 'rgba(168,216,170,0.9)'; ctx.font = `bold ${isHov?10:9}px monospace`;
      ctx.textAlign = 'center'; ctx.fillText(`S${i+1}`, sp.x, sp.y-(sz+5));
      ctx.restore();
    });
  }

  // ── Animation loop ───────────────────────────────────────────
  useEffect(() => {
    if (!animOn) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      wRef.current?.getContext('2d')?.clearRect(0,0,canvasSize.w,canvasSize.h);
      return;
    }
    const cv  = cvRef.current!;
    const wCv = wRef.current!;
    const ctx = cv.getContext('2d')!;
    const wCtx = wCv.getContext('2d')!;
    animT0.current = null; lastSecT.current = null; totalSec.current = 0;

    function frame(ts: number) {
      if (!animT0.current) animT0.current = ts;
      ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
      drawGrid(ctx, canvasSize.w, canvasSize.h);
      if (polygon.length > 0) drawPoly(ctx);
      drawPipesLayer(ctx);
      drawSprinklersLayer(ctx);

      sprRef.current.forEach((sp) => {
        if (!activeCircs.has(sp.circIdx)) return;
        const circ = circRef.current[sp.circIdx];
        if (!circ) return;
        const span = ((sp.endA - sp.startA) + 360) % 360 || 360;
        const period = (span<=100 ? 10000 : span<=200 ? 18000 : 25000) / speed;
        const t = ((ts - animT0.current! + sp.phase * period) % period) / period;
        let frac = t < 0.85
          ? (t/0.85 < 0.08 ? 0.5*(t/0.85/0.08)**2*0.12 : t/0.85 > 0.9 ? 0.88+0.12*(1-(1-(t/0.85-0.9)/0.1)**2) : 0.06+(t/0.85-0.08)/0.82*0.82)
          : Math.max(1-((t-0.85)/0.15)**3, 0);
        frac = Math.min(Math.max(frac, 0), 1);
        const r = sp.radius * m2px.current;
        const a1r = sp.startA*Math.PI/180;
        const a2r = (sp.startA + span*frac)*Math.PI/180;
        const gr = ctx.createRadialGradient(sp.x,sp.y,0,sp.x,sp.y,r);
        gr.addColorStop(0, circ.color+'cc'); gr.addColorStop(0.4, circ.color+'77');
        gr.addColorStop(0.8, circ.color+'33'); gr.addColorStop(1, circ.color+'00');
        ctx.save(); ctx.beginPath(); ctx.moveTo(sp.x,sp.y); ctx.arc(sp.x,sp.y,r,a1r,a2r);
        ctx.closePath(); ctx.clip(); ctx.fillStyle=gr; ctx.fill(); ctx.restore();
        // Needle
        const na = (sp.startA + span*frac)*Math.PI/180;
        ctx.save(); ctx.strokeStyle=circ.color; ctx.lineWidth=2; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(sp.x,sp.y); ctx.lineTo(sp.x+11*Math.cos(na),sp.y+11*Math.sin(na));
        ctx.stroke(); ctx.restore();
        // Wet paint
        if (frac > 0.04) {
          wCtx.save(); wCtx.beginPath(); wCtx.moveTo(sp.x,sp.y);
          wCtx.arc(sp.x,sp.y,r*frac,a1r,a2r); wCtx.closePath();
          wCtx.fillStyle='rgba(10,60,8,0.012)'; wCtx.fill(); wCtx.restore();
        }
      });

      // Timer update
      if (!lastSecT.current) lastSecT.current = ts;
      if (ts - lastSecT.current >= 1000/speed) {
        totalSec.current++; lastSecT.current = ts;
      }

      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [animOn, activeCircs, speed, canvasSize, polygon, polyClosed]);

  // ── Canvas events ────────────────────────────────────────────
  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const x = e.nativeEvent.offsetX, y = e.nativeEvent.offsetY;
    if (mode === 'draw') {
      if (polyClosed) return;
      if (polygon.length > 2 && Math.hypot(x-polygon[0].x, y-polygon[0].y) < 15) {
        setPolyClosed(true);
        const newPolyM = polygon.map(p => toMeters(p.x, p.y));
        setPolyM(newPolyM);
        setMode('add');
        setMsg('Curtea a fost definită. Plasează aspersoare!');
      } else {
        setPolygon(prev => [...prev, {x, y}]);
      }
    } else if (mode === 'add') {
      if (!polyClosed) { setMsg('Desenează mai întâi curtea!'); return; }
      const m = toMeters(x, y);
      if (!pip(m, polyM)) return;
      const bb = bbox(polygon);
      const r  = curRadius * m2px.current;
      const mg = r * 0.45;
      const L2 = x < bb.minX+mg, R2 = x > bb.maxX-mg, T2 = y < bb.minY+mg, B2 = y > bb.maxY-mg;
      const sa = L2&&T2?0:R2&&T2?90:R2&&B2?180:L2&&B2?270:T2?0:B2?180:L2?270:R2?90:0;
      const ea = L2&&T2?90:R2&&T2?180:R2&&B2?270:L2&&B2?360:T2?180:B2?360:L2?450:R2?270:360;
      const newSp: PlacedSprinkler = {
        id: sprinklers.length, x, y, xm: m.x, ym: m.y,
        radius: curRadius, circIdx: selCirc, startA: sa, endA: ea, phase: Math.random(),
      };
      const updated = [...sprinklers, newSp];
      setSprinklers(updated); calcPipes(updated);
    } else if (mode === 'delete') {
      const i = nearSp(x, y);
      if (i !== null) { const u = sprinklers.filter((_,idx)=>idx!==i); setSprinklers(u); calcPipes(u); }
    }
  }

  function handleDblClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const x = e.nativeEvent.offsetX, y = e.nativeEvent.offsetY;
    if (mode==='draw' && !polyClosed && polygon.length > 2) {
      setPolyClosed(true);
      setPolyM(polygon.map(p => toMeters(p.x, p.y)));
      setMode('add');
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mode !== 'move') return;
    const i = nearSp(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    if (i !== null) setDragging({ i, ox: e.nativeEvent.offsetX - sprinklers[i].x, oy: e.nativeEvent.offsetY - sprinklers[i].y });
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const x = e.nativeEvent.offsetX, y = e.nativeEvent.offsetY;
    if (dragging && mode==='move') {
      const nx = x - dragging.ox, ny = y - dragging.oy;
      const m  = toMeters(nx, ny);
      setSprinklers(prev => {
        const u = [...prev];
        u[dragging.i] = { ...u[dragging.i], x: nx, y: ny, xm: m.x, ym: m.y };
        return u;
      });
      return;
    }
    const i = nearSp(x, y);
    if (i !== hovSp) setHovSp(i);
  }

  function handleMouseUp() {
    if (dragging) { calcPipes(sprinklers); setDragging(null); }
  }

  function nearSp(px: number, py: number, maxD = 18): number | null {
    let best: number|null = null, bD = Infinity;
    sprinklers.forEach((s, i) => {
      const d = Math.hypot(px-s.x, py-s.y);
      if (d < maxD && d < bD) { bD = d; best = i; }
    });
    return best;
  }

  // ── Auto place ───────────────────────────────────────────────
  function autoPlace() {
    if (!polyClosed || polygon.length < 3) { setMsg('Desenează mai întâi curtea!'); return; }
    const r   = curRadius * m2px.current;
    const bb  = bbox(polygon);
    const step = r;
    let id = 0;
    const placed: PlacedSprinkler[] = [];
    for (let y = bb.minY + r; y <= bb.maxY; y += step) {
      for (let x = bb.minX + r; x <= bb.maxX; x += step) {
        const m = toMeters(x, y);
        if (!pip(m, polyM)) continue;
        const mg = r*0.45;
        const L2=x<bb.minX+mg,R2=x>bb.maxX-mg,T2=y<bb.minY+mg,B2=y>bb.maxY-mg;
        const sa=L2&&T2?0:R2&&T2?90:R2&&B2?180:L2&&B2?270:T2?0:B2?180:L2?270:R2?90:0;
        const ea=L2&&T2?90:R2&&T2?180:R2&&B2?270:L2&&B2?360:T2?180:B2?360:L2?450:R2?270:360;
        placed.push({ id:id++, x, y, xm:m.x, ym:m.y, radius:curRadius, circIdx:id%project.circuits.length, startA:sa, endA:ea, phase:Math.random() });
      }
    }
    setSprinklers(placed); calcPipes(placed);
    setMsg(`✅ ${placed.length} aspersoare plasate automat`);
  }

  // ── Save ─────────────────────────────────────────────────────
  async function saveProject() {
    setSaving(true);
    const sb = createClient();
    const areaM2 = polyClosed && polyM.length > 2 ? polyArea(polyM) : null;
    await sb.from('projects').update({
      polygon:    polyM,
      sprinklers: sprinklers.map(s => ({ ...s, x: undefined, y: undefined })), // save meters only
      pipes:      pipes,
      area_m2:    areaM2,
    }).eq('id', project.id);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const pipeLen = pipes.reduce((s,p) => s+p.lengthM, 0);
  const areaM2  = polyClosed && polyM.length > 2 ? polyArea(polyM) : 0;

  return (
    <div className="h-screen flex flex-col bg-green-950 overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-green-900 flex-shrink-0 flex-wrap">
        <Link href="/dashboard" className="text-green-600 hover:text-green-300 text-sm flex items-center gap-1">
          ← Dashboard
        </Link>
        <span className="text-green-800">|</span>
        <span className="text-green-200 font-semibold text-sm truncate max-w-[180px]">{project.name}</span>
        {project.location && <span className="text-green-700 text-xs hidden md:block">📍 {project.location}</span>}

        {/* Tabs */}
        <div className="flex gap-1 ml-2">
          {(['sim','pipes','report'] as const).map((t,i) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`text-xs px-3 py-1 rounded-md border transition-all
                ${activeTab===t ? 'bg-green-800 border-green-600 text-green-200' : 'border-green-900 text-green-600 hover:border-green-700'}`}>
              {['🌊 Simulare','🔧 Trasee','📋 Raport'][i]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isOwner && (
            <button onClick={saveProject} disabled={saving}
              className={`text-xs px-4 py-1.5 rounded-lg border transition-all
                ${saved ? 'bg-green-700 border-green-500 text-green-100' : 'btn-ghost'}`}>
              {saving ? 'Se salvează...' : saved ? '✓ Salvat!' : '💾 Salvează'}
            </button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 flex-shrink-0 border-r border-green-900 overflow-y-auto bg-green-950 p-3 flex flex-col gap-3">

          {/* Forma curte */}
          <SbCard title="📐 Formă curte">
            <SbBtn onClick={() => { setMode('draw'); setPolyClosed(false); setPolygon([]); setMsg('Click = punct · Dublu-click = închide'); }} active={mode==='draw'}>✏️ Redesenează</SbBtn>
            <SbBtn onClick={() => { setPolyM(project.polygon); setPolyClosed(true); setMsg('Formă din proiect restaurată'); }}>↩ Reset formă</SbBtn>
          </SbCard>

          {/* Aspersor */}
          <SbCard title="💧 Aspersor">
            <select value={selSp} onChange={e => { setSelSp(e.target.value); const [br,mo] = e.target.value.split('|'); const s = sprinklerDb.find(x=>x.brand===br&&x.model===mo); if(s) setCurRadius((s.rmin+s.rmax)/2||6); }}
              className="w-full bg-green-950 border border-green-800 rounded-md px-2 py-1.5 text-xs text-green-200 mb-2">
              <option value="">— selectează model —</option>
              {Object.entries(
                sprinklerDb.reduce((g,s) => { (g[s.brand]??=[]).push(s); return g; }, {} as Record<string,typeof sprinklerDb>)
              ).map(([brand, items]) => (
                <optgroup key={brand} label={brand}>
                  {items.map(s => (
                    <option key={s.id} value={`${s.brand}|${s.model}`}>
                      {s.model} ({s.rmin}–{s.rmax}m)
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-green-600 w-16 flex-shrink-0">Raza (m)</span>
              <input type="range" min={0.5} max={15} step={0.5} value={curRadius}
                onChange={e => setCurRadius(+e.target.value)}
                className="flex-1 h-1 bg-green-800 rounded appearance-none" />
              <span className="text-green-300 font-mono w-8 text-right">{curRadius}m</span>
            </div>
          </SbCard>

          {/* Plasare */}
          <SbCard title="⚡ Plasare">
            <SbBtn onClick={autoPlace}>⚡ Automat S→S</SbBtn>
            <SbBtn onClick={() => setMode('add')} active={mode==='add'}>➕ Manual</SbBtn>
            <SbBtn onClick={() => setMode('move')} active={mode==='move'}>✋ Mută</SbBtn>
            <SbBtn onClick={() => setMode('delete')} active={mode==='delete'} danger>❌ Șterge</SbBtn>
          </SbCard>

          {/* Trasee */}
          <SbCard title="🔧 Trasee">
            <div className="flex gap-1 mb-2">
              {(['auto','manual'] as const).map(m => (
                <button key={m} onClick={() => setPipeMode(m)}
                  className={`flex-1 text-xs py-1 rounded border transition-all
                    ${pipeMode===m ? 'bg-green-800 border-green-600 text-green-200' : 'border-green-900 text-green-600'}`}>
                  {m==='auto' ? '⚡ Auto' : '✋ Manual'}
                </button>
              ))}
            </div>
            <SbBtn onClick={() => calcPipes(sprinklers)}>🔄 Recalculează</SbBtn>
            <SbBtn onClick={() => setPipes([])} danger>🗑 Șterge trasee</SbBtn>
          </SbCard>

          {/* Circuite */}
          <SbCard title="⚡ Circuite">
            {project.circuits.map((c, i) => (
              <div key={c.id} onClick={() => setSelCirc(i)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all text-xs
                  ${selCirc===i ? 'bg-green-800 border border-green-600' : 'hover:bg-green-900 border border-transparent'}`}>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{background:c.color,boxShadow:`0 0 5px ${c.color}`}} />
                <span className="flex-1 truncate text-green-200">{c.name}</span>
              </div>
            ))}
          </SbCard>

          {/* Animație */}
          <SbCard title="▶ Simulare">
            {!animOn
              ? <SbBtn onClick={() => { setAnimOn(true); setActiveCircs(new Set(project.circuits.map((_,i)=>i))); }}>▶ Toate</SbBtn>
              : <SbBtn onClick={() => setAnimOn(false)} danger>⏹ Stop</SbBtn>
            }
            {project.circuits.map((c,i) => (
              <SbBtn key={c.id} onClick={() => { setAnimOn(true); setActiveCircs(new Set([i])); }}
                style={{borderLeft:`3px solid ${c.color}`}}>
                ▶ {c.name}
              </SbBtn>
            ))}
            <div className="flex items-center gap-2 text-xs mt-1">
              <span className="text-green-600 w-14">Viteză</span>
              <input type="range" min={0.3} max={4} step={0.1} value={speed}
                onChange={e=>setSpeed(+e.target.value)}
                className="flex-1 h-1 bg-green-800 rounded appearance-none" />
              <span className="text-green-300 font-mono w-8 text-right">{speed.toFixed(1)}×</span>
            </div>
          </SbCard>

          {/* Info */}
          <SbCard title="ℹ Info">
            {[
              ['Suprafață', areaM2>0 ? areaM2.toFixed(1)+' m²' : '—'],
              ['Aspersoare', sprinklers.length],
              ['Țeavă', pipeLen>0 ? pipeLen.toFixed(1)+'m' : '—'],
              ['Circuite', project.circuits.length],
            ].map(([l,v]) => (
              <div key={String(l)} className="flex justify-between text-xs py-0.5 border-b border-green-900">
                <span className="text-green-600">{l}</span>
                <span className="text-green-300 font-mono">{v}</span>
              </div>
            ))}
          </SbCard>

        </aside>

        {/* Canvas area */}
        <div className="flex-1 relative overflow-hidden">
          <canvas ref={wRef}
            width={canvasSize.w} height={canvasSize.h}
            className="absolute inset-0 pointer-events-none" />
          <canvas ref={cvRef}
            width={canvasSize.w} height={canvasSize.h}
            className="absolute inset-0"
            style={{ cursor: mode==='move' ? (dragging ? 'grabbing' : 'grab') : mode==='delete' ? 'not-allowed' : mode==='draw' ? 'crosshair' : 'cell' }}
            onClick={handleClick}
            onDoubleClick={handleDblClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { handleMouseUp(); setHovSp(null); }}
          />
          {/* Mode label */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-green-950/85 border border-green-800 rounded-full px-4 py-1 text-xs text-green-500 pointer-events-none backdrop-blur-sm">
            {msg}
          </div>
          {/* Pipe legend for pipes tab */}
          {activeTab==='pipes' && (
            <div className="absolute bottom-3 right-3 bg-green-950/90 border border-green-800 rounded-lg p-3 text-xs space-y-1.5 backdrop-blur-sm">
              <div className="flex items-center gap-2"><div className="w-5 h-0.5 bg-yellow-400"/><span className="text-green-400">Conductă principală PE32</span></div>
              <div className="flex items-center gap-2"><div className="w-5 h-0.5 bg-orange-500"/><span className="text-green-400">Circuit aspersor PE25</span></div>
              <div className="flex items-center gap-2"><div className="w-5 h-0.5 bg-cyan-400"/><span className="text-green-400">Picurare PE16</span></div>
            </div>
          )}
        </div>
      </div>

      {/* Dashboard bar */}
      <div className="border-t border-green-900 px-4 py-2 flex items-center gap-6 text-xs bg-green-950 flex-shrink-0">
        {[
          ['Aspersoare', sprinklers.length, ''],
          ['Suprafață', areaM2>0?areaM2.toFixed(0):'—', 'm²'],
          ['Țeavă', pipeLen>0?pipeLen.toFixed(1):'—', 'm'],
          ['Circuit activ', selCirc>=0?project.circuits[selCirc]?.name:'—', ''],
        ].map(([l,v,u]) => (
          <div key={String(l)}>
            <span className="text-green-700">{l}: </span>
            <span className="text-green-300 font-mono font-bold">{v}{u}</span>
          </div>
        ))}
        {animOn && (
          <span className="ml-auto flex items-center gap-1.5 text-green-400">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" /> Simulare activă
          </span>
        )}
      </div>
    </div>
  );
}

// ── Small UI helpers ─────────────────────────────────────────
function SbCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-green-900/60 border border-green-800 rounded-lg p-2.5">
      <div className="text-green-700 text-[10px] font-bold uppercase tracking-widest mb-2">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function SbBtn({ onClick, children, active, danger, style }: {
  onClick: () => void; children: React.ReactNode;
  active?: boolean; danger?: boolean; style?: React.CSSProperties;
}) {
  return (
    <button onClick={onClick} style={style}
      className={`w-full text-left px-2.5 py-1.5 rounded-md border text-xs transition-all
        ${active  ? 'bg-green-700 border-green-500 text-green-100' :
          danger  ? 'border-red-900 text-red-500 hover:bg-red-950 hover:border-red-700' :
                    'border-green-800 text-green-400 hover:bg-green-800 hover:text-green-200'}`}>
      {children}
    </button>
  );
}
