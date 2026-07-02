#!/usr/bin/env node
// ponytail — Claude Code SessionStart activation hook
//
// Runs on every session start:
//   1. Writes flag file at $CLAUDE_CONFIG_DIR/.ponytail-active (defaults to ~/.claude; statusline reads this)
//   2. Emits ponytail ruleset as hidden SessionStart context
//   2b. If no default level is configured yet, nudges Claude to ask once via
//       AskUserQuestion and persist the answer to the config file
//   3. Detects missing statusline config and emits setup nudge

const fs = require('fs');
const path = require('path');
const { getDefaultMode, getConfigPath, hasConfiguredDefault, getClaudeDir, isShellSafe } = require('./ponytail-config');
const { getPonytailInstructions } = require('./ponytail-instructions');
const {
  clearMode,
  isCodex,
  isCopilot,
  setMode,
  writeHookOutput,
} = require('./ponytail-runtime');

const claudeDir = getClaudeDir();
const settingsPath = path.join(claudeDir, 'settings.json');

const mode = getDefaultMode();

// "off" mode — skip activation entirely, don't write flag or emit rules
if (mode === 'off') {
  clearMode();
  const hookOutput = (isCodex || isCopilot) ? '' : 'OK';
  writeHookOutput('SessionStart', 'off', hookOutput);
  process.exit(0);
}

// 1. Write flag file
try {
  setMode(mode);
} catch (e) {
  // Silent fail -- flag is best-effort, don't block the hook
}

// 2. Emit the ponytail ruleset, filtered to the active intensity level.
let output = getPonytailInstructions(mode);

// 2b. No default configured yet — nudge Claude to ask once and persist the answer.
if (!isCodex && !isCopilot && !hasConfiguredDefault()) {
  output += "\n\n" +
    "PONYTAIL FIRST RUN: No default level is configured for this user yet " +
    "(running at the built-in default, '" + mode + "', for now). Before doing " +
    "anything else this session, use AskUserQuestion to ask which Ponytail level " +
    "they want as their persistent default. Include a one-line explanation: " +
    "Ponytail is a lazy-senior-dev mode that forces the simplest solution that " +
    "works (reuse existing code, stdlib/native features, and dependencies already " +
    "installed, before writing anything new). Options: lite, full, ultra, off " +
    "(lite = light touch, full = the standard ladder enforced, ultra = maximally " +
    "aggressive simplification, off = disabled). If the question is dismissed " +
    "with no selection, treat that as 'off'. Once answered, write " +
    JSON.stringify({ defaultMode: '<answer>' }) + " to " + getConfigPath() +
    " (creating parent directories as needed) so this is never asked again, and " +
    "adopt that level as your effective mode for the rest of this session.";
}

// 3. Detect missing statusline config — nudge Claude to help set it up
if (!isCodex && !isCopilot) try {
  let hasStatusline = false;
  if (fs.existsSync(settingsPath)) {
    // Strip UTF-8 BOM some editors prepend on Windows (breaks JSON.parse)
    const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
    const settings = JSON.parse(raw);
    if (settings.statusLine) {
      hasStatusline = true;
    }
  }

  if (!hasStatusline) {
    const isWindows = process.platform === 'win32';
    const scriptName = isWindows ? 'ponytail-statusline.ps1' : 'ponytail-statusline.sh';
    const scriptPath = path.join(__dirname, scriptName);
    if (isShellSafe(scriptPath)) {
      const command = isWindows
        ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
        : `bash "${scriptPath}"`;
      const statusLineSnippet =
        '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
      output += "\n\n" +
        "STATUSLINE SETUP NEEDED: The ponytail plugin includes a statusline badge showing active mode " +
        "(e.g. [PONYTAIL], [PONYTAIL:ULTRA]). It is not configured yet. " +
        "To enable, add this to ~/.claude/settings.json: " +
        statusLineSnippet + " " +
        "Proactively offer to set this up for the user on first interaction.";
    } else {
      // ponytail: install path has shell metacharacters — don't embed it in a
      // command snippet; have the agent wire it up by hand instead.
      output += "\n\n" +
        "STATUSLINE SETUP NEEDED: The ponytail plugin includes a statusline badge showing active mode. " +
        "Its install path contains characters unsafe to embed in a shell command, so configure it manually: " +
        "add a statusLine command of type \"command\" that runs " + scriptName +
        " from the plugin's hooks directory to ~/.claude/settings.json, quoting/escaping the path for your shell. " +
        "Proactively offer to set this up for the user on first interaction.";
    }
  }
} catch (e) {
  // Silent fail — don't block session start over statusline detection
}

try {
  writeHookOutput('SessionStart', mode, output);
} catch (e) {
  // Silent fail — stdout closed/EPIPE at hook exit must not surface as a hook failure
}
