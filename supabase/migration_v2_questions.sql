-- Migration v2: add variable_name, rename type → field_type, position → order_index
-- Run this in the Supabase SQL Editor if you already ran the original schema.sql.
-- It is safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).

-- 1. Add new columns (no-ops if they already exist)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS variable_name text NOT NULL DEFAULT '';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS field_type   text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS order_index  integer;

-- 2. Back-fill field_type from the old "type" column (if it still exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'type'
  ) THEN
    UPDATE questions SET field_type = type WHERE field_type IS NULL;
  END IF;
END $$;

-- 3. Back-fill order_index from the old "position" column (if it still exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'position'
  ) THEN
    UPDATE questions SET order_index = position WHERE order_index IS NULL;
  END IF;
END $$;

-- 4. Fill any remaining NULLs with safe defaults
UPDATE questions SET field_type  = 'text' WHERE field_type  IS NULL;
UPDATE questions SET order_index = 0       WHERE order_index IS NULL;

-- 5. Apply NOT NULL + check constraint on field_type
ALTER TABLE questions ALTER COLUMN field_type  SET NOT NULL;
ALTER TABLE questions ALTER COLUMN order_index SET NOT NULL;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_field_type_check;
ALTER TABLE questions ADD  CONSTRAINT questions_field_type_check
  CHECK (field_type IN ('text','textarea','radio','checkbox','dropdown','number'));

-- 6. Optional: drop the old columns once you've verified everything works
-- ALTER TABLE questions DROP COLUMN IF EXISTS type;
-- ALTER TABLE questions DROP COLUMN IF EXISTS position;
