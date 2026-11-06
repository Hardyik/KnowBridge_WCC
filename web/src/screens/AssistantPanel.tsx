import { useEffect, useRef, useState } from 'react';
import { AssistantMessage, AssistantReply } from '@knowbridge/shared';
import { api, ApiError } from '../api';

const STARTERS = [
  'What is still pending and who owns it?',
  'What decisions were made, and why?',
  'What are the open risks and blockers?',
  'What must the incoming person do first?',
  'What is unresolved or contradictory?',
];

export default function AssistantPanel({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ context_claims: number; hidden_by_scope: number } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<{ messages: AssistantMessage[] }>(`/projects/${projectId}/assistant`);
        setMessages(data.messages);
      } catch (err) {
        if (err instanceof ApiError && err.status !== 404) setError(err.message);
      }
    })();
  }, [projectId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setQuestion('');
    const optimistic: AssistantMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: trimmed,
      citations: null,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const reply = await api<AssistantReply>(`/projects/${projectId}/assistant`, {
        method: 'POST',
        body: JSON.stringify({ question: trimmed }),
      });
      setMessages((current) => [...current, reply.message]);
      setMeta({ context_claims: reply.context_claims, hidden_by_scope: reply.hidden_by_scope });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setQuestion(trimmed);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!window.confirm('Clear this conversation? The audit trail keeps a record of questions asked.')) return;
    try {
      await api(`/projects/${projectId}/assistant`, { method: 'DELETE' });
      setMessages([]);
      setMeta(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card pad-lg stack">
        <div className="spread">
          <div>
            <h3>Ask this project</h3>
            <p className="muted small">
              Answers come only from the approved handover — never from general knowledge. Every answer cites
              the claims it used, scoped to your role and each source's confidentiality.
            </p>
          </div>
          {messages.length > 0 && (
            <button className="ghost small" onClick={() => void clear()} disabled={busy}>
              Clear conversation
            </button>
          )}
        </div>

        {messages.length === 0 && (
          <div className="pill-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {STARTERS.map((starter) => (
              <button key={starter} className="chip" onClick={() => void ask(starter)} disabled={busy}>
                {starter}
              </button>
            ))}
          </div>
        )}

        <div className="chat">
          {messages.length === 0 && (
            <div className="chat-empty muted small">
              No questions yet. Ask about pending work, owners, risks or the decisions behind the build.
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={`chat-row ${message.role}`}>
              <div className={`chat-bubble ${message.role}`}>
                {message.role === 'assistant' && !message.citations?.length && (
                  <span className="muted tiny">not in the handover · </span>
                )}
                <span className="chat-text">{message.content}</span>
                {message.citations && message.citations.length > 0 && (
                  <div className="citations">
                    {message.citations.map((citation) => (
                      <div key={`${message.id}-${citation.claim_id}`} className="citation">
                        <span className="tiny">
                          <strong>{citation.source_title}</strong>
                          {citation.location ? ` · ${citation.location}` : ''} · {citation.source_kind}
                        </span>
                        <span className="small">{citation.text}</span>
                        {citation.quote && <span className="quote-block">“{citation.quote}”</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="chat-row assistant">
              <div className="chat-bubble assistant">
                <span className="spinner" /> Reading the handover…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {error && <div className="notice bad">{error}</div>}

        <form
          className="chat-input"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about this project — pending work, owners, risks, why a decision was made…"
            disabled={busy}
          />
          <button className="primary" type="submit" disabled={busy || question.trim().length < 3}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </form>

        {meta && (
          <p className="muted tiny">
            Answered from {meta.context_claims} claim(s) in your scope
            {meta.hidden_by_scope > 0 ? ` · ${meta.hidden_by_scope} withheld by scope or confidentiality` : ''}.
          </p>
        )}
      </section>
    </div>
  );
}
