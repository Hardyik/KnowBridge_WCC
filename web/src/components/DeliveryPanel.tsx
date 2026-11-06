import { useCallback, useEffect, useState } from 'react';
import {
  DeliveryLink,
  RECIPIENT_SCOPES,
  RecipientScope,
  SCOPE_DESCRIPTIONS,
} from '@knowbridge/shared';
import { api, ApiError } from '../api';

interface Props {
  handoverId: string;
  approved: boolean;
  canManage: boolean;
  canReview: boolean;
}

const EXPIRY_OPTIONS = [1, 3, 7, 14, 30];

export default function DeliveryPanel({ handoverId, approved, canManage, canReview }: Props) {
  const [links, setLinks] = useState<DeliveryLink[]>([]);
  const [scope, setScope] = useState<RecipientScope>('engineer');
  const [days, setDays] = useState(7);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canReview || !handoverId) return;
    try {
      const data = await api<{ deliveries: DeliveryLink[] }>(`/handovers/${handoverId}/deliveries`);
      setLinks(data.deliveries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [handoverId, canReview]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await api<{ delivery: DeliveryLink }>(`/handovers/${handoverId}/deliveries`, {
        method: 'POST',
        body: JSON.stringify({ scope, days, recipient_label: label.trim() || undefined }),
      });
      setLinks((current) => [data.delivery, ...current]);
      setLabel('');
      setMessage('Link created. Copy it and send it to the incoming person.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: DeliveryLink) {
    if (!link.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setMessage('Link copied to the clipboard.');
    } catch {
      setMessage(link.url);
    }
  }

  async function revoke(link: DeliveryLink) {
    if (!window.confirm('Revoke this link? Anyone holding it loses access immediately.')) return;
    setBusy(true);
    try {
      await api(`/deliveries/${link.id}/revoke`, { method: 'POST' });
      await load();
      setMessage('Link revoked.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remind(link: DeliveryLink) {
    setBusy(true);
    try {
      const data = await api<{ delivery: DeliveryLink }>(`/deliveries/${link.id}/remind`, { method: 'POST' });
      if (data.delivery.url) {
        try {
          await navigator.clipboard.writeText(data.delivery.url);
        } catch {
          /* clipboard may be blocked; the message still points at the link */
        }
      }
      setMessage('Reminder recorded in the audit trail — the link is copied so you can resend it.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canReview) {
    return (
      <section className="card pad-lg stack">
        <h3>Deliver this handover</h3>
        <p className="muted small">Only a manager or reviewer can create and track delivery links.</p>
      </section>
    );
  }

  const pending = links.filter((link) => link.needs_reminder);

  return (
    <section className="card pad-lg stack">
      <div className="spread">
        <div>
          <h3>Deliver this handover</h3>
          <p className="muted small">
            An expiring link for someone without a KnowBridge account. The link carries the scope and the
            confidentiality tier, so it can never show more than the manager chose.
          </p>
        </div>
        {pending.length > 0 && (
          <span className="badge conflicting">{pending.length} waiting for acknowledgement</span>
        )}
      </div>

      {error && <div className="notice bad">{error}</div>}
      {message && <div className="notice ok">{message}</div>}

      {!approved ? (
        <div className="notice">Approve the handover first — a link always points at an approved snapshot.</div>
      ) : (
        <div className="grid cols-3" style={{ alignItems: 'end' }}>
          <div>
            <label htmlFor="delivery-scope">Scope for the recipient</label>
            <select
              id="delivery-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as RecipientScope)}
            >
              {RECIPIENT_SCOPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <p className="muted tiny" style={{ marginTop: 4 }}>
              {SCOPE_DESCRIPTIONS[scope]}
            </p>
          </div>
          <div>
            <label htmlFor="delivery-days">Expires in</label>
            <select id="delivery-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} day{option === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="delivery-label">Recipient label (optional)</label>
            <input
              id="delivery-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="New backend engineer"
            />
          </div>
        </div>
      )}

      {approved && (
        <div className="row">
          <button className="primary" disabled={busy || !handoverId} onClick={() => void create()}>
            Create delivery link
          </button>
          {!canManage && <span className="muted tiny">Only the manager can revoke a link.</span>}
        </div>
      )}

      {links.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Recipient</th>
              <th>Scope</th>
              <th>Expires</th>
              <th>Status</th>
              <th>Opened</th>
              <th>Acknowledgement</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.id}>
                <td className="small">{link.recipient_label ?? '—'}</td>
                <td>
                  <span className="badge cat">{link.scope}</span>
                </td>
                <td className="muted small">{new Date(link.expires_at).toLocaleDateString()}</td>
                <td>
                  <span
                    className={`badge ${
                      link.status === 'active' ? 'supported' : link.status === 'revoked' ? 'excluded' : 'pending'
                    }`}
                  >
                    {link.status}
                  </span>
                </td>
                <td className="muted small">
                  {link.opened_at ? `${link.open_count}×` : 'not yet'}
                </td>
                <td className="small">
                  {link.acknowledgement ? (
                    <>
                      {link.acknowledgement.name}
                      <div className="muted tiny">
                        {new Date(link.acknowledgement.acknowledged_at).toLocaleString()}
                      </div>
                    </>
                  ) : (
                    <span className="muted tiny">pending</span>
                  )}
                </td>
                <td>
                  <div className="pill-row">
                    {link.url && (
                      <button className="ghost small" disabled={busy} onClick={() => void copy(link)}>
                        Copy
                      </button>
                    )}
                    {link.needs_reminder && (
                      <button className="ghost small" disabled={busy} onClick={() => void remind(link)}>
                        Remind
                      </button>
                    )}
                    {canManage && link.status === 'active' && (
                      <button className="ghost small danger" disabled={busy} onClick={() => void revoke(link)}>
                        Revoke
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
