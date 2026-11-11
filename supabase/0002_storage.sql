-- Private file storage for staff and vehicle documents.
-- Object paths: <site-slug>/staff/<staff-id>/<file>  or  <site-slug>/vehicle/<vehicle-id>/<file>
-- Files are only ever opened through short-lived signed links.

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 5242880)
on conflict (id) do nothing;

create policy documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.has_role('admin', 'ops_manager'));

-- Staff documents (IDs etc.) can be opened by admins only; the ops manager can open vehicle documents.
create policy documents_view on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      public.has_role('admin')
      or (public.has_role('ops_manager') and (storage.foldername(name))[2] = 'vehicle')
    )
  );

create policy documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.has_role('admin'));
