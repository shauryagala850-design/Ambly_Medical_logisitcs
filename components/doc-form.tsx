import { DOC_LABELS } from '@/config/sites/types';
import { addDocument } from '@/app/(app)/actions';
import { Button } from './ui';

/** Form to record a document (and optionally upload the file) for one staff member or one of the given vehicles. */
export function DocForm({
  back,
  staffId,
  vehicles,
  types,
}: {
  back: string;
  staffId?: string;
  vehicles?: { id: string; registration: string }[];
  types: string[];
}) {
  const others = Object.keys(DOC_LABELS).filter((t) => !types.includes(t));
  return (
    <form action={addDocument} className="space-y-3">
      <input type="hidden" name="back" value={back} />
      {staffId && <input type="hidden" name="staff_id" value={staffId} />}
      {vehicles && (
        <label>Vehicle
          <select name="vehicle_id" required>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration}</option>)}
          </select>
        </label>
      )}
      <label>Document type
        <select name="doc_type" required>
          <optgroup label="Required">{types.map((t) => <option key={t} value={t}>{DOC_LABELS[t] ?? t}</option>)}</optgroup>
          <optgroup label="Other">{others.map((t) => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}</optgroup>
        </select>
      </label>
      <label>Document number<input name="doc_number" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label>Issued on<input name="issued_on" type="date" /></label>
        <label>Expires on<input name="expires_on" type="date" /></label>
      </div>
      <label>Scan or photo (PDF or image, up to 4 MB)<input name="file" type="file" accept="application/pdf,image/*" /></label>
      <label>Notes<input name="notes" /></label>
      <Button type="submit">Add document</Button>
    </form>
  );
}
