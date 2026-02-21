import { NextResponse } from 'next/server';
import { createClient }  from '@/lib/supabase/server';

interface Params { params: { id: string } }

// GET /api/projects/[id]
export async function GET(_req: Request, { params }: Params) {
  const sb = createClient();
  const { data, error } = await sb
    .from('projects').select('*').eq('id', params.id).single();
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(data);
}

// PATCH /api/projects/[id]
export async function PATCH(req: Request, { params }: Params) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { data, error } = await sb
    .from('projects').update(body).eq('id', params.id).eq('user_id', user.id)
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/projects/[id]
export async function DELETE(_req: Request, { params }: Params) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await sb
    .from('projects').delete().eq('id', params.id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
