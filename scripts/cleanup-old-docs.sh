#!/bin/bash

# Archive Old Documentation Script
# Purpose: Move deprecated docs to .archive/ directory
# Date: December 14, 2025

set -e

echo "🗂️  AetherDEX - Old Documentation Archival Script"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the project root
if [ ! -d "docs/old-ref" ]; then
    echo -e "${RED}Error: docs/old-ref/ directory not found${NC}"
    echo "Please run this script from the project root directory"
    exit 1
fi

# Create archive directory
echo -e "${YELLOW}Creating archive directory...${NC}"
mkdir -p .archive/2024-docs

# Count files to be archived
FILE_COUNT=$(find docs/old-ref -type f | wc -l)
echo -e "${YELLOW}Found ${FILE_COUNT} files to archive${NC}"
echo ""

# List files that will be archived
echo "Files to be archived:"
find docs/old-ref -type f | sed 's|^|  - |'
echo ""

# Ask for confirmation
read -p "Continue with archival? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}Archival cancelled${NC}"
    exit 1
fi

# Move old docs to archive
echo -e "${YELLOW}Moving docs/old-ref/ to .archive/2024-docs/${NC}"
mv docs/old-ref/ .archive/2024-docs/

# Update .gitignore
if ! grep -q "/.archive/" .gitignore 2>/dev/null; then
    echo -e "${YELLOW}Adding .archive/ to .gitignore${NC}"
    echo "" >> .gitignore
    echo "# Archived documentation" >> .gitignore
    echo "/.archive/" >> .gitignore
fi

# Create README in archive
cat > .archive/README.md << 'EOF'
# Archived Documentation

This directory contains historical documentation and implementation plans that are no longer current.

## Contents

- **2024-docs/old-ref/** - Original implementation plans and dependency reports
  - Archived on: December 14, 2025
  - Reason: Implementation has diverged from these plans
  - Current docs: See `/docs/` directory

## Why Archived?

These documents contained outdated TODOs, implementation strategies, and design decisions that have been superseded by the current codebase. Keeping them in the main docs directory caused confusion.

## Current Documentation

For up-to-date documentation, see:
- `/docs/` - Current project documentation
- `PROJECT_READINESS_REPORT.md` - Latest readiness assessment
- `TODO_CLEANUP_ANALYSIS.md` - TODO management strategy
EOF

echo -e "${GREEN}✅ Archival complete!${NC}"
echo ""
echo "Summary:"
echo "  - Moved: docs/old-ref/ → .archive/2024-docs/old-ref/"
echo "  - Updated: .gitignore"
echo "  - Created: .archive/README.md"
echo ""
echo "Next steps:"
echo "  1. Review archived content: .archive/2024-docs/"
echo "  2. Commit changes: git add -A && git commit -m 'chore: archive outdated documentation'"
echo "  3. Removed ${FILE_COUNT} outdated documentation files from active docs"
echo ""
echo -e "${GREEN}🎉 Cleanup successful!${NC}"
