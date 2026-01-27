#!/usr/bin/env node
import React, { useState, useEffect } from 'react';
import { render, Text, Box, Static } from 'ink';
import meow from 'meow';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { diffLines } from 'diff';
import chokidar from 'chokidar';

const cli = meow(`
  Usage
    $ cc-tail [options] [session-id] [project-path]

  Options
    --no-follow  Print existing content and exit (default: follow live)
    --tools      Also show tool calls (Edit, Bash, Write, etc.)
    -h, --help   Show this help

  Examples
    $ cc-tail                          # follow live thinking
    $ cc-tail --no-follow              # print existing and exit
    $ cc-tail --tools                  # follow with tool calls
`, {
  importMeta: import.meta,
  flags: {
    follow: {
      type: 'boolean',
      default: true,
    },
    tools: {
      type: 'boolean',
      default: false,
    },
  },
});

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

  // Find most recent session
  if (!fs.existsSync(projectDir)) {
    return null;
  }

  const files = fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      name: f,
      mtime: fs.statSync(path.join(projectDir, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) return null;
  return path.join(projectDir, files[0].name);
}

// Colors for cycling through thinking blocks
const THINKING_COLORS = ['cyan', 'green', 'magenta', 'blue'];

// Component for rendering a diff
function DiffView({ oldStr, newStr }) {
  const changes = diffLines(oldStr, newStr);

  // Find context: lines before first change, lines after last change
  let firstChangeIdx = changes.findIndex(c => c.added || c.removed);
  let lastChangeIdx = changes.length - 1 - [...changes].reverse().findIndex(c => c.added || c.removed);

  // Show 2 lines of context
  const contextLines = 2;

  return (
    <Box flexDirection="column">
      {changes.map((change, idx) => {
        const lines = change.value.split('\n').filter((l, i, arr) => i < arr.length - 1 || l);

        // Skip if outside context window
        if (!change.added && !change.removed) {
          if (idx < firstChangeIdx - contextLines || idx > lastChangeIdx + contextLines) {
            return null;
          }
        }

        return lines.map((line, lineIdx) => {
          if (change.added) {
            return <Text key={`${idx}-${lineIdx}`} color="green">+ {line}</Text>;
          } else if (change.removed) {
            return <Text key={`${idx}-${lineIdx}`} color="red">- {line}</Text>;
          } else {
            return <Text key={`${idx}-${lineIdx}`} dimColor>  {line}</Text>;
          }
        });
      })}
    </Box>
  );
}

// Component for rendering a tool call
function ToolCall({ name, input, timestamp }) {
  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : '??:??:??';
  const homeDir = os.homedir();
  const shortPath = (p) => p?.replace(homeDir, '~') || '';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>─── <Text color="cyan">{name}</Text> @ {time} ───</Text>

      {name === 'Edit' && (
        <Box flexDirection="column">
          <Text bold>{shortPath(input.file_path)}</Text>
          {input.replace_all && <Text dimColor>(replace all)</Text>}
          <DiffView oldStr={input.old_string || ''} newStr={input.new_string || ''} />
        </Box>
      )}

      {name === 'Write' && (
        <Box flexDirection="column">
          <Text bold>{shortPath(input.file_path)}</Text>
          <Text dimColor>({input.content?.split('\n').length || 0} lines)</Text>
          {input.content?.split('\n').slice(0, 5).map((line, i) => (
            <Text key={i} color="green">+ {line}</Text>
          ))}
          {(input.content?.split('\n').length || 0) > 5 && (
            <Text dimColor>... ({input.content.split('\n').length - 5} more lines)</Text>
          )}
        </Box>
      )}

      {name === 'Bash' && (
        <Box flexDirection="column">
          {input.description && <Text dimColor># {input.description}</Text>}
          <Text color="yellow">$ {input.command}</Text>
        </Box>
      )}

      {name === 'Read' && (
        <Text><Text dimColor>reading</Text> <Text bold>{shortPath(input.file_path)}</Text></Text>
      )}

      {name === 'Glob' && (
        <Text><Text dimColor>glob</Text> <Text color="yellow">{input.pattern}</Text> <Text dimColor>in</Text> {input.path || '.'}</Text>
      )}

      {name === 'Grep' && (
        <Text><Text dimColor>grep</Text> <Text color="yellow">{input.pattern}</Text> <Text dimColor>in</Text> {input.path || '.'}</Text>
      )}

      {name === 'Task' && (
        <Text><Text color="magenta">{input.subagent_type}</Text>: {input.description}</Text>
      )}
    </Box>
  );
}

// Component for rendering thinking
function ThinkingBlock({ thinking, index, timestamp }) {
  const color = THINKING_COLORS[index % THINKING_COLORS.length];
  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : '??:??:??';

  // Highlight backticks
  const highlightBackticks = (text) => {
    const parts = text.split(/(`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return <Text key={i} color="yellow">{part}</Text>;
      }
      return <Text key={i} color={color}>{part}</Text>;
    });
  };

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>─── <Text color="yellow">thinking</Text> @ {time} ───</Text>
      {thinking.split('\n').map((line, i) => (
        <Text key={i}>{highlightBackticks(line)}</Text>
      ))}
    </Box>
  );
}

// Main app component
function App({ sessionFile, follow, showTools }) {
  const [entries, setEntries] = useState([]);
  const [thinkingCount, setThinkingCount] = useState(0);

  useEffect(() => {
    // Read existing content
    const readExisting = () => {
      if (!fs.existsSync(sessionFile)) return [];
      const content = fs.readFileSync(sessionFile, 'utf8');
      return content.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    };

    const existing = readExisting();
    const processed = processEntries(existing, showTools);
    setEntries(processed.entries);
    setThinkingCount(processed.thinkingCount);

    if (!follow) {
      // Exit after rendering
      setTimeout(() => process.exit(0), 100);
      return;
    }

    // Watch for changes
    let lastSize = fs.existsSync(sessionFile) ? fs.statSync(sessionFile).size : 0;

    const watcher = chokidar.watch(sessionFile, { persistent: true });
    watcher.on('change', () => {
      const newSize = fs.statSync(sessionFile).size;
      if (newSize > lastSize) {
        const fd = fs.openSync(sessionFile, 'r');
        const buffer = Buffer.alloc(newSize - lastSize);
        fs.readSync(fd, buffer, 0, buffer.length, lastSize);
        fs.closeSync(fd);

        const newLines = buffer.toString().split('\n').filter(Boolean);
        const newEntries = newLines.map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);

        if (newEntries.length > 0) {
          setEntries(prev => {
            const processed = processEntries(newEntries, showTools, prev.length);
            setThinkingCount(c => c + processed.thinkingCount);
            return [...prev, ...processed.entries];
          });
        }
        lastSize = newSize;
      }
    });

    return () => watcher.close();
  }, [sessionFile, follow, showTools]);

  const sessionId = path.basename(sessionFile, '.jsonl');

  return (
    <Box flexDirection="column">
      <Static items={[
        { type: 'header', key: 'header' },
        ...entries.map((entry, i) => ({ type: 'entry', element: entry, key: `entry-${i}` }))
      ]}>
        {(item) => {
          if (item.type === 'header') {
            return (
              <Box key="header" flexDirection="column">
                <Text bold>{follow ? 'Following' : 'Showing'} thinking{showTools ? ' + tools' : ''} from session: <Text color="cyan">{sessionId}</Text></Text>
                <Text dimColor>{sessionFile}</Text>
                <Text dimColor>────────────────────────────────────────</Text>
              </Box>
            );
          }
          return item.element;
        }}
      </Static>
    </Box>
  );
}

// Process JSONL entries into renderable components
function processEntries(entries, showTools, startIndex = 0) {
  const result = [];
  let thinkingCount = 0;

  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const item of content) {
      if (item.type === 'thinking' && item.thinking) {
        result.push(
          <ThinkingBlock
            key={`thinking-${startIndex + result.length}`}
            thinking={item.thinking}
            index={thinkingCount}
            timestamp={entry.timestamp}
          />
        );
        thinkingCount++;
      }

      if (showTools && item.type === 'tool_use') {
        result.push(
          <ToolCall
            key={`tool-${startIndex + result.length}`}
            name={item.name}
            input={item.input || {}}
            timestamp={entry.timestamp}
          />
        );
      }
    }
  }

  return { entries: result, thinkingCount };
}

// Main
const [sessionId, projectPath] = cli.input;
const sessionFile = findSessionFile(sessionId, projectPath);

if (!sessionFile || !fs.existsSync(sessionFile)) {
  console.error('No session file found');
  console.error(`Looked for: ${sessionFile || 'N/A'}`);
  process.exit(1);
}

render(<App sessionFile={sessionFile} follow={cli.flags.follow} showTools={cli.flags.tools} />);
