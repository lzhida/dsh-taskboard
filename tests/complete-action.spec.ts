/**
 * Tests for the ✓ Done decision flow (0.9.x): the pure resolver in
 * `src/client/board/complete-action.ts` is the single source of truth shared
 * by the card and detail entry points. Covering the action matrix here keeps
 * the wiring test (TaskCard/TaskDetail) free of branching.
 */
import { describe, expect, it } from 'vitest'
import { resolveCompleteAction } from '../src/client/board/complete-action.ts'

describe('resolveCompleteAction', () => {
  it('factory defaults: archive off → done-only regardless of host capability', () => {
    expect(resolveCompleteAction({ settings: undefined, archiveSessionsSupported: true })).toEqual({ kind: 'done-only' })
    expect(resolveCompleteAction({ settings: undefined, archiveSessionsSupported: false })).toEqual({ kind: 'done-only' })
  })

  it('archive off, prompt on (the prompt field is ignored when archive is off)', () => {
    expect(resolveCompleteAction({
      settings: { completeArchiveSessions: false, completeArchivePrompt: true },
      archiveSessionsSupported: true,
    })).toEqual({ kind: 'done-only' })
  })

  it('archive on + prompt off + host supports archive → archive-immediately with sessions', () => {
    expect(resolveCompleteAction({
      settings: { completeArchiveSessions: true, completeArchivePrompt: false },
      archiveSessionsSupported: true,
    })).toEqual({ kind: 'archive-immediately', withSessions: true })
  })

  it('archive on + prompt off + host does NOT support archive → archive-immediately without sessions', () => {
    expect(resolveCompleteAction({
      settings: { completeArchiveSessions: true, completeArchivePrompt: false },
      archiveSessionsSupported: false,
    })).toEqual({ kind: 'archive-immediately', withSessions: false })
  })

  it('archive on + prompt on + host supports archive → prompt with sessions', () => {
    expect(resolveCompleteAction({
      settings: { completeArchiveSessions: true, completeArchivePrompt: true },
      archiveSessionsSupported: true,
    })).toEqual({ kind: 'prompt', withSessions: true })
  })

  it('archive on + prompt on + host does NOT support archive → prompt without sessions (the modal still asks Yes/No)', () => {
    expect(resolveCompleteAction({
      settings: { completeArchiveSessions: true, completeArchivePrompt: true },
      archiveSessionsSupported: false,
    })).toEqual({ kind: 'prompt', withSessions: false })
  })

  it('explicit empty settings behave the same as factory defaults', () => {
    expect(resolveCompleteAction({ settings: {}, archiveSessionsSupported: true })).toEqual({ kind: 'done-only' })
  })
})
