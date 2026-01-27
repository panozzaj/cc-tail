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
    $ cc-tail [options] [session-id] [project-path]

  ${chalk.dim('Options')}
    --no-follow    Print existing content and exit (default: follow live)
    --tools        Also show tool calls (Edit, Bash, Write, etc.)
    --tool-output  Also show tool results/outputs
    --output       Also show Claude's text responses
    --user         Also show user messages
    --all          Show everything
    -h, --help     Show this help

  ${chalk.dim('Examples')}
    $ cc-tail                          # follow live thinking
    $ cc-tail --no-follow              # print existing and exit
    $ cc-tail --tools                  # include tool calls
    $ cc-tail --all                    # show everything
`, {
  importMeta: import.meta,
  flags: {
    follow: { type: 'boolean', default: true },
    tools: { type: 'boolean', default: false },
    toolOutput: { type: 'boolean', default: false },
    output: { type: 'boolean', default: false },
    user: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
  },
});

// Shades of blue/gray for thinking blocks (subtle gradations)
const THINKING_COLORS = [
  chalk.rgb(100, 149, 237),  // cornflower blue
  chalk.rgb(119, 136, 153),  // light slate gray
  chalk.rgb(135, 160, 190),  // steel blue-ish
  chalk.rgb(95, 130, 160),   // darker steel
];
let thinkingCount = 0;

// Convert path to Claude's directory format
function pathToClaudeDir(p) {
  return p.replace(/\//g, '-');
}

// Find the session file
function findSessionFile(sessionId, projectPath) {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const projectDir = path.join(claudeDir, pathToClaudeDir(projectPath || process.cwd()));

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

// Shorten home directory in paths
function shortPath(p) {
  return p?.replace(os.homedir(), '~') || '';
}

// Format timestamp
function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : '??:??:??';
}

// Highlight backticks in text with a specific color for non-backtick text
function highlightBackticks(text, baseColor) {
  return text.replace(/`([^`]+)`/g, (_, code) => chalk.yellow(`\`${code}\``) + baseColor(''));
}

// Render a unified diff with context
function renderDiff(oldStr, newStr, contextLines = 3) {
  const changes = diffLines(oldStr || '', newStr || '');
  const lines = [];

  // Track line numbers
  let oldLineNum = 1;
  let newLineNum = 1;

  // First pass: mark all lines with their type and line numbers
  const allLines = [];
  for (const change of changes) {
    const changeLines = change.value.split('\n');
    // Remove trailing empty string from split
    if (changeLines[changeLines.length - 1] === '') changeLines.pop();

    for (const line of changeLines) {
      if (change.added) {
        allLines.push({ type: 'add', line, newNum: newLineNum++ });
      } else if (change.removed) {
        allLines.push({ type: 'remove', line, oldNum: oldLineNum++ });
      } else {
        allLines.push({ type: 'context', line, oldNum: oldLineNum++, newNum: newLineNum++ });
      }
    }
  }

  // Find ranges of changes and include context
  const output = [];
  let i = 0;
  while (i < allLines.length) {
    const item = allLines[i];

    if (item.type === 'add' || item.type === 'remove') {
      // Found a change - include context before
      const contextStart = Math.max(0, i - contextLines);

      // Add separator if we skipped lines
      if (contextStart > 0 && output.length === 0) {
        output.push(chalk.dim('  ...'));
      }

      // Add context before
      for (let j = contextStart; j < i; j++) {
        const ctx = allLines[j];
        if (ctx.type === 'context' && !output.includes(ctx)) {
          output.push(chalk.dim(`  ${ctx.line}`));
        }
      }

      // Add the change and following changes
      while (i < allLines.length && (allLines[i].type === 'add' || allLines[i].type === 'remove' ||
             (allLines[i].type === 'context' && i + 1 < allLines.length &&
              (allLines[i + 1].type === 'add' || allLines[i + 1].type === 'remove')))) {
        const curr = allLines[i];
        if (curr.type === 'add') {
          output.push(chalk.green(`+ ${curr.line}`));
        } else if (curr.type === 'remove') {
          output.push(chalk.red(`- ${curr.line}`));
        } else {
          output.push(chalk.dim(`  ${curr.line}`));
        }
        i++;
      }

      // Add context after
      const contextEnd = Math.min(allLines.length, i + contextLines);
      for (let j = i; j < contextEnd; j++) {
        const ctx = allLines[j];
        if (ctx.type === 'context') {
          output.push(chalk.dim(`  ${ctx.line}`));
        }
      }
      i = contextEnd;

      // Add separator if more content follows
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
  const color = THINKING_COLORS[thinkingCount % THINKING_COLORS.length];
  thinkingCount++;

  console.log();
  console.log(chalk.dim(`─── ${chalk.yellow('thinking')} @ ${formatTime(timestamp)} ───`));

  for (const line of thinking.split('\n')) {
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
  console.log(chalk.dim(`─── ${chalk.white('response')} @ ${formatTime(timestamp)} ───`));
  console.log(highlightCodeBlocks(text));
}

// Print user message
function printUserMessage(text, timestamp) {
  console.log();
  console.log(chalk.dim(`─── ${chalk.green('user')} @ ${formatTime(timestamp)} ───`));
  console.log(chalk.green(text));
}

// Print a tool call
function printToolCall(name, input, timestamp) {
  console.log();
  console.log(chalk.dim(`─── ${chalk.cyan(name)} @ ${formatTime(timestamp)} ───`));

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
      if (input.description) console.log(chalk.dim(`# ${input.description}`));
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

  console.log(chalk.dim(`    ↳ `));

  // Truncate long output
  const maxLines = 15;
  if (output) {
    const lines = output.split('\n');
    const truncated = lines.length > maxLines;
    lines.slice(0, maxLines).forEach(line => {
      console.log(chalk.dim(`    ${line}`));
    });
    if (truncated) {
      console.log(chalk.dim(`    ... (${lines.length - maxLines} more lines)`));
    }
  }

  if (stderr) {
    console.log(chalk.red(`    stderr: ${stderr.slice(0, 200)}`));
  }
}

// Process a single JSONL entry
function processEntry(entry, { showTools, showToolOutput, showOutput, showUser }) {
  // Handle user messages (top-level type)
  if (showUser && entry.type === 'user' && entry.message?.content) {
    printUserMessage(entry.message.content, entry.timestamp);
    return;
  }

  const content = entry.message?.content;
  if (!Array.isArray(content)) return;

  for (const item of content) {
    if (item.type === 'thinking' && item.thinking) {
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
const [sessionId, projectPath] = cli.input;
const sessionFile = findSessionFile(sessionId, projectPath);

if (!sessionFile || !fs.existsSync(sessionFile)) {
  console.error(chalk.red('No session file found'));
  console.error(chalk.dim(`Looked for: ${sessionFile || 'N/A'}`));
  process.exit(1);
}

const sessionIdFromFile = path.basename(sessionFile, '.jsonl');

// Resolve flags
const showTools = cli.flags.tools || cli.flags.all;
const showToolOutput = cli.flags.toolOutput || cli.flags.all;
const showOutput = cli.flags.output || cli.flags.all;
const showUser = cli.flags.user || cli.flags.all;

// Build description of what we're showing
const parts = ['thinking'];
if (showTools) parts.push('tools');
if (showToolOutput) parts.push('tool-output');
if (showOutput) parts.push('output');
if (showUser) parts.push('user');
const modeDesc = parts.join(' + ');

// Print header
console.log(chalk.bold(cli.flags.follow ? 'Following' : 'Showing'),
  modeDesc, 'from session:', chalk.cyan(sessionIdFromFile));
console.log(chalk.dim(sessionFile));
console.log(chalk.dim('────────────────────────────────────────'));

// Read and process existing content
const existingContent = fs.readFileSync(sessionFile, 'utf8');
for (const line of existingContent.split('\n').filter(Boolean)) {
  try {
    processEntry(JSON.parse(line), { showTools, showToolOutput, showOutput, showUser });
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
        processEntry(JSON.parse(line), { showTools, showToolOutput, showOutput, showUser });
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
