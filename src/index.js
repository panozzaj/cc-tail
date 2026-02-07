#!/usr/bin/env node
import chalk from 'chalk';
import meow from 'meow';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { diffLines } from 'diff';
import chokidar from 'chokidar';
import { highlight } from 'cli-highlight';

const cli = meow(`
  ${chalk.bold('cc-tail')} - Tail thinking from Claude Code sessions

  ${chalk.dim('Usage')}
    $ cc-tail [options] [project-path] [session-id]
    $ cc-tail [options] <path-to-file.jsonl>

  ${chalk.dim('Options')}
    -l, --list     List sessions in the project directory
    --no-follow    Print existing content and exit (default: follow live)
    --no-thinking  Hide thinking blocks (shown by default)
    --no-user      Hide user messages (shown by default)
    --tools        Also show tool calls (Edit, Bash, Write, etc.)
    --tool-output  Also show tool results/outputs
    --output       Also show Claude's text responses
    --all          Show everything
    -h, --help     Show this help

  ${chalk.dim('Examples')}
    $ cc-tail                          # follow live in current project
    $ cc-tail -l                       # list sessions in current project
    $ cc-tail /path/to/project         # follow live in specific project
    $ cc-tail /path/to/project -l      # list sessions in specific project
    $ cc-tail --no-follow              # print existing and exit
    $ cc-tail --tools                  # include tool calls
    $ cc-tail --all                    # show everything
    $ cc-tail ./path/to/session.jsonl  # tail a specific file
`, {
  importMeta: import.meta,
  flags: {
    list: { type: 'boolean', shortFlag: 'l', default: false },
    follow: { type: 'boolean', default: true },
    thinking: { type: 'boolean', default: true },
    tools: { type: 'boolean', default: false },
    toolOutput: { type: 'boolean', default: false },
    output: { type: 'boolean', default: false },
    user: { type: 'boolean', default: true },
    all: { type: 'boolean', default: false },
  },
});

// meow handles --help but not -h
if (process.argv.includes('-h')) {
  cli.showHelp();
}

// Color palette - centralized for consistency
const COLORS = {
  // Structural (separators, labels) - keep dim
  separator: chalk.dim,
  // Secondary content (tool output, descriptions) - readable but muted
  secondary: chalk.rgb(160, 160, 160),
  // Thinking blocks - rotating blue/gray shades
  thinking: [
    chalk.rgb(100, 149, 237),  // cornflower blue
    chalk.rgb(119, 136, 153),  // light slate gray
    chalk.rgb(135, 160, 190),  // steel blue-ish
    chalk.rgb(95, 130, 160),   // darker steel
  ],
};
let thinkingCount = 0;

// Convert path to Claude's directory format
function pathToClaudeDir(p) {
  return p.replace(/\//g, '-');
}

// Get project directory for Claude sessions
function getProjectDir(projectPath) {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  return path.join(claudeDir, pathToClaudeDir(projectPath || process.cwd()));
}

// Find the session file
function findSessionFile(sessionId, projectPath) {
  const projectDir = getProjectDir(projectPath);

  if (sessionId) {
    return path.join(projectDir, `${sessionId}.jsonl`);
  }

  if (!fs.existsSync(projectDir)) return null;

  const files = fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(projectDir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length ? path.join(projectDir, files[0].name) : null;
}

// Get a quick summary of a session file
function getSessionSummary(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    let firstUserMessage = null;
    let messageCount = 0;
    let thinkingCount = 0;
    let toolCount = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Count user messages and get first one
        if (entry.type === 'user' && entry.message?.content) {
          messageCount++;
          if (!firstUserMessage) {
            const content = entry.message.content;
            if (typeof content === 'string') {
              firstUserMessage = content;
            } else if (Array.isArray(content)) {
              const textItem = content.find(item => item.type === 'text' && item.text);
              if (textItem) firstUserMessage = textItem.text;
            }
          }
        }

        // Count thinking blocks and tool uses
        if (Array.isArray(entry.message?.content)) {
          for (const item of entry.message.content) {
            if (item.type === 'thinking') thinkingCount++;
            if (item.type === 'tool_use') toolCount++;
          }
        }
      } catch {}
    }

    // Truncate first user message
    if (firstUserMessage) {
      firstUserMessage = firstUserMessage.replace(/\n/g, ' ').slice(0, 60);
      if (firstUserMessage.length === 60) firstUserMessage += '...';
    }

    return { firstUserMessage, messageCount, thinkingCount, toolCount };
  } catch {
    return null;
  }
}

// List sessions in the project directory
function listSessions(projectPath) {
  const projectDir = getProjectDir(projectPath);

  if (!fs.existsSync(projectDir)) {
    console.error(chalk.red('No sessions found'));
    console.error(chalk.dim(`Looked in: ${projectDir}`));
    process.exit(1);
  }

  const files = fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const filePath = path.join(projectDir, f);
      const stat = fs.statSync(filePath);
      return { name: f, mtime: stat.mtime, size: stat.size, path: filePath };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    console.error(chalk.red('No sessions found'));
    process.exit(1);
  }

  console.log(chalk.bold('Sessions in'), chalk.dim(shortPath(projectDir)));
  console.log(chalk.dim('────────────────────────────────────────'));

  for (const file of files) {
    const sessionId = path.basename(file.name, '.jsonl');
    const shortId = sessionId.slice(0, 8);
    const timeAgo = getTimeAgo(file.mtime);
    const summary = getSessionSummary(file.path);

    console.log();
    console.log(
      chalk.cyan(shortId),
      chalk.dim('|'),
      chalk.yellow(timeAgo),
      chalk.dim('|'),
      chalk.dim(`${(file.size / 1024).toFixed(0)}KB`)
    );

    if (summary) {
      const stats = [];
      if (summary.messageCount) stats.push(`${summary.messageCount} msgs`);
      if (summary.thinkingCount) stats.push(`${summary.thinkingCount} thinking`);
      if (summary.toolCount) stats.push(`${summary.toolCount} tools`);

      if (stats.length) {
        console.log(chalk.dim(`  ${stats.join(', ')}`));
      }
      if (summary.firstUserMessage) {
        console.log(chalk.white(`  "${summary.firstUserMessage}"`));
      }
    }
  }

  console.log();
  console.log(chalk.dim(`${files.length} session(s)`));
}

// Get human-readable time ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

// Shorten home directory in paths
function shortPath(p) {
  return p?.replace(os.homedir(), '~') || '';
}

// Word wrap text to terminal width
function wrapText(text, indent = 0) {
  const width = process.stdout.columns || 80;
  const maxWidth = width - indent;
  if (maxWidth < 20) return text; // Too narrow, don't wrap

  const indentStr = ' '.repeat(indent);
  return text.split('\n').map(line => {
    if (line.length <= maxWidth) return line;

    const words = line.split(/(\s+)/);
    const wrapped = [];
    let current = '';

    for (const word of words) {
      if (current.length + word.length <= maxWidth) {
        current += word;
      } else {
        if (current) wrapped.push(current);
        current = word.trimStart();
      }
    }
    if (current) wrapped.push(current);

    return wrapped.join('\n' + indentStr);
  }).join('\n');
}

// Format timestamp
function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : '??:??:??';
}

// Highlight backticks in text with a specific color for non-backtick text
function highlightBackticks(text, baseColor) {
  return text.replace(/`([^`]+)`/g, (_, code) => chalk.yellow(`\`${code}\``) + baseColor(''));
}

// Render a unified diff with line numbers and background colors (like Claude Code)
function renderDiff(oldStr, newStr, contextLines = 3) {
  const changes = diffLines(oldStr || '', newStr || '');

  // Build list of all lines with metadata
  let oldLineNum = 1;
  let newLineNum = 1;
  const allLines = [];

  for (const change of changes) {
    const changeLines = change.value.split('\n');
    if (changeLines[changeLines.length - 1] === '') changeLines.pop();

    for (const line of changeLines) {
      if (change.added) {
        allLines.push({ type: 'add', line, num: newLineNum++ });
      } else if (change.removed) {
        allLines.push({ type: 'remove', line, num: oldLineNum++ });
      } else {
        allLines.push({ type: 'context', line, num: newLineNum });
        oldLineNum++;
        newLineNum++;
      }
    }
  }

  // Find max line number for padding
  const maxNum = Math.max(...allLines.map(l => l.num));
  const numWidth = String(maxNum).length;
  const pad = (n) => String(n).padStart(numWidth, ' ');

  // Diff colors - subtle backgrounds like Claude Code
  const addedBg = chalk.bgRgb(30, 60, 30);      // dark green bg
  const removedBg = chalk.bgRgb(60, 30, 30);    // dark red bg
  const addedText = chalk.green;
  const removedText = chalk.red;

  // Find ranges of changes and include context
  const output = [];
  let i = 0;
  while (i < allLines.length) {
    const item = allLines[i];

    if (item.type === 'add' || item.type === 'remove') {
      const contextStart = Math.max(0, i - contextLines);

      if (contextStart > 0 && output.length === 0) {
        output.push(chalk.dim('  ...'));
      }

      // Context before
      for (let j = contextStart; j < i; j++) {
        const ctx = allLines[j];
        if (ctx.type === 'context') {
          output.push(chalk.dim(`${pad(ctx.num)}   ${ctx.line}`));
        }
      }

      // Changes
      while (i < allLines.length && (allLines[i].type === 'add' || allLines[i].type === 'remove' ||
             (allLines[i].type === 'context' && i + 1 < allLines.length &&
              (allLines[i + 1].type === 'add' || allLines[i + 1].type === 'remove')))) {
        const curr = allLines[i];
        if (curr.type === 'add') {
          output.push(addedBg(addedText(`${pad(curr.num)} + ${curr.line}`)));
        } else if (curr.type === 'remove') {
          output.push(removedBg(removedText(`${pad(curr.num)} - ${curr.line}`)));
        } else {
          output.push(chalk.dim(`${pad(curr.num)}   ${curr.line}`));
        }
        i++;
      }

      // Context after
      const contextEnd = Math.min(allLines.length, i + contextLines);
      for (let j = i; j < contextEnd; j++) {
        const ctx = allLines[j];
        if (ctx.type === 'context') {
          output.push(chalk.dim(`${pad(ctx.num)}   ${ctx.line}`));
        }
      }
      i = contextEnd;

      if (i < allLines.length) {
        output.push(chalk.dim('  ...'));
      }
    } else {
      i++;
    }
  }

  return output.join('\n');
}

// Print a thinking block
function printThinking(thinking, timestamp) {
  const color = COLORS.thinking[thinkingCount % COLORS.thinking.length];
  thinkingCount++;

  console.log();
  console.log(chalk.dim('─── ') + chalk.yellow.bold('thinking') + chalk.dim(` @ ${formatTime(timestamp)} ───`));

  const wrapped = wrapText(thinking);
  for (const line of wrapped.split('\n')) {
    console.log(color(highlightBackticks(line, color)));
  }
}

// Syntax highlight code blocks in text
function highlightCodeBlocks(text) {
  // Match ```lang\ncode\n``` blocks
  return text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    try {
      const highlighted = highlight(code.trimEnd(), { language: lang || 'plaintext', ignoreIllegals: true });
      return chalk.dim('```' + lang) + '\n' + highlighted + '\n' + chalk.dim('```');
    } catch {
      return chalk.dim('```' + lang) + '\n' + code.trimEnd() + '\n' + chalk.dim('```');
    }
  });
}

// Print Claude's text response
function printTextResponse(text, timestamp) {
  console.log();
  console.log(chalk.dim('─── ') + chalk.white.bold('response') + chalk.dim(` @ ${formatTime(timestamp)} ───`));
  // Wrap text but preserve code blocks
  const wrapped = wrapTextPreservingCodeBlocks(text);
  console.log(highlightCodeBlocks(wrapped));
}

// Wrap text but leave code blocks untouched
function wrapTextPreservingCodeBlocks(text) {
  const parts = text.split(/(```[\s\S]*?```)/);
  return parts.map((part, i) => {
    // Odd indices are code blocks (captured groups)
    if (part.startsWith('```')) return part;
    return wrapText(part);
  }).join('');
}

// Print user message
function printUserMessage(content, timestamp) {
  // Content can be a string or an array of objects
  let text;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    // Extract text from array items
    text = content
      .filter(item => item.type === 'text' && item.text)
      .map(item => item.text)
      .join('\n');
  }

  if (!text) return;

  console.log();
  console.log(chalk.dim('─── ') + chalk.magenta.bold('user') + chalk.dim(` @ ${formatTime(timestamp)} ───`));
  console.log(chalk.magenta(wrapText(text)));
}

// Print a tool call
function printToolCall(name, input, timestamp) {
  console.log();
  console.log(chalk.dim('─── ') + chalk.cyan.bold(name) + chalk.dim(` @ ${formatTime(timestamp)} ───`));

  switch (name) {
    case 'Edit': {
      console.log(chalk.bold(shortPath(input.file_path)));
      if (input.replace_all) console.log(chalk.dim('(replace all)'));
      const diff = renderDiff(input.old_string, input.new_string);
      if (diff) console.log(diff);
      break;
    }
    case 'Write': {
      const lines = input.content?.split('\n') || [];
      console.log(chalk.bold(shortPath(input.file_path)), chalk.dim(`(${lines.length} lines)`));
      lines.slice(0, 5).forEach(line => console.log(chalk.green(`+ ${line}`)));
      if (lines.length > 5) console.log(chalk.dim(`  ... (${lines.length - 5} more lines)`));
      break;
    }
    case 'Bash': {
      if (input.description) console.log(COLORS.secondary(`# ${input.description}`));
      console.log(chalk.yellow(`$ ${input.command}`));
      break;
    }
    case 'Read': {
      console.log(chalk.dim('reading'), chalk.bold(shortPath(input.file_path)));
      break;
    }
    case 'Glob': {
      console.log(chalk.dim('glob'), chalk.yellow(input.pattern), chalk.dim('in'), input.path || '.');
      break;
    }
    case 'Grep': {
      console.log(chalk.dim('grep'), chalk.yellow(input.pattern), chalk.dim('in'), input.path || '.');
      break;
    }
    case 'Task': {
      console.log(chalk.magenta(input.subagent_type) + ':', input.description);
      break;
    }
    default: {
      console.log(chalk.dim(JSON.stringify(input, null, 2)));
    }
  }
}

// Print tool result/output
function printToolResult(content, toolUseResult, timestamp) {
  // Get output from toolUseResult if available, otherwise from content
  let output = toolUseResult?.stdout || content;
  const stderr = toolUseResult?.stderr;
  const isError = toolUseResult?.is_error || content?.is_error;

  if (!output && !stderr) return;

  console.log(COLORS.secondary(`    ↳`));

  // Truncate long output
  const maxLines = 15;
  if (output) {
    const lines = output.split('\n');
    const truncated = lines.length > maxLines;
    lines.slice(0, maxLines).forEach(line => {
      console.log(COLORS.secondary(`    ${line}`));
    });
    if (truncated) {
      console.log(COLORS.separator(`    ... (${lines.length - maxLines} more lines)`));
    }
  }

  if (stderr) {
    console.log(chalk.red(`    stderr: ${stderr.slice(0, 200)}`));
  }
}

// Process a single JSONL entry
function processEntry(entry, { showThinking, showTools, showToolOutput, showOutput, showUser }) {
  // Handle user messages (top-level type)
  if (entry.type === 'user' && entry.message?.content) {
    if (showUser) {
      printUserMessage(entry.message.content, entry.timestamp);
    }
    // Also check for tool_result in user message content (tool results come back as user messages)
    if (showToolOutput && Array.isArray(entry.message.content)) {
      for (const item of entry.message.content) {
        if (item.type === 'tool_result') {
          printToolResult(item.content, entry.toolUseResult, entry.timestamp);
        }
      }
    }
    return;
  }

  const content = entry.message?.content;
  if (!Array.isArray(content)) return;

  for (const item of content) {
    if (showThinking && item.type === 'thinking' && item.thinking) {
      printThinking(item.thinking, entry.timestamp);
    }
    if (showTools && item.type === 'tool_use') {
      printToolCall(item.name, item.input || {}, entry.timestamp);
    }
    if (showToolOutput && item.type === 'tool_result') {
      printToolResult(item.content, entry.toolUseResult, entry.timestamp);
    }
    if (showOutput && item.type === 'text' && item.text) {
      printTextResponse(item.text, entry.timestamp);
    }
  }
}

// Main
// Smart arg parsing: detect direct file path, project path, or session ID
let [arg1, arg2] = cli.input;
let sessionId, projectPath, directFile;

if (arg1 && arg1.endsWith('.jsonl')) {
  // Direct path to a .jsonl file
  directFile = path.resolve(arg1);
} else if (arg1 && (arg1.startsWith('/') || arg1.startsWith('.') || arg1.startsWith('~'))) {
  // First arg is a project path
  projectPath = arg1;
  sessionId = arg2;
} else {
  sessionId = arg1;
  projectPath = arg2;
}

// Handle --list flag
if (cli.flags.list) {
  listSessions(projectPath);
  process.exit(0);
}

const sessionFile = directFile || findSessionFile(sessionId, projectPath);

if (!sessionFile || !fs.existsSync(sessionFile)) {
  console.error(chalk.red('No session file found'));
  console.error(chalk.dim(`Looked for: ${sessionFile || 'N/A'}`));
  process.exit(1);
}

const sessionIdFromFile = path.basename(sessionFile, '.jsonl');

// Resolve flags
const showThinking = cli.flags.thinking || cli.flags.all;
const showTools = cli.flags.tools || cli.flags.all;
const showToolOutput = cli.flags.toolOutput || cli.flags.all;
const showOutput = cli.flags.output || cli.flags.all;
const showUser = cli.flags.user || cli.flags.all;

// Build description of what we're showing
const parts = [];
if (showThinking) parts.push('thinking');
if (showUser) parts.push('user');
if (showTools) parts.push('tools');
if (showToolOutput) parts.push('tool-output');
if (showOutput) parts.push('output');
const modeDesc = parts.join(' + ');

// Print header
console.log(chalk.bold(cli.flags.follow ? 'Following' : 'Showing'), 'session:', chalk.cyan(sessionIdFromFile));
console.log(modeDesc);
console.log(chalk.dim(sessionFile));
console.log(chalk.dim('────────────────────────────────────────'));

// Read and process existing content
const existingContent = fs.readFileSync(sessionFile, 'utf8');
for (const line of existingContent.split('\n').filter(Boolean)) {
  try {
    processEntry(JSON.parse(line), { showThinking, showTools, showToolOutput, showOutput, showUser });
  } catch {}
}

if (!cli.flags.follow) {
  process.exit(0);
}

// Watch for new content
let lastSize = fs.statSync(sessionFile).size;

const watcher = chokidar.watch(sessionFile, { persistent: true });
watcher.on('change', () => {
  const newSize = fs.statSync(sessionFile).size;
  if (newSize > lastSize) {
    const fd = fs.openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(newSize - lastSize);
    fs.readSync(fd, buffer, 0, buffer.length, lastSize);
    fs.closeSync(fd);

    for (const line of buffer.toString().split('\n').filter(Boolean)) {
      try {
        processEntry(JSON.parse(line), { showThinking, showTools, showToolOutput, showOutput, showUser });
      } catch {}
    }
    lastSize = newSize;
  }
});

// Keep running
process.on('SIGINT', () => {
  watcher.close();
  process.exit(0);
});
