-- ============================================================
-- V2: Update storage policies for anon-key uploads
-- Run this in the Supabase SQL Editor if audio uploads fail
-- ============================================================

-- Ensure audio bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('audio', 'audio', false)
ON CONFLICT (id) DO NOTHING;

-- Drop old restrictive policies (they required auth.uid)
DROP POLICY IF EXISTS "Users can upload audio files" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own audio files" ON storage.objects;

-- Allow uploads from anon key (the app uses signed URLs for access)
CREATE POLICY "Allow audio uploads"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'audio');

-- Allow reads for signed URL generation
CREATE POLICY "Allow audio reads"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'audio');

-- Also relax the transcripts table RLS for anon usage
-- (remove if you add proper auth later)
DROP POLICY IF EXISTS "Users can view own transcripts" ON transcripts;
DROP POLICY IF EXISTS "Users can insert own transcripts" ON transcripts;
DROP POLICY IF EXISTS "Users can update own transcripts" ON transcripts;

CREATE POLICY "Allow all transcript reads"
  ON transcripts FOR SELECT USING (true);

CREATE POLICY "Allow all transcript inserts"
  ON transcripts FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow all transcript updates"
  ON transcripts FOR UPDATE USING (true);
