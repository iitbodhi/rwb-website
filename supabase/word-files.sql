-- =====================================================================
-- RWB App: bills and My documents also accept Word files (.doc, .docx)
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================
update storage.buckets set allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id in ('bills', 'docs');
