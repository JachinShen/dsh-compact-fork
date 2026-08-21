# dsh-compact-fork

A DeepSeek Harness Cordis plugin that uses a task as a selective compaction direction, keeps the parent Agent unchanged, and starts a resumable fresh child with only the compacted context.

## Behavior

When installed through its bundle, the plugin disables DSH's default fresh-only `subagent` consumer and registers the directional compact-fork behavior under the same `subagent` tool name. The Agent therefore sees one ordinary delegation entry instead of choosing between duplicate tools.

`subagent`:

1. Reads the parent Agent's model-visible completed turns.
2. Reuses the parent model route, system prompt, tools, and message prefix for one directional compaction call.
3. Starts a continuable `spawn` child with the compacted context and original task.
4. Optionally loads another Agent profile in that child.
5. Relies on the existing settlement response to resume the parent; `send_message` continues the same child later.

The current in-flight tool-calling turn is excluded. The explicit `prompt` carries the new task.

## Tool

```text
subagent(
  description, // short child label
  prompt,      // child task and compaction direction
  profile?     // omitted to inherit the parent profile
)
```

The implementation still accepts a custom `toolName` when mounted manually, but the shipped bundle intentionally owns the single `subagent` entry.

## Configuration

```yaml
- id: tool-subagent
  disabled: true

- insert:
    - id: tool-compact-fork
      name: dsh-compact-fork
      config:
        provider: spawn
        toolName: subagent
        maxDepth: 3
        maxTokens: 8192
```

## Development

```sh
npm test
```

The package is intentionally outside the DSH monorepo. Install it as a profile bundle or add its Cordis row to the target profile; no DSH core source change is required.
