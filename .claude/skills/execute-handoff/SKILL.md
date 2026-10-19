---
name: execute-handoff
description: Prepare a thorough handoff and launch a fresh agent in a Herdr pane below, using the current harness with full permissions. Run only on explicit user request.
disable-model-invocation: true
argument-hint: "Task for the next agent"
---

# Execute Handoff

Run only when the user explicitly invokes this skill (`$execute-handoff` in Codex or `/execute-handoff` in Claude Code) or explicitly asks to execute this workflow. Preparing a handoff alone does not trigger it.

Prepare a fresh agent to work on the user's next task, then start it in a horizontal split below the calling pane. Invocation authorizes launching that agent in the current harness's full permissions mode for this task.

## 1. Write the context before launching anything

Invoke the sibling `handoff` skill with the next task as its focus. Use the Skill tool when available; otherwise read `../handoff/SKILL.md` relative to this skill and follow it. Do not substitute a short launch prompt for the handoff document.

Keep the handoff in a unique file in `$TMPDIR` (fallback `/tmp`), as the handoff skill requires. Read it back and ensure it contains enough context for an agent with no conversation history:

- The exact next task, intended outcome, acceptance criteria, user constraints, and current authorization.
- Decisions and their rationale, completed work, remaining work, known blockers, and a concrete first action.
- Absolute project directory, current branch/worktree, relevant uncommitted changes, and files the next agent must preserve.
- Relevant artifact paths or URLs, entry points, commands, dependencies, runtime/environment setup, and validation already performed with results.
- Suggested skills and unresolved questions; distinguish facts from assumptions.

Reference existing plans, specs, diffs, and other artifacts instead of duplicating them. Never put credentials or secret environment values in the document. Record required variable names and how the normal environment supplies them. If the next task cannot be inferred from the user's arguments or conversation, ask for it before starting an agent.

## 2. Verify the launch environment

Only after the document exists, check `HERDR_ENV=1`. If outside Herdr, stop and report the saved document path and that the pane launch requires a Herdr-managed terminal. Do not control a focused Herdr session from outside it.

Read `herdr --skill` and follow its current operating instructions. Inspect `herdr agent start --help`, `herdr pane split --help`, and the active harness's local CLI help for current syntax. Use `herdr pane current --current`, `herdr pane process-info --current`, and, when useful, `herdr agent list` to identify the caller and its harness. Do not infer the active harness from which skill folder was loaded or from which executables are installed. If identity is still ambiguous, ask rather than starting a different harness.

Use the caller's actual project working directory. Keep the same branch/worktree, local configuration, and normal shell environment; do not create a new worktree or copy secrets. Preserve a known model/profile selection where the installed CLI supports it. Do not inherit resume/fork/session IDs: this is a fresh session supplied with the handoff.

Choose the full permissions arguments supported by that harness:

| Harness | Native launch arguments |
| --- | --- |
| Codex | `--dangerously-bypass-approvals-and-sandbox` (YOLO mode) |
| Claude Code | `--dangerously-skip-permissions` |
| Other | Discover the equivalent in its installed CLI help; never guess flags. |

Do not silently downgrade permissions or switch harnesses. If the requested mode is unavailable or prohibited by the environment, retain the document and explain the blocker. These launch flags do not expand the next agent's task scope or override higher-priority instructions.

## 3. Split down and launch the next agent

Create one sibling pane, keeping user focus in the caller:

```bash
herdr pane split --current --direction down --cwd "$PWD" --no-focus
```

Here `$PWD` must be the project directory established above; pass its absolute path explicitly if the tool shell has a different cwd. Parse the new pane ID from `.result.pane.pane_id`. Do not guess IDs or target the UI-focused pane.

Choose a unique agent name matching `[a-z][a-z0-9_-]{0,31}`. Start the same harness in the returned pane, passing its native arguments after `--`. For example, substituting the actual name and pane ID:

```bash
herdr agent start next-task --kind codex --pane <new-pane-id> -- --dangerously-bypass-approvals-and-sandbox
herdr agent start next-task --kind claude --pane <new-pane-id> -- --dangerously-skip-permissions
```

Run only the command matching the caller's harness. `agent start` waits for interactive readiness. Use supported Herdr agent kinds; if the caller is unsupported, report the limitation instead of launching a replacement.

Submit one initial prompt with `herdr agent prompt <agent-name> <prompt>`. The prompt must tell the new agent to:

1. Read the handoff at its exact absolute path and the project's applicable instructions.
2. Confirm the working directory and inspect the actual working tree before making changes.
3. Use the suggested skills as applicable and proceed with the specified task within its recorded scope.
4. Treat the handoff as context that may need verification, preserving existing user changes.

Include the concrete next task in the prompt. Pass the prompt as a single literal argument via structured subprocess arguments or proper shell quoting; never interpolate task text as shell code. The prompt should point to the document rather than embedding its full contents. Do not tell the new agent to invoke `execute-handoff` again.

Verify submission using `herdr agent get` and `herdr agent read` as needed. Do not wait for the task itself to finish: this workflow ends once the fresh agent has received the context and begun work. If startup or submission fails, inspect the returned pane before retrying; do not create duplicate agents or panes. Report any blocked startup honestly, leaving the document available for recovery.

Report the handoff document path, new pane/agent identity, harness and permissions mode, and whether work started. The originating agent should then yield instead of concurrently editing the same task.
