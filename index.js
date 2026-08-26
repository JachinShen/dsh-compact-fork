import {
  childPrompt,
  compactionInstruction,
  completedSurfaceMessages,
  finishFailure,
  resolveTarget,
} from './core.js'

/** Cordis plugin name. */
export const name = 'tool-compact-fork'
/** Required DSH services. */
export const inject = ['llm', 'subagents', 'tools']

let summaryMessageId = 0

function resolveConfig(config = {}) {
  const provider = config.provider ?? 'spawn'
  const toolName = config.toolName ?? 'compact_fork'
  const maxDepth = config.maxDepth ?? 3
  const maxTokens = config.maxTokens ?? 8192
  if (typeof provider !== 'string' || provider.length === 0) throw new TypeError('provider must be a non-empty string')
  if (typeof toolName !== 'string' || toolName.length === 0) throw new TypeError('toolName must be a non-empty string')
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) throw new TypeError('maxDepth must be a non-negative safe integer')
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new TypeError('maxTokens must be a positive safe integer')
  return { provider, toolName, maxDepth, maxTokens }
}

async function directionalSummary(ctx, agent, direction, maxTokens, signal) {
  const messages = completedSurfaceMessages(agent)
  if (messages.length === 0) return '(No completed parent turns were available; rely on the task below.)'

  const target = resolveTarget(agent)
  const header = agent.session.requestHeader()
  const instruction = {
    id: `compact-fork-summary-${summaryMessageId += 1}`,
    role: 'user',
    content: [{ type: 'text', text: compactionInstruction(direction) }],
    source: { kind: 'plugin', plugin: name },
  }
  const options = {
    provider: target.provider,
    model: target.model,
    messages: [...messages, instruction],
    sessionId: agent.session.id,
    purpose: 'compaction',
    signal,
  }
  if (header?.system !== undefined) options.system = header.system
  if (header?.tools !== undefined) options.tools = [...header.tools]
  options.maxTokens = maxTokens

  const text = []
  let finish
  for await (const chunk of ctx.llm.stream(options)) {
    if (chunk.type === 'block-end' && chunk.block.type === 'text') text.push(chunk.block.text)
    if (chunk.type === 'finish') finish = chunk.reason
  }
  const failure = finishFailure(finish)
  if (failure !== undefined) throw new Error(`compact_fork summarization failed: ${failure}`)
  const summary = text.join('\n').trim()
  if (summary.length === 0) throw new Error('compact_fork summarization produced no text')
  return summary
}

function toolDefinition(ctx, config, supportsAgentPreset) {
  const properties = {
    description: {
      type: 'string',
      description: 'A short 3–5 word label for the child and its task.',
    },
    prompt: {
      type: 'string',
      description: 'The child task. This same text directs which parent context the compaction preserves.',
    },
  }
  if (supportsAgentPreset) {
    properties.profile = {
      type: 'string',
      description: 'Optional agent preset id for the child. Omit it to inherit the parent profile.',
    }
  }

  return {
    name: config.toolName,
    description:
      'Fork a resumable child from a task-directed compacted projection of this agent’s completed conversation. '
      + 'The parent keeps its full context. Use this when a subtask needs relevant conversation context without '
      + 'inheriting unrelated history. The child runs in the background; its ordinary response resumes the parent, '
      + 'and send_message can continue the same child later.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties,
      required: ['description', 'prompt'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { subagentId: { type: 'string' } },
        required: ['subagentId'],
      },
      render: (_args, value) => [{ type: 'text', text: `started compact-fork subagent ${value.subagentId}` }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) throw new Error('compact_fork requires a calling agent')
      const summary = await directionalSummary(ctx, parent, args.prompt, config.maxTokens, exec.signal)
      const request = {
        label: args.description,
        prompt: [{ type: 'text', text: childPrompt(summary, args.prompt) }],
        parent,
        maxDepth: config.maxDepth,
      }
      if (supportsAgentPreset && args.profile !== undefined) {
        request.agentPreset = args.profile
      }
      const started = await ctx.subagents.startContinuable({
        provider: config.provider,
        label: args.description,
        request,
        signal: exec.signal,
      })
      return { subagentId: started.childId }
    },
  }
}

/** Register `compact_fork` while the configured fresh-child provider exists. */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  let disposeTool

  const mount = (provider) => {
    if (provider.prepareContinuable === undefined) {
      throw new Error(`compact_fork provider "${provider.name}" does not support continuable children`)
    }
    disposeTool = ctx.tools.register(toolDefinition(ctx, config, Boolean(provider.capabilities.agentPreset)))
  }

  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === config.provider && disposeTool === undefined) mount(provider)
  })
  ctx.on('subagent/provider-removed', (providerName) => {
    if (providerName !== config.provider || disposeTool === undefined) return
    disposeTool()
    disposeTool = undefined
  })

  const provider = ctx.subagents.getProvider(config.provider)
  if (provider !== undefined) mount(provider)
}
