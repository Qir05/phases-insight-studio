import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { slugify } from '@/lib/utils';

export async function GET() {
  const db = getServiceClient();
  const { data, error } = await db
    .from('tools')
    .select('*, submissions(count), questions(count)')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tools: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    title, description, system_prompt,
    email_capture_enabled, phone_capture_enabled,
    ghl_enabled, ghl_webhook_url, ghl_tag,
    provider_name, provider_logo_url, primary_color,
  } = body;

  if (!title || !system_prompt) {
    return NextResponse.json({ error: 'title and system_prompt are required' }, { status: 400 });
  }

  const db = getServiceClient();
  const slug = slugify(title);

  const { data, error } = await db
    .from('tools')
    .insert({
      title,
      slug,
      description:             description          ?? null,
      system_prompt,
      email_capture_enabled:   email_capture_enabled ?? true,
      phone_capture_enabled:   phone_capture_enabled ?? false,
      ghl_enabled:             ghl_enabled           ?? false,
      ghl_webhook_url:         ghl_webhook_url       ?? null,
      ghl_tag:                 ghl_tag               ?? null,
      provider_name:           provider_name         ?? null,
      provider_logo_url:       provider_logo_url     ?? null,
      primary_color:           primary_color         ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tool: data }, { status: 201 });
}
