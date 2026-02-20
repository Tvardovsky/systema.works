'use client';

import {FormEvent, useEffect, useMemo, useState} from 'react';
import {Turnstile} from '@marsidev/react-turnstile';
import {useLocale, useTranslations} from 'next-intl';
import type {Locale, ServiceInterest} from '@/types/lead';

type ChatResult = {
  answer: string;
  topic: 'allowed' | 'disallowed' | 'unclear';
  leadIntentScore: number;
  nextQuestion: string;
  requiresLeadCapture: boolean;
};

export function ChatWidget() {
  const t = useTranslations('Chat');
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{role: 'user' | 'assistant'; content: string}>>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [intentScore, setIntentScore] = useState(0);
  const [leadSent, setLeadSent] = useState(false);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const canStart = useMemo(() => Boolean(sessionId), [sessionId]);

  useEffect(() => {
    const openFromEvent = () => setOpen(true);

    const openFromClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      const trigger = target.closest('[data-chat-open]');
      if (!trigger) {
        return;
      }

      event.preventDefault();
      setOpen(true);
    };

    window.addEventListener('systema:open-chat', openFromEvent as EventListener);
    document.addEventListener('click', openFromClick);

    return () => {
      window.removeEventListener('systema:open-chat', openFromEvent as EventListener);
      document.removeEventListener('click', openFromClick);
    };
  }, []);

  async function startSession() {
    if (sessionId) {
      return;
    }

    const response = await fetch('/api/chat/session/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        locale,
        pagePath: window.location.pathname,
        turnstileToken,
        honeypot: ''
      })
    });

    if (!response.ok) {
      setMessages([{role: 'assistant', content: t('startError')}]);
      return;
    }

    const data = (await response.json()) as {sessionId: string; allowed: boolean};
    setSessionId(data.sessionId);
    setMessages([{role: 'assistant', content: t('hello')}]);
  }

  async function onSubmitMessage(event: FormEvent) {
    event.preventDefault();
    if (!sessionId || !input.trim() || loading) {
      return;
    }

    const userText = input.trim();
    setInput('');
    setLoading(true);
    setMessages((prev) => [...prev, {role: 'user', content: userText}]);

    const response = await fetch('/api/chat/message', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sessionId,
        locale,
        message: userText,
        turnstileToken,
        honeypot: ''
      })
    });

    if (!response.ok) {
      setLoading(false);
      setMessages((prev) => [...prev, {role: 'assistant', content: t('replyError')}]);
      return;
    }

    const data = (await response.json()) as ChatResult;
    setIntentScore(data.leadIntentScore);
    setShowLeadForm(data.requiresLeadCapture);
    setMessages((prev) => [...prev, {role: 'assistant', content: data.answer}]);
    setLoading(false);
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const payload = {
      sessionId,
      locale,
      name: String(formData.get('name') ?? ''),
      company: String(formData.get('company') ?? ''),
      serviceInterest: String(formData.get('serviceInterest') ?? 'combo') as ServiceInterest,
      budgetBand: String(formData.get('budgetBand') ?? 'unknown'),
      timeline: String(formData.get('timeline') ?? 'exploring'),
      contactChannel: String(formData.get('contactChannel') ?? 'telegram'),
      contactValue: String(formData.get('contactValue') ?? ''),
      consent: formData.get('consent') === 'on',
      honeypot: ''
    };

    const response = await fetch('/api/lead/submit', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      setLeadSent(true);
      setShowLeadForm(false);
      setMessages((prev) => [...prev, {role: 'assistant', content: t('leadSent')}]);
    }
  }

  return (
    <>
      <button className="chat-launcher" type="button" onClick={() => setOpen((v) => !v)}>
        {open ? t('close') : t('cta')}
      </button>

      {open ? (
        <aside className="chat-panel" aria-label={t('title')}>
          <header>
            <h3>{t('title')}</h3>
            {!canStart && <button type="button" onClick={startSession}>{t('start')}</button>}
          </header>

          {siteKey ? (
            <Turnstile siteKey={siteKey} onSuccess={(token) => setTurnstileToken(token)} options={{theme: 'light'}} />
          ) : null}

          <div className="chat-log">
            {messages.map((item, index) => (
              <p key={`${item.role}-${index}`} className={`chat-message ${item.role}`}>
                {item.content}
              </p>
            ))}
            {loading ? <p className="chat-message assistant">{t('typing')}</p> : null}
          </div>

          <form className="chat-composer" onSubmit={onSubmitMessage}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t('placeholder')}
              disabled={!canStart || loading}
            />
            <button type="submit" disabled={!canStart || loading || !input.trim()}>{t('send')}</button>
          </form>

          {showLeadForm && !leadSent ? (
            <form className="lead-form" onSubmit={submitLead}>
              <h4>{t('leadTitle')} ({intentScore})</h4>
              <input name="name" placeholder={t('name')} required />
              <input name="company" placeholder={t('company')} />
              <select name="serviceInterest" defaultValue="combo">
                <option value="web">Web</option>
                <option value="automation">Automation</option>
                <option value="smm">SMM</option>
                <option value="combo">Combo</option>
              </select>
              <select name="budgetBand" defaultValue="unknown">
                <option value="unknown">Unknown budget</option>
                <option value="<1k">&lt;1k</option>
                <option value="1k-3k">1k-3k</option>
                <option value="3k-10k">3k-10k</option>
                <option value="10k+">10k+</option>
              </select>
              <select name="timeline" defaultValue="exploring">
                <option value="asap">ASAP</option>
                <option value="1m">1 month</option>
                <option value="3m">3 months</option>
                <option value="exploring">Exploring</option>
              </select>
              <select name="contactChannel" defaultValue="telegram">
                <option value="telegram">Telegram</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </select>
              <input name="contactValue" placeholder={t('contact')} required />
              <label>
                <input type="checkbox" name="consent" required /> {t('consent')}
              </label>
              <button type="submit">{t('submitLead')}</button>
            </form>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
