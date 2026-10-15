// @vitest-environment jsdom
/**
 * End-to-end integration coverage for the "archive on ✓ Done" flow (0.9.x).
 * Wires the real BoardController against a fake TaskboardClient (an in-memory
 * host that mirrors the real /state + /move + SSE pipeline) and exercises
 * the completeAndMaybeArchive + controller.move path with thenArchive.
 *
 * This complements the unit tests (protocol/route/complete-action) by proving
 * the round trip: client → controller → host route → controller → snapshot.
 * The board's UI smoke (clicks, modal, settings toggles) is already covered
 * by tests/client.spec.ts; this file is the host-aware middle layer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BoardController } from '../src/client/controller.ts'
import { resolveCompleteAction } from '../src/client/board/complete-action.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'
import type { MoveTaskBody, MoveTaskResponse, SessionArchiveResult, StateResponse } from '../src/shared/api.ts'

interface InMemoryHost {
  tasks: TaskRecord[]
  revision: number
  capabilities: { archiveSessions: boolean }
  moveRequests: MoveTaskBody[]
  archiveCalls: string[]
}

function newHost(capabilities: { archiveSessions: boolean } = { archiveSessions: true }): InMemoryHost {
  return { tasks: [], revision: 0, capabilities, moveRequests: [], archiveCalls: [] }
}

function seedTask(host: InMemoryHost, status: TaskRecord['status'], sessionId?: string): string {
  const id = `t-${Math.random().toString(36).slice(2, 8)}`
  const now = 1_700_000_000_000
  const task: TaskRecord = {
    id, title: '验收', description: '', prompt: '', workspaceId: 'ws-a', urgency: 'normal',
    status, blocked: false, execution: { mode: 'claim' },
    version: 1, createdAt: now, updatedAt: now,
    createdBy: { kind: 'agent', sessionId: 'session-planner' },
    updatedBy: { kind: 'agent', sessionId: 'session-planner' },
    comments: [],
    executions: sessionId !== undefined
      ? [{ id: 'e-1', trigger: 'manual', outcome: 'succeeded', sessionId }]
      : [],
  }
  host.tasks.push(task)
  host.revision += 1
  return id
}

/**
 * Build a TaskboardClient-like object backed by the host. The chain in
 * move() mirrors the real host route in src/host/routes.ts:
 *   first hop: status='done' → done
 *   if thenArchive=true: second hop → archived
 *   if archiveSessions=true: call session archive (when capability present)
 */
function makeClient(host: InMemoryHost) {
  return {
    state: async (): Promise<StateResponse> => ({
      schemaVersion: 1, revision: host.revision, tasks: host.tasks, capabilities: host.capabilities,
    }),
    workspaces: async () => [],
    stream: () => () => {},
    async move(id: string, body: MoveTaskBody): Promise<MoveTaskResponse> {
      host.moveRequests.push(body)
      const task = host.tasks.find(t => t.id === id)
      if (task === undefined) throw new Error('not_found')
      // Real route rejects out-of-order ifVersion; this stub trusts the caller
      // and just walks the state machine.
      if (task.status === 'in_review' && body.status === 'done') {
        task.status = 'done'
        task.version += 1
        if (body.thenArchive === true) {
          task.status = 'archived'
          task.version += 1
        }
      } else if (task.status === 'in_review' && body.status === 'archived') {
        task.status = 'archived'
        task.version += 1
      } else {
        task.status = body.status as TaskRecord['status']
        task.version += 1
      }
      let sessionArchive: SessionArchiveResult | undefined
      if (body.archiveSessions === true) {
        const ids = (task.executions ?? []).map(e => e.sessionId).filter((s): s is string => typeof s === 'string' && s.length > 0)
        if (host.capabilities.archiveSessions) {
          sessionArchive = { archived: ids, failed: [], unsupported: [] }
          for (const sessionId of ids) host.archiveCalls.push(sessionId)
        } else {
          sessionArchive = { archived: [], failed: [], unsupported: ids }
        }
      }
      return {
        id: task.id, title: task.title, workspaceId: task.workspaceId, urgency: task.urgency,
        status: task.status, blocked: task.blocked, executionMode: task.execution.mode,
        version: task.version, commentCount: task.comments.length,
        ...(sessionArchive !== undefined ? { sessionArchive } : {}),
      } as MoveTaskResponse
    },
    async updateSettings(body: Record<string, unknown>) { return body as never },
  }
}

async function flush() {
  // Yield a few microtasks so the controller's queued refresh + state promise
  // chain settles. jsdom runs on real timers; one setTimeout(0) is enough.
  await new Promise<void>(r => setTimeout(r, 0))
}

describe('archive-on-complete: end-to-end integration', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-CN'
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('resolveCompleteAction covers all 6 boardSetting × capability combinations', () => {
    // Defaults: archive off → done-only regardless of host capability.
    expect(resolveCompleteAction({ settings: undefined, archiveSessionsSupported: true })).toEqual({ kind: 'done-only' })
    expect(resolveCompleteAction({ settings: undefined, archiveSessionsSupported: false })).toEqual({ kind: 'done-only' })
    // Archive on + prompt on: ask first.
    expect(resolveCompleteAction({ settings: { completeArchiveSessions: true, completeArchivePrompt: true }, archiveSessionsSupported: true })).toEqual({ kind: 'prompt', withSessions: true })
    expect(resolveCompleteAction({ settings: { completeArchiveSessions: true, completeArchivePrompt: true }, archiveSessionsSupported: false })).toEqual({ kind: 'prompt', withSessions: false })
    // Archive on + prompt off: archive immediately.
    expect(resolveCompleteAction({ settings: { completeArchiveSessions: true, completeArchivePrompt: false }, archiveSessionsSupported: true })).toEqual({ kind: 'archive-immediately', withSessions: true })
    expect(resolveCompleteAction({ settings: { completeArchiveSessions: true, completeArchivePrompt: false }, archiveSessionsSupported: false })).toEqual({ kind: 'archive-immediately', withSessions: false })
  })

  it('completeAndMaybeArchive(decision=archive) sends thenArchive+archiveSessions and lands the card in archived', async () => {
    const host = newHost({ archiveSessions: true })
    seedTask(host, 'in_review', 'session-flow-1')
    const id = host.tasks[0]!.id
    const controller = new BoardController(makeClient(host) as never)
    await controller.refresh()
    expect(controller.getSnapshot().archiveSessionsSupported).toBe(true)
    // Simulate: user clicked ✓ Done → confirmed "是" in the modal.
    await controller.completeAndMaybeArchive(id, 1, 'archive')
    await flush()
    // The host received exactly one /move call with both flags.
    expect(host.moveRequests).toHaveLength(1)
    expect(host.moveRequests[0]).toEqual({ ifVersion: 1, status: 'done', thenArchive: true, archiveSessions: true })
    // The chain moved the card all the way to archived (version bumped twice).
    const final = controller.getSnapshot().ledger.tasks.find(t => t.id === id)
    expect(final?.status).toBe('archived')
    expect(final?.version).toBe(3)
    // The session was archived exactly once.
    expect(host.archiveCalls).toEqual(['session-flow-1'])
  })

  it('completeAndMaybeArchive(decision=done) does NOT chain (factory default behaviour)', async () => {
    const host = newHost({ archiveSessions: true })
    seedTask(host, 'in_review', 'session-flow-2')
    const id = host.tasks[0]!.id
    const controller = new BoardController(makeClient(host) as never)
    await controller.refresh()
    await controller.completeAndMaybeArchive(id, 1, 'done')
    await flush()
    expect(host.moveRequests).toHaveLength(1)
    expect(host.moveRequests[0]).toEqual({ ifVersion: 1, status: 'done' })
    // thenArchive undefined, archiveSessions undefined — old-client wire format.
    expect(host.moveRequests[0]?.thenArchive).toBeUndefined()
    expect(host.archiveCalls).toEqual([])
    const final = controller.getSnapshot().ledger.tasks.find(t => t.id === id)
    expect(final?.status).toBe('done')
    expect(final?.version).toBe(2)
  })

  it('thenArchive chain on a host without archiveSession: card still archived, no session call', async () => {
    const host = newHost({ archiveSessions: false })
    seedTask(host, 'in_review', 'session-flow-3')
    const id = host.tasks[0]!.id
    const controller = new BoardController(makeClient(host) as never)
    await controller.refresh()
    expect(controller.getSnapshot().archiveSessionsSupported).toBe(false)
    await controller.completeAndMaybeArchive(id, 1, 'archive')
    await flush()
    // Host received the chain request. The controller strips archiveSessions
    // when the host has no capability (so the host doesn't get a request it
    // can't fulfill); the chain still moves the card to archived.
    expect(host.moveRequests[0]).toMatchObject({ status: 'done', thenArchive: true })
    expect(host.archiveCalls).toEqual([])
    const final = controller.getSnapshot().ledger.tasks.find(t => t.id === id)
    expect(final?.status).toBe('archived')
  })

  it('controller.updateSettings sends the new toggle fields verbatim to the host', async () => {
    const host = newHost()
    seedTask(host, 'in_review')
    let saved: Record<string, unknown> | undefined
    const client = {
      ...makeClient(host),
      async updateSettings(body: Record<string, unknown>) { saved = body; return body as never },
    }
    const controller = new BoardController(client as never)
    await controller.refresh()
    const ok = await controller.updateSettings({
      defaultIsolation: 'none',
      completeArchiveSessions: true,
      completeArchivePrompt: false,
    } as never)
    expect(ok).toBe(true)
    expect(saved).toEqual({ defaultIsolation: 'none', completeArchiveSessions: true, completeArchivePrompt: false })
  })

  it('thenArchive with no associated execution sessions: card archived, no session call', async () => {
    // Edge case: a task that reached in_review with no execution sessions
    // (e.g. created by hand + manually moved). archiveSessions=true must not
    // crash on an empty session list.
    const host = newHost({ archiveSessions: true })
    seedTask(host, 'in_review') // no sessionId
    const id = host.tasks[0]!.id
    const controller = new BoardController(makeClient(host) as never)
    await controller.refresh()
    await controller.completeAndMaybeArchive(id, 1, 'archive')
    await flush()
    const final = controller.getSnapshot().ledger.tasks.find(t => t.id === id)
    expect(final?.status).toBe('archived')
    expect(host.archiveCalls).toEqual([])
  })
})
