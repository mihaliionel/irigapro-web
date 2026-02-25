'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { DbProject } from '@/types';
import type { User } from '@supabase/supabase-js';

interface Props { user: User; projects: DbProject[]; }

export default function DashboardClient({ user, projects }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showNew, setShowNew]   = useState(false);
  const [newName, setNewName]   = useState('');
  const [newLoc,  setNewLoc]    = useState('');

  async function handleLogout() {
    const sb = createClient();
    await sb.auth.signOut();
    router.push('/');
  }

  async function createProject() {
    if (!newName.trim()) return;
    setCreating(true);
    const sb = createClient();
    const { data } = await sb.from('projects').insert({
      user_id:  user.id,
      name:     newName.trim(),
      location: newLoc.trim(),
      // No pre-set dimensions — user draws any shape in the simulator
      length_m: 0,
      width_m:  0,
      polygon:  [],
      circuits: [
        {id:'c1',name:'Circuit 1',color:'#4CAF50',sprinkler:'Rain Bird 3504',radius:6,pressure:2.5,flow:0.9},
        {id:'c2',name:'Circuit 2',color:'#2196F3',sprinkler:'Rain Bird 3504',radius:6,pressure:2.5,flow:0.9},
        {id:'c3',name:'Circuit 3',color:'#FF9800',sprinkler:'Rain Bird XFCV Drip',radius:2,pressure:1.5,flow:0.05},
      ],
      sprinklers: [],
      pipes: [],
    }).select().single();

    setCreating(false);
    if (data) router.push(`/simulator/${data.id}`);
  }

  async function deleteProject(id: string) {
    if (!confirm('Ștergi proiectul? Acțiunea este ireversibilă.')) return;
    setDeleting(id);
    const sb = createClient();
    await sb.from('projects').delete().eq('id', id);
    router.refresh();
    setDeleting(null);
  }

  const userName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'tu';

  return (
    <div className="min-h-screen bg-green-950 flex flex-col">
      {/* Top bar */}
      <header className="border-b border-green-900 px-6 py-3 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl">🌿</span>
          <span className="font-bold tracking-widest text-green-300 uppercase text-sm">
            Iriga<span className="text-green-500">Pro</span>
          </span>
        </Link>
        <span className="text-green-800">|</span>
        <span className="text-green-600 text-sm">Dashboard</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-green-600 text-sm hidden sm:block">{user.email}</span>
          <button onClick={handleLogout} className="btn-ghost text-xs py-1.5 px-3">
            Deconectare
          </button>
        </div>
      </header>

      <main className="flex-1 px-6 py-8 max-w-6xl mx-auto w-full">
        {/* Welcome */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-green-100">
              Bună, {userName}! 👋
            </h1>
            <p className="text-green-600 text-sm mt-1">
              {projects.length === 0
                ? 'Nu ai proiecte încă. Creează primul tău proiect!'
                : `${projects.length} proiect${projects.length > 1 ? 'e' : ''} salvat${projects.length > 1 ? 'e' : ''}`
              }
            </p>
          </div>
          <button onClick={() => setShowNew(true)} className="btn-primary px-6 py-2.5">
            + Proiect nou
          </button>
        </div>

        {/* New project modal */}
        {showNew && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => { if(e.target===e.currentTarget) setShowNew(false); }}>
            <div className="card w-full max-w-md">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-bold text-green-100 text-lg">Proiect nou</h2>
                  <p className="text-green-600 text-xs mt-0.5">Forma curții se desenează direct în simulator</p>
                </div>
                <button onClick={() => setShowNew(false)} className="text-green-700 hover:text-green-400 text-xl leading-none">×</button>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="label">Nume proiect <span className="text-red-500">*</span></label>
                  <input className="input" value={newName} autoFocus
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key==='Enter' && newName.trim() && createProject()}
                    placeholder="ex: Curte casă Ionescu" />
                </div>
                <div>
                  <label className="label">Locație <span className="text-green-700">(opțional)</span></label>
                  <input className="input" value={newLoc}
                    onChange={e => setNewLoc(e.target.value)}
                    placeholder="ex: Timișoara, str. Florilor 12" />
                </div>

                {/* Info banner */}
                <div className="bg-green-950/60 border border-green-800 rounded-lg p-3 flex gap-3 items-start">
                  <span className="text-2xl mt-0.5">✏️</span>
                  <div className="text-xs text-green-400 space-y-1">
                    <div className="font-semibold text-green-300">Formă liberă în simulator</div>
                    <div>Click punct cu punct pentru <strong>orice formă</strong> de curte:</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {['Dreptunghi','Formă L','Formă U','Trapez','Poligon liber','Curte cu intrânduri'].map(s=>(
                        <span key={s} className="bg-green-900/60 border border-green-700 rounded px-1.5 py-0.5 text-green-300">{s}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowNew(false)} className="btn-ghost flex-1">Anulează</button>
                <button onClick={createProject} disabled={creating || !newName.trim()} className="btn-primary flex-1">
                  {creating ? '⏳ Se creează...' : '🚀 Creează proiect'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Project grid */}
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <div className="text-6xl opacity-30">🌱</div>
            <p className="text-green-600 text-lg">Niciun proiect încă</p>
            <button onClick={() => setShowNew(true)} className="btn-primary px-8">
              Creează primul proiect
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => (
              <ProjectCard key={p.id} project={p}
                onDelete={() => deleteProject(p.id)}
                deleting={deleting === p.id} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectCard({ project: p, onDelete, deleting }:
  { project: DbProject; onDelete: () => void; deleting: boolean }) {

  const spCount  = (p.sprinklers as unknown[])?.length ?? 0;
  const circCount = (p.circuits as unknown[])?.length ?? 0;
  const updated  = new Date(p.updated_at).toLocaleDateString('ro-RO');

  return (
    <div className="card hover:border-green-600 transition-all group flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-green-100 truncate group-hover:text-green-200">
            {p.name}
          </h3>
          {p.location && (
            <p className="text-green-600 text-xs truncate mt-0.5">📍 {p.location}</p>
          )}
        </div>
        {p.is_public && (
          <span className="text-xs bg-green-900 border border-green-700 text-green-400 px-2 py-0.5 rounded-full flex-shrink-0">
            public
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { lbl: 'Suprafață', val: p.area_m2 ? `${p.area_m2.toFixed(0)} m²` : (p.length_m && p.width_m ? `~${(p.length_m * p.width_m).toFixed(0)} m²` : '—') },
          { lbl: 'Aspersoare', val: spCount },
          { lbl: 'Circuite', val: circCount },
        ].map(s => (
          <div key={s.lbl} className="bg-green-950 rounded-lg p-2 text-center border border-green-900">
            <div className="text-green-300 font-bold text-sm font-mono">{s.val}</div>
            <div className="text-green-700 text-xs">{s.lbl}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <span className="text-green-700 text-xs">Actualizat {updated}</span>
        <div className="flex gap-2">
          <button onClick={onDelete} disabled={deleting}
            className="text-xs text-red-600 hover:text-red-400 transition-colors px-1">
            {deleting ? '...' : 'Șterge'}
          </button>
          <Link href={`/simulator/${p.id}`}
            className="btn-primary text-xs py-1.5 px-4">
            Deschide →
          </Link>
        </div>
      </div>
    </div>
  );
}
