import { deleteDocument } from '@/app/(app)/actions';
import { docLabel, expiryText } from '@/lib/alerts';
import { expiryStatus, expiryTone } from '@/lib/rules/expiry';
import { fmtDate } from '@/lib/time';
import type { DocumentRow } from '@/lib/types';
import { Badge, linkClass } from './ui';

export function DocTable({
  docs,
  today,
  alertDays,
  ownerOf,
  back,
  canDelete,
}: {
  docs: DocumentRow[];
  today: string;
  alertDays: number[];
  ownerOf?: (d: DocumentRow) => string;
  back: string;
  canDelete: boolean;
}) {
  if (docs.length === 0) return <p className="text-sm text-carbon/70">No documents.</p>;
  return (
    <div className="-m-4 overflow-x-auto">
      <table>
        <thead>
          <tr>{ownerOf && <th>Belongs to</th>}<th>Document</th><th>Number</th><th>Expiry</th><th>Status</th><th>File</th>{canDelete && <th />}</tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const status = expiryStatus(d.expires_on, today, alertDays);
            return (
              <tr key={d.id}>
                {ownerOf && <td className="font-medium">{ownerOf(d)}</td>}
                <td>{docLabel(d.doc_type)}{d.notes && <span className="block text-xs text-carbon/60">{d.notes}</span>}</td>
                <td>{d.doc_number ?? '—'}</td>
                <td className="whitespace-nowrap">{d.expires_on ? fmtDate(d.expires_on) : '—'}</td>
                <td><Badge tone={expiryTone(status, alertDays)}>{expiryText(status)}</Badge></td>
                <td>{d.file_path ? <a className={linkClass} href={`/documents/${d.id}/file`} target="_blank">View</a> : <span className="text-carbon/50">None</span>}</td>
                {canDelete && (
                  <td>
                    <form action={deleteDocument}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="back" value={back} />
                      <button className="cursor-pointer text-xs text-alert-red underline">Remove</button>
                    </form>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
