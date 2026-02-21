import { notFound, redirect } from 'next/navigation';
import { createClient }       from '@/lib/supabase/server';
import type { DbProject }     from '@/types';
import SimulatorClient        from './SimulatorClient';

interface Props { params: { id: string } }

export default async function SimulatorPage({ params }: Props) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();

  const { data: project } = await sb
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!project) notFound();

  // Check access: owner or public
  if (!project.is_public && (!user || user.id !== project.user_id)) {
    redirect('/auth/login');
  }

  const { data: sprinklerDb } = await sb
    .from('sprinkler_models')
    .select('*')
    .eq('is_public', true)
    .order('brand').order('model');

  return (
    <SimulatorClient
      project={project as DbProject}
      sprinklerDb={sprinklerDb ?? []}
      isOwner={!!user && user.id === project.user_id}
    />
  );
}
