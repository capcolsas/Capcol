-- Private thumbnails inherit the contract's read access and administrative write access.
begin;

alter table public.contracts add column if not exists reference_image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-reference-images', 'contract-reference-images', false, 2097152,
  array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists contract_reference_images_read on storage.objects;
create policy contract_reference_images_read on storage.objects for select to authenticated
using (bucket_id = 'contract-reference-images' and exists (
  select 1 from public.contracts c
  where c.id::text = (storage.foldername(name))[1]
));

drop policy if exists contract_reference_images_insert on storage.objects;
create policy contract_reference_images_insert on storage.objects for insert to authenticated
with check (bucket_id = 'contract-reference-images' and public.is_admin_like() and exists (
  select 1 from public.contracts c
  where c.id::text = (storage.foldername(name))[1]
));

drop policy if exists contract_reference_images_delete on storage.objects;
create policy contract_reference_images_delete on storage.objects for delete to authenticated
using (bucket_id = 'contract-reference-images' and public.is_admin_like() and exists (
  select 1 from public.contracts c
  where c.id::text = (storage.foldername(name))[1]
    and c.reference_image_path is distinct from name
));

commit;
