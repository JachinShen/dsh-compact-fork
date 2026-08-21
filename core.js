/** Select model-visible messages from the parent's completed-turn prefix. */
export function completedSurfaceMessages(agent) {
  const events = agent.session.events
  const lastEnd = events.findLast(event => event.type === 'turn/end')
  if (lastEnd === undefined) return []

  const messages = []
  for (const seq of agent.session.surface.nodes) {
    if (seq > lastEnd.seq) continue
    const event = events[seq]
    if (event === undefined) continue
    const message = agent.session.deriveEventMessage(event)
    if (message !== null) messages.push(message)
  }
  return messages
}

/** Resolve the latest routed model target, falling back to Agent creation options. */
export function resolveTarget(agent) {
  const latest = agent.session.requestHeader()?.config
  if (latest?.provider && latest?.model) {
    return { provider: latest.provider, model: latest.model }
  }
  if (agent.options.provider && agent.options.model) {
    return { provider: agent.options.provider, model: agent.options.model }
  }
  throw new Error('compact_fork cannot resolve the parent provider/model')
}

/** Convert a terminal summary reason to an error message. */
export function finishFailure(reason) {
  if (reason?.kind === 'stop') return undefined
  if (reason?.kind === 'error' || reason?.kind === 'aborted') {
    return reason.failure?.message || `summary call ended with ${reason.kind}`
  }
  if (reason?.kind === 'max-tokens') return 'summary call reached its token cap'
  if (reason?.kind === 'tool-calls') return 'summary call attempted a tool call'
  return reason === undefined
    ? 'summary call ended without a finish reason'
    : `summary call ended with ${String(reason.kind)}`
}

/** Build the task-directed instruction appended to the completed parent prefix. */
export function compactionInstruction(direction) {
  return [
    'Act only as a context compaction engine for a child AI agent.',
    'Selectively condense the completed conversation above for the target task below.',
    'Keep every fact, user correction, decision, constraint, file path, command, error, artifact, and unresolved issue needed to complete that task.',
    'Forget unrelated history. Do not perform the task, call tools, invent facts, or describe the compaction process.',
    'Write concise English context that the child can immediately continue from. Use whatever structure best fits the task; do not force a fixed schema.',
    '',
    '<target-task>',
    direction,
    '</target-task>',
    '',
    'Output only the compacted context.',
  ].join('\n')
}

/** Compose the compacted checkpoint and original task as one child prompt. */
export function childPrompt(summary, task) {
  return [
    'The following compacted context was selected from your parent agent’s completed conversation specifically for your task. Treat it as established background, but follow your own current system instructions and tool availability.',
    '',
    '<compacted-context>',
    summary,
    '</compacted-context>',
    '',
    '<task>',
    task,
    '</task>',
    '',
    'Complete the task. Return the useful result or the concrete blocker in your ordinary final response; do not use a separate parent-reporting protocol.',
  ].join('\n')
}
