import { NextResponse } from 'next/server';
import { getServiceClient } from './supabase';
import type { Profile, Tool, ToolStatus } from './supabase';

/** super_admin sees every tool; provider_admin only tools in their own workspace. */
export function canAccessTool(
  role: string,
  workspaceId: string | null,
  toolWorkspaceId: string | null,
): boolean {
  if (role === 'super_admin') return true;
  return !!workspaceId && workspaceId === toolWorkspaceId;
}

/**
 * Loads a tool and enforces workspace access in one step.
 * Returns the tool row, or a 404/403 response to return as-is.
 */
export async function loadToolForAdmin(
  toolId: string,
  profile: Pick<Profile, 'role' | 'workspace_id'>,
): Promise<{ tool: Tool } | { response: NextResponse }> {
  const db = getServiceClient();
  const { data, error } = await db.from('tools').select('*').eq('id', toolId).maybeSingle();
  if (error || !data) {
    return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  if (!canAccessTool(profile.role, profile.workspace_id, data.workspace_id)) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { tool: data as Tool };
}

/** A tool with no status column yet (pre-009 database) is treated as published. */
export function toolStatus(tool: { status?: ToolStatus | null }): ToolStatus {
  return tool.status === 'draft' ? 'draft' : 'published';
}

/** True when PostgREST rejected a write because a column does not exist (migration not applied yet). */
export function isMissingColumnError(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false;
  const msg = error.message ?? '';
  return (error.code === 'PGRST204' || error.code === '42703') && msg.includes(column);
}

/**
 * Inserts a tool as a draft. If the database predates migration 009 (no
 * `status` column) the insert is retried without it, and `draftSupported`
 * is false so the caller can tell the admin the tool is already live.
 */
export async function insertToolRow(row: Record<string, unknown>) {
  const db = getServiceClient();
  const first = await db.from('tools').insert({ ...row, status: 'draft' }).select().single();
  if (first.error && isMissingColumnError(first.error, 'status')) {
    const retry = await db.from('tools').insert(row).select().single();
    return { data: retry.data as Tool | null, error: retry.error, draftSupported: false };
  }
  return { data: first.data as Tool | null, error: first.error, draftSupported: true };
}
