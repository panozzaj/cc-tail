# cc-tail

Tail thinking blocks from Claude Code sessions. Useful for understanding Claude's reasoning process in real-time or reviewing past sessions.

Here's Claude Code running on the left pane, and a cc-tail process running on the right side:

<img width="1510" height="746" alt="image" src="https://github.com/user-attachments/assets/d787039d-3fab-45af-b8bd-5dee8f7e355d" />

## Why

Claude Code doesn't show thinking by default - you need `Ctrl+O` then `Ctrl+E` to view it after the fact. This tool lets you follow thinking in real-time in a separate terminal.

Related Claude Code issues:
- [#8477](https://github.com/anthropics/claude-code/issues/8477) - Add Option to Always Show Claude's Thinking
- [#15890](https://github.com/anthropics/claude-code/issues/15890) - Separate flags for showing thinking vs tool results

## Installation

```bash
git clone https://github.com/panozzaj/cc-tail
cd cc-tail && npm install
```

## Usage

```bash
./cc-tail                  # follow live thinking (bash version)
node src/index.js          # follow live thinking (JS version)

# Options (both versions)
--no-follow        # print existing and exit
--tools            # include tool calls (Edit, Bash, etc.)
--tool-output      # include tool results
--output           # include Claude's text responses
--user             # include user messages
--all              # show everything
```

By default, cc-tail finds the most recently updated session for the current working directory.

To specify a session ID (from `/status` in Claude Code) or project path:
```bash
cc-tail <session-id>
cc-tail <session-id> /path/to/project
```

## Requirements

- **Bash version**: `jq`
- **JS version**: Node.js

## License

ISC
