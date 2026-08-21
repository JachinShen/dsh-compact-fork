import assert from 'node:assert/strict'
import test from 'node:test'
import {
  childPrompt,
  compactionInstruction,
  completedSurfaceMessages,
  finishFailure,
  resolveTarget,
} from '../core.js'

test('completedSurfaceMessages excludes the open turn and hidden events', () => {
  const events = [
    { seq: 0, type: 'user/message', message: { role: 'user', content: 'old' } },
    { seq: 1, type: 'turn/end' },
    { seq: 2, type: 'assistant/message', message: { role: 'assistant', content: 'open' } },
  ]
  const agent = {
    session: {
      events,
      surface: { nodes: [0, 2] },
      deriveEventMessage(event) { return event.message ?? null },
    },
  }
  assert.deepEqual(completedSurfaceMessages(agent), [{ role: 'user', content: 'old' }])
})

test('completedSurfaceMessages returns empty before any completed turn', () => {
  const agent = {
    session: {
      events: [{ seq: 0, type: 'user/message' }],
      surface: { nodes: [0] },
      deriveEventMessage() { throw new Error('must not derive') },
    },
  }
  assert.deepEqual(completedSurfaceMessages(agent), [])
})

test('resolveTarget prefers the latest routed request', () => {
  const agent = {
    session: { requestHeader: () => ({ config: { provider: 'latest', model: 'm1' } }) },
    options: { provider: 'fallback', model: 'm2' },
  }
  assert.deepEqual(resolveTarget(agent), { provider: 'latest', model: 'm1' })
})

test('resolveTarget falls back and fails without a complete route', () => {
  const fallback = {
    session: { requestHeader: () => undefined },
    options: { provider: 'fallback', model: 'm2' },
  }
  assert.deepEqual(resolveTarget(fallback), { provider: 'fallback', model: 'm2' })
  assert.throws(
    () => resolveTarget({ session: { requestHeader: () => undefined }, options: {} }),
    /cannot resolve/,
  )
})

test('finishFailure accepts stop and rejects every incomplete class', () => {
  assert.equal(finishFailure({ kind: 'stop' }), undefined)
  assert.equal(finishFailure({ kind: 'error', failure: { message: 'broken' } }), 'broken')
  assert.equal(finishFailure({ kind: 'aborted', failure: {} }), 'summary call ended with aborted')
  assert.equal(finishFailure({ kind: 'max-tokens' }), 'summary call reached its token cap')
  assert.equal(finishFailure({ kind: 'tool-calls' }), 'summary call attempted a tool call')
  assert.equal(finishFailure(undefined), 'summary call ended without a finish reason')
  assert.equal(finishFailure({ kind: 'other' }), 'summary call ended with other')
})

test('prompts preserve the task without imposing an output schema', () => {
  const instruction = compactionInstruction('research current evidence')
  assert.match(instruction, /<target-task>\nresearch current evidence\n<\/target-task>/)
  assert.match(instruction, /do not force a fixed schema/i)

  const prompt = childPrompt('Prior fact.', 'research current evidence')
  assert.match(prompt, /<compacted-context>\nPrior fact\.\n<\/compacted-context>/)
  assert.match(prompt, /<task>\nresearch current evidence\n<\/task>/)
})
