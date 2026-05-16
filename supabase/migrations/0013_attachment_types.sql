-- Allow link and text attachment types (no storage path / size needed)
ALTER TABLE task_attachments ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE task_attachments ALTER COLUMN mime_type DROP NOT NULL;
ALTER TABLE task_attachments ALTER COLUMN size_bytes DROP NOT NULL;

-- Relax size check to allow NULL (links/text have no size)
ALTER TABLE task_attachments DROP CONSTRAINT IF EXISTS task_attachments_size_bytes_check;
ALTER TABLE task_attachments ADD CONSTRAINT task_attachments_size_bytes_check
  CHECK (size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 26214400));

-- New columns
ALTER TABLE task_attachments
  ADD COLUMN attachment_type text NOT NULL DEFAULT 'file'
    CHECK (attachment_type IN ('file', 'link', 'text')),
  ADD COLUMN url text,
  ADD COLUMN text_content text;

-- Referential integrity per type
ALTER TABLE task_attachments ADD CONSTRAINT attachment_type_fields_check CHECK (
  (attachment_type = 'file' AND storage_path IS NOT NULL) OR
  (attachment_type = 'link' AND url IS NOT NULL) OR
  (attachment_type = 'text' AND text_content IS NOT NULL)
);
