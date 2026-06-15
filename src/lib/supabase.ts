import { createClient } from '@supabase/supabase-js';

// Public client – safe for browser/server components (anon key)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Server-only admin client – never expose to browser
export function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Tool {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  system_prompt: string;
  email_capture_enabled: boolean;
  phone_capture_enabled: boolean;
  ghl_enabled: boolean;
  ghl_webhook_url: string | null;
  ghl_tag: string | null;
  // Provider branding (added via provider-tool-upgrade.sql migration)
  provider_name: string | null;
  provider_logo_url: string | null;
  primary_color: string | null;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  tool_id: string;
  label: string;
  variable_name: string;
  field_type: 'text' | 'textarea' | 'radio' | 'checkbox' | 'dropdown' | 'number';
  options: string[] | null;
  required: boolean;
  order_index: number;
  created_at: string;
}

export interface Submission {
  id: string;
  tool_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  answers: Record<string, string | string[]>;
  compiled_prompt: string | null;
  ai_result: string | null;
  result_token: string;
  ghl_sync_status: 'pending' | 'success' | 'failed' | 'skipped' | null;
  ghl_response: Record<string, unknown> | null;
  created_at: string;
}
