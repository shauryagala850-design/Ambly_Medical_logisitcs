import { NextResponse } from 'next/server';
import { MANAGERS, requireUser } from '@/lib/auth';

/** Opens a stored document through a signed link that expires after 60 seconds. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(MANAGERS);
  const { data: doc } = await supabase.from('documents').select('file_path').eq('id', id).maybeSingle();
  if (!doc?.file_path) return new NextResponse('No file is attached to this document.', { status: 404 });
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60);
  if (error || !data) {
    return new NextResponse('You do not have permission to open this file. Staff documents can be opened by admins only.', { status: 403 });
  }
  return NextResponse.redirect(data.signedUrl);
}
