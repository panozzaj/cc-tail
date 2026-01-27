# cc-tail

Tail thinking blocks from Claude Code sessions. Useful for understanding Claude's reasoning process in real-time or reviewing past sessions.

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

Specify a session ID (from `/status` in Claude Code) or project path:
```bash
cc-tail <session-id>
cc-tail <session-id> /path/to/project
```

## Requirements

- **Bash version**: `jq`
- **JS version**: Node.js

## License

ISC
