import { redirect }    from 'next/navigation';
import Link            from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { DbProject }   from '@/types';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: projects } = await sb
    .from('projects')
    .select('id, name, location, created_at, updated_at, length_m, width_m, area_m2, is_public, circuits, sprinklers')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  return <DashboardClient user={user} projects={(projects ?? []) as DbProject[]} />;
}
