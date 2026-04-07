-- ============================================================
-- V3: Ensure 'protocols' table has all required columns
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Add columns if they don't exist (safe to run multiple times)
DO $$
BEGIN
  -- file_name column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'protocols' AND column_name = 'file_name'
  ) THEN
    ALTER TABLE protocols ADD COLUMN file_name TEXT DEFAULT '';
  END IF;

  -- audio_url column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'protocols' AND column_name = 'audio_url'
  ) THEN
    ALTER TABLE protocols ADD COLUMN audio_url TEXT;
  END IF;

  -- pdf_text column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'protocols' AND column_name = 'pdf_text'
  ) THEN
    ALTER TABLE protocols ADD COLUMN pdf_text TEXT;
  END IF;

  -- analysis_result JSONB column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'protocols' AND column_name = 'analysis_result'
  ) THEN
    ALTER TABLE protocols ADD COLUMN analysis_result JSONB DEFAULT '{}';
  END IF;

  -- status column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'protocols' AND column_name = 'status'
  ) THEN
    ALTER TABLE protocols ADD COLUMN status TEXT DEFAULT 'done';
  END IF;

  -- created_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'protocols' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE protocols ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
  END IF;
END
$$;

-- Ensure RLS policies allow anon access
ALTER TABLE protocols ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist (safe)
DROP POLICY IF EXISTS "Allow all protocol reads" ON protocols;
DROP POLICY IF EXISTS "Allow all protocol inserts" ON protocols;
DROP POLICY IF EXISTS "Allow all protocol updates" ON protocols;

-- Create open policies for anon key usage
CREATE POLICY "Allow all protocol reads"
  ON protocols FOR SELECT USING (true);

CREATE POLICY "Allow all protocol inserts"
  ON protocols FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow all protocol updates"
  ON protocols FOR UPDATE USING (true);

-- ============================================================
-- Verify: Run this query to check the table structure:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'protocols' ORDER BY ordinal_position;
-- ============================================================
