import { useState } from 'react';
import { Modal, Field, Select, Textarea } from './ui.tsx';
import { post } from '../lib/api.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { label } from '../lib/format.ts';

export function ReportDialog({ targetType, targetId, onClose }: { targetType: string; targetId: number; onClose: () => void }) {
  const { meta } = useSession();
  const act = useAction();
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await act(() => post('/reports', { target_type: targetType, target_id: targetId, reason, details }), 'Report sent — thank you');
    setBusy(false);
    if (r) onClose();
  };
  return (
    <Modal
      title={`Report ${targetType}`}
      onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={busy} onClick={submit}>Send report</button></>}
    >
      <div className="stack">
        <p className="muted small">Reports are reviewed by the OmniBiz moderation team. Content reported by several people is hidden automatically until reviewed.</p>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)} options={(meta?.report_reasons ?? []).map((r) => ({ value: r, label: label(r) }))} />
        </Field>
        <Field label="Details (optional)">
          <Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} placeholder="What's wrong?" />
        </Field>
      </div>
    </Modal>
  );
}
