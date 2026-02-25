'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { DbProject } from '@/types';
import type { User } from '@supabase/supabase-js';

interface Props { user: User; projects: DbProject[]; }
interface Pt { x: number; y: number; }

function polyArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return Math.abs(a / 2);
}

// ── Canvas Drawing Widget ──────────────────────────────────────
function PolygonCanvas({ onPolygonChange }: { onPolygonChange: (pts: Pt[]) => void }) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [pts,     setPts]     = useState<Pt[]>([]);
  const [closed,  setClosed]  = useState(false);
  const [cursor,  setCursor]  = useState<Pt | null>(null);
  const [history, setHistory] = useState<Pt[][]>([]);
  const [snap,    setSnap]    = useState<Pt | null>(null);

  const SCALE = 0.1; // m per px  (canvas 560×340 = 56×34 m workspace)
  const GRID  = 10;  // px per grid line = 1 m

  useEffect(() => {
    if (closed && pts.length >= 3)
      onPolygonChange(pts.map(p => ({ x: p.x * SCALE, y: p.y * SCALE })));
    else
      onPolygonChange([]);
  }, [pts, closed]);

  // ── Render ──────────────────────────────────────────────────
  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    // BG
    ctx.fillStyle = '#080f08';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += GRID) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y <= H; y += GRID) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Thicker lines every 5m (50px)
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 50) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 50) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Metric ruler labels
    ctx.fillStyle = 'rgba(80,160,80,0.4)'; ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    for (let x = 0; x <= W; x += 50) ctx.fillText((x * SCALE).toFixed(0)+'m', x, H - 3);
    ctx.textAlign = 'right';
    for (let y = 0; y <= H; y += 50) ctx.fillText((y * SCALE).toFixed(0)+'m', W - 2, y + 3);

    // Empty hint
    if (pts.length === 0 && !cursor) {
      ctx.fillStyle = 'rgba(60,140,60,0.25)'; ctx.font = '13px monospace'; ctx.textAlign = 'center';
      ctx.fillText('Click pentru a adăuga primul vârf', W/2, H/2 - 8);
      ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(60,120,60,0.18)';
      ctx.fillText('Orice formă: L · U · T · trapez · poligon liber', W/2, H/2+12);
      return;
    }

    // Filled polygon
    if (pts.length >= 3) {
      ctx.save();
      ctx.beginPath();
      pts.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
      ctx.closePath();
      const g = ctx.createLinearGradient(0,0,0,H);
      g.addColorStop(0,'rgba(46,125,50,0.35)'); g.addColorStop(1,'rgba(20,70,20,0.2)');
      ctx.fillStyle=g; ctx.fill();
      ctx.restore();
    }

    // Edges
    if (pts.length >= 2) {
      ctx.save();
      ctx.strokeStyle = closed ? '#5cb85c' : 'rgba(92,184,92,0.75)';
      ctx.lineWidth = closed ? 2 : 1.5; ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath(); pts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
      if (closed) ctx.closePath(); ctx.stroke(); ctx.restore();
    }

    // Live preview line
    if (!closed && cursor && pts.length > 0) {
      const last = pts[pts.length-1], eff = snap ?? cursor;
      ctx.save();
      ctx.strokeStyle='rgba(92,184,92,0.4)'; ctx.lineWidth=1.5; ctx.setLineDash([5,4]);
      ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(eff.x,eff.y); ctx.stroke(); ctx.setLineDash([]);
      const dm = Math.hypot((eff.x-last.x)*SCALE,(eff.y-last.y)*SCALE);
      if (dm > 0.3) {
        const mx=(last.x+eff.x)/2, my=(last.y+eff.y)/2;
        ctx.fillStyle='rgba(0,0,0,0.72)'; ctx.beginPath(); ctx.roundRect(mx-18,my-9,36,13,3); ctx.fill();
        ctx.fillStyle='rgba(180,240,160,0.95)'; ctx.font='bold 8px monospace'; ctx.textAlign='center';
        ctx.fillText(dm.toFixed(1)+'m', mx, my+1);
      }
      ctx.restore();
    }

    // Segment labels
    const drawSegLabel = (a: Pt, b: Pt) => {
      const dm = Math.hypot((b.x-a.x)*SCALE,(b.y-a.y)*SCALE);
      if (dm < 0.4) return;
      const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
      const angle = Math.atan2(b.y-a.y,b.x-a.x);
      ctx.save(); ctx.translate(mx,my); ctx.rotate(angle);
      ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.beginPath(); ctx.roundRect(-16,-9,32,12,3); ctx.fill();
      ctx.fillStyle='rgba(200,240,160,0.9)'; ctx.font='bold 7.5px monospace'; ctx.textAlign='center';
      ctx.fillText(dm.toFixed(1)+'m',0,1); ctx.restore();
    };
    for (let i = 1; i < pts.length; i++) drawSegLabel(pts[i-1], pts[i]);
    if (closed && pts.length >= 3) drawSegLabel(pts[pts.length-1], pts[0]);

    // Vertices
    pts.forEach((p,i) => {
      const isFirst = i===0;
      const canClose = isFirst && pts.length > 2 && !closed;
      const nearClose = canClose && cursor && Math.hypot(cursor.x-p.x,cursor.y-p.y)<22;
      const r = nearClose ? 9 : (canClose ? 7 : 5);
      ctx.save();
      if (nearClose) { ctx.shadowBlur=14; ctx.shadowColor='#FF9800'; }
      ctx.beginPath(); ctx.arc(p.x,p.y,r+2,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2);
      ctx.fillStyle = nearClose ? '#FF5722' : canClose ? '#FF9800' : '#5cb85c'; ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=1.5; ctx.shadowBlur=0; ctx.stroke();
      if (canClose) {
        ctx.beginPath(); ctx.arc(p.x,p.y,20,0,Math.PI*2);
        ctx.strokeStyle='rgba(255,152,0,0.25)'; ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
    });

    // Snap indicator
    if (snap && !closed) {
      ctx.save(); ctx.strokeStyle='rgba(100,200,255,0.75)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(snap.x,snap.y,7,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(snap.x-11,snap.y); ctx.lineTo(snap.x+11,snap.y);
      ctx.moveTo(snap.x,snap.y-11); ctx.lineTo(snap.x,snap.y+11); ctx.stroke();
      ctx.restore();
    }

    // Area label
    if (closed && pts.length >= 3) {
      const aM2 = polyArea(pts)*SCALE*SCALE;
      const cx = pts.reduce((s,p)=>s+p.x,0)/pts.length;
      const cy = pts.reduce((s,p)=>s+p.y,0)/pts.length;
      ctx.save();
      ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.beginPath(); ctx.roundRect(cx-38,cy-13,76,21,5); ctx.fill();
      ctx.fillStyle='rgba(180,240,160,0.95)'; ctx.font='bold 11px monospace'; ctx.textAlign='center';
      ctx.fillText(aM2.toFixed(0)+' m²', cx, cy+3);
      ctx.restore();
    }
  }, [pts, closed, cursor, snap]);

  // ── Snap computation ─────────────────────────────────────────
  const computeSnap = useCallback((x: number, y: number): Pt | null => {
    const S = 14;
    if (pts.length > 2 && Math.hypot(x-pts[0].x,y-pts[0].y) < S*1.6) return {x:pts[0].x,y:pts[0].y};
    for (const p of pts) if (Math.hypot(x-p.x,y-p.y) < S) return {x:p.x,y:p.y};
    if (pts.length > 0) {
      const last=pts[pts.length-1], dx=x-last.x, dy=y-last.y;
      const angle=Math.atan2(dy,dx), snapped=Math.round(angle/(Math.PI/4))*(Math.PI/4);
      if (Math.abs(angle-snapped) < 0.13) {
        const d=Math.hypot(dx,dy);
        return {x:last.x+Math.cos(snapped)*d, y:last.y+Math.sin(snapped)*d};
      }
    }
    return null;
  }, [pts]);

  function getPos(e: React.MouseEvent<HTMLCanvasElement>): Pt {
    const r = cvRef.current!.getBoundingClientRect();
    const scaleX = cvRef.current!.width / r.width;
    const scaleY = cvRef.current!.height / r.height;
    return { x: (e.clientX-r.left)*scaleX, y: (e.clientY-r.top)*scaleY };
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (closed) return;
    const {x,y} = getPos(e);
    setCursor({x,y}); setSnap(computeSnap(x,y));
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (closed) return;
    const {x,y} = getPos(e);
    const eff = snap ?? {x,y};
    if (pts.length > 2 && Math.hypot(eff.x-pts[0].x,eff.y-pts[0].y) < 22) {
      setClosed(true); setCursor(null); setSnap(null); return;
    }
    setHistory(h=>[...h, pts]);
    setPts(prev=>[...prev, eff]);
  }

  function handleDblClick() {
    if (closed || pts.length < 3) return;
    setPts(prev => prev.slice(0,-1));
    setClosed(true); setCursor(null); setSnap(null);
  }

  function undo() {
    if (closed) { setClosed(false); return; }
    if (history.length > 0) { setPts(history[history.length-1]); setHistory(h=>h.slice(0,-1)); }
  }

  function reset() { setPts([]); setClosed(false); setHistory([]); setCursor(null); setSnap(null); }

  function applyTemplate(tPts: [number,number][]) {
    const cv = cvRef.current!;
    const W=cv.width, H=cv.height;
    const xs=tPts.map(p=>p[0]), ys=tPts.map(p=>p[1]);
    const tw=Math.max(...xs), th=Math.max(...ys);
    const scale=Math.min((W-80)/tw,(H-80)/th);
    const ox=(W-tw*scale)/2, oy=(H-th*scale)/2;
    setPts(tPts.map(([x,y])=>({x:ox+x*scale, y:oy+y*scale})));
    setClosed(true); setHistory([]);
  }

  const areaM2 = closed && pts.length>=3 ? polyArea(pts)*SCALE*SCALE : 0;

  const TEMPLATES: {label:string, icon:string, pts:[number,number][]}[] = [
    {label:'Dreptunghi', icon:'▭', pts:[[0,0],[10,0],[10,6],[0,6]]},
    {label:'Formă L',    icon:'⌐', pts:[[0,0],[10,0],[10,5],[5,5],[5,10],[0,10]]},
    {label:'Formă U',    icon:'∪', pts:[[0,0],[3,0],[3,7],[7,7],[7,0],[10,0],[10,10],[0,10]]},
    {label:'Formă T',    icon:'T', pts:[[0,0],[10,0],[10,3],[6,3],[6,10],[4,10],[4,3],[0,3]]},
    {label:'Trapez',     icon:'◡', pts:[[2,0],[8,0],[10,6],[0,6]]},
    {label:'Pentagon',   icon:'⬠', pts:[[5,0],[10,3.5],[8,9],[2,9],[0,3.5]]},
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Templates */}
      <div>
        <div className="text-[10px] text-green-600 mb-1.5 font-mono uppercase tracking-wider">Șabloane rapide</div>
        <div className="grid grid-cols-6 gap-1">
          {TEMPLATES.map(t => (
            <button key={t.label}
              className="flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg border border-green-800 hover:border-green-500 hover:bg-green-900/40 transition-all group"
              title={t.label}
              onClick={() => applyTemplate(t.pts)}>
              <span className="text-sm text-green-400 group-hover:text-green-200 font-mono leading-none">{t.icon}</span>
              <span className="text-[8px] text-green-700 group-hover:text-green-500 leading-none">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="relative rounded-xl overflow-hidden border border-green-800">
        <canvas
          ref={cvRef} width={560} height={340}
          className="w-full cursor-crosshair block"
          style={{touchAction:'none'}}
          onClick={handleClick}
          onDoubleClick={handleDblClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={()=>{if(!closed){setCursor(null);setSnap(null);}}}
        />
        {/* Status badge */}
        <div className="absolute top-2 left-2 pointer-events-none">
          {!closed ? (
            <span className="text-[10px] bg-black/65 text-green-400 px-2 py-1 rounded-full font-mono border border-green-900">
              {pts.length===0 ? '✏️ Click = primul vârf' : `${pts.length} vârfuri · dublu-click = închide`}
            </span>
          ) : (
            <span className="text-[10px] bg-green-900/80 text-green-200 px-2 py-1 rounded-full font-mono border border-green-700">
              ✓ {pts.length} vârfuri · {areaM2.toFixed(0)} m²
            </span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button onClick={undo} disabled={pts.length===0&&!closed}
          className="flex-1 text-xs py-1.5 rounded-lg border border-green-800 text-green-500 hover:border-green-600 hover:text-green-300 disabled:opacity-30 transition-all font-mono">
          ↩ Undo
        </button>
        <button onClick={reset} disabled={pts.length===0}
          className="flex-1 text-xs py-1.5 rounded-lg border border-red-900/60 text-red-600 hover:border-red-700 hover:text-red-400 disabled:opacity-30 transition-all font-mono">
          ✕ Reset
        </button>
        {!closed && pts.length>=3 && (
          <button onClick={()=>setClosed(true)}
            className="flex-1 text-xs py-1.5 rounded-lg border border-green-600 bg-green-900/50 text-green-200 hover:bg-green-800/60 font-mono font-bold transition-all">
            ✓ Închide
          </button>
        )}
      </div>
      <div className="text-[9px] text-green-800 text-center font-mono">
        Grilă 1m · snap automat 45° · dublu-click = închide · Scala: 0.1 m/px
      </div>
    </div>
  );
}

// ── Main Dashboard ──────────────────────────────────────────────
export default function DashboardClient({ user, projects }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string|null>(null);
  const [showNew,  setShowNew]  = useState(false);
  const [newName,  setNewName]  = useState('');
  const [newLoc,   setNewLoc]   = useState('');
  const [polygon,  setPolygon]  = useState<Pt[]>([]);
  const [step,     setStep]     = useState<1|2>(1);

  function openModal() { setShowNew(true); setStep(1); setNewName(''); setNewLoc(''); setPolygon([]); }

  async function handleLogout() {
    await createClient().auth.signOut();
    router.push('/');
  }

  async function createProject() {
    if (!newName.trim()) return;
    setCreating(true);
    const areaM2 = polygon.length>=3 ? polyArea(polygon) : 0;
    const {data} = await createClient().from('projects').insert({
      user_id:  user.id,
      name:     newName.trim(),
      location: newLoc.trim(),
      length_m: 0, width_m: 0,
      area_m2:  areaM2,
      polygon,
      circuits: [
        {id:'c1',name:'Circuit 1',color:'#4CAF50',sprinkler:'Rain Bird 3504',radius:6,pressure:2.5,flow:0.9},
        {id:'c2',name:'Circuit 2',color:'#2196F3',sprinkler:'Rain Bird 3504',radius:6,pressure:2.5,flow:0.9},
        {id:'c3',name:'Circuit 3',color:'#FF9800',sprinkler:'Rain Bird XFCV Drip',radius:2,pressure:1.5,flow:0.05},
      ],
      sprinklers:[], pipes:[],
    }).select().single();
    setCreating(false);
    if (data) router.push(`/simulator/${data.id}`);
  }

  async function deleteProject(id: string) {
    if (!confirm('Ștergi proiectul? Acțiunea este ireversibilă.')) return;
    setDeleting(id);
    await createClient().from('projects').delete().eq('id', id);
    router.refresh(); setDeleting(null);
  }

  const userName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'tu';
  const canCreate = newName.trim().length > 0;

  return (
    <div className="min-h-screen bg-green-950 flex flex-col">
      <header className="border-b border-green-900 px-6 py-3 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl">🌿</span>
          <span className="font-bold tracking-widest text-green-300 uppercase text-sm">Iriga<span className="text-green-500">Pro</span></span>
        </Link>
        <span className="text-green-800">|</span>
        <span className="text-green-600 text-sm">Dashboard</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-green-600 text-sm hidden sm:block">{user.email}</span>
          <button onClick={handleLogout} className="btn-ghost text-xs py-1.5 px-3">Deconectare</button>
        </div>
      </header>

      <main className="flex-1 px-6 py-8 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-green-100">Bună, {userName}! 👋</h1>
            <p className="text-green-600 text-sm mt-1">
              {projects.length===0 ? 'Nu ai proiecte încă. Creează primul tău proiect!'
                : `${projects.length} proiect${projects.length>1?'e':''} salvat${projects.length>1?'e':''}`}
            </p>
          </div>
          <button onClick={openModal} className="btn-primary px-6 py-2.5">+ Proiect nou</button>
        </div>

        {/* ── Modal ───────────────────────────────────────────── */}
        {showNew && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e=>{if(e.target===e.currentTarget) setShowNew(false);}}>
            <div className="bg-green-950 border border-green-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">

              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-green-900 sticky top-0 bg-green-950 z-10">
                <div>
                  <h2 className="font-bold text-green-100 text-lg">Proiect nou</h2>
                  <div className="flex items-center gap-2 mt-1.5">
                    {([1,2] as (1|2)[]).map(s=>(
                      <div key={s} className="flex items-center gap-1.5">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                          ${step>=s?'bg-green-600 text-white':'border border-green-800 text-green-700'}`}>{s}</div>
                        <span className={`text-[11px] ${step>=s?'text-green-400':'text-green-700'}`}>
                          {s===1?'Informații':'Forma curții'}
                        </span>
                        {s<2&&<span className="text-green-800 text-xs">›</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={()=>setShowNew(false)} className="text-green-700 hover:text-green-400 text-2xl w-8 h-8 flex items-center justify-center">×</button>
              </div>

              <div className="px-6 py-5">
                {/* Step 1 */}
                {step===1 && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="label">Nume proiect <span className="text-red-500">*</span></label>
                      <input className="input" value={newName} autoFocus
                        onChange={e=>setNewName(e.target.value)}
                        onKeyDown={e=>e.key==='Enter'&&canCreate&&setStep(2)}
                        placeholder="ex: Curte casă Ionescu" />
                    </div>
                    <div>
                      <label className="label">Locație <span className="text-green-700">(opțional)</span></label>
                      <input className="input" value={newLoc}
                        onChange={e=>setNewLoc(e.target.value)}
                        placeholder="ex: Timișoara, str. Florilor 12" />
                    </div>
                    <div className="bg-green-900/20 border border-green-800 rounded-xl p-4 flex gap-3 items-start">
                      <span className="text-3xl mt-0.5">✏️</span>
                      <div>
                        <div className="text-green-200 font-semibold text-sm mb-1">Desenezi forma în pasul următor</div>
                        <div className="text-green-500 text-xs mb-2">Canvas cu grilă metrică · snap automat la 45° · orice formă de poligon</div>
                        <div className="flex flex-wrap gap-1">
                          {['Dreptunghi','Formă L','Formă U','Formă T','Trapez','Poligon liber'].map(s=>(
                            <span key={s} className="text-[10px] bg-green-900/60 border border-green-700 text-green-300 px-1.5 py-0.5 rounded-full">{s}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={()=>setShowNew(false)} className="btn-ghost flex-1">Anulează</button>
                      <button onClick={()=>setStep(2)} disabled={!canCreate} className="btn-primary flex-1 disabled:opacity-40">
                        Continuă → Desenează forma
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2 */}
                {step===2 && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <button onClick={()=>setStep(1)} className="text-green-600 hover:text-green-400 text-sm flex items-center gap-1">
                        ← <span className="font-mono text-xs truncate max-w-[140px]">{newName}</span>
                      </button>
                      {polygon.length>=3&&(
                        <span className="text-[11px] text-green-300 bg-green-900/60 border border-green-700 px-2 py-0.5 rounded-full font-mono">
                          ✓ {polygon.length} vârfuri · {polyArea(polygon).toFixed(0)} m²
                        </span>
                      )}
                    </div>

                    <PolygonCanvas onPolygonChange={setPolygon} />

                    <div className="flex gap-2 pt-1">
                      <button onClick={()=>setStep(1)} className="btn-ghost flex-1">← Înapoi</button>
                      <button onClick={createProject} disabled={creating||!canCreate} className="btn-primary flex-1 disabled:opacity-40">
                        {creating ? '⏳ Se creează...'
                          : polygon.length>=3 ? `🚀 Creează (${polyArea(polygon).toFixed(0)} m²)`
                          : '🚀 Creează fără formă'}
                      </button>
                    </div>
                    {polygon.length<3&&(
                      <p className="text-[10px] text-green-700 text-center">
                        Poți sări acest pas — forma se poate desena și în simulator
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Grid ──────────────────────────────────────────────── */}
        {projects.length===0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <div className="text-6xl opacity-30">🌱</div>
            <p className="text-green-600 text-lg">Niciun proiect încă</p>
            <button onClick={openModal} className="btn-primary px-8">Creează primul proiect</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p=>(
              <ProjectCard key={p.id} project={p} onDelete={()=>deleteProject(p.id)} deleting={deleting===p.id}/>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectCard({project:p,onDelete,deleting}:{project:DbProject;onDelete:()=>void;deleting:boolean}) {
  const spCount  = (p.sprinklers as unknown[])?.length??0;
  const circCount= (p.circuits   as unknown[])?.length??0;
  const updated  = new Date(p.updated_at).toLocaleDateString('ro-RO');
  const area     = p.area_m2 ? `${p.area_m2.toFixed(0)} m²`
    : p.length_m&&p.width_m ? `~${(p.length_m*p.width_m).toFixed(0)} m²` : '—';
  const polyPts  = (p.polygon as {x:number;y:number}[]|null)??[];

  return (
    <div className="card hover:border-green-600 transition-all group flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-green-100 truncate group-hover:text-green-200">{p.name}</h3>
          {p.location&&<p className="text-green-600 text-xs truncate mt-0.5">📍 {p.location}</p>}
        </div>
        <MiniShape pts={polyPts}/>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[{lbl:'Suprafață',val:area},{lbl:'Aspersoare',val:spCount},{lbl:'Circuite',val:circCount}].map(s=>(
          <div key={s.lbl} className="bg-green-950 rounded-lg p-2 text-center border border-green-900">
            <div className="text-green-300 font-bold text-sm font-mono">{s.val}</div>
            <div className="text-green-700 text-xs">{s.lbl}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <span className="text-green-700 text-xs">Actualizat {updated}</span>
        <div className="flex gap-2">
          <button onClick={onDelete} disabled={deleting} className="text-xs text-red-600 hover:text-red-400 transition-colors px-1">
            {deleting?'...':'Șterge'}
          </button>
          <Link href={`/simulator/${p.id}`} className="btn-primary text-xs py-1.5 px-4">Deschide →</Link>
        </div>
      </div>
    </div>
  );
}

function MiniShape({pts}:{pts:{x:number;y:number}[]}) {
  if (pts.length<3) return <div className="w-9 h-9 rounded border border-green-900 flex items-center justify-center flex-shrink-0"><span className="text-green-800 text-xs">—</span></div>;
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const W=maxX-minX||1,H=maxY-minY||1;
  const SIZE=36,scale=SIZE/Math.max(W,H)*0.82;
  const ox=(SIZE-W*scale)/2,oy=(SIZE-H*scale)/2;
  const d=pts.map((p,i)=>`${i===0?'M':'L'}${((p.x-minX)*scale+ox).toFixed(1)},${((p.y-minY)*scale+oy).toFixed(1)}`).join(' ')+'Z';
  return (
    <svg width={SIZE} height={SIZE} className="flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
      <path d={d} fill="rgba(46,125,50,0.4)" stroke="#5cb85c" strokeWidth="1.2"/>
    </svg>
  );
}
