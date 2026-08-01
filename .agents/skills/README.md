# Vendored: Remotion Agent Skills

Source: https://github.com/remotion-dev/skills, pinned at v4.0.503
(commit 4951f6aca2a236f2f2a2bff4734566963fe12707, 2026-07-31).

Instructions for Claude and other coding agents on scaffolding, editing, and
rendering programmatic videos with Remotion (`npx create-video@latest`).
Unrelated to the Logbook app itself: agent tooling only, never loaded by the
PWA or the service worker.

`remotion-create` is the skill tied to `npx create-video@latest`. It cross-links
`remotion-best-practices`, `remotion-markup`, and `remotion-interactivity` via
relative paths, so the full bundle is vendored together rather than picked
apart (a partial copy would leave those links dangling).

## Structure

Real content lives here in `.agents/skills/`. `.claude/skills/*` are symlinks
back into this directory, one per skill, mirroring the upstream project's own
layout so Claude Code's skill loader finds them while other agents that read
`.agents/skills` directly also work.

## Updating

Re-clone `remotion-dev/skills`, copy `skills/*` over this directory, and add
symlinks in `.claude/skills/` for any newly added skill folders.
