# Copilot Custom Agents — Research (2026-02-24)

Research on using custom agents in VS Code Copilot and compatibility with Claude Code agent format.

---

## Key Finding

**Claude Code agent format (.md files with YAML frontmatter) is natively compatible with VS Code Copilot.**

---

## 1. Format for Defining Custom Agents/Extensions in Copilot

Custom agents use YAML frontmatter at the top of a `.agent.md` file, followed by Markdown instructions in the body. Key fields include:
- `name`: Required agent name.
- `description`: What the agent does.
- `tools`: Array of allowed tools (e.g., `['codebase', 'editFiles']`); reference tools in the body with `#tool:<tool-name>` syntax.
- Optional: `model` (e.g., GPT-4o or Claude models via autocomplete), `target` (e.g., `vscode` or `github-copilot`).

Example from VS Code docs:
```yaml
---
name: Researcher
description: Research codebase patterns and gather context
tools: ['codebase', 'fetch', 'usages']
---
Research thoroughly using read-only tools. Return a summary of findings.
```

Location: `.github/agents/` (workspace) or user profile folder (global).

To create one: Use `/agents` in Copilot Chat, the Command Palette (`Chat: New Custom Agent`), or the agents dropdown > **Configure Custom Agents** > **Create new custom agent**.

## 2. Similarity to Claude Code's Format

Highly similar. Both use Markdown files with YAML frontmatter for `name`, `description`, and `tools`. Instructions go in the Markdown body.

## 3. Compatibility / Convertibility

Directly compatible: VS Code detects plain `.md` files in `.claude/agents/` and maps Claude-specific tool names (e.g., "Read, Grep") to VS Code equivalents, enabling reuse across VS Code Copilot and Claude Code without changes. For full VS Code features, rename to `.agent.md` in `.github/agents/`.

## 4. Current Ways to Extend Copilot (as of early 2026)

- **Custom agents**: `.agent.md` files in `.github/agents/` (workspace) or user profile (global)
- **Claude-style agents**: `.md` files in `.claude/agents/` for cross-tool compatibility
- **Repository custom instructions**: `.github/copilot-instructions.md` for project-wide context
- **Background/cloud agents and subagents**: Reuse custom agents for autonomous tasks (experimental)
- **Handoffs**: Define workflows between agents in YAML
- **Agent Skills and MCP integrations**: For specialized roles and team workflows

## 5. Third-Party Tools or Converters

No third-party converters needed — native VS Code support for `.claude/agents/` provides direct compatibility without conversion. For GitHub.com Copilot, some VS Code properties (e.g., `model`, `handoffs`) are unsupported.

---

## Sources

- https://code.visualstudio.com/docs/copilot/customization/custom-agents
- https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents
- https://montemagno.com/building-better-apps-with-github-copilot-custom-agents/
- https://onlyutkarsh.com/posts/2025/github-copilot-custom-agents/
- https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-custom-agents
- https://docs.github.com/en/copilot/reference/custom-agents-configuration
- https://devblogs.microsoft.com/visualstudio/custom-agents-in-visual-studio-built-in-and-build-your-own-agents/
- https://github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot
