# 🪞 ConfigDiff

[![CI](https://img.shields.io/github/actions/workflow/status/YOUR_USERNAME/configdiff/ci.yml?branch=main&label=CI)](../../actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/YOUR_USERNAME/configdiff?label=release)](../../releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

Compares configuration files across environments — `.env`, JSON, YAML, or INI — and highlights exactly what drifted: keys only on one side, and shared keys with different values. Secret-looking keys are always redacted in the output, never printed in the clear.

```
$ configdiff diff staging.env production.env

Comparing staging.env vs production.env

Only in staging.env (1):
  - DEBUG_MODE

Only in production.env (1):
  - CDN_URL

Different values (2):
  ~ LOG_LEVEL: staging.env=debug  production.env=warn
  ~ API_KEY: staging.env=***redacted***  production.env=***redacted***

5 key(s) identical.
```

## Install

```bash
git clone https://github.com/YOUR_USERNAME/configdiff.git
cd configdiff
npm install
```

Or open in **GitHub Codespaces** for a zero-setup environment (Node 20 + GitHub CLI).

## Usage

```bash
# Compare two config files (auto-detects format by extension)
npx configdiff diff staging.env production.env

# Machine-readable output for scripting
npx configdiff diff staging.yaml production.yaml --json

# Compare 3+ environments pairwise in one go
npx configdiff diff-many dev.env staging.env production.env
```

`configdiff diff` and `diff-many` exit with a **non-zero status if any drift is found** — drop it straight into a CI job to fail the build when environments have diverged from each other unexpectedly.

## Supported formats

Auto-detected by file extension:

| Extension | Format |
|---|---|
| `.json` | JSON (nested objects flattened to dot notation, e.g. `database.host`) |
| `.yaml`, `.yml` | A YAML subset — flat and nested mappings of scalars (no anchors, aliases, or lists) |
| `.ini`, `.cfg` | INI (`[section]` headers become key prefixes, e.g. `database.host`) |
| `.env`, or any file starting with `.env` | Standard `KEY=value` dotenv format |

## Secret redaction

Any key matching `secret`, `password`, `token`, `api_key`/`apikey`, or `private_key` (case-insensitive) has its value replaced with `***redacted***` in every output mode — you can see *that* it differs, never *what* it differs to.

## Development

```bash
npm test              # run the test suite (pure parsing/diffing logic, uses temp files)
npm run tracker        # see real repo stats (PRs merged, issues closed, releases)
npm run roadmap        # see the Day 1 -> Month 1 contributor roadmap
bash scripts/setup.sh   # check dependencies & make scripts executable
bash scripts/release.sh patch   # bump version, tag, and open a release PR
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## License

[MIT](LICENSE)
