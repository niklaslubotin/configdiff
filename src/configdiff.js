#!/usr/bin/env node
/**
 * ConfigDiff — compares configuration files across environments (e.g.
 * staging vs production .env/.json/.yaml files) and highlights drift:
 * keys only on one side, and keys present on both sides with different
 * values. Values are never printed for keys that look like secrets.
 *
 * Supports JSON, YAML (basic subset — flat and nested mappings, no
 * anchors/aliases), .env, and INI-style files, auto-detected by extension.
 *
 * Usage:
 *   node src/configdiff.js diff <fileA> <fileB> [--json]
 *   node src/configdiff.js diff-many <file1> <file2> <file3>...   Compare 3+ files, pairwise summary
 *   node src/configdiff.js --help
 */

const fs = require("fs");
const path = require("path");

const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|private[_-]?key)/i;

function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function parseIni(content) {
  const result = {};
  let section = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) { section = sectionMatch[1]; continue; }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const fullKey = section ? `${section}.${key}` : key;
    result[fullKey] = value;
  }
  return result;
}

/** A minimal YAML subset parser: flat and nested mappings of scalars (strings, numbers, booleans). No lists, anchors, or multi-line scalars. */
function parseSimpleYaml(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (const rawLine of lines) {
    const indent = rawLine.match(/^(\s*)/)[1].length;
    const line = rawLine.trim();
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;

    if (value === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      parent[key] = value;
    }
  }
  return root;
}

/** Flattens a nested object into dot-notation keys, e.g. { a: { b: 1 } } -> { "a.b": 1 }. */
function flatten(obj, prefix = "") {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flatten(value, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }
  return result;
}

function loadConfig(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return flatten(JSON.parse(content));
  if (ext === ".yaml" || ext === ".yml") return flatten(parseSimpleYaml(content));
  if (ext === ".ini" || ext === ".cfg") return parseIni(content);
  if (ext === ".env" || path.basename(filePath).startsWith(".env")) return parseEnv(content);
  // Fallback: try JSON, then .env-style key=value
  try {
    return flatten(JSON.parse(content));
  } catch {
    return parseEnv(content);
  }
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key);
}

function redact(key, value) {
  return isSecretKey(key) ? "***redacted***" : value;
}

/** Computes drift between two flat key->value maps: keys only in A, only in B, and keys in both with differing values. */
function diffConfigs(a, b) {
  const onlyInA = [];
  const onlyInB = [];
  const differing = [];
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const key of [...allKeys].sort()) {
    const inA = Object.prototype.hasOwnProperty.call(a, key);
    const inB = Object.prototype.hasOwnProperty.call(b, key);
    if (inA && !inB) onlyInA.push(key);
    else if (!inA && inB) onlyInB.push(key);
    else if (a[key] !== b[key]) differing.push({ key, a: redact(key, a[key]), b: redact(key, b[key]) });
  }

  return { onlyInA, onlyInB, differing, identicalCount: allKeys.size - onlyInA.length - onlyInB.length - differing.length };
}

function formatDiff(diff, labelA, labelB) {
  const lines = [`Comparing ${labelA} vs ${labelB}\n`];
  if (!diff.onlyInA.length && !diff.onlyInB.length && !diff.differing.length) {
    lines.push("✔ No drift detected — all keys match.");
    return lines.join("\n");
  }
  if (diff.onlyInA.length) {
    lines.push(`Only in ${labelA} (${diff.onlyInA.length}):`);
    for (const k of diff.onlyInA) lines.push(`  - ${k}`);
    lines.push("");
  }
  if (diff.onlyInB.length) {
    lines.push(`Only in ${labelB} (${diff.onlyInB.length}):`);
    for (const k of diff.onlyInB) lines.push(`  - ${k}`);
    lines.push("");
  }
  if (diff.differing.length) {
    lines.push(`Different values (${diff.differing.length}):`);
    for (const d of diff.differing) lines.push(`  ~ ${d.key}: ${labelA}=${d.a}  ${labelB}=${d.b}`);
    lines.push("");
  }
  lines.push(`${diff.identicalCount} key(s) identical.`);
  return lines.join("\n");
}

function parseFlags(args) {
  const opts = {};
  const positional = [];
  for (const a of args) {
    if (a.startsWith("--")) opts[a.slice(2)] = true;
    else positional.push(a);
  }
  return { opts, positional };
}

function cmdDiff(args) {
  const { opts, positional } = parseFlags(args);
  const [fileA, fileB] = positional;
  if (!fileA || !fileB) { console.error("Usage: diff <fileA> <fileB> [--json]"); process.exit(1); }
  const a = loadConfig(path.resolve(fileA));
  const b = loadConfig(path.resolve(fileB));
  const diff = diffConfigs(a, b);
  if (opts.json) console.log(JSON.stringify(diff, null, 2));
  else console.log(formatDiff(diff, fileA, fileB));

  if (diff.onlyInA.length || diff.onlyInB.length || diff.differing.length) process.exitCode = 1;
}

function cmdDiffMany(args) {
  const { positional } = parseFlags(args);
  if (positional.length < 3) { console.error("Usage: diff-many <file1> <file2> <file3> [...]"); process.exit(1); }
  const loaded = positional.map((f) => ({ file: f, config: loadConfig(path.resolve(f)) }));
  let anyDrift = false;
  for (let i = 0; i < loaded.length; i++) {
    for (let j = i + 1; j < loaded.length; j++) {
      const diff = diffConfigs(loaded[i].config, loaded[j].config);
      const drifted = diff.onlyInA.length || diff.onlyInB.length || diff.differing.length;
      if (drifted) anyDrift = true;
      console.log(formatDiff(diff, loaded[i].file, loaded[j].file));
      console.log("");
    }
  }
  if (anyDrift) process.exitCode = 1;
}

function printHelp() {
  console.log(`ConfigDiff — compares configuration files across environments and highlights drift

Usage:
  node src/configdiff.js diff <fileA> <fileB> [--json]              Compare two config files
  node src/configdiff.js diff-many <file1> <file2> <file3> [...]    Pairwise-compare 3+ config files
  node src/configdiff.js --help

Supports .json, .yaml/.yml (flat/nested mappings, no anchors or lists),
.ini/.cfg, and .env files, auto-detected by extension. Nested keys are
flattened to dot notation (e.g. "database.host"). Values for keys that look
like secrets (password, token, api_key, etc.) are always redacted in output.

Exits with a non-zero status if any drift is found — safe to use as a CI
gate that fails when environments diverge.
`);
}

function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === "--help" || cmd === "-h") return printHelp();
  switch (cmd) {
    case "diff": return cmdDiff(args);
    case "diff-many": return cmdDiffMany(args);
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { parseEnv, parseIni, parseSimpleYaml, flatten, loadConfig, isSecretKey, diffConfigs, formatDiff };
