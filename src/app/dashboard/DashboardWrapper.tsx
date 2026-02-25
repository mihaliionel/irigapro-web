'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import DashboardClient from './DashboardClient';

export default function DashboardWrapper() {
  const [user, setUser]       = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading]  = useState(true);

  useEffect(() => {
    async function load() {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      
      if (!user) {
        window.location.href = '/auth/login';
        return;
      }

      const { data: projects } = await sb
        .from('projects')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      setUser(user);
      setProjects(projects ?? []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-green-950 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Se încarcă...</div>
    </div>
  );

  return <DashboardClient user={user} projects={projects} />;
}