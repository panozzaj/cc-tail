# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

cc-tail is a CLI tool for tailing Claude Code's thinking blocks in real-time or reviewing past sessions. It reads the JSONL session files stored in `~/.claude/projects/` and displays thinking, tool calls, responses, and user messages.

## Running the Tool

```bash
# JS version (preferred)
node src/index.js              # follow live thinking
node src/index.js --no-follow  # print existing and exit
node src/index.js --all        # show everything

# Bash version (requires jq)
./cc-tail
```

## Development

```bash
npm install    # install dependencies
npm start      # runs node src/index.js
```

No tests or linting configured.

## Architecture

Two parallel implementations exist with identical CLI interfaces:

- **`src/index.js`** - Node.js version using ES modules. Uses `chokidar` for file watching, `diff` for unified diffs, and `cli-highlight` for syntax highlighting. This is the entire JS app — one file, no modules.
- **`cc-tail`** - Bash version using `jq` for JSON parsing and `tail -f` for following.

Both read Claude Code session files (JSONL format) from `~/.claude/projects/{path-with-dashes-not-slashes}/{session-id}.jsonl`.

### Key concepts

- Session files are JSONL with entries containing `type`, `timestamp`, `message.content[]`
- Content items have types: `thinking`, `tool_use`, `tool_result`, `text`
- User messages have top-level `type: "user"` with content as string or array
- Thinking blocks are displayed in rotating blue/gray colors
- Tool calls (Edit, Write, Bash, Read, Glob, Grep, Task) have custom formatters
- CLI arg parsing: first positional arg starting with `/`, `.`, or `~` is treated as a project path; otherwise as session ID
