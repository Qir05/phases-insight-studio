import type { Question, QuestionOption, Tool } from './supabase';
import { getOptionLabel, getOptionValue, isOptionObject } from './scoring';

/**
 * Fields of a tool that the public quiz page needs. Everything else
 * (prompts, scoring/result config, webhook URLs, admin notes, workspace)
 * stays server-side.
 */
export function publicTool(tool: Tool) {
  return {
    id:                    tool.id,
    title:                 tool.title,
    slug:                  tool.slug,
    description:           tool.description,
    email_capture_enabled: tool.email_capture_enabled,
    phone_capture_enabled: tool.phone_capture_enabled,
    provider_name:         tool.provider_name,
    provider_logo_url:     tool.provider_logo_url,
    primary_color:         tool.primary_color,
    tool_mode:             tool.tool_mode,
  };
}

/** Question fields needed to render the quiz — option scores/categories are stripped. */
export function publicQuestion(q: Question) {
  const options = Array.isArray(q.options)
    ? (q.options as QuestionOption[]).map((o) =>
        isOptionObject(o) ? { label: getOptionLabel(o), value: getOptionValue(o) } : o
      )
    : null;
  return {
    id:            q.id,
    label:         q.label,
    variable_name: q.variable_name,
    field_type:    q.field_type,
    options,
    required:      q.required,
    order_index:   q.order_index,
  };
}
