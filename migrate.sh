#!/usr/bin/env bash
set -e

# Create target directories
mkdir -p backend/smart-contract/src/primary backend/smart-contract/src/security

# Idempotent move of Solidity primary modules
PRIMARY_FILES=("BaseRouter.sol" "AetherRouter.sol" "AetherRouterCrossChain.sol" "AetherFactory.sol" "FeeRegistry.sol")
for f in "${PRIMARY_FILES[@]}"; do
  src="backend/smart-contract/src/$f"
  dst="backend/smart-contract/src/primary/$f"
  if [ -f "$src" ] && [ ! -f "$dst" ]; then
    mv "$src" "backend/smart-contract/src/primary/"
    echo "Moved $f to src/primary"
  fi
done

# Idempotent move of Vyper security contracts
SECURITY_FILES=("AetherPool.vy" "Escrow.vy")
for f in "${SECURITY_FILES[@]}"; do
  src="backend/smart-contract/src/$f"
  dst="backend/smart-contract/src/security/$f"
  if [ -f "$src" ] && [ ! -f "$dst" ]; then
    mv "$src" "backend/smart-contract/src/security/"
    echo "Moved $f to src/security"
  fi
done

# Update import paths in primary contracts
for f in backend/smart-contract/src/primary/*.sol; do
  sed -i '' 's@"\.\./interfaces/@"../src/primary/interfaces/@g' "$f"
  sed -i '' 's@"\.\./libraries/@"../src/primary/libraries/@g' "$f"
  sed -i '' 's@"\.\./types/@"../src/primary/types/@g' "$f"
  sed -i '' 's@"\./@"../src/primary/@g' "$f"
done

# Update vm.getCode for Vyper pool in tests
find backend/smart-contract/test -type f -name "*.sol" -exec sed -i '' 's@vm.getCode("AetherPool.vy")@vm.getCode("../src/security/AetherPool.vy")@g' {} +

find backend/smart-contract/test -type f -name "*.sol" -exec sed -i '' 's@"\./@"../src/primary/@g' {} +

# Adjust import paths for primary modules in tests
for f in AetherFactory.sol AetherRouter.sol AetherRouterCrossChain.sol FeeRegistry.sol BaseRouter.sol; do
  find backend/smart-contract/test -type f -name "*.sol" -exec sed -i '' "s@/src/$f@/src/primary/$f@g" {} +
done

# Update imports for primary modules in tests
find backend/smart-contract/test -type f -exec sed -i '' 's@"\.\./src/\(AetherFactory.sol\|AetherRouter.sol\|AetherRouterCrossChain.sol\|FeeRegistry.sol\|BaseRouter.sol\)"@"../src/primary/\1"@g' {} +

# Fix mock imports in test files (mocks moved to test/mocks)
# Update mocks import paths in test root
find backend/smart-contract/test -type f -name "*.t.sol" -exec sed -i '' 's@"../src/primary/mocks/\(MockERC20.sol\)"@"./mocks/\1"@g' {} +
find backend/smart-contract/test -type f -name "*.t.sol" -exec sed -i '' 's@"../src/primary/mocks/\(MockPoolManager.sol\)"@"./mocks/\1"@g' {} +
# Update mocks import paths in integration tests
find backend/smart-contract/test/integration -type f -name "*.t.sol" -exec sed -i '' 's@"../../src/primary/mocks/\(MockERC20.sol\)"@"../mocks/\1"@g' {} +
find backend/smart-contract/test/integration -type f -name "*.t.sol" -exec sed -i '' 's@"../../src/primary/mocks/\(MockPoolManager.sol\)"@"../mocks/\1"@g' {} +
# Update mocks import paths in hook tests
find backend/smart-contract/test/hooks -type f -name "*.t.sol" -exec sed -i '' 's@"../../src/primary/mocks/\(MockERC20.sol\)"@"../mocks/\1"@g' {} +
find backend/smart-contract/test/hooks -type f -name "*.t.sol" -exec sed -i '' 's@"../../src/primary/mocks/\(MockPoolManager.sol\)"@"../mocks/\1"@g' {} +

# Update mocks import paths
find backend/smart-contract/test/mocks -type f -name "*.sol" -exec sed -i '' 's@"../src/primary/MockERC20.sol"@"./MockERC20.sol"@g' {} +
find backend/smart-contract/test/mocks -type f -name "*.sol" -exec sed -i '' 's@"../src/primary/MockPoolManager.sol"@"./MockPoolManager.sol"@g' {} +

# Update Vyper deploy paths in tests
sed -i '' 's@vm.deployCode("src/AetherPool.vy"@vm.deployCode("src/security/AetherPool.vy"@g' backend/smart-contract/test/AetherPoolVyperTest.t.sol
sed -i '' 's@vm.deployCode("src/Escrow.vy"@vm.deployCode("src/security/Escrow.vy"@g' backend/smart-contract/test/EscrowVyper.t.sol
sed -i '' 's@import {MockERC20} from "../src/primary/mocks/MockERC20.sol";@import {MockERC20} from "./MockERC20.sol";@g' backend/smart-contract/test/AetherPoolVyperTest.t.sol

# Fix lint in SmartRoutingIntegration: remove unused initialPool and add view mutability
sed -i '' '/AetherPool initialPool = new AetherPool(address(this))/d' backend/smart-contract/test/integration/SmartRoutingIntegration.t.sol
sed -i '' 's/function _setupSingleChainTest() internal returns (TestParams memory)/function _setupSingleChainTest() internal view returns (TestParams memory)/' backend/smart-contract/test/integration/SmartRoutingIntegration.t.sol

# Remove obsolete backup interface if exists
backup="backend/smart-contract/src/interfaces/IFeeRegistry_DynamicHook_Backup.sol"
if [ -f "$backup" ]; then rm "$backup" && echo "Removed backup interface"; fi

echo "Migration complete: modules split into src/primary and src/security."
