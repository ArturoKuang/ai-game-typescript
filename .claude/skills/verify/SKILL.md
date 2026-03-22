---
name: verify
description: Run tests and optionally verify via the debug API after code changes to confirm nothing is broken.
---

# Verify Changes

Run tests and optionally verify via the debug API. Use this after quick edits to confirm nothing is broken.

## Instructions

### Step 1: Run Tests

```bash
cd server && npm test
```

If any tests fail, report the failures with details. Do not attempt to fix unless asked.

### Step 2: Debug API Verification (if server is running)

Check whether the server is running:

```bash
curl -s -o /dev/null -w "%{http_code}" localhost:3001/api/debug/state
```

If the server responds (200), do a quick visual check:

```bash
curl -s localhost:3001/api/debug/state | jq .
curl -s localhost:3001/api/debug/map
curl -s localhost:3001/api/debug/players | jq .
```

If the server is not running, skip this step — test results are sufficient.

### Step 3: Report

Report:
- Test results (pass/fail count, any failures)
- Game state snapshot (if server was running)
- Whether changes look safe to commit
