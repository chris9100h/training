-- Allow admin to delete any file in chat-attachments (e.g. when deleting a ticket)
DROP POLICY IF EXISTS "chat_attach_delete" ON storage.objects;
CREATE POLICY "chat_attach_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-attachments' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR auth.email() = 'office@btc-prime.biz'
  )
);
