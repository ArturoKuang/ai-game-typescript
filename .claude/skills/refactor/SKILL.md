---
name: refactor
description: Refactor code in the AI Town codebase — extract functions, rename symbols, restructure modules, reduce duplication, and improve type safety while keeping all tests green. Run without arguments to auto-discover refactoring opportunities.
argument-hint: "[refactoring description or empty to discover]"
---

# Refactor Code

Refactor code in the AI Town codebase safely, ensuring tests pass before and after changes.

## Arguments

- `$ARGUMENTS` — what to refactor. **If empty or not provided**, run discovery mode (Step 0) to find and propose opportunities.

## Instructions

Follow these steps in order. Do not skip steps.

### Step 0: Discovery Mode (when no specific refactoring is requested)

If `$ARGUMENTS` is empty or vague (e.g., "find things to clean up"), scan the codebase for refactoring opportunities. Run these analyses in parallel:

**A. Large files** — find files with the most lines of code:

```bash
wc -l server/src/**/*.ts server/src/**/**/*.ts | sort -rn | head -20
```

Files over 300 lines are candidates for extraction.

**B. Complex functions** — find long functions (likely doing too much):

Search for functions longer than ~40 lines. Read the largest source files (`gameLoop.ts`, `conversation.ts`, `world.ts`, `websocket.ts`, `router.ts`) and identify functions that could be broken up.

**C. Duplication** — look for repeated patterns:

Search for similar code blocks across files. Common duplication spots:
- Position/distance calculations used in multiple files
- Player lookup + validation patterns repeated across handlers
- Similar error handling or response formatting

**D. Type safety** — find loose typing:

```bash
# Find any types
grep -rn ': any' server/src/ --include='*.ts' | grep -v node_modules
grep -rn 'as any' server/src/ --include='*.ts' | grep -v node_modules

# Find type assertions that might be avoidable
grep -rn 'as [A-Z]' server/src/ --include='*.ts' | grep -v node_modules | grep -v 'import'
```

**E. Import complexity** — find files with many imports (possible coupling issues):

```bash
grep -c "^import" server/src/**/*.ts server/src/**/**/*.ts | sort -t: -k2 -rn | head -10
```

**F. Dead code** — find exported symbols that might be unused:

Search for exported functions/types and check if they're imported anywhere.

After analysis, present a **ranked list of refactoring opportunities** to the user, grouped by category:

```
## Refactoring Opportunities

### High Value (large impact, low risk)
1. [description] — [file] — [why]
2. ...

### Medium Value
1. ...

### Low Value (small improvement or higher risk)
1. ...
```

For each opportunity, note:
- **What**: the specific refactoring
- **Where**: file(s) and approximate line numbers
- **Why**: what's wrong with the current code (too long, duplicated, loosely typed, etc.)
- **Risk**: low / medium / high

Then ask the user which one(s) to proceed with. Once they choose, continue to Step 1.

---

### Step 1: Baseline — Run Tests

Run the test suite first to establish a green baseline. If tests are already failing, report this to the user before proceeding.

```bash
cd server && npm test
```

If any tests fail, stop and report. Do not refactor on top of a broken test suite.

### Step 2: Analyze Scope

Read the files involved in the refactoring: **$ARGUMENTS**

Determine the refactoring type and plan:

- **Extract**: Identify the code to extract, its dependencies, and where it should live. Check for circular import risks.
- **Rename**: Find all usages across the codebase (source, tests, types, protocol). Use grep/glob to ensure nothing is missed.
- **Move/restructure**: Map out all imports that reference the moved code. Check for barrel exports or re-exports.
- **Deduplicate**: Identify all instances of the duplicated pattern. Design a shared abstraction only if there are 3+ instances.
- **Type safety**: Find the `any` types or loose typings. Determine the correct narrower types.

Key things to check:
- Which files import/depend on the code being changed?
- Are there tests that directly test the code being refactored?
- Does this touch `protocol.ts` (which affects the client)?
- Does this touch `types.ts` (which is imported everywhere)?

### Step 3: Refactor

Apply the changes for: **$ARGUMENTS**

Follow these rules:

1. **Preserve behavior** — refactoring must not change observable behavior. No feature additions, no bug fixes mixed in.
2. **Small, atomic changes** — if the refactoring is large, break it into smaller steps. Complete each step fully before moving to the next.
3. **Update all references** — when renaming or moving, update every import, every test, every type reference. Missing an import is the #1 refactoring bug.
4. **ES module imports** — always use `.js` extensions in import paths.
5. **No `any`** — do not introduce `any` types. If removing code that was typed as `any`, replace with the correct type.
6. **Keep engine I/O-free** — files in `engine/` must not import from `db/`, `network/`, or `npc/`.
7. **Preserve public API** — if the refactored code is used by `debug/router.ts` or `network/websocket.ts`, ensure the public interface remains compatible (or update all consumers).

### Step 4: Update Tests

- If you extracted/moved code, ensure tests import from the new location.
- If you renamed symbols, update all test references.
- If you split a module, add tests for the new module if it has standalone logic.
- Do NOT delete existing test coverage. Tests may need to move but should not disappear.

### Step 5: Run Tests Again

```bash
cd server && npm test
```

All tests must pass. If any fail:
1. Read the failure output carefully.
2. Fix the issue (usually a missed import or renamed reference).
3. Re-run tests until green.

Do not proceed until all tests pass.

### Step 6: Verify No Regressions (if server is running)

Check whether the server is running:

```bash
curl -s -o /dev/null -w "%{http_code}" localhost:3001/api/debug/state
```

If the server responds (200), do a quick sanity check:

```bash
curl -s localhost:3001/api/debug/state | jq .
curl -s localhost:3001/api/debug/map
```

If the server is not running, skip — test results are sufficient.

### Step 7: Report

Report to the user:
- **What changed**: files modified, created, or deleted
- **Refactoring type**: extract / rename / move / deduplicate / type-safety
- **Import graph changes**: any files that now import from a different path
- **Test results**: pass/fail count, confirming green
- **Risk assessment**: low (internal-only change), medium (touches shared types), high (touches protocol/client boundary)
