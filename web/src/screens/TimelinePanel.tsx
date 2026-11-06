import { useMemo, useState } from 'react';
import { Claim, SectionKey, sectionForCategory, SECTION_TITLES } from '@knowbridge/shared';

type KindFilter = 'all' | 'github' | 'document';

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function TimelinePanel({ claims }: { claims: Claim[] }) {
  const [kind, setKind] = useState<KindFilter>('all');

  const visible = useMemo(
    () =>
      claims.filter(
        (claim) => claim.review_state !== 'excluded' && (kind === 'all' || claim.source_kind === kind),
      ),
    [claims, kind],
  );

  const dated = useMemo(
    () =>
      visible
        .filter((claim) => claim.occurred_at)
        .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at))),
    [visible],
  );
  const undated = visible.filter((claim) => !claim.occurred_at);

  const groups = useMemo(() => {
    const byMonth = new Map<string, Claim[]>();
    for (const claim of dated) {
      const key = monthLabel(String(claim.occurred_at));
      const list = byMonth.get(key) ?? [];
      list.push(claim);
      byMonth.set(key, list);
    }
    return [...byMonth.entries()];
  }, [dated]);

  const githubCount = visible.filter((claim) => claim.source_kind === 'github').length;
  const documentCount = visible.length - githubCount;
  const corroborated = visible.filter((claim) => claim.corroborations.length > 0).length;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="card pad-lg stack">
        <h3>Cross-source timeline</h3>
        <p className="muted small">
          Claims ordered by the date their source states — commit and issue dates arrive with the repository
          connector. A handover note rarely states a date, so those claims are listed as undated rather than
          guessed.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ width: 200 }}>
            <label htmlFor="timeline-kind">Source type</label>
            <select id="timeline-kind" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
              <option value="all">All sources</option>
              <option value="github">GitHub only</option>
              <option value="document">Documents only</option>
            </select>
          </div>
          <span className="badge cat">{documentCount} document claim(s)</span>
          <span className="badge cat">{githubCount} repository claim(s)</span>
          {corroborated > 0 && <span className="badge supported">{corroborated} corroborated across sources</span>}
        </div>
      </section>

      {groups.length === 0 && (
        <div className="empty">
          <strong>No dated activity yet</strong>
          <p className="small">
            Connect a GitHub repository in Sources to bring commits and issues onto the timeline.
          </p>
        </div>
      )}

      {groups.map(([month, monthClaims]) => (
        <section key={month} className="stack">
          <div className="section-title">
            <h3>{month}</h3>
            <span className="badge cat">{monthClaims.length}</span>
          </div>
          <div className="timeline">
            {monthClaims.map((claim) => (
              <article key={claim.id} className="timeline-row">
                <div className="timeline-date">
                  {claim.occurred_at ? dayLabel(claim.occurred_at) : '—'}
                  <span className={`badge ${claim.source_kind === 'github' ? 'supported' : 'cat'}`}>
                    {claim.source_kind}
                  </span>
                </div>
                <div className="timeline-body">
                  <div className="pill-row">
                    <span className="badge cat">{claim.category.replace('_', ' ')}</span>
                    <span className={`badge ${claim.status}`}>{claim.status.replace('_', ' ')}</span>
                    {claim.review_state !== 'pending' && (
                      <span className={`badge ${claim.review_state}`}>{claim.review_state}</span>
                    )}
                  </div>
                  <p className="small" style={{ margin: '6px 0' }}>
                    {claim.text}
                  </p>
                  <span className="muted tiny">
                    {claim.evidence.source_title}
                    {claim.evidence.location ? ` · ${claim.evidence.location}` : ''} ·{' '}
                    {SECTION_TITLES[sectionForCategory(claim.category) as SectionKey]}
                  </span>
                  {claim.corroborations.length > 0 && (
                    <div className="corroboration">
                      Also stated in{' '}
                      {claim.corroborations.map((match, index) => (
                        <span key={match.claim_id}>
                          {index > 0 ? ', ' : ''}
                          <strong>{match.source_title}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {undated.length > 0 && (
        <section className="stack">
          <div className="section-title">
            <h3>Undated</h3>
            <span className="badge cat">{undated.length}</span>
          </div>
          <p className="muted small">Claims whose source does not state a date.</p>
          <div className="grid">
            {undated.map((claim) => (
              <article key={claim.id} className="claim-card">
                <div className="pill-row">
                  <span className="badge cat">{claim.category.replace('_', ' ')}</span>
                  <span className={`badge ${claim.status}`}>{claim.status.replace('_', ' ')}</span>
                  <span className="badge">{claim.source_kind}</span>
                </div>
                <p className="small">{claim.text}</p>
                <span className="muted tiny">
                  {claim.evidence.source_title}
                  {claim.evidence.location ? ` · ${claim.evidence.location}` : ''}
                </span>
                {claim.corroborations.length > 0 && (
                  <div className="corroboration">
                    Also stated in {claim.corroborations.map((match) => match.source_title).join(', ')}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
