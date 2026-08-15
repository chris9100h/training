-- Chat image attachments + seen tracking
ALTER TABLE zane_coaching_notes ADD COLUMN IF NOT EXISTS attachments jsonb;

-- Storage bucket for chat images (public so URLs are directly usable in <img> tags)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  true,
  10485760,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/heic','image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: authenticated users can upload to their own folder
DROP POLICY IF EXISTS "chat_attach_insert" ON storage.objects;
CREATE POLICY "chat_attach_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: public reads (bucket is public, belt-and-suspenders)
DROP POLICY IF EXISTS "chat_attach_select" ON storage.objects;
CREATE POLICY "chat_attach_select" ON storage.objects
FOR SELECT USING (bucket_id = 'chat-attachments');

-- RLS: users can delete their own uploads
DROP POLICY IF EXISTS "chat_attach_delete" ON storage.objects;
CREATE POLICY "chat_attach_delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
