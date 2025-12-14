# TODO/FIXME Cleanup Analysis - AetherDEX

**Analysis Date:** December 14, 2025
**Purpose:** Identify current vs. deprecated TODOs for cleanup
**Total TODOs Found:** 9 in active code + 6 in old docs + many in dependencies

---

## Executive Summary

**Recommendation:** Remove or update **80% of current TODOs**. Most are either:
1. Old documentation that should be archived
2. Dependency TODOs (not our code)
3. Vague placeholders that should be converted to tracked issues

**Action Required:**
- ✅ **Keep:** 3 critical TODOs (need immediate action)
- ⚠️ **Update/Convert:** 3 TODOs (convert to GitHub issues)
- ❌ **Remove:** 6 documentation TODOs + test TODOs
- 🗑️ **Archive:** Entire `docs/old-ref/` directory

---

## Category 1: CRITICAL - KEEP & ADDRESS IMMEDIATELY

These are **active blockers** in production code that MUST be fixed:

### 1. ✅ CRITICAL: Vyper Bytecode Deployment
**Location:** `packages/contracts/src/primary/AetherFactory.sol:192`

```solidity
// TODO: Replace with actual compiled Vyper bytecode
// This is a placeholder - in practice, you would include the compiled
// Vyper bytecode for AetherPool.vy here
```

**Status:** ACTIVE - MUST FIX
**Why Keep:** Factory cannot deploy pools without proper bytecode
**Action:**
1. Compile AetherPool.vy to bytecode
2. Inject bytecode into `getPoolBytecode()`
3. Remove TODO comment after fix

**Severity:** 🔴 BLOCKING - Pool creation will fail

---

### 2. ✅ CRITICAL: Cross-Chain Fee Configuration
**Location:** `packages/contracts/src/hooks/CrossChainLiquidityHook.sol:192`

```solidity
// TODO: Fee and tickSpacing should ideally come from payload or manager lookup
```

**Status:** ACTIVE - SHOULD FIX
**Why Keep:** Cross-chain liquidity may use incorrect pool parameters
**Action:**
1. Implement dynamic fee/tickSpacing lookup from PoolManager
2. Add payload field for cross-chain fee configuration
3. Update after implementation

**Severity:** 🟠 HIGH - Affects cross-chain liquidity accuracy

---

### 3. ✅ ACTIVE: WebSocket Token Validation
**Location:** `apps/api/internal/websocket/handlers.go:202`

```go
// TODO: Implement actual token validation
```

**Status:** ACTIVE - SHOULD FIX
**Why Keep:** WebSocket authentication is incomplete
**Action:**
1. Implement JWT token validation for authenticated WebSocket
2. Add token expiration checking
3. Remove TODO after implementation

**Severity:** 🟠 HIGH - Security gap in WebSocket auth

---

## Category 2: UPDATE/CONVERT TO ISSUES

These TODOs should be removed from code and tracked as GitHub issues:

### 4. ⚠️ CONVERT TO ISSUE: Initial Mint Case
**Location:** `packages/contracts/src/security/AetherPool.vy:511`

```vyper
# TODO: Handle initial mint case (_totalSupply == 0) if required by design.
assert _totalSupply > 0, "MINT_REQUIRES_EXISTING_LIQUIDITY"
```

**Current State:** Code explicitly prevents initial mint (asserts totalSupply > 0)
**Why Convert:** This is a design decision, not a missing implementation
**Action:**
1. Create GitHub issue: "Design decision: Should AetherPool support initial mint?"
2. Document current behavior (requires pre-existing liquidity)
3. **Remove TODO** - current implementation is intentional
4. Add comment explaining design choice:
   ```vyper
   # Design: Initial liquidity must be added via factory/manager
   # This prevents first LP from manipulating pool ratio
   assert _totalSupply > 0, "MINT_REQUIRES_EXISTING_LIQUIDITY"
   ```

**Severity:** 🟡 MEDIUM - Design decision needed

---

### 5. ⚠️ CONVERT TO ISSUE: Re-enable Pool Test
**Location:** `packages/contracts/test/security/AetherPool.t.sol:119`

```solidity
/* TODO: Re-enable testInitialize after FeeRegistry/Factory refactor
```

**Current State:** Test is commented out/disabled
**Why Convert:** Test debt that needs tracking
**Action:**
1. Create GitHub issue: "Re-enable testInitialize after FeeRegistry/Factory refactor"
2. Link to FeeRegistry refactor issue
3. **Remove TODO comment** - tracked in issues

**Severity:** 🟡 MEDIUM - Test coverage gap

---

### 6. ⚠️ CONVERT TO ISSUE: Router Test Liquidity
**Location:** `packages/contracts/test/primary/AetherRouter.t.sol:254`

```solidity
// TODO: Add liquidity via PoolManager or update test logic
```

**Current State:** Test setup incomplete
**Why Convert:** Test improvement, not production code
**Action:**
1. Create GitHub issue: "Update AetherRouter tests to use PoolManager for liquidity"
2. **Remove TODO** - tracked in issues
3. Add comment: `// See issue #XXX: Update to use PoolManager`

**Severity:** 🟡 MEDIUM - Test improvement needed

---

## Category 3: REMOVE - Old Documentation

These are in **deprecated/old documentation** and should be removed:

### 7. ❌ REMOVE: Old Implementation Plan TODOs
**Location:** `docs/old-ref/implementation-plan/smart-contract-development.md`

**Found 5 TODOs** in this file, including:
- `TODO` regarding initial mint case (duplicate of #4 above)
- Test failure TODOs that are now fixed
- Old implementation notes

**Action:**
```bash
# Entire docs/old-ref/ directory should be archived or removed
git rm -r docs/old-ref/
# OR move to .archive/
mkdir -p .archive/old-docs
git mv docs/old-ref/ .archive/old-docs/
```

**Reason:** These are historical documents that are no longer relevant. Current implementation differs significantly.

---

### 8. ❌ REMOVE: Security Analysis Log TODO
**Location:** `docs/reports/security-analysis-log.md:3`

```markdown
> TODO: Update this log after every Slither/static analysis run
```

**Action:**
1. Replace with process documentation:
   ```markdown
   > **Maintenance:** Update this log after running Slither/static analysis
   > **Frequency:** After each smart contract change
   > **Owner:** Smart Contract Team
   ```
2. This is a process note, not a task

---

### 9. ❌ REMOVE: Test Debug Output
**Location:** `apps/api/test/error_handling_test.go:950`

```go
fmt.Printf("DEBUG: Expected 409, got %d. Response body: %s\n", w.Code, w.Body.String())
```

**Action:**
1. Remove this debug line entirely
2. If debugging needed, use proper test output:
   ```go
   t.Logf("Expected 409, got %d. Response body: %s", w.Code, w.Body.String())
   ```

**Reason:** Debug code should not be committed. Use proper test logging.

---

## Category 4: DEPRECATED DOCS - ARCHIVE ENTIRE DIRECTORY

### Old Reference Documentation Directory

**Location:** `docs/old-ref/`

**Contains:**
- `implementation-plan/smart-contract-development.md` (5 TODOs)
- `implementation-plan/refactor-monorepo-tech-review-tanstack-migration-deps-update-prd-analysis.md`
- `DEPENDENCY_TEST_REPORT.md` (1 TODO)
- `scratchpad.md`

**Total Old TODOs:** 6

**Recommendation:** Archive or remove this entire directory

**Action Plan:**
```bash
# Option 1: Delete (if content is truly obsolete)
git rm -r docs/old-ref/

# Option 2: Archive (if want to preserve history)
mkdir -p .archive/2024-docs
git mv docs/old-ref/ .archive/2024-docs/
echo "/.archive/" >> .gitignore

# Option 3: Convert to historical wiki
# Move content to GitHub Wiki under "Historical Implementation Plans"
```

**Reason:**
- Implementation has diverged from these plans
- Keeping old docs causes confusion
- Current docs in `docs/smart-contracts/` supersede these

---

## Category 5: IGNORE - Third-Party Dependencies

These are in libraries/dependencies and should NOT be modified:

### Dependency TODOs (DO NOT MODIFY)

**Found in:**
- `packages/contracts/lib/forge-std/` (multiple TODOs)
- `packages/contracts/lib/openzeppelin-contracts/` (multiple TODOs)
- `packages/contracts/lib/v4-core/` (multiple TODOs)
- `node_modules/` (hundreds of TODOs)

**Examples:**
```solidity
// packages/contracts/lib/v4-core/src/libraries/NonzeroDeltaCount.sol:6
/// TODO: This library can be deleted when we have transient keyword support

// packages/contracts/lib/forge-std/scripts/vm.py:72
# TODO: Custom errors were introduced in 0.8.4
```

**Action:** IGNORE - These are maintained by third parties

**Best Practice:**
- Add to `.grepignore` or grep exclusions:
  ```bash
  # When searching for TODOs, exclude dependencies
  grep -r "TODO" --exclude-dir=lib --exclude-dir=node_modules .
  ```

---

## Summary Statistics

| Category | Count | Action |
|----------|-------|--------|
| **Critical (Keep & Fix)** | 3 | Address immediately |
| **Convert to Issues** | 3 | Create GH issues, remove TODOs |
| **Remove (Old Docs)** | 6 | Archive `docs/old-ref/` |
| **Remove (Debug Code)** | 1 | Delete debug statements |
| **Ignore (Dependencies)** | 100+ | Exclude from searches |
| **TOTAL to Clean** | **13** | **Active cleanup needed** |

---

## Cleanup Action Plan

### Phase 1: Immediate (This Week)

**Smart Contracts:**
```bash
# 1. Fix critical bytecode issue
cd packages/contracts
# Compile Vyper pool
vyper --evm-version cancun src/security/AetherPool.vy > AetherPool.bin
# Inject bytecode into AetherFactory.sol (manual edit)

# 2. Update AetherPool.vy comment
# Replace TODO with design explanation (see #4 above)
```

**Backend:**
```bash
# 3. Implement WebSocket token validation
cd apps/api
# Add validation logic in internal/websocket/handlers.go
```

**Documentation:**
```bash
# 4. Archive old docs
mkdir -p .archive/2024-docs
git mv docs/old-ref/ .archive/2024-docs/
git commit -m "chore: archive outdated implementation plans"
```

### Phase 2: Convert to Issues (Next Week)

Create GitHub issues for:
1. "Design decision: Support initial mint in AetherPool?" (#4)
2. "Re-enable testInitialize after FeeRegistry refactor" (#5)
3. "Update AetherRouter tests to use PoolManager" (#6)
4. "Implement dynamic fee lookup for cross-chain hooks" (#2)

Then remove TODO comments from code and reference issues:
```solidity
// See issue #XXX: Design decision needed for initial mint
```

### Phase 3: Code Cleanup (Next Week)

**Remove:**
1. Debug `fmt.Printf` in error_handling_test.go
2. All TODO comments converted to issues
3. Update security-analysis-log.md with process notes

**Add to CI:**
```bash
# Add pre-commit hook to prevent new TODOs without issue reference
# .git/hooks/pre-commit
grep -rn "TODO" apps/ packages/contracts/src/ | grep -v "See issue" && {
  echo "Error: TODO found without issue reference"
  exit 1
}
```

---

## Best Practices for Future TODOs

### ✅ DO:
```typescript
// Issue #123: Implement retry logic for failed transactions
// Temporarily using exponential backoff
```

### ❌ DON'T:
```typescript
// TODO: fix this later
// TODO: implement properly
// FIXME: hack
```

### Guidelines:
1. **Always link TODOs to tracked issues** - No orphan TODOs
2. **Set deadline** - Add target sprint/milestone in issue
3. **Single owner** - Assign issue to specific developer
4. **Remove when obsolete** - Clean up regularly
5. **Document design decisions** - Don't leave TODOs for intentional behavior

---

## Grep Commands for TODO Management

### Find Active TODOs (excluding dependencies):
```bash
grep -rn "TODO\|FIXME\|HACK\|XXX" \
  --include="*.sol" \
  --include="*.vy" \
  --include="*.go" \
  --include="*.ts" \
  --include="*.tsx" \
  --exclude-dir=lib \
  --exclude-dir=node_modules \
  --exclude-dir=.archive \
  apps/ packages/contracts/src/
```

### Find TODOs without issue references:
```bash
grep -rn "TODO" apps/ packages/contracts/src/ \
  --include="*.sol" --include="*.vy" --include="*.go" --include="*.ts" \
  --exclude-dir=lib --exclude-dir=node_modules \
  | grep -v "issue\|Issue\|#[0-9]"
```

### Count TODOs by type:
```bash
echo "Smart Contracts:" && grep -r "TODO" packages/contracts/src/ --include="*.sol" --include="*.vy" | wc -l
echo "Backend:" && grep -r "TODO" apps/api/ --include="*.go" --exclude-dir=vendor | wc -l
echo "Frontend:" && grep -r "TODO" apps/web/src --include="*.ts" --include="*.tsx" | wc -l
```

---

## Recommended `.grepignore` File

Create `.grepignore` in project root:
```
# Ignore TODOs in dependencies
node_modules/
packages/contracts/lib/
.archive/
docs/old-ref/

# Ignore TODOs in build artifacts
dist/
build/
out/
*.min.js
```

---

## Conclusion

**Current TODO Landscape:**
- 3 critical TODOs need immediate fixes
- 6 old documentation TODOs should be removed (archive `docs/old-ref/`)
- 3 code TODOs should be converted to GitHub issues
- 1 debug statement should be removed
- 100+ dependency TODOs should be excluded from searches

**Post-Cleanup:**
- **0 orphan TODOs** - All tracked in issues or removed
- **Clean codebase** - No stale comments
- **Clear accountability** - Each issue has owner and timeline

**Estimated Cleanup Time:** 4-6 hours across 1 week

---

**Next Steps:**
1. Review and approve this cleanup plan
2. Create GitHub issues for items in Category 2
3. Execute Phase 1 cleanup (archive old docs)
4. Fix critical TODOs (#1, #2, #3)
5. Remove/update remaining TODOs
6. Add pre-commit hook to prevent future orphan TODOs

---

*Generated by: Claude Code TODO Analysis*
*Date: December 14, 2025*
