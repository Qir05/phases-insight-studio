-- Provider branding columns for tools
ALTER TABLE tools ADD COLUMN IF NOT EXISTS provider_name      text;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS provider_logo_url  text;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS primary_color      text;

-- Store the compiled prompt alongside each submission for transparency/debugging
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS compiled_prompt text;
