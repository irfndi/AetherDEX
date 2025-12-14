# Critical TODOs - Prioritization & Implementation Guide

**Date:** December 14, 2025
**Status:** Active Development Priorities
**Total Critical TODOs:** 3

---

## 🎯 Priority Matrix

| # | TODO | Priority | Effort | Impact | Sprint | Owner |
|---|------|----------|--------|--------|--------|-------|
| 1 | Vyper Bytecode Deployment | P0 - BLOCKER | 4-6h | 🔴 Critical | Week 1 | Smart Contracts Team |
| 2 | WebSocket Token Validation | P1 - HIGH | 6-8h | 🟠 High | Week 1 | Backend Team |
| 3 | Cross-Chain Fee Lookup | P1 - HIGH | 8-12h | 🟠 High | Week 2-3 | Smart Contracts Team |

---

## Priority Scoring Methodology

**Impact Assessment:**
- 🔴 Critical: Blocks production deployment
- 🟠 High: Significant functionality or security gap
- 🟡 Medium: Enhancement or optimization
- 🟢 Low: Nice-to-have improvement

**Effort Estimation:**
- Research + Implementation + Testing + Documentation

**Sprint Assignment:**
- Week 1 (Current): Immediate blockers
- Week 2-3: High priority enhancements
- Week 4+: Medium/low priority improvements

---

## 1. 🔴 P0: Vyper Bytecode Deployment

### Why This is #1 Priority

**Blocking Impact:**
- ❌ Pool creation via factory will **FAIL**
- ❌ Cannot deploy liquidity pools on-chain
- ❌ Entire DEX functionality blocked
- ❌ **Production deployment impossible**

**Current State:**
- Factory uses minimal proxy placeholder instead of actual bytecode
- Proxy pattern inappropriate for stateful pool contracts
- Each pool needs isolated state (reserves, liquidity)

**Dependencies:**
- None - can start immediately
- Requires Vyper compiler (v0.4.3)
- Foundry test environment

### Implementation Roadmap

**Phase 1: Compile (1 hour)**
```bash
cd packages/contracts
vyper --evm-version cancun src/security/AetherPool.vy -f bytecode > AetherPool.bin
```

**Phase 2: Inject Bytecode (1 hour)**
- Copy compiled bytecode from AetherPool.bin
- Replace `getPoolBytecode()` function in AetherFactory.sol
- Add compilation metadata in comments

**Phase 3: Verify (2-3 hours)**
- Create test: `testFactoryDeploysValidPool()`
- Verify pool bytecode length
- Test pool implements IAetherPool interface
- Integration test: Factory → Pool → Swap

**Phase 4: Document (30 minutes)**
- Add compilation date and version
- Document EVM version (cancun)
- Update deployment documentation

### Success Criteria

- [ ] Bytecode compiled with Vyper 0.4.3
- [ ] Factory deploys pool successfully
- [ ] Pool has correct token addresses
- [ ] Pool swap functionality works
- [ ] Gas cost acceptable (<2M gas)
- [ ] All tests passing

### Risk Assessment

**Low Risk:**
- Straightforward compilation task
- Well-defined success criteria
- Existing test infrastructure

**Mitigation:**
- Keep minimal proxy as fallback (commented)
- Test on testnet before mainnet
- Verify bytecode matches expected hash

---

## 2. 🟠 P1: WebSocket Token Validation

### Why This is #2 Priority

**Security Impact:**
- ⚠️ WebSocket authentication incomplete
- ⚠️ Potential unauthorized access to user events
- ⚠️ Cannot verify token expiration
- ⚠️ High severity security gap

**Current State:**
- Auth middleware exists and works
- Context key mismatch prevents validation
- Token validation function missing
- No token expiration handling

**Dependencies:**
- Existing auth middleware (already implemented)
- JWT library (already in dependencies)

### Implementation Roadmap

**Phase 1: Quick Fix (30 minutes)**
- Fix context key mismatch: `"userAddress"` → `"user_address"`
- Test basic authentication flow

**Phase 2: Token Validation (2 hours)**
- Add `ValidateWebSocketToken` function
- Parse JWT token from query/header
- Validate signature and expiration
- Return validated claims

**Phase 3: Integration (2 hours)**
- Update WebSocket upgrade handler
- Extract token before upgrade
- Validate for authenticated endpoint only
- Set validated address in context

**Phase 4: Long-Lived Connections (2 hours)**
- Track token expiry in Client struct
- Add periodic expiration check
- Send token refresh notification
- Gracefully disconnect expired clients

**Phase 5: Testing (2 hours)**
- Unit tests for token validation
- Integration test for authenticated WebSocket
- Test token expiration flow
- Test public endpoints (no auth required)

### Success Criteria

- [ ] Context key mismatch fixed
- [ ] Valid tokens accepted
- [ ] Expired tokens rejected (401)
- [ ] Invalid signatures rejected
- [ ] Token expiration tracked
- [ ] Refresh notification sent
- [ ] Tests passing (6+ test cases)

### Risk Assessment

**Medium Risk:**
- Auth logic already complex
- WebSocket connection lifecycle management
- Token refresh UX considerations

**Mitigation:**
- Reuse existing auth middleware patterns
- Test with long-lived connections
- Add comprehensive logging
- Gradual rollout (dev → staging → prod)

---

## 3. 🟠 P1: Cross-Chain Fee Lookup

### Why This is #3 Priority

**Functional Impact:**
- ⚠️ Cross-chain liquidity may use wrong fee tier
- ⚠️ Liquidity added to wrong price ranges
- ⚠️ Fee calculation mismatches
- ⚠️ Suboptimal capital efficiency

**Current State:**
- Cross-chain hook implemented
- Fee/tickSpacing hardcoded or defaulted
- Payload doesn't include pool parameters
- No validation on destination chain

**Dependencies:**
- Cross-chain messaging infrastructure (exists)
- LayerZero/Hyperlane integration (exists)
- PoolManager interface (exists)

### Implementation Roadmap

**Phase 1: Design Decision (1 hour)**
- Choose approach: Payload vs. Lookup vs. Registry
- **Recommended:** Include in payload (simplest, most reliable)
- Document tradeoffs

**Phase 2: Update Payload Struct (2 hours)**
- Add `fee` and `tickSpacing` fields
- Update encoding function
- Update decoding function
- Version payload format

**Phase 3: Source Chain Validation (2 hours)**
- Validate fee tier before sending
- Ensure pool exists with specified fee
- Encode fee/tickSpacing in message
- Add event emission

**Phase 4: Destination Chain Handling (2 hours)**
- Extract fee/tickSpacing from payload
- Validate pool exists on destination
- Use exact parameters for liquidity
- Handle fee tier mismatch errors

**Phase 5: Testing (3-4 hours)**
- Unit tests for payload encoding/decoding
- Unit tests for fee validation
- Integration test: Cross-chain with 0.3% fee
- Integration test: Cross-chain with 1% fee
- Edge case: Non-existent pool (revert)
- Edge case: Fee tier mismatch (revert)

### Success Criteria

- [ ] Payload includes fee/tickSpacing
- [ ] Source validates fee tier
- [ ] Destination uses exact parameters
- [ ] Pool existence validated
- [ ] Tests passing (6+ scenarios)
- [ ] Documentation updated

### Risk Assessment

**Medium Risk:**
- Cross-chain message format change
- Backward compatibility considerations
- Multiple chain deployment coordination

**Mitigation:**
- Version payload format (v1, v2, etc.)
- Test on testnet cross-chain first
- Deploy source chain updates before destination
- Add feature flag for gradual rollout

---

## Implementation Timeline

### Week 1 (Current Sprint)

**Day 1-2: Vyper Bytecode** (P0)
- Compile AetherPool.vy
- Inject bytecode into AetherFactory
- Test pool deployment
- Verify all tests passing
- **Estimated:** 6 hours

**Day 3-4: WebSocket Auth** (P1)
- Fix context key mismatch
- Implement token validation
- Add expiration handling
- Write and run tests
- **Estimated:** 8 hours

**Day 5: Buffer**
- Address any issues from P0/P1
- Code review and refinement
- Update documentation

### Week 2-3 (Next Sprint)

**Day 1-3: Cross-Chain Fee** (P1)
- Update payload structure
- Implement validation logic
- Add comprehensive tests
- **Estimated:** 12 hours

**Day 4-5: Integration Testing**
- End-to-end testing of all fixes
- Cross-chain testing
- Performance validation
- Documentation updates

---

## Parallel Work Opportunities

While Smart Contracts team works on #1 and #3, Backend team can work on #2 in parallel:

**Smart Contracts Team:**
- Week 1: Vyper Bytecode (P0)
- Week 2-3: Cross-Chain Fee (P1)

**Backend Team:**
- Week 1: WebSocket Auth (P1)
- Week 2: Database Migrations
- Week 3: Missing API Domains

This parallel approach reduces overall timeline from 3 weeks to ~2 weeks.

---

## Communication Plan

### Daily Standups
- Progress on current TODO
- Blockers encountered
- Help needed

### Issue Updates
- Update GitHub issue with progress
- Mark checkboxes as completed
- Add implementation notes

### Code Reviews
- Create PR when 80% complete
- Request review from team lead
- Address feedback promptly

### Documentation
- Update TODO_CLEANUP_ANALYSIS.md when complete
- Update PROJECT_READINESS_REPORT.md with new scores
- Add implementation notes to relevant docs

---

## Success Metrics

### Technical Metrics
- [ ] All 3 critical TODOs resolved
- [ ] 100% test coverage for new code
- [ ] 0 regressions introduced
- [ ] Gas costs within budget

### Timeline Metrics
- [ ] P0 completed in Week 1
- [ ] P1 items completed by end of Week 3
- [ ] No blockers lasting >1 day

### Quality Metrics
- [ ] Code review approved
- [ ] CI/CD passing
- [ ] Documentation updated
- [ ] Security review (for auth changes)

---

## Post-Completion Actions

After all 3 critical TODOs are resolved:

1. **Update Reports**
   - Regenerate PROJECT_READINESS_REPORT.md
   - Update readiness scores
   - Mark TODOs as completed

2. **Archive TODO_CLEANUP_ANALYSIS.md**
   - Move to `.archive/2024-docs/`
   - Create new cleanup analysis if needed

3. **Celebrate**
   - Team recognition
   - Document lessons learned
   - Share improvements with stakeholders

4. **Move to Next Phase**
   - Address High Priority items from backlog
   - Plan Phase 2 improvements
   - Schedule security audit

---

## Appendix: Quick Reference

### Issue Links
- #1: [CRITICAL] Fix Vyper Bytecode Deployment
- #2: [HIGH] Implement WebSocket Token Validation
- #3: [HIGH] Implement Dynamic Fee Lookup for Cross-Chain

### Related Documentation
- `PROJECT_READINESS_REPORT.md` - Overall project assessment
- `TODO_CLEANUP_ANALYSIS.md` - Detailed TODO analysis
- `.github/ISSUE_TEMPLATE/` - GitHub issue templates

### Commands

**Compile Vyper:**
```bash
vyper --evm-version cancun src/security/AetherPool.vy -f bytecode > AetherPool.bin
```

**Run Smart Contract Tests:**
```bash
cd packages/contracts && forge test -vvv
```

**Run Backend Tests:**
```bash
cd apps/api && go test ./... -v
```

**Check for Orphan TODOs:**
```bash
grep -rn "TODO\|FIXME" packages/contracts/src apps/api/internal \
  --exclude-dir=lib --exclude-dir=node_modules \
  | grep -v "issue\|Issue\|#[0-9]"
```

---

**Status:** Active - Ready for Implementation
**Owner:** Development Team
**Review Date:** Weekly during standups
**Last Updated:** December 14, 2025
