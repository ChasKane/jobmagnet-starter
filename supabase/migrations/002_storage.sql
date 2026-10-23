-- Private buckets. Ignored when this database has no storage schema.
insert into storage.buckets (id, name, public)
values
  ('resumes', 'resumes', false),
  ('action-blobs', 'action-blobs', false),
  ('mail-kept', 'mail-kept', false)
on conflict (id) do nothing;
