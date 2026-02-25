'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import SimulatorClient from './SimulatorClient';

export default function SimulatorWrapper({ id }: { id: string }) {
  const [project, setProject]       = useState<any>(null);
  const [sprinklerDb, setSprinklerDb] = useState<any[]>([]);
  const [loading, setLoading]        = useState(true);
  const [notFound, setNotFound]      = useState(false);

  useEffect(() => {
    async function load() {
      const sb = createClient();

      const { data: project } = await sb
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();

      if (!project) { setNotFound(true); setLoading(false); return; }

      const { data: sprinklers } = await sb
        .from('sprinkler_models')
        .select('*')
        .eq('is_public', true)
        .order('brand').order('model');

      setProject(project);
      setSprinklerDb(sprinklers ?? []);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) return (
    <div className="min-h-screen bg-green-950 flex items-center justify-center">
      <div className="text-green-400 animate-pulse">Se încarcă simulatorul...</div>
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-green-950 flex items-center justify-center">
      <div className="text-red-400">Proiectul nu a fost găsit.</div>
    </div>
  );

  return (
    <SimulatorClient
      project={project}
      sprinklerDb={sprinklerDb}
      isOwner={true}
    />
  );
}