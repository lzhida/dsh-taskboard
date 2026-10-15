/**
 * The "✓ Done" decision flow (0.9.x): pure logic that resolves the user's
 * effective action from the board settings + host capability. The card and
 * detail surfaces call this to share one source of truth on:
 *   - whether to archive sessions on ✓ Done
 *   - whether to prompt first
 *
 * The shared helper is pure (no React) so both entry points stay in sync and
 * the resolution is testable without a DOM.
 *
 * @module dsh-taskboard/client/board/complete-action
 */
import type { BoardSettings } from '../../shared/protocol.ts'
import { completeArchivePromptOf, completeArchiveSessionsOf } from '../../shared/protocol.ts'

/** What the UI should do when the user clicks ✓ Done. */
export type CompleteAction =
  /** Move the card to 'done' only; do not archive; do not show a prompt. */
  | { kind: 'done-only' }
  /** Move to 'done' AND archive the card (and sessions when supported); no prompt. */
  | { kind: 'archive-immediately'; withSessions: boolean }
  /** Show a Yes/No/Cancel prompt before performing the move. */
  | { kind: 'prompt'; withSessions: boolean }

/** Inputs for {@link resolveCompleteAction}. */
export interface CompleteActionInputs {
  /** The live board settings; undefined = fresh install, factory defaults apply. */
  settings: BoardSettings | undefined
  /** Whether the host exposes a `archiveSession` capability. */
  archiveSessionsSupported: boolean
}

/**
 * Compute the ✓ Done entry-point action.
 * - Both switches off (factory default) → {@link CompleteAction.kind} = 'done-only'.
 * - Archive on, prompt off → 'archive-immediately'.
 * - Archive on, prompt on → 'prompt'.
 * The 'withSessions' flag is false when the host has no archiveSession
 * capability: a prompt with no sessions still asks the Yes/No question
 * (it just archives the card, not the sessions).
 */
export function resolveCompleteAction(inputs: CompleteActionInputs): CompleteAction {
  const archiveOn = completeArchiveSessionsOf(inputs.settings)
  if (!archiveOn) return { kind: 'done-only' }
  const promptOn = completeArchivePromptOf(inputs.settings)
  if (promptOn) return { kind: 'prompt', withSessions: inputs.archiveSessionsSupported }
  return { kind: 'archive-immediately', withSessions: inputs.archiveSessionsSupported }
}
