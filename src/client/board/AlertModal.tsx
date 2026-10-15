/**
 * A lightweight alert modal — replaces native alert() with a themed overlay
 * that matches the shell design tokens. Also ships a 3-button confirm modal
 * for the "archive sessions on ✓ Done" prompt (0.9.x).
 *
 * @module dsh-taskboard/client/board/AlertModal
 */
import { useState, useEffect, useCallback } from 'react'
import { useT } from '../i18n/runtime.ts'

/** Show a non-blocking alert modal. Returns true when opened. */
export function useAlert(): { alert: (msg: string) => void; el: React.ReactNode } {
  const [msg, setMsg] = useState<string | null>(null)
  const show = (m: string) => setMsg(m)
  const close = () => setMsg(null)
  const el = msg !== null
    ? <AlertModal message={msg} onClose={close} />
    : null
  return { alert: show, el }
}

/** The verdict a {@link useConfirm} prompt resolves to. */
export type ConfirmVerdict = 'yes' | 'no' | 'cancel'

/** Inputs of one confirm prompt. */
export interface ConfirmRequest {
  /** Heading above the body (translated or plain text). */
  title: string
  /** Body text — supports `\n` line breaks. */
  body: string
  /** Label for the affirmative button. */
  yesText: string
  /** Label for the negative button. */
  noText: string
  /** Optional label for the dismiss button (defaults to 'shared.cancel'). */
  cancelText?: string
  /** When true, render the positive action as a danger-styled button. */
  yesDanger?: boolean
}

/** Imperative three-button prompt. Resolves with the chosen verdict. */
export function useConfirm(): { confirm: (req: ConfirmRequest) => Promise<ConfirmVerdict>; el: React.ReactNode } {
  const [req, setReq] = useState<ConfirmRequest | null>(null)
  const resolverRef = useState<((v: ConfirmVerdict) => void) | null>(null)[0]
  const setResolver = useState<((v: ConfirmVerdict) => void) | null>(null)[1]
  const close = useCallback((verdict: ConfirmVerdict) => {
    setReq(current => {
      if (current === null) return current
      const r = resolverRef
      setResolver(null)
      r?.(verdict)
      return null
    })
  }, [resolverRef, setResolver])
  const confirm = useCallback((next: ConfirmRequest) => new Promise<ConfirmVerdict>(resolve => {
    setResolver(() => resolve)
    setReq(next)
  }), [setResolver])
  const el = req !== null
    ? <ConfirmModal req={req} onClose={close} />
    : null
  return { confirm, el }
}

function AlertModal({ message, onClose }: { message: string; onClose: () => void }) {
  const t = useT()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="dsh-atb-alert-backdrop" onClick={onClose}>
      <div className="dsh-atb-alert" onClick={e => e.stopPropagation()}>
        <div className="dsh-atb-alert-icon">⛔</div>
        <div className="dsh-atb-alert-msg">{message}</div>
        <button type="button" className="dsh-atb-btn" data-primary="true" onClick={onClose}>{t('alert.ok')}</button>
      </div>
    </div>
  )
}

function ConfirmModal({ req, onClose }: { req: ConfirmRequest; onClose: (v: ConfirmVerdict) => void }) {
  const t = useT()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose('cancel')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  return (
    <div className="dsh-atb-alert-backdrop" onClick={() => onClose('cancel')}>
      <div className="dsh-atb-alert" onClick={e => e.stopPropagation()}>
        <div className="dsh-atb-alert-icon">❓</div>
        <div className="dsh-atb-alert-msg">
          {req.title.length > 0 && <div className="dsh-atb-alert-title">{req.title}</div>}
          {req.body.split('\n').map((line, i) => <p key={i} style={{ margin: i === 0 ? 0 : '0.4em 0 0 0' }}>{line}</p>)}
        </div>
        <div className="dsh-atb-alert-actions">
          <button type="button" className="dsh-atb-btn" onClick={() => onClose('no')}>{req.noText}</button>
          <button
            type="button"
            className="dsh-atb-btn"
            data-primary="true"
            data-danger={req.yesDanger === true ? 'true' : undefined}
            onClick={() => onClose('yes')}
          >
            {req.yesText}
          </button>
          <button type="button" className="dsh-atb-btn" onClick={() => onClose('cancel')}>{req.cancelText ?? t('shared.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
