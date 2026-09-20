const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseEnv, parseIni, parseSimpleYaml, flatten, loadConfig, isSecretKey, diffConfigs, formatDiff } = require("../src/configdiff.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✘ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("configdiff tests");

test("parseEnv handles KEY=value, quotes, comments, and blank lines", () => {
  const result = parseEnv('# comment\nFOO=bar\nBAZ="quoted value"\n\nQUX=\'single\'\n');
  assert.deepStrictEqual(result, { FOO: "bar", BAZ: "quoted value", QUX: "single" });
});

test("parseIni handles sections as key prefixes", () => {
  const result = parseIni("[database]\nhost=localhost\nport=5432\n\n[cache]\nhost=redis\n");
  assert.deepStrictEqual(result, { "database.host": "localhost", "database.port": "5432", "cache.host": "redis" });
});

test("parseSimpleYaml handles nested mappings", () => {
  const result = parseSimpleYaml("database:\n  host: localhost\n  port: 5432\ndebug: true\n");
  assert.deepStrictEqual(result, { database: { host: "localhost", port: "5432" }, debug: "true" });
});

test("flatten converts nested objects to dot notation", () => {
  const result = flatten({ a: { b: { c: 1 } }, d: 2 });
  assert.deepStrictEqual(result, { "a.b.c": "1", d: "2" });
});

test("loadConfig auto-detects JSON by extension", () => {
  const tmp = path.join(os.tmpdir(), `configdiff-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ a: { b: 1 } }));
  const result = loadConfig(tmp);
  assert.deepStrictEqual(result, { "a.b": "1" });
  fs.unlinkSync(tmp);
});

test("loadConfig auto-detects .env files", () => {
  const tmp = path.join(os.tmpdir(), `configdiff-${Date.now()}.env`);
  fs.writeFileSync(tmp, "FOO=bar\n");
  const result = loadConfig(tmp);
  assert.deepStrictEqual(result, { FOO: "bar" });
  fs.unlinkSync(tmp);
});

test("isSecretKey flags common secret-ish key names", () => {
  assert.strictEqual(isSecretKey("DB_PASSWORD"), true);
  assert.strictEqual(isSecretKey("API_KEY"), true);
  assert.strictEqual(isSecretKey("stripe_secret_key"), true);
  assert.strictEqual(isSecretKey("HOSTNAME"), false);
});

test("diffConfigs finds keys only in A, only in B, and differing values", () => {
  const a = { shared: "1", onlyA: "x" };
  const b = { shared: "2", onlyB: "y" };
  const diff = diffConfigs(a, b);
  assert.deepStrictEqual(diff.onlyInA, ["onlyA"]);
  assert.deepStrictEqual(diff.onlyInB, ["onlyB"]);
  assert.strictEqual(diff.differing.length, 1);
  assert.strictEqual(diff.differing[0].key, "shared");
});

test("diffConfigs redacts secret-looking keys in the differing output", () => {
  const diff = diffConfigs({ API_KEY: "abc123" }, { API_KEY: "def456" });
  assert.strictEqual(diff.differing[0].a, "***redacted***");
  assert.strictEqual(diff.differing[0].b, "***redacted***");
});

test("diffConfigs reports zero drift for identical configs", () => {
  const diff = diffConfigs({ a: "1", b: "2" }, { a: "1", b: "2" });
  assert.strictEqual(diff.onlyInA.length, 0);
  assert.strictEqual(diff.onlyInB.length, 0);
  assert.strictEqual(diff.differing.length, 0);
  assert.strictEqual(diff.identicalCount, 2);
});

test("formatDiff reports 'no drift' cleanly when configs match", () => {
  const diff = diffConfigs({ a: "1" }, { a: "1" });
  const out = formatDiff(diff, "staging.env", "prod.env");
  assert.ok(out.includes("No drift detected"));
});

test("formatDiff lists differing keys with redaction applied", () => {
  const diff = diffConfigs({ TOKEN: "x" }, { TOKEN: "y" });
  const out = formatDiff(diff, "a.env", "b.env");
  assert.ok(out.includes("***redacted***"));
  assert.ok(!out.includes("x"));
  assert.ok(!out.includes("=y"));
});

console.log(`\n${passed} test(s) passed`);
if (process.exitCode === 1) process.exit(1);
