'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { DbProject, DbSprinklerModel, PlacedSprinkler, Pipe, Point } from '@/types';

interface Props {
  project:     DbProject;
  sprinklerDb: DbSprinklerModel[];
  isOwner:     boolean;
}

interface WaterSource {
  xm: number;
  ym: number;
  x:  number;
  y:  number;
}

// ════════════════════════════════════════════════════════════
// GEOMETRY
// ════════════════════════════════════════════════════════════
function pip(pt: {x:number,y:number}, poly: {x:number,y:number}[]): boolean {
  let inside = false;
  for (let i=0, j=poly.length-1; i<poly.length; j=i++) {
    const xi=poly[i].x,yi=poly[i].y,xj=poly[j].x,yj=poly[j].y;
    if (((yi>pt.y)!==(yj>pt.y)) && pt.x<(xj-xi)*(pt.y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}

function bbox(pts: {x:number,y:number}[]) {
  return {
    minX:Math.min(...pts.map(p=>p.x)), maxX:Math.max(...pts.map(p=>p.x)),
    minY:Math.min(...pts.map(p=>p.y)), maxY:Math.max(...pts.map(p=>p.y)),
  };
}

function polyAreaM(pts: {x:number,y:number}[]): number {
  let a=0;
  for (let i=0,j=pts.length-1;i<pts.length;j=i++) a+=pts[j].x*pts[i].y-pts[i].x*pts[j].y;
  return Math.abs(a/2);
}

// Distance from point to line segment
function ptToSegDist(px:number,py:number, ax:number,ay:number, bx:number,by:number): number {
  const dx=bx-ax, dy=by-ay, len2=dx*dx+dy*dy;
  if (len2===0) return Math.hypot(px-ax,py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len2));
  return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
}

// Min distance from interior point to any polygon edge (in meters)
function distToEdge(xm:number,ym:number, polyM:{x:number,y:number}[]): number {
  let min=Infinity;
  for (let i=0;i<polyM.length;i++) {
    const p1=polyM[i], p2=polyM[(i+1)%polyM.length];
    min=Math.min(min, ptToSegDist(xm,ym,p1.x,p1.y,p2.x,p2.y));
  }
  return min;
}

// ════════════════════════════════════════════════════════════
// PIPE ROUTING — Professional, matches reference image
//
// SA on perimeter → main trunk follows polygon edge clockwise
// to each circuit valve (also on perimeter).
// Per circuit: main lateral runs vertically/horizontally through
// the zone, with perpendicular branches to each head.
// Result: minimum trenches, clean parallel layout.
// ════════════════════════════════════════════════════════════

function nearestPerimeterPoint(
  xm: number, ym: number,
  polyM: {x:number,y:number}[]
): {x:number,y:number,edgeIdx:number,t:number,dist:number} {
  let best = {x:xm,y:ym,edgeIdx:0,t:0,dist:Infinity};
  for (let i=0;i<polyM.length;i++){
    const p1=polyM[i],p2=polyM[(i+1)%polyM.length];
    const dx=p2.x-p1.x,dy=p2.y-p1.y,l2=dx*dx+dy*dy;
    if(l2<1e-9) continue;
    const t=Math.max(0,Math.min(1,((xm-p1.x)*dx+(ym-p1.y)*dy)/l2));
    const px=p1.x+t*dx,py=p1.y+t*dy,d=Math.hypot(xm-px,ym-py);
    if(d<best.dist) best={x:px,y:py,edgeIdx:i,t,dist:d};
  }
  return best;
}

// Scalar arc-length from vertex 0 to a perimeter position (clockwise)
function perimScalar(polyM:{x:number,y:number}[],edgeIdx:number,t:number):number{
  const n=polyM.length;
  let pos=0;
  for(let i=0;i<edgeIdx;i++) pos+=Math.hypot(polyM[(i+1)%n].x-polyM[i].x,polyM[(i+1)%n].y-polyM[i].y);
  const p1=polyM[edgeIdx],p2=polyM[(edgeIdx+1)%n];
  pos+=t*Math.hypot(p2.x-p1.x,p2.y-p1.y);
  return pos;
}

// Walk perimeter clockwise from one edge-position to another, return path
function walkPerimeter(
  polyM:{x:number,y:number}[],
  fromEdge:number,fromT:number,
  toEdge:number,toT:number
):{x:number,y:number}[]{
  const n=polyM.length;
  const p1s=polyM[fromEdge],p2s=polyM[(fromEdge+1)%n];
  const pts:[{x:number,y:number}]=[] as any;
  pts.push({x:p1s.x+(p2s.x-p1s.x)*fromT, y:p1s.y+(p2s.y-p1s.y)*fromT});
  let e=fromEdge,guard=0;
  while(e!==toEdge&&guard++<n+2){ e=(e+1)%n; pts.push({x:polyM[e].x,y:polyM[e].y}); }
  const p1t=polyM[toEdge],p2t=polyM[(toEdge+1)%n];
  pts.push({x:p1t.x+(p2t.x-p1t.x)*toT, y:p1t.y+(p2t.y-p1t.y)*toT});
  return pts;
}

// Emit Pipe segments along a list of points
function pathToPipes(pts:{x:number,y:number}[],type:'main'|'branch',circIdx:number):Pipe[]{
  const out:Pipe[]=[];
  for(let i=0;i<pts.length-1;i++){
    const d=Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].y-pts[i].y);
    if(d<0.01) continue;
    out.push({from:{x:pts[i].x,y:pts[i].y},to:{x:pts[i+1].x,y:pts[i+1].y},type,circIdx,lengthM:d});
  }
  return out;
}

// Build lateral network for one circuit using MST (Prim) from valve
// This gives a clean tree from valve → all heads, minimising total trench length
function buildCircuitLaterals(
  valve:{x:number,y:number},
  heads:{xm:number,ym:number}[],
  circIdx:number
):Pipe[]{
  if(!heads.length) return [];
  // nodes: [valve, ...heads]
  const nodes=[{x:valve.x,y:valve.y},...heads.map(h=>({x:h.xm,y:h.ym}))];
  const visited=new Set([0]);
  const out:Pipe[]=[];
  while(visited.size<nodes.length){
    let bestD=Infinity,bestFrom=-1,bestTo=-1;
    visited.forEach(vi=>{
      for(let j=0;j<nodes.length;j++){
        if(visited.has(j)) continue;
        const d=Math.hypot(nodes[vi].x-nodes[j].x,nodes[vi].y-nodes[j].y);
        if(d<bestD){bestD=d;bestFrom=vi;bestTo=j;}
      }
    });
    if(bestTo<0) break;
    visited.add(bestTo);
    out.push({
      from:{x:nodes[bestFrom].x,y:nodes[bestFrom].y},
      to:{x:nodes[bestTo].x,y:nodes[bestTo].y},
      type:'branch',circIdx,lengthM:bestD
    });
  }
  return out;
}

function buildPipeNetwork(
  sps:{xm:number,ym:number,circIdx:number}[],
  source:{xm:number,ym:number},
  polyM:{x:number,y:number}[],
  nCircuits:number
):Pipe[]{
  if(!sps.length||polyM.length<3) return [];
  const n=polyM.length;
  const allPipes:Pipe[]=[];

  // Group heads by circuit
  const groups:{xm:number,ym:number}[][]=Array.from({length:nCircuits},()=>[]);
  sps.forEach(s=>{if(s.circIdx<nCircuits) groups[s.circIdx].push({xm:s.xm,ym:s.ym});});

  // SA → nearest perimeter point
  const srcPP=nearestPerimeterPoint(source.xm,source.ym,polyM);
  const srcPos=perimScalar(polyM,srcPP.edgeIdx,srcPP.t);
  const totalPerim=polyM.reduce((s,p,i)=>s+Math.hypot(p.x-polyM[(i+1)%n].x,p.y-polyM[(i+1)%n].y),0);

  // For each active circuit: valve = perimeter point nearest to circuit centroid
  const valves:{x:number,y:number,edgeIdx:number,t:number,circIdx:number,ps:number}[]=[];
  groups.forEach((grp,ci)=>{
    if(!grp.length) return;
    const cx=grp.reduce((s,p)=>s+p.xm,0)/grp.length;
    const cy=grp.reduce((s,p)=>s+p.ym,0)/grp.length;
    const pp=nearestPerimeterPoint(cx,cy,polyM);
    valves.push({x:pp.x,y:pp.y,edgeIdx:pp.edgeIdx,t:pp.t,circIdx:ci,ps:perimScalar(polyM,pp.edgeIdx,pp.t)});
  });
  if(!valves.length) return [];

  // Sort valves clockwise from SA position
  const sortedValves=[...valves].sort((a,b)=>{
    const da=(a.ps-srcPos+totalPerim)%totalPerim;
    const db=(b.ps-srcPos+totalPerim)%totalPerim;
    return da-db;
  });

  // ── Main trunk: SA → V1 → V2 → ... clockwise along perimeter ──
  const chain=[
    {x:srcPP.x,y:srcPP.y,edgeIdx:srcPP.edgeIdx,t:srcPP.t},
    ...sortedValves
  ];
  for(let i=0;i<chain.length-1;i++){
    const from=chain[i],to=chain[i+1];
    const pts=walkPerimeter(polyM,from.edgeIdx,from.t,to.edgeIdx,to.t);
    const ci=sortedValves[Math.min(i,sortedValves.length-1)]?.circIdx??0;
    allPipes.push(...pathToPipes(pts,'main',ci));
  }

  // ── Laterals: MST per circuit from valve to all its heads ──
  groups.forEach((grp,ci)=>{
    if(!grp.length) return;
    const valve=valves.find(v=>v.circIdx===ci);
    if(!valve) return;
    allPipes.push(...buildCircuitLaterals({x:valve.x,y:valve.y},grp,ci));
  });

  return allPipes;
}

// ════════════════════════════════════════════════════════════
// SPRINKLER TYPE LABEL  (#5)
// ════════════════════════════════════════════════════════════
function sprinklerTypeLabel(radius:number): {label:string, color:string} {
  if (radius<=3)  return {label:'Spray fix',  color:'#4fc3f7'};
  if (radius<=6)  return {label:'Spray rot.', color:'#81c784'};
  if (radius<=10) return {label:'Jet rotor',  color:'#ffb74d'};
  return              {label:'Impact',      color:'#f06292'};
}

// ════════════════════════════════════════════════════════════
// INWARD NORMAL — for arc direction
// ════════════════════════════════════════════════════════════
// Inward normal of a polygon edge (points toward centroid)
function inwardNormalOfEdge(
  p1:{x:number,y:number}, p2:{x:number,y:number},
  centX:number, centY:number
): {nx:number, ny:number} {
  const ex=p2.x-p1.x, ey=p2.y-p1.y;
  const len=Math.hypot(ex,ey)||1;
  let nx=-ey/len, ny=ex/len;
  const midX=(p1.x+p2.x)/2, midY=(p1.y+p2.y)/2;
  if ((centX-midX)*nx+(centY-midY)*ny < 0) { nx=-nx; ny=-ny; }
  return {nx,ny};
}

// Compute arc for a sprinkler at (xm,ym) based on distance to polygon edges
function computeArc(
  xm:number, ym:number,
  polyM:{x:number,y:number}[],
  radius:number,
  centX:number, centY:number
): {sa:number, ea:number} {
  const edgeThresh = radius * 0.65;
  let dMin1=Infinity, dMin2=Infinity;
  let norm1={nx:0,ny:1}, norm2={nx:1,ny:0};

  for (let e=0; e<polyM.length; e++) {
    const p1=polyM[e], p2=polyM[(e+1)%polyM.length];
    const d=ptToSegDist(xm,ym,p1.x,p1.y,p2.x,p2.y);
    const n=inwardNormalOfEdge(p1,p2,centX,centY);
    if (d<dMin1) { dMin2=dMin1; norm2={...norm1}; dMin1=d; norm1=n; }
    else if (d<dMin2) { dMin2=d; norm2=n; }
  }

  const near1 = dMin1 < edgeThresh;
  const near2 = dMin2 < edgeThresh;

  if (near1 && near2) {
    // Corner: 90° arc bisecting two edge normals
    const bx=norm1.nx+norm2.nx, by=norm1.ny+norm2.ny;
    const bLen=Math.hypot(bx,by);
    if (bLen>0.01) {
      const angle = Math.atan2(by/bLen, bx/bLen)*180/Math.PI;
      return { sa: ((angle-45)%360+360)%360, ea: ((angle+45)%360+360)%360 };
    }
  }
  if (near1) {
    // Edge: 180° pointing inward
    const angle = Math.atan2(norm1.ny, norm1.nx)*180/Math.PI;
    const sa = ((angle-90)%360+360)%360;
    const ea = ((angle+90)%360+360)%360;
    return { sa, ea };
  }
  // Interior: full 360°
  return { sa:0, ea:360 };
}

// Scanline: find x-intersections of polygon at a given y (in meters)
function scanlineX(y:number, polyM:{x:number,y:number}[]): number[] {
  const xs: number[] = [];
  for (let i=0; i<polyM.length; i++) {
    const p1=polyM[i], p2=polyM[(i+1)%polyM.length];
    if ((p1.y<=y && p2.y>y) || (p2.y<=y && p1.y>y)) {
      const t=(y-p1.y)/(p2.y-p1.y);
      xs.push(p1.x+t*(p2.x-p1.x));
    }
  }
  return xs.sort((a,b)=>a-b);
}

// ════════════════════════════════════════════════════════════
// PROFESSIONAL PLACEMENT — Scanline with proper pair segments
//
// FIX: scanline returns N intersection points per row.
//   For convex shapes: 2 points → 1 segment
//   For L/U/concave:  4+ points → multiple segments
//   MUST use pairs [xs[0],xs[1]], [xs[2],xs[3]] — NOT xs[0] to xs[last]
//
// Arc direction: computed from nearest polygon edge (inward normal)
// ════════════════════════════════════════════════════════════
function professionalPlace(
  polyM: {x:number,y:number}[],
  radiusRequested: number,
  nCircuits: number
): Omit<PlacedSprinkler,'x'|'y'>[] {
  if (polyM.length < 3) return [];

  const bb    = bbox(polyM);
  const W     = bb.maxX - bb.minX;
  const H     = bb.maxY - bb.minY;

  // Clamp radius so we always get at least 1 head
  const radius = Math.min(radiusRequested, Math.min(W, H) * 0.98);

  // ── Grid spacing: head-to-head = radius (adjacent arcs touch) ──
  // Triangular hex grid: horizontal step = radius, vertical step = radius * √3/2
  const hStep = radius;
  const vStep = radius * 0.866;

  const placed: Omit<PlacedSprinkler,'x'|'y'>[] = [];
  let id = 0;

  // Number of rows that fully covers polygon height
  const nRows = Math.max(1, Math.ceil(H / vStep) + 1);

  for (let row = 0; row <= nRows; row++) {
    const ym = bb.minY + row * vStep;

    // Scanline intersections at this Y
    const xs: number[] = [];
    for (let e = 0; e < polyM.length; e++) {
      const p1 = polyM[e], p2 = polyM[(e+1) % polyM.length];
      if ((p1.y <= ym && p2.y > ym) || (p2.y <= ym && p1.y > ym)) {
        const t = (ym - p1.y) / (p2.y - p1.y);
        xs.push(p1.x + t * (p2.x - p1.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);

    // Hex offset: alternate rows shift by hStep/2
    const offset = row % 2 === 1 ? hStep * 0.5 : 0;

    // Process pairs of intersections (handles concave shapes: L, U, T)
    for (let seg = 0; seg + 1 < xs.length; seg += 2) {
      const xLeft  = xs[seg];
      const xRight = xs[seg + 1];
      const segW   = xRight - xLeft;
      if (segW <= 0) continue;

      // Number of heads in this segment row
      const nCols = Math.max(1, Math.round(segW / hStep));
      const actualH = segW / nCols;

      for (let col = 0; col < nCols; col++) {
        const xm = xLeft + (col + 0.5) * actualH + offset;
        const effX = xm > xRight ? xRight - actualH * 0.5 : xm;

        // Must be inside polygon
        if (!pip({x: effX, y: ym}, polyM)) continue;

        // Skip duplicates (can happen with hex offset near segment edges)
        if (placed.some(p => Math.hypot(p.xm - effX, p.ym - ym) < radius * 0.35)) continue;

        // ── Arc direction: based on proximity to polygon edges ──
        const CORNER_THRESH = radius * 0.65;
        const EDGE_THRESH   = radius * 0.70;

        // Find distances + inward normals for each edge
        type EdgeInfo = {d: number; nx: number; ny: number};
        const edges: EdgeInfo[] = polyM.map((p1, ei) => {
          const p2 = polyM[(ei+1) % polyM.length];
          const d  = ptToSegDist(effX, ym, p1.x, p1.y, p2.x, p2.y);
          const ex = p2.x - p1.x, ey = p2.y - p1.y;
          const len = Math.hypot(ex, ey) || 1;
          let nx = -ey / len, ny = ex / len;
          // Ensure inward: test pip
          if (!pip({x: effX + nx*0.05, y: ym + ny*0.05}, polyM)) { nx=-nx; ny=-ny; }
          return {d, nx, ny};
        });
        edges.sort((a, b) => a.d - b.d);

        const near = edges.filter(e => e.d < EDGE_THRESH);
        let sa = 0, ea = 360;

        if (near.length >= 2 && near[0].d < CORNER_THRESH && near[1].d < CORNER_THRESH) {
          // CORNER: average the two closest normals → 90° arc pointing into corner
          const bx = near[0].nx + near[1].nx;
          const by = near[0].ny + near[1].ny;
          const bLen = Math.hypot(bx, by);
          if (bLen > 0.01) {
            const angle = Math.atan2(by / bLen, bx / bLen) * 180 / Math.PI;
            sa = ((angle - 45) % 360 + 360) % 360;
            ea = ((angle + 45) % 360 + 360) % 360;
          }
        } else if (near.length >= 1 && near[0].d < EDGE_THRESH) {
          // EDGE: 180° arc pointing inward
          const angle = Math.atan2(near[0].ny, near[0].nx) * 180 / Math.PI;
          sa = ((angle - 90) % 360 + 360) % 360;
          ea = ((angle + 90) % 360 + 360) % 360;
        }
        // Interior (near empty): full 360°

        // Effective radius: for edge/corner heads, allow reaching the boundary
        const dEdge = distToEdge(effX, ym, polyM);
        const effectiveRadius = near.length > 0
          ? Math.min(radius, dEdge + radius * 0.15)
          : radius;

        placed.push({
          id: id++,
          xm: effX, ym,
          radius: effectiveRadius,
          circIdx: id % nCircuits,
          startA: sa,
          endA:   ea === sa ? 360 : ea,
          phase:  Math.random(),
        });
      }
    }
  }

  return placed;
}
// ════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════
export default function SimulatorClient({project,sprinklerDb,isOwner}:Props) {
  const cvRef  = useRef<HTMLCanvasElement>(null);
  const wRef   = useRef<HTMLCanvasElement>(null);
  const animRef= useRef<number|null>(null);

  const m2pxR = useRef(40);
  const oxR   = useRef(0);
  const oyR   = useRef(0);
  const [sz,  setSz]   = useState({w:900,h:600});

  // Polygon — stored in meters, rendered in canvas px
  // Auto-init polygon from project dimensions if none saved
  const initPolyM = (project.polygon?.length??0)>=3
    ? project.polygon!
    : (project.length_m && project.width_m)
      ? [{x:0,y:0},{x:project.length_m,y:0},{x:project.length_m,y:project.width_m},{x:0,y:project.width_m}]
      : [];
  const [polyM,      setPolyM]      = useState<Point[]>(initPolyM);
  const [polygon,    setPolygon]    = useState<{x:number,y:number}[]>([]);
  const [polyClosed, setPolyClosed] = useState(initPolyM.length>=3);
  const [drawPt,     setDrawPt]     = useState<{x:number,y:number}|null>(null); // live cursor while drawing
  const [snapPt,     setSnapPt]     = useState<{x:number,y:number}|null>(null); // snap indicator
  const [drawHistory,setDrawHistory]= useState<{x:number,y:number}[][]>([]); // undo stack

  // Sprinklers & pipes
  const [sprinklers, setSprinklers] = useState<PlacedSprinkler[]>(
    (project.sprinklers as PlacedSprinkler[])??[]
  );
  const [pipes,  setPipes]  = useState<Pipe[]>([]);

  // Water source — drag & drop (#12)
  const [waterSrc,    setWaterSrc]    = useState<WaterSource|null>(null);
  const [draggingWS,  setDraggingWS]  = useState(false);
  const [wsMode,      setWsMode]      = useState(false); // dedicated water source placement mode
  const [placingWS,   setPlacingWS]   = useState(false); // click-to-place water source mode

  // UI state
  const [mode,       setMode]       = useState<'draw'|'add'|'move'|'delete'>('add');
  const [selCirc,    setSelCirc]    = useState(0);
  const [curRadius,  setCurRadius]  = useState(6);
  const [hovSp,      setHovSp]      = useState<number|null>(null);
  const [draggingSp, setDraggingSp] = useState<{i:number,ox:number,oy:number}|null>(null);
  const [animOn,     setAnimOn]     = useState(false);
  const [speed,      setSpeed]      = useState(1);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [activeTab,  setActiveTab]  = useState<'sim'|'pipes'|'report'>('sim');
  const [msg,        setMsg]        = useState(
    initPolyM.length>=3
      ? '✅ Formă încărcată! Apasă ⚡ Automat pentru plasare aspersoare.'
      : '⚠️ Nu există formă. Mergi la Dashboard și creează un proiect nou cu forma desenată.'
  );
  const [coverage,   setCoverage]   = useState(0);
  const [showPDF,    setShowPDF]    = useState(false); // #13

  const sprRef   = useRef(sprinklers);
  const circRef  = useRef(project.circuits);
  const polyMRef = useRef(polyM);
  const animT0  = useRef<number|null>(null);
  const parts   = useRef<any[]>([]);

  useEffect(()=>{sprRef.current=sprinklers;},[sprinklers]);
  useEffect(()=>{polyMRef.current=polyM;},[polyM]);

  // On first load: convert initial polyM to canvas coords
  useEffect(()=>{
    if (polyM.length>=3 && polygon.length===0) {
      computeScale(sz.w, sz.h, polyM);
      const pts = polyM.map(p=>({x:oxR.current+p.x*m2pxR.current, y:oyR.current+p.y*m2pxR.current}));
      setPolygon(pts);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // ── Scale ─────────────────────────────────────────────────
  const computeScale = useCallback((w:number,h:number,poly:Point[]) => {
    const pad=0.82;
    if (poly.length<2) {
      const L=project.length_m||20, H2=project.width_m||10;
      const sc=Math.min((w*pad)/L,(h*pad)/H2);
      m2pxR.current=sc; oxR.current=(w-L*sc)/2; oyR.current=(h-H2*sc)/2; return;
    }
    const bb=bbox(poly);
    const W=bb.maxX-bb.minX||1, H2=bb.maxY-bb.minY||1;
    const sc=Math.min((w*pad)/W,(h*pad)/H2);
    m2pxR.current=sc;
    oxR.current=w/2-(bb.minX+W/2)*sc;
    oyR.current=h/2-(bb.minY+H2/2)*sc;
  },[project.length_m,project.width_m]);

  const toC = useCallback((xm:number,ym:number)=>
    ({x:oxR.current+xm*m2pxR.current, y:oyR.current+ym*m2pxR.current}),[]);
  const toM = useCallback((xc:number,yc:number):Point=>
    ({x:(xc-oxR.current)/m2pxR.current, y:(yc-oyR.current)/m2pxR.current}),[]);

  // ── Resize ────────────────────────────────────────────────
  useEffect(()=>{
    const el=cvRef.current?.parentElement; if(!el) return;
    const ro=new ResizeObserver(([e])=>{
      const w=e.contentRect.width,h=e.contentRect.height;
      setSz({w,h}); computeScale(w,h,polyM);
    });
    ro.observe(el);
    computeScale(el.clientWidth,el.clientHeight,polyM);
    setSz({w:el.clientWidth,h:el.clientHeight});
    return ()=>ro.disconnect();
  },[computeScale,polyM]);

  // Recompute canvas coords when polyM or size changes (#1)
  useEffect(()=>{
    computeScale(sz.w,sz.h,polyM);
    setPolygon(polyM.map(p=>toC(p.x,p.y)));
    setSprinklers(prev=>prev.map(s=>{const c=toC(s.xm,s.ym);return{...s,x:c.x,y:c.y};}));
    if (waterSrc) {
      const c=toC(waterSrc.xm,waterSrc.ym);
      setWaterSrc(w=>w?{...w,x:c.x,y:c.y}:null);
    }
  },[polyM,sz]);

  // ── Pipes from water source (#12) ─────────────────────────
  const recalcPipes = useCallback((sps:PlacedSprinkler[], ws:WaterSource|null)=>{
    if (!sps.length){setPipes([]);return;}
    const origin = ws ?? {
      xm: polyM.reduce((s,p)=>s+p.x,0)/Math.max(polyM.length,1),
      ym: polyM.reduce((s,p)=>s+p.y,0)/Math.max(polyM.length,1)
    };
    const result = buildPipeNetwork(sps, origin, polyM, project.circuits.length);
    setPipes(result);
  },[polyM,project.circuits]);

  // ── Coverage ──────────────────────────────────────────────
  const recalcCov = useCallback((sps:PlacedSprinkler[])=>{
    if (!polyClosed||!polyM.length||!sps.length){setCoverage(0);return;}
    const bb=bbox(polyM); const N=60;
    const dx=(bb.maxX-bb.minX)/N, dy=(bb.maxY-bb.minY)/N;
    let ins=0,cov=0;
    for (let i=0;i<N;i++) for (let j=0;j<N;j++){
      const px=bb.minX+(i+0.5)*dx, py=bb.minY+(j+0.5)*dy;
      if (!pip({x:px,y:py},polyM)) continue;
      ins++;
      if (sps.some(sp=>Math.hypot((oxR.current+px*m2pxR.current)-sp.x,
                                   (oyR.current+py*m2pxR.current)-sp.y)<=sp.radius*m2pxR.current)) cov++;
    }
    setCoverage(ins>0?Math.round(cov/ins*100):0);
  },[polyClosed,polyM]);

  // ── Draw ──────────────────────────────────────────────────
  useEffect(()=>{
    const cv=cvRef.current; if(!cv) return;
    const ctx=cv.getContext('2d')!;
    ctx.clearRect(0,0,sz.w,sz.h);
    drawGrid(ctx);
    if (polygon.length>0) drawPoly(ctx);
    if (activeTab==='pipes') drawPipesLayer(ctx);
    drawHeads(ctx);
    if (waterSrc) drawWaterSrc(ctx, waterSrc);
  },[polygon,polyClosed,sprinklers,pipes,hovSp,sz,animOn,activeTab,waterSrc,drawPt,mode]);

  function drawGrid(ctx:CanvasRenderingContext2D) {
    const step=m2pxR.current; if(step<4) return;
    ctx.save();
    ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1;
    for(let x=((oxR.current%step)+step)%step;x<sz.w;x+=step){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,sz.h);ctx.stroke();}
    for(let y=((oyR.current%step)+step)%step;y<sz.h;y+=step){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(sz.w,y);ctx.stroke();}
    // #4 — meter labels on both axes
    ctx.fillStyle='rgba(168,216,170,0.4)'; ctx.font='9px monospace'; ctx.textAlign='center';
    const maxX=Math.ceil(sz.w/step)+1, maxY=Math.ceil(sz.h/step)+1;
    for(let m=0;m<=maxX*2;m+=5){
      const cx=oxR.current+m*m2pxR.current;
      if(cx<0||cx>sz.w) continue;
      ctx.fillText(m+'m',cx,oyR.current-8);
    }
    ctx.textAlign='right';
    for(let m=0;m<=maxY*2;m+=5){
      const cy=oyR.current+m*m2pxR.current;
      if(cy<0||cy>sz.h) continue;
      ctx.fillText(m+'m',oxR.current-6,cy+3);
    }
    ctx.restore();
  }

  function drawPoly(ctx:CanvasRenderingContext2D) {
    ctx.save();
    ctx.beginPath();
    polygon.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));

    if (polyClosed) {
      ctx.closePath();
      const bb2=bbox(polygon);
      const gr=ctx.createLinearGradient(0,bb2.minY,0,bb2.maxY);
      gr.addColorStop(0,'rgba(46,125,50,0.6)'); gr.addColorStop(1,'rgba(20,80,20,0.6)');
      ctx.fillStyle=gr; ctx.fill();
      ctx.strokeStyle='#5cb85c'; ctx.lineWidth=2; ctx.stroke();

      // Dimension labels on polygon centroid
      const cx=polygon.reduce((s,p)=>s+p.x,0)/polygon.length;
      const cy=polygon.reduce((s,p)=>s+p.y,0)/polygon.length;
      const bb3=bbox(polyM);
      const wM=(bb3.maxX-bb3.minX).toFixed(1), hM=(bb3.maxY-bb3.minY).toFixed(1);
      ctx.fillStyle='rgba(168,216,170,0.9)'; ctx.font='bold 13px monospace'; ctx.textAlign='center';
      ctx.fillText(wM+'m', cx, bb2.minY-12);
      ctx.save(); ctx.translate(bb2.minX-20,cy); ctx.rotate(-Math.PI/2);
      ctx.fillText(hM+'m',0,0); ctx.restore();
      // Area
      const area=polyAreaM(polyM).toFixed(0);
      ctx.fillStyle='rgba(168,216,170,0.5)'; ctx.font='11px monospace';
      ctx.fillText(area+' m²',cx,cy);
    } else {
      ctx.strokeStyle='rgba(92,184,92,0.5)'; ctx.lineWidth=2;
      ctx.setLineDash([8,5]); ctx.stroke(); ctx.setLineDash([]);
      // Live preview line to cursor
      if (drawPt&&polygon.length>0) {
        const last=polygon[polygon.length-1];
        ctx.strokeStyle='rgba(92,184,92,0.25)'; ctx.lineWidth=1.5;
        ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(drawPt.x,drawPt.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Vertices + labels
    polygon.forEach((p,i)=>{
      const isFirst=i===0;
      const isClose=isFirst&&polygon.length>2&&drawPt&&Math.hypot(drawPt.x-p.x,drawPt.y-p.y)<20;
      // vertex dot
      ctx.beginPath(); ctx.arc(p.x,p.y,isClose?9:(isFirst&&polygon.length>2?7:5),0,Math.PI*2);
      ctx.fillStyle=isClose?'#FF5722':(isFirst&&polygon.length>2?'#FF9800':'#5cb85c');
      ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=1.5; ctx.stroke();
      // close hint ring
      if(isFirst&&polygon.length>2&&!polyClosed){
        ctx.beginPath(); ctx.arc(p.x,p.y,18,0,Math.PI*2);
        ctx.strokeStyle='rgba(255,152,0,0.4)'; ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      }
      // segment length label
      if(i>0){
        const prev=polygon[i-1];
        const lm=Math.hypot(p.x-prev.x,p.y-prev.y)/m2pxR.current;
        if(lm>0.3){
          const mx=(p.x+prev.x)/2, my=(p.y+prev.y)/2;
          const angle=Math.atan2(p.y-prev.y,p.x-prev.x);
          ctx.save(); ctx.translate(mx,my); ctx.rotate(angle);
          ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.roundRect(-18,-9,36,12,3); ctx.fill();
          ctx.fillStyle='rgba(220,255,200,0.9)'; ctx.font='bold 8px monospace'; ctx.textAlign='center';
          ctx.fillText(lm.toFixed(1)+'m',0,1);
          ctx.restore();
        }
        // angle indicator at vertex
        if(i>0&&i<polygon.length-1||polyClosed){
          const prev2=polygon[(i-1+polygon.length)%polygon.length];
          const next=polygon[(i+1)%polygon.length];
          const a1=Math.atan2(prev2.y-p.y,prev2.x-p.x);
          const a2=Math.atan2(next.y-p.y,next.x-p.x);
          let deg=((a2-a1)*180/Math.PI+360)%360;
          if(deg>180) deg=360-deg;
          if(deg<175||deg>185){ // only show non-straight angles
            ctx.save(); ctx.fillStyle='rgba(150,220,150,0.5)'; ctx.font='7px monospace'; ctx.textAlign='center';
            ctx.fillText(Math.round(deg)+'°',p.x,p.y+18); ctx.restore();
          }
        }
      }
    });

    // Snap point indicator (grid snap or 45° snap)
    if(snapPt&&!polyClosed){
      ctx.save();
      ctx.beginPath(); ctx.arc(snapPt.x,snapPt.y,6,0,Math.PI*2);
      ctx.strokeStyle='rgba(100,200,255,0.8)'; ctx.lineWidth=1.5; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(snapPt.x-10,snapPt.y); ctx.lineTo(snapPt.x+10,snapPt.y);
      ctx.moveTo(snapPt.x,snapPt.y-10); ctx.lineTo(snapPt.x,snapPt.y+10);
      ctx.strokeStyle='rgba(100,200,255,0.5)'; ctx.lineWidth=1; ctx.stroke();
      ctx.restore();
    }

    // Live segment from last point to cursor (with distance)
    if(drawPt&&polygon.length>0&&!polyClosed){
      const last=polygon[polygon.length-1];
      const effective=snapPt??drawPt;
      const lm=Math.hypot(effective.x-last.x,effective.y-last.y)/m2pxR.current;
      ctx.save();
      ctx.strokeStyle='rgba(92,184,92,0.5)'; ctx.lineWidth=1.5; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(effective.x,effective.y); ctx.stroke();
      ctx.setLineDash([]);
      if(lm>0.2){
        const mx=(last.x+effective.x)/2, my=(last.y+effective.y)/2;
        ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(mx-16,-10+my,32,13,3); ctx.fill();
        ctx.fillStyle='rgba(150,230,150,0.9)'; ctx.font='7.5px monospace'; ctx.textAlign='center';
        ctx.fillText(lm.toFixed(1)+'m',mx,my+1);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  function drawWaterSrc(ctx:CanvasRenderingContext2D, ws:WaterSource) {
    ctx.save();
    ctx.beginPath(); ctx.arc(ws.x,ws.y,12,0,Math.PI*2);
    ctx.fillStyle='rgba(0,100,200,0.85)'; ctx.fill();
    ctx.strokeStyle='#60b8ff'; ctx.lineWidth=2.5; ctx.stroke();
    ctx.fillStyle='white'; ctx.font='bold 12px sans-serif'; ctx.textAlign='center';
    ctx.fillText('💧',ws.x,ws.y+4);
    ctx.fillStyle='rgba(100,200,255,0.8)'; ctx.font='8px monospace';
    ctx.fillText('Sursă apă',ws.x,ws.y+22);
    ctx.restore();
  }

  function drawPipesLayer(ctx:CanvasRenderingContext2D) {
    const FLOW_PER_HEAD = 0.45; // m³/h per head

    // ── Background: polygon outline ──────────────────────────
    if(polygon.length>2){
      ctx.save();
      ctx.strokeStyle='rgba(80,160,80,0.2)'; ctx.lineWidth=1; ctx.setLineDash([5,5]);
      ctx.beginPath(); polygon.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    }

    // ── Lateral pipes (comb pattern, per circuit color) ──────
    pipes.filter(p=>p.type==='branch').forEach(p=>{
      const circ=project.circuits[p.circIdx];
      const color=circ?.color??'#4fc3f7';
      const from=toC(p.from.x,p.from.y),to2=toC(p.to.x,p.to.y);
      ctx.save();
      ctx.strokeStyle=color; ctx.lineWidth=2; ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath(); ctx.moveTo(from.x,from.y); ctx.lineTo(to2.x,to2.y); ctx.stroke();
      // small length label on longer segments
      if(p.lengthM>1.5){
        const mx=(from.x+to2.x)/2,my=(from.y+to2.y)/2;
        ctx.font='6.5px monospace'; ctx.fillStyle=color+'cc'; ctx.textAlign='center';
        ctx.fillText(p.lengthM.toFixed(1)+'m',mx,my-4);
      }
      ctx.restore();
    });

    // ── Main pipe — thick, black outline + color per circuit ─
    // Draw each circuit's main segment in its own color
    const circuitColors:string[]=project.circuits.map(c=>c.color??'#f0c040');

    // First pass: black outline
    pipes.filter(p=>p.type==='main').forEach(p=>{
      const from=toC(p.from.x,p.from.y),to2=toC(p.to.x,p.to.y);
      ctx.save();
      ctx.strokeStyle='#0a0a0a'; ctx.lineWidth=6; ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath(); ctx.moveTo(from.x,from.y); ctx.lineTo(to2.x,to2.y); ctx.stroke();
      ctx.restore();
    });
    // Second pass: colored core per circuit
    pipes.filter(p=>p.type==='main').forEach(p=>{
      const color=circuitColors[p.circIdx]??'#f0c040';
      const from=toC(p.from.x,p.from.y),to2=toC(p.to.x,p.to.y);
      ctx.save();
      ctx.strokeStyle=color; ctx.lineWidth=3.5; ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath(); ctx.moveTo(from.x,from.y); ctx.lineTo(to2.x,to2.y); ctx.stroke();
      ctx.restore();
    });

    // Flow + length labels on main segments (one per circuit, at midpoint)
    const mainByCi:{[ci:number]:Pipe[]}={};
    pipes.filter(p=>p.type==='main').forEach(p=>{
      if(!mainByCi[p.circIdx]) mainByCi[p.circIdx]=[];
      mainByCi[p.circIdx].push(p);
    });
    Object.entries(mainByCi).forEach(([ciStr,segs])=>{
      const ci=parseInt(ciStr);
      const nH=sprinklers.filter(s=>s.circIdx===ci).length;
      const totalLen=segs.reduce((s,p)=>s+p.lengthM,0);
      const flow=(nH*FLOW_PER_HEAD).toFixed(2);
      const color=circuitColors[ci]??'#f0c040';
      const mid=segs[Math.floor(segs.length/2)];
      const from=toC(mid.from.x,mid.from.y),to2=toC(mid.to.x,mid.to.y);
      const mx=(from.x+to2.x)/2,my=(from.y+to2.y)/2;
      ctx.save();
      // pill background
      ctx.fillStyle='rgba(5,15,5,0.88)';
      ctx.beginPath(); ctx.roundRect(mx-32,my-12,64,16,5); ctx.fill();
      ctx.fillStyle=color; ctx.font='bold 7px monospace'; ctx.textAlign='center';
      ctx.fillText('D='+flow+'m³/h  '+totalLen.toFixed(1)+'m',mx,my+1);
      ctx.restore();
    });

    // ── Valve markers (on perimeter, colored ring) ───────────
    const groups:{xm:number,ym:number}[][]=Array.from({length:project.circuits.length},()=>[]);
    sprinklers.forEach(s=>{if(s.circIdx<project.circuits.length) groups[s.circIdx].push({xm:s.xm,ym:s.ym});});
    groups.forEach((grp,ci)=>{
      if(!grp.length) return;
      const cx=grp.reduce((s,p)=>s+p.xm,0)/grp.length;
      const cy=grp.reduce((s,p)=>s+p.ym,0)/grp.length;
      const pp=nearestPerimeterPoint(cx,cy,polyM);
      const vc=toC(pp.x,pp.y);
      const color=circuitColors[ci]??'#ff9800';
      ctx.save();
      ctx.shadowBlur=10; ctx.shadowColor=color;
      // outer ring
      ctx.beginPath(); ctx.arc(vc.x,vc.y,8,0,Math.PI*2);
      ctx.fillStyle='#060f06'; ctx.fill();
      ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.stroke();
      ctx.shadowBlur=0;
      // inner dot
      ctx.beginPath(); ctx.arc(vc.x,vc.y,3.5,0,Math.PI*2);
      ctx.fillStyle=color; ctx.fill();
      // label: V + circuit number
      ctx.fillStyle='white'; ctx.font='bold 6.5px sans-serif'; ctx.textAlign='center';
      ctx.fillText('V'+(ci+1),vc.x,vc.y+2.5);
      ctx.restore();
    });

    // ── Sprinkler heads (pipe view — small colored dot) ──────
    sprinklers.forEach(sp=>{
      const circ=project.circuits[sp.circIdx]; if(!circ) return;
      if(!sp.x||!sp.y||!isFinite(sp.x)||!isFinite(sp.y)){
        const c=toC(sp.xm,sp.ym); sp={...sp,x:c.x,y:c.y};
      }
      ctx.save();
      ctx.beginPath(); ctx.arc(sp.x,sp.y,5,0,Math.PI*2);
      ctx.fillStyle='#0a0a0a'; ctx.fill();
      ctx.strokeStyle=circ.color; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(sp.x,sp.y,4,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(sp.x,sp.y,1.8,0,Math.PI*2);
      ctx.fillStyle=circ.color; ctx.fill();
      ctx.restore();
    });

    // ── SA — water source box ─────────────────────────────────
    const srcM=waterSrc??{
      xm:polyM.reduce((s,p)=>s+p.x,0)/Math.max(polyM.length,1),
      ym:polyM.reduce((s,p)=>s+p.y,0)/Math.max(polyM.length,1)
    };
    const saPP=nearestPerimeterPoint(srcM.xm,srcM.ym,polyM);
    const saC=toC(saPP.x,saPP.y);
    ctx.save();
    ctx.shadowBlur=14; ctx.shadowColor='#60a0ff';
    const bw=34,bh=24;
    // outer box
    ctx.fillStyle='white'; ctx.strokeStyle='#1565c0'; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.roundRect(saC.x-bw/2,saC.y-bh/2,bw,bh,5);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur=0;
    ctx.fillStyle='#1565c0'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center';
    ctx.fillText('SA',saC.x,saC.y+4);
    ctx.restore();

    // ── Legend box ────────────────────────────────────────────
    const lx=12,ly=sz.h-12-project.circuits.length*16-60;
    ctx.save();
    ctx.fillStyle='rgba(5,15,5,0.85)'; ctx.strokeStyle='rgba(80,160,80,0.3)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.roundRect(lx,ly,160,project.circuits.length*16+52,6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle='rgba(150,220,150,0.7)'; ctx.font='bold 8px monospace'; ctx.textAlign='left';
    ctx.fillText('TRASEE IRIGAȚII',lx+8,ly+13);
    // main pipe legend
    ctx.fillStyle='#f0c040'; ctx.fillRect(lx+8,ly+22,22,3);
    ctx.fillStyle='rgba(200,240,160,0.8)'; ctx.font='7.5px monospace';
    ctx.fillText('Conductă principală',lx+36,ly+26);
    // per circuit
    project.circuits.forEach((c,i)=>{
      const cy2=ly+38+i*16;
      ctx.fillStyle=c.color; ctx.fillRect(lx+8,cy2,22,2.5);
      ctx.fillStyle='rgba(200,240,160,0.7)'; ctx.font='7px monospace';
      const nH=sprinklers.filter(s=>s.circIdx===i).length;
      ctx.fillText('Circuit '+(i+1)+' — '+nH+' capete',lx+36,cy2+5);
    });
    // total
    const totLen=pipes.reduce((s,p)=>s+p.lengthM,0);
    ctx.fillStyle='rgba(150,200,150,0.6)'; ctx.font='7px monospace';
    ctx.fillText('Total conductă: '+totLen.toFixed(1)+'m',lx+8,ly+42+project.circuits.length*16);
    ctx.restore();
  }


  function drawHeads(ctx:CanvasRenderingContext2D) {
    sprinklers.forEach((sp,i)=>{
      const circ=project.circuits[sp.circIdx]; if(!circ) return;

      // Guard: recompute canvas coords from meters if x/y missing or NaN
      if (!sp.x || !sp.y || !isFinite(sp.x) || !isFinite(sp.y)) {
        const c = toC(sp.xm, sp.ym);
        sp = { ...sp, x: c.x, y: c.y };
      }

      const r=Math.max(1, sp.radius*m2pxR.current);
      const isHov=hovSp===i;
      const span=((sp.endA-sp.startA)+360)%360||360;
      const {label:tLabel}=sprinklerTypeLabel(sp.radius); // #5

      if(!animOn){
        const a1=sp.startA*Math.PI/180, a2=(sp.startA+span)*Math.PI/180;
        const gr=ctx.createRadialGradient(sp.x,sp.y,0,sp.x,sp.y,r);
        gr.addColorStop(0,circ.color+'66');
        gr.addColorStop(0.6,circ.color+'33');
        gr.addColorStop(1,circ.color+'00');
        ctx.save();
        ctx.beginPath(); ctx.moveTo(sp.x,sp.y); ctx.arc(sp.x,sp.y,r,a1,a2); ctx.closePath();
        ctx.fillStyle=gr; ctx.fill();
        ctx.strokeStyle=circ.color+'44'; ctx.lineWidth=1;
        ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();
      }

      const sz2=isHov?13:9;
      ctx.save();
      ctx.beginPath(); ctx.arc(sp.x,sp.y,sz2+2,0,Math.PI*2);
      ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill();
      ctx.beginPath(); ctx.arc(sp.x,sp.y,sz2,0,Math.PI*2);
      ctx.fillStyle='#0d2b0d'; ctx.fill();
      ctx.strokeStyle=circ.color; ctx.lineWidth=2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(sp.x,sp.y,sz2*0.35,0,Math.PI*2);
      ctx.fillStyle=circ.color; ctx.fill();

      ctx.fillStyle='rgba(200,240,160,0.9)'; ctx.font=`bold ${isHov?11:9}px monospace`; ctx.textAlign='center';
      ctx.fillText('S'+(i+1),sp.x,sp.y-sz2-5);

      if(isHov){
        // #5 — show type on hover
        ctx.fillStyle='rgba(168,216,170,0.8)'; ctx.font='8px monospace';
        ctx.fillText(`${tLabel} · ${span}° · r=${sp.radius.toFixed(1)}m`,sp.x,sp.y+sz2+14);
      }
      ctx.restore();
    });
  }

  // ── Animation ─────────────────────────────────────────────
  useEffect(()=>{
    if(!animOn){
      if(animRef.current) cancelAnimationFrame(animRef.current);
      wRef.current?.getContext('2d')?.clearRect(0,0,sz.w,sz.h);
      return;
    }
    const cv=cvRef.current!,wCv=wRef.current!;
    const ctx=cv.getContext('2d')!,wCtx=wCv.getContext('2d')!;
    animT0.current=null;

    function frame(ts:number){
      if(!animT0.current) animT0.current=ts;
      ctx.clearRect(0,0,sz.w,sz.h);
      drawGrid(ctx); drawPoly(ctx);
      if(activeTab==='pipes') drawPipesLayer(ctx);
      drawHeads(ctx);
      if(waterSrc) drawWaterSrc(ctx,waterSrc);

      sprRef.current.forEach(rawSp=>{
        const circ=circRef.current[rawSp.circIdx]; if(!circ) return;
        // Guard: recompute canvas coords if missing/NaN
        let sp=rawSp;
        if (!sp.x||!sp.y||!isFinite(sp.x)||!isFinite(sp.y)){
          const c=toC(sp.xm,sp.ym); sp={...sp,x:c.x,y:c.y};
        }
        const span=((sp.endA-sp.startA)+360)%360||360;
        const period=(span<=100?10000:span<=200?18000:25000)/speed;
        const t=((ts-animT0.current!+sp.phase*period)%period)/period;
        let frac=t<0.85
          ?(t/0.85<0.08?0.5*(t/0.85/0.08)**2*0.12:t/0.85>0.9?0.88+0.12*(1-(1-(t/0.85-0.9)/0.1)**2):0.06+(t/0.85-0.08)/0.82*0.82)
          :Math.max(1-((t-0.85)/0.15)**3,0);
        frac=Math.min(Math.max(frac,0),1);
        const r=Math.max(1,sp.radius*m2pxR.current);
        const a1r=sp.startA*Math.PI/180, a2r=(sp.startA+span*frac)*Math.PI/180;
        const gr=ctx.createRadialGradient(sp.x,sp.y,0,sp.x,sp.y,r);
        gr.addColorStop(0,circ.color+'ee');
        gr.addColorStop(0.5,circ.color+'88');
        gr.addColorStop(1,circ.color+'00');
        ctx.save(); ctx.beginPath(); ctx.moveTo(sp.x,sp.y);
        ctx.arc(sp.x,sp.y,r,a1r,a2r); ctx.closePath();
        ctx.clip(); ctx.fillStyle=gr; ctx.fill(); ctx.restore();
        const na=(sp.startA+span*frac)*Math.PI/180;
        ctx.save(); ctx.strokeStyle=circ.color; ctx.lineWidth=2.5; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(sp.x,sp.y);
        ctx.lineTo(sp.x+14*Math.cos(na),sp.y+14*Math.sin(na)); ctx.stroke(); ctx.restore();
        if(frac>0.04){
          // #2 — clip water animation to polygon
          ctx.save();
          ctx.beginPath();
          polygon.forEach((p,i)=>i===0?wCtx.moveTo(p.x,p.y):wCtx.lineTo(p.x,p.y));
          wCtx.save(); wCtx.beginPath(); wCtx.moveTo(sp.x,sp.y);
          wCtx.arc(sp.x,sp.y,r*frac,a1r,a2r); wCtx.closePath();
          wCtx.fillStyle='rgba(10,60,8,0.012)'; wCtx.fill(); wCtx.restore();
          ctx.restore();
        }
        if(frac>0.05&&frac<0.92&&Math.random()<0.35&&parts.current.length<300){
          const pa=(sp.startA+span*frac*(0.2+Math.random()*0.8))*Math.PI/180;
          const dist=(0.2+Math.random()*0.75)*r;
          const perp=pa+Math.PI/2;
          parts.current.push({x:sp.x+dist*Math.cos(pa),y:sp.y+dist*Math.sin(pa),
            vx:Math.cos(perp)*0.7+Math.cos(pa)*0.2,vy:Math.sin(perp)*0.7+Math.sin(pa)*0.2,
            life:0,maxL:15+Math.floor(Math.random()*20),r:0.7+Math.random()*1.5,color:circ.color});
        }
      });

      for(let i=parts.current.length-1;i>=0;i--){
        const p=parts.current[i]; p.life++;p.x+=p.vx;p.y+=p.vy;p.vy+=0.05;
        if(p.life>=p.maxL){parts.current.splice(i,1);continue;}
        ctx.save(); ctx.globalAlpha=(1-p.life/p.maxL)*0.7;
        ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); ctx.restore();
      }
      animRef.current=requestAnimationFrame(frame);
    }
    animRef.current=requestAnimationFrame(frame);
    return ()=>{if(animRef.current)cancelAnimationFrame(animRef.current);};
  },[animOn,speed,sz,polygon,polyClosed,activeTab,waterSrc]);

  // ── Auto Place ────────────────────────────────────────────
  function autoPlace() {
    if (!polyClosed||polyM.length<3){setMsg('Desenează mai întâi curtea!');return;}

    const raw=professionalPlace(polyM,curRadius,project.circuits.length);
    if(!raw.length){setMsg('Nu s-au putut plasa aspersoare. Încearcă o rază mai mică.');return;}

    const placed:PlacedSprinkler[]=raw.map(p=>{
      const c=toC(p.xm,p.ym);
      return{...p,x:c.x,y:c.y};
    });

    setSprinklers(placed);
    recalcPipes(placed,waterSrc);
    recalcCov(placed);

    const {label}=sprinklerTypeLabel(curRadius);
    const c90=placed.filter(s=>((s.endA-s.startA+360)%360||360)<=95).length;
    const c180=placed.filter(s=>{const sp=((s.endA-s.startA+360)%360||360);return sp>95&&sp<=185;}).length;
    const c360=placed.filter(s=>((s.endA-s.startA+360)%360||360)>185).length;
    setMsg(`✅ ${placed.length} aspersoare ${label} · ${c90}×90° · ${c180}×180° · ${c360}×360°`);
  }

  // ── Canvas events ─────────────────────────────────────────
  function getPos(e:React.MouseEvent<HTMLCanvasElement>){
    return{x:e.nativeEvent.offsetX,y:e.nativeEvent.offsetY};
  }

  function handleClick(e:React.MouseEvent<HTMLCanvasElement>) {
    const {x,y}=getPos(e);

    // Water source placement mode (button click)
    if (placingWS) {
      const m=toM(x,y);
      const ws={xm:m.x,ym:m.y,x,y};
      setWaterSrc(ws);
      setPlacingWS(false);
      recalcPipes(sprinklers,ws);
      setMsg('💧 Sursă apă plasată! Drag pentru a o muta. Traseele s-au recalculat.');
      return;
    }

    // Alt+Click also works as before
    if (e.altKey) {
      const m=toM(x,y);
      const ws={xm:m.x,ym:m.y,x,y};
      setWaterSrc(ws);
      recalcPipes(sprinklers,ws);
      setMsg('💧 Sursă apă plasată! Traseele se recalculează automat.');
      return;
    }

    if (mode==='draw') {
      if (polyClosed) return;
      // Snap: use snapPt if available
      const sx = snapPt?.x ?? x;
      const sy = snapPt?.y ?? y;
      if (polygon.length>2&&Math.hypot(sx-polygon[0].x,sy-polygon[0].y)<20) {
        // Close polygon
        const newPolyM=polygon.map(p=>toM(p.x,p.y));
        setPolyClosed(true); setPolyM(newPolyM);
        setMode('add'); setDrawPt(null); setSnapPt(null);
        setMsg('✅ Formă definită! Apasă ⚡ Automat.');
      } else {
        // Save to undo history
        setDrawHistory(h=>[...h, polygon]);
        setPolygon(prev=>[...prev,{x:sx,y:sy}]);
        setMsg('Punct '+( polygon.length+1)+' adăugat · Dublu-click sau click pe ⬤ = închide · Ctrl+Z = anulează');
      }
    } else if (mode==='add') {
      // #6 — Manual add
      if(!polyClosed){setMsg('⚠️ Mai întâi desenează forma curții cu ✏️ Desenează formă!');return;}
      const m=toM(x,y);
      const currentPolyM=polyMRef.current;
      if(!pip(m,currentPolyM)){setMsg('Click înăuntrul curții!');return;}
      const bb=bbox(currentPolyM); const ez=curRadius*0.55;
      const dL=m.x-bb.minX,dR=bb.maxX-m.x,dT=m.y-bb.minY,dB=bb.maxY-m.y;
      const iL=dL<ez,iR=dR<ez,iT=dT<ez,iB=dB<ez;
      let sa=0,ea=360;
      if(iL&&iT){sa=0;ea=90;}else if(iR&&iT){sa=90;ea=180;}
      else if(iR&&iB){sa=180;ea=270;}else if(iL&&iB){sa=270;ea=360;}
      else if(iT){sa=0;ea=180;}else if(iB){sa=180;ea=360;}
      else if(iL){sa=315;ea=405;}else if(iR){sa=135;ea=225;}
      // #3 — auto-adjust radius if near edge
      const dEdge=distToEdge(m.x,m.y,currentPolyM);
      const r=Math.min(curRadius,dEdge*1.15);
      const ns:PlacedSprinkler={id:sprinklers.length,x,y,xm:m.x,ym:m.y,
        radius:r,circIdx:selCirc,startA:sa,endA:ea,phase:Math.random()};
      const u=[...sprinklers,ns];
      setSprinklers(u); recalcPipes(u,waterSrc); recalcCov(u);
    } else if (mode==='delete') {
      // #10 — delete only sprinklers, not the drawn area
      const i=nearSp(x,y);
      if(i!==null){const u=sprinklers.filter((_,idx)=>idx!==i);setSprinklers(u);recalcPipes(u,waterSrc);recalcCov(u);}
    }
  }

  function handleKeyDown(e:React.KeyboardEvent<HTMLCanvasElement>) {
    // Ctrl+Z / Cmd+Z — undo last polygon point
    if((e.ctrlKey||e.metaKey)&&e.key==='z'&&mode==='draw'&&!polyClosed){
      e.preventDefault();
      if(drawHistory.length>0){
        const prev=drawHistory[drawHistory.length-1];
        setPolygon(prev);
        setDrawHistory(h=>h.slice(0,-1));
        setMsg('Punct anulat. '+prev.length+' puncte rămase.');
      }
    }
    // Escape — cancel drawing
    if(e.key==='Escape'&&mode==='draw'){
      setPolygon([]); setPolyM([]); setDrawHistory([]);
      setDrawPt(null); setSnapPt(null);
      setMsg('Desenare anulată.');
    }
  }

  function handleDblClick(e:React.MouseEvent<HTMLCanvasElement>) {
    if(mode==='draw'&&!polyClosed&&polygon.length>2){
      // Remove the extra point added by the preceding click
      const pts=polygon.slice(0,-1);
      const newPolyM=pts.map(p=>toM(p.x,p.y));
      setPolygon(pts);
      setPolyClosed(true); setPolyM(newPolyM);
      setMode('add'); setDrawPt(null); setSnapPt(null);
      setMsg('✅ Formă definită! '+newPolyM.length+' vârfuri · Apasă ⚡ Automat.');
    }
  }

  function handleMouseDown(e:React.MouseEvent<HTMLCanvasElement>) {
    const {x,y}=getPos(e);
    // #12 — drag water source
    if(waterSrc&&Math.hypot(x-waterSrc.x,y-waterSrc.y)<16){setDraggingWS(true);return;}
    // #7 — move SPRINKLER (not just radius)
    if(mode==='move'){
      const i=nearSp(x,y);
      if(i!==null) setDraggingSp({i,ox:x-sprinklers[i].x,oy:y-sprinklers[i].y});
    }
  }

  function handleMouseMove(e:React.MouseEvent<HTMLCanvasElement>) {
    const {x,y}=getPos(e);
    if(mode==='draw'&&!polyClosed){
      setDrawPt({x,y});
      // Snap logic: 45° angle snap + close-to-existing-vertex snap
      let snapped:{x:number,y:number}|null=null;
      const SNAP_PX=12;
      // 1. Snap to first vertex (close polygon)
      if(polygon.length>2&&Math.hypot(x-polygon[0].x,y-polygon[0].y)<SNAP_PX*1.5){
        snapped={x:polygon[0].x,y:polygon[0].y};
      }
      // 2. Snap to existing vertices
      if(!snapped){
        for(const p of polygon){
          if(Math.hypot(x-p.x,y-p.y)<SNAP_PX){snapped={x:p.x,y:p.y};break;}
        }
      }
      // 3. Angle snap: constrain to 45° increments from last point
      if(!snapped&&polygon.length>0){
        const last=polygon[polygon.length-1];
        const dx=x-last.x,dy=y-last.y;
        const angle=Math.atan2(dy,dx);
        const snapAngle=Math.round(angle/(Math.PI/4))*(Math.PI/4);
        const dist=Math.hypot(dx,dy);
        const dAngle=Math.abs(angle-snapAngle);
        if(dAngle<0.15||Math.abs(dAngle-Math.PI*2)<0.15){ // within ~8.6°
          snapped={x:last.x+Math.cos(snapAngle)*dist, y:last.y+Math.sin(snapAngle)*dist};
        }
      }
      setSnapPt(snapped);
    } else {
      setDrawPt(null); setSnapPt(null);
    }

    // #12 — drag water source
    if(draggingWS&&waterSrc){
      const m=toM(x,y);
      const ws={xm:m.x,ym:m.y,x,y};
      setWaterSrc(ws);
      recalcPipes(sprinklers,ws);
      return;
    }
    // #7 — drag sprinkler head
    if(draggingSp&&mode==='move'){
      const nx=x-draggingSp.ox, ny=y-draggingSp.oy;
      const m=toM(nx,ny);
      // #8 — auto adjust radius if moved near edge
      const dEdge=pip(m,polyM)?distToEdge(m.x,m.y,polyM):0;
      const r=dEdge>0?Math.min(sprinklers[draggingSp.i].radius,dEdge*1.15):sprinklers[draggingSp.i].radius;
      setSprinklers(prev=>{
        const u=[...prev];
        u[draggingSp.i]={...u[draggingSp.i],x:nx,y:ny,xm:m.x,ym:m.y,radius:r};
        return u;
      });
      return;
    }
    const i=nearSp(x,y); if(i!==hovSp) setHovSp(i);
  }

  function handleMouseUp() {
    if(draggingWS){setDraggingWS(false);return;}
    if(draggingSp){recalcPipes(sprinklers,waterSrc);recalcCov(sprinklers);setDraggingSp(null);}
  }

  function nearSp(px:number,py:number,maxD=18):number|null {
    let best:number|null=null,bD=Infinity;
    sprinklers.forEach((s,i)=>{const d=Math.hypot(px-s.x,py-s.y);if(d<maxD&&d<bD){bD=d;best=i;}});
    return best;
  }

  // ── Save ──────────────────────────────────────────────────
  async function saveProject() {
    setSaving(true);
    const sb=createClient();
    const aM2=polyClosed&&polyM.length>2?polyAreaM(polyM):null;
    await sb.from('projects').update({
      polygon:polyM,
      sprinklers:sprinklers.map(({x:_x,y:_y,...r})=>r),
      pipes, area_m2:aM2,
    }).eq('id',project.id);
    setSaving(false); setSaved(true); setTimeout(()=>setSaved(false),2500);
  }

  // ── Materials list for report (#13) ───────────────────────
  const materials = (() => {
    const spMap:Record<string,number>={};
    sprinklers.forEach(s=>{
      const {label}=sprinklerTypeLabel(s.radius);
      const key=`${label} r=${s.radius.toFixed(1)}m`;
      spMap[key]=(spMap[key]||0)+1;
    });
    const pipeMain=pipes.filter(p=>p.type==='main').reduce((s,p)=>s+p.lengthM,0);
    const pipeBranch=pipes.filter(p=>p.type!=='main').reduce((s,p)=>s+p.lengthM,0);
    return {spMap,pipeMain,pipeBranch};
  })();

  const pipeLen=pipes.reduce((s,p)=>s+p.lengthM,0);
  const areaM2=polyClosed&&polyM.length>2?polyAreaM(polyM):0;
  const {label:spType,color:spColor}=sprinklerTypeLabel(curRadius);

  return (
    <div className="h-screen flex flex-col bg-green-950 overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-green-900 flex-shrink-0">
        <Link href="/dashboard" className="text-green-600 hover:text-green-300 text-sm">← Dashboard</Link>
        <span className="text-green-800">|</span>
        <span className="text-green-200 font-semibold text-sm truncate max-w-[160px]">{project.name}</span>
        <div className="flex gap-1 ml-2">
          {(['sim','pipes','report'] as const).map((t,i)=>(
            <button key={t} onClick={()=>setActiveTab(t)}
              className={`text-xs px-3 py-1 rounded-md border transition-all
                ${activeTab===t?'bg-green-800 border-green-600 text-green-200':'border-green-900 text-green-600 hover:border-green-700'}`}>
              {['🌊 Simulare','🔧 Trasee','📋 Raport'][i]}
            </button>
          ))}
        </div>
        {sprinklers.length>0&&(
          <div className={`px-2 py-0.5 rounded-full text-xs font-bold border
            ${coverage>=95?'bg-green-900 border-green-600 text-green-300':
              coverage>=80?'bg-yellow-900 border-yellow-600 text-yellow-300':
                           'bg-red-900 border-red-700 text-red-300'}`}>
            {coverage}% acoperire
          </div>
        )}
        <div className="ml-auto flex gap-2">
          {isOwner&&(
            <button onClick={saveProject} disabled={saving}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all
                ${saved?'bg-green-700 border-green-500 text-green-100':'border-green-800 text-green-500 hover:border-green-600 hover:text-green-300'}`}>
              {saving?'...' :saved?'✓ Salvat':'💾 Salvează'}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 flex-shrink-0 border-r border-green-900 overflow-y-auto p-2.5 flex flex-col gap-2">

          {/* ── Formă curte — read-only, set from Dashboard ── */}
          <SbCard title="📐 Formă curte">
            {polyClosed ? (
              <div className="bg-green-950/60 rounded-lg p-2 border border-green-800">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"/>
                  <span className="text-green-300 text-[10px] font-semibold">Formă definită</span>
                </div>
                <div className="text-green-500 text-[10px] font-mono space-y-0.5">
                  <div>{polyM.length} vârfuri</div>
                  <div>{polyAreaM(polyM).toFixed(0)} m²</div>
                </div>
              </div>
            ) : (
              <div className="bg-yellow-950/40 border border-yellow-800 rounded-lg p-2 text-[10px] text-yellow-400">
                <div className="font-semibold mb-1">⚠️ Fără formă</div>
                <div className="text-yellow-600">Mergi la Dashboard, creează un proiect nou și desenează forma acolo.</div>
                <Link href="/dashboard" className="mt-2 block text-center py-1 rounded border border-yellow-700 text-yellow-300 hover:bg-yellow-900/40 transition-all">
                  ← Dashboard
                </Link>
              </div>
            )}
          </SbCard>

          {/* Aspersor */}
          <SbCard title="💧 Aspersor">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-green-600 w-10">Raza</span>
              <input type="range" min={1} max={15} step={0.5} value={curRadius}
                onChange={e=>setCurRadius(+e.target.value)}
                className="flex-1 h-1.5 bg-green-800 rounded appearance-none cursor-pointer"/>
              <span className="text-green-300 font-mono font-bold w-10 text-right">{curRadius}m</span>
            </div>
            {/* #5 — Sprinkler type badge */}
            <div className="flex items-center gap-2 mt-1 px-1">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border"
                style={{color:spColor,borderColor:spColor+'44',background:spColor+'11'}}>
                {spType}
              </span>
              <span className="text-green-700 text-[10px]">Pas: {curRadius}m · Rând: {(curRadius*0.866).toFixed(1)}m</span>
            </div>
            <div className="flex gap-1 mt-1">
              {[2,3,4,6,9,12].map(r=>(
                <button key={r} onClick={()=>setCurRadius(r)}
                  className={`flex-1 text-[10px] py-0.5 rounded border transition-all
                    ${curRadius===r?'bg-green-700 border-green-500 text-white':'border-green-800 text-green-600 hover:border-green-600'}`}>
                  {r}m
                </button>
              ))}
            </div>
          </SbCard>

          {/* Plasare */}
          <SbCard title="⚡ Plasare">
            <SbBtn highlight onClick={autoPlace}>⚡ Automat profesional</SbBtn>
            <SbBtn active={mode==='add'} onClick={()=>{
              setMode('add');
              setMsg(polyClosed?'Click pe curte = adaugă aspersor manual':'Mai întâi desenează forma curții!');
            }}>➕ Manual</SbBtn>
            <SbBtn active={mode==='move'} onClick={()=>{setMode('move');setMsg('Drag pe un aspersor = mută');}}> ✋ Mută aspersor</SbBtn>
            <SbBtn danger active={mode==='delete'} onClick={()=>{setMode('delete');setMsg('Click pe aspersor = șterge');}}>❌ Șterge aspersor</SbBtn>
            <SbBtn danger onClick={()=>{setSprinklers([]);setPipes([]);setCoverage(0);setMsg('Toate aspersoarele șterse.');}}>🗑 Șterge toate</SbBtn>
          </SbCard>

          {/* Sursă apă */}
          <SbCard title="💧 Sursă apă">
            {!placingWS ? (
              <SbBtn highlight={!waterSrc} active={false} onClick={()=>{
                setPlacingWS(true);
                setMode('add');
                setMsg('💧 Click oriunde pe canvas pentru a plasa sursa de apă');
              }}>💧 {waterSrc ? 'Mută sursa apă' : 'Plasează sursă apă'}</SbBtn>
            ) : (
              <div className="bg-blue-900/50 border border-blue-700 rounded-md px-2 py-1.5 text-xs text-blue-300 flex items-center gap-2">
                <span className="animate-pulse">💧</span>
                <span className="flex-1">Click pe canvas...</span>
                <button onClick={()=>{setPlacingWS(false);setMsg('Plasare anulată');}} className="text-red-500 hover:text-red-300">✕</button>
              </div>
            )}
            {waterSrc&&(
              <div className="flex items-center gap-2 px-1">
                <span className="text-blue-400 text-xs flex-1">📍 {waterSrc.xm.toFixed(1)}m, {waterSrc.ym.toFixed(1)}m</span>
                <button onClick={()=>{setWaterSrc(null);setPlacingWS(false);recalcPipes(sprinklers,null);}}
                  className="text-red-600 text-[10px] hover:text-red-400 border border-red-900 rounded px-1">Șterge</button>
              </div>
            )}
            {!waterSrc&&!placingWS&&(
              <div className="text-green-700 text-[10px] italic px-1">Neselectată — centroid folosit</div>
            )}
            <div className="text-green-800 text-[10px] px-1 mt-0.5">Drag 💧 = mută după plasare</div>
          </SbCard>

          {/* Circuite (#9 — show unified) */}
          <SbCard title="⚡ Circuite (#9)">
            <div className="text-green-700 text-[10px] px-1 mb-1">Selectează circuitul pentru plasare manuală:</div>
            {project.circuits.map((c,i)=>(
              <div key={c.id} onClick={()=>setSelCirc(i)}
                className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer text-xs transition-all
                  ${selCirc===i?'bg-green-800 border border-green-600':'hover:bg-green-900 border border-transparent'}`}>
                <div className="w-2.5 h-2.5 rounded-full" style={{background:c.color,boxShadow:`0 0 4px ${c.color}`}}/>
                <span className="flex-1 truncate text-green-200">{c.name}</span>
                <span className="text-green-600 text-[10px]">{sprinklers.filter(s=>s.circIdx===i).length}×</span>
              </div>
            ))}
          </SbCard>

          {/* Animatie */}
          <SbCard title="▶ Animație">
            {!animOn
              ?<SbBtn highlight onClick={()=>setAnimOn(true)}>▶ Pornește</SbBtn>
              :<SbBtn danger onClick={()=>{setAnimOn(false);parts.current=[];wRef.current?.getContext('2d')?.clearRect(0,0,sz.w,sz.h);}}>⏹ Stop</SbBtn>
            }
            <div className="flex items-center gap-2 text-xs mt-1">
              <span className="text-green-600 w-12">Viteză</span>
              <input type="range" min={0.3} max={4} step={0.1} value={speed}
                onChange={e=>setSpeed(+e.target.value)}
                className="flex-1 h-1 bg-green-800 rounded appearance-none cursor-pointer"/>
              <span className="text-green-300 font-mono w-8 text-right">{speed.toFixed(1)}×</span>
            </div>
          </SbCard>

          {/* Stats */}
          <SbCard title="📊 Statistici">
            {[
              ['Suprafață', areaM2>0?areaM2.toFixed(0)+' m²':'—'],
              ['Aspersoare', sprinklers.length],
              ['Tip', sprinklers.length>0?spType:'—'],
              ['Colțuri 90°', sprinklers.filter(s=>((s.endA-s.startA+360)%360||360)<=95).length],
              ['Margini 180°', sprinklers.filter(s=>{const sp=((s.endA-s.startA+360)%360||360);return sp>95&&sp<=185;}).length],
              ['Interior 360°', sprinklers.filter(s=>((s.endA-s.startA+360)%360||360)>185).length],
              ['Țeavă total', pipeLen>0?pipeLen.toFixed(1)+'m':'—'],
              ['Acoperire', sprinklers.length>0?coverage+'%':'—'],
            ].map(([l,v])=>(
              <div key={String(l)} className="flex justify-between text-xs py-0.5 border-b border-green-900 last:border-0">
                <span className="text-green-600">{l}</span>
                <span className={`font-mono font-bold ${String(l)==='Acoperire'?coverage>=95?'text-green-300':coverage>=80?'text-yellow-300':'text-red-400':'text-green-300'}`}>{v}</span>
              </div>
            ))}
          </SbCard>

        </aside>

        {/* Canvas / Report */}
        <div className="flex-1 relative overflow-hidden">
          {activeTab==='report' ? (
            <ReportTab
              project={project}
              sprinklers={sprinklers}
              pipes={pipes}
              areaM2={areaM2}
              coverage={coverage}
              materials={materials}
              spType={spType}
              curRadius={curRadius}
              waterSrc={waterSrc}
            />
          ) : (
            <>
              <canvas ref={wRef} width={sz.w} height={sz.h} className="absolute inset-0 pointer-events-none"/>
              <canvas ref={cvRef} width={sz.w} height={sz.h} className="absolute inset-0"
                style={{cursor:
                  placingWS?'crosshair':
                  draggingWS?'grabbing':
                  mode==='move'?(draggingSp?'grabbing':'grab'):
                  mode==='delete'?'not-allowed':
                  mode==='draw'?'crosshair':'cell'}}
                onClick={handleClick} onDoubleClick={handleDblClick}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp} onMouseLeave={()=>{handleMouseUp();setHovSp(null);setDrawPt(null);}}/>
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-green-950/85 border border-green-800 rounded-full px-5 py-1.5 text-xs text-green-500 pointer-events-none backdrop-blur-sm max-w-[85%] text-center">
                {msg}
              </div>
              {activeTab==='pipes'&&(
                <div className="absolute bottom-4 right-4 bg-green-950/92 border border-green-800 rounded-lg p-3 text-xs space-y-1.5 backdrop-blur-sm min-w-[180px]">
                  <div className="text-green-500 font-bold uppercase text-[10px] tracking-wider mb-2">Legendă trasee</div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-2 bg-yellow-400 rounded" style={{boxShadow:'0 0 4px #f0c040'}}/>
                    <span className="text-green-300">Conductă principală</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {project.circuits.map((c,i)=>(
                      <div key={i} className="w-2 h-2 rounded-full flex-shrink-0" style={{background:c.color}}/>
                    ))}
                    <span className="text-green-300">Circuite laterale</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-blue-700 border-2 border-blue-300 flex items-center justify-center">
                      <span className="text-white text-[8px] font-bold">SA</span>
                    </div>
                    <span className="text-green-300">Sursă apă</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-green-900 border-2 border-green-400 flex items-center justify-center">
                      <span className="text-green-300 text-[8px] font-bold">V</span>
                    </div>
                    <span className="text-green-300">Valvă circuit</span>
                  </div>
                  <div className="border-t border-green-800 pt-1.5 mt-1">
                    <div className="text-green-600 text-[9px]">Total conductă: <span className="text-green-300 font-mono">{pipes.reduce((s,p)=>s+p.lengthM,0).toFixed(1)}m</span></div>
                    <div className="text-green-600 text-[9px]">Principală: <span className="text-yellow-300 font-mono">{pipes.filter(p=>p.type==='main').reduce((s,p)=>s+p.lengthM,0).toFixed(1)}m</span></div>
                    <div className="text-green-600 text-[9px]">Laterale: <span className="text-green-300 font-mono">{pipes.filter(p=>p.type==='branch').reduce((s,p)=>s+p.lengthM,0).toFixed(1)}m</span></div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="border-t border-green-900 px-5 py-1.5 flex items-center gap-5 text-xs bg-green-950 flex-shrink-0">
        <span><span className="text-green-700">Suprafață: </span><span className="text-green-300 font-mono">{areaM2>0?areaM2.toFixed(0)+' m²':'—'}</span></span>
        <span><span className="text-green-700">Aspersoare: </span><span className="text-green-300 font-mono">{sprinklers.length}</span></span>
        <span><span className="text-green-700">Țeavă: </span><span className="text-green-300 font-mono">{pipeLen>0?pipeLen.toFixed(1)+'m':'—'}</span></span>
        <span><span className="text-green-700">Acoperire: </span>
          <span className={`font-mono font-bold ${coverage>=95?'text-green-300':coverage>=80?'text-yellow-300':'text-red-400'}`}>
            {sprinklers.length>0?coverage+'%':'—'}
          </span>
        </span>
        <span className="text-green-700 text-[10px]">Alt+Click = sursă apă</span>
        {animOn&&<span className="ml-auto text-green-400 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"/>Simulare activă</span>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// REPORT TAB (#13)
// ════════════════════════════════════════════════════════════
function ReportTab({project,sprinklers,pipes,areaM2,coverage,materials,spType,curRadius,waterSrc}:{
  project:DbProject; sprinklers:PlacedSprinkler[]; pipes:Pipe[];
  areaM2:number; coverage:number; materials:any; spType:string; curRadius:number;
  waterSrc:WaterSource|null;
}) {
  const totalPipe=pipes.reduce((s,p)=>s+p.lengthM,0);

  // Estimate costs (RON, approximate)
  const costPerSp=spType==='Spray fix'?45:spType==='Spray rot.'?75:spType==='Jet rotor'?120:150;
  const costPipe=Math.ceil(totalPipe*1.15)*8; // +15% pierderi, 8 RON/m
  const costValves=project.circuits.length*180;
  const costController=350;
  const costInstall=Math.ceil(areaM2*12); // 12 RON/m²
  const costTotal=sprinklers.length*costPerSp+costPipe+costValves+costController+costInstall;

  function printReport() { window.print(); }

  return (
    <div className="h-full overflow-y-auto p-6 text-green-200" id="print-report">
      <div className="max-w-2xl mx-auto space-y-6">

        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-green-300">📋 Raport Proiect — {project.name}</h1>
          <button onClick={printReport}
            className="text-xs px-4 py-2 bg-green-800 border border-green-600 rounded-lg hover:bg-green-700 text-green-200 transition-all">
            🖨 Printează / PDF
          </button>
        </div>

        {/* Summary */}
        <Section title="Rezumat proiect">
          <Row l="Locație" v={project.location||'—'}/>
          <Row l="Suprafață totală" v={areaM2>0?areaM2.toFixed(0)+' m²':'—'}/>
          <Row l="Acoperire" v={coverage+'%'} highlight={coverage>=95?'green':coverage>=80?'yellow':'red'}/>
          <Row l="Sursa apă" v={waterSrc?`${waterSrc.xm.toFixed(1)}m, ${waterSrc.ym.toFixed(1)}m`:'Centrul curții'}/>
          <Row l="Circuite" v={project.circuits.length+' zone'}/>
        </Section>

        {/* Sprinklers */}
        <Section title="Aspersoare">
          <Row l="Tip" v={spType}/>
          <Row l="Raza de acoperire" v={curRadius+'m'}/>
          <Row l="Total aspersoare" v={sprinklers.length+'×'}/>
          {Object.entries(materials.spMap).map(([k,v])=>(
            <Row key={k} l={'  '+k} v={v+'×'}/>
          ))}
          <Row l="Colțuri (90°)" v={sprinklers.filter(s=>((s.endA-s.startA+360)%360||360)<=95).length+'×'}/>
          <Row l="Margini (180°)" v={sprinklers.filter(s=>{const sp=((s.endA-s.startA+360)%360||360);return sp>95&&sp<=185;}).length+'×'}/>
          <Row l="Interior (360°)" v={sprinklers.filter(s=>((s.endA-s.startA+360)%360||360)>185).length+'×'}/>
        </Section>

        {/* Pipes */}
        <Section title="Conducte">
          <Row l="Conductă principală" v={materials.pipeMain.toFixed(1)+'m'}/>
          <Row l="Circuite laterale" v={materials.pipeBranch.toFixed(1)+'m'}/>
          <Row l="Total conductă" v={(totalPipe*1.15).toFixed(1)+'m (incl. 15% pierderi)'}/>
          <Row l="Tip recomandat" v="PVC PN6 ø25mm principal / ø20mm lateral"/>
        </Section>

        {/* Lista materiale (#13) */}
        <Section title="📦 Listă materiale estimativă">
          <div className="text-green-700 text-[10px] mb-2">* Cantități orientative. Verificați cu furnizorul.</div>
          <Row l={`Aspersoare ${spType}`} v={sprinklers.length+'× buc'}/>
          <Row l="Conductă principală PVC ø25" v={Math.ceil(materials.pipeMain*1.15)+'m'}/>
          <Row l="Conductă laterală PVC ø20" v={Math.ceil(materials.pipeBranch*1.15)+'m'}/>
          <Row l="Electrovalve" v={project.circuits.length+'× buc'}/>
          <Row l="Controler programare" v="1× buc"/>
          <Row l="Capete T/L fitinguri" v={Math.ceil(sprinklers.length*1.5)+'× buc (est.)'}/>
          <Row l="Coliere / fixare" v={Math.ceil(totalPipe/2)+'× buc (est.)'}/>
          <Row l="Filtru/Reductor presiune" v="1× buc"/>
        </Section>

        {/* Cost estimate (#13) */}
        <Section title="💰 Estimare cost (RON)">
          <div className="text-green-700 text-[10px] mb-2">* Estimare orientativă. Prețuri pot varia.</div>
          <Row l={`Aspersoare (${sprinklers.length}× × ${costPerSp} RON)`} v={sprinklers.length*costPerSp+' RON'}/>
          <Row l="Conducte + fitinguri" v={costPipe+' RON'}/>
          <Row l="Electrovalve (zone)" v={costValves+' RON'}/>
          <Row l="Controler programare" v={costController+' RON'}/>
          <Row l="Manoperă instalare" v={costInstall+' RON'}/>
          <div className="border-t border-green-700 mt-2 pt-2 flex justify-between">
            <span className="text-green-300 font-bold">TOTAL ESTIMAT</span>
            <span className="text-green-300 font-bold font-mono">{costTotal.toLocaleString()} RON</span>
          </div>
        </Section>

        {/* Best practices note */}
        <Section title="✅ Best Practices aplicate">
          <div className="text-green-600 text-xs space-y-1 leading-relaxed">
            <p>• Head-to-head coverage (Rain Bird/Hunter standard) — fiecare aspersor acoperă până la cel vecin</p>
            <p>• Triangular grid spacing — eficiență maximă cu număr minim de aspersoare</p>
            <p>• Colțuri 90°, margini 180°, interior 360° — distribuție uniformă</p>
            <p>• Raza auto-ajustată la marginea poligonului — fără risipă în afara curții</p>
            <p>• MST (Minimum Spanning Tree) pentru rutare conducte — lungime minimă</p>
            <p>• Separare circuite/zone — presiune optimă per circuit</p>
            <p>• Sursă apă configurabilă — optimizare rută principală</p>
          </div>
        </Section>

        <div className="text-center text-green-800 text-xs pt-4 border-t border-green-900">
          Generat de IrigaPRO · {new Date().toLocaleDateString('ro-RO')}
        </div>
      </div>
    </div>
  );
}

function Section({title,children}:{title:string;children:React.ReactNode}){
  return(
    <div className="bg-green-900/40 border border-green-800 rounded-lg p-4">
      <div className="text-green-500 font-bold text-sm mb-3 border-b border-green-800 pb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({l,v,highlight}:{l:string;v:any;highlight?:'green'|'yellow'|'red'}){
  const vc=highlight==='green'?'text-green-300':highlight==='yellow'?'text-yellow-300':highlight==='red'?'text-red-400':'text-green-300';
  return(
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-green-600">{l}</span>
      <span className={`font-mono font-bold ${vc}`}>{v}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════════════════════════════
function SbCard({title,children}:{title:string;children:React.ReactNode}){
  return(
    <div className="bg-green-900/50 border border-green-800 rounded-lg p-2.5">
      <div className="text-green-700 text-[10px] font-bold uppercase tracking-widest mb-2">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function SbBtn({onClick,children,active,danger,highlight,style}:{
  onClick:()=>void;children:React.ReactNode;
  active?:boolean;danger?:boolean;highlight?:boolean;style?:React.CSSProperties;
}){
  return(
    <button onClick={onClick} style={style}
      className={`w-full text-left px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all
        ${highlight?'bg-green-700 border-green-500 text-green-100 hover:bg-green-600':
          active  ?'bg-green-800 border-green-600 text-green-100':
          danger  ?'border-red-900 text-red-500 hover:bg-red-950 hover:border-red-700':
                   'border-green-800 text-green-500 hover:bg-green-800 hover:text-green-200'}`}>
      {children}
    </button>
  );
}
