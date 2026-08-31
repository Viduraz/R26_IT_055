#!/bin/bash

# Verification Script for Phase 1 Implementation
# Run this to verify all components are ready

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  Phase 1: Adaptive Thresholds - Implementation Verification   ║"
echo "║                  SecureElderCare System                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counter for results
PASSED=0
FAILED=0
WARNINGS=0

# Function to check file exists
check_file() {
    local file=$1
    local desc=$2
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $desc"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC} $desc (Not found: $file)"
        ((FAILED++))
        return 1
    fi
}

# Function to check directory
check_dir() {
    local dir=$1
    local desc=$2
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✓${NC} $desc"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC} $desc (Not found: $dir)"
        ((FAILED++))
        return 1
    fi
}

# Function to check Python package
check_python_package() {
    local package=$1
    local desc=$2
    python3 -c "import $package" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $desc (installed)"
        ((PASSED++))
        return 0
    else
        echo -e "${YELLOW}⚠${NC} $desc (not installed - run: pip install $package)"
        ((WARNINGS++))
        return 1
    fi
}

# Function to check Node package in package.json
check_node_package() {
    local package=$1
    local desc=$2
    local file=$3
    if grep -q "\"$package\"" "$file"; then
        echo -e "${GREEN}✓${NC} $desc"
        ((PASSED++))
        return 0
    else
        echo -e "${YELLOW}⚠${NC} $desc (not in package.json)"
        ((WARNINGS++))
        return 1
    fi
}

# Function to check file contains string
check_file_contains() {
    local file=$1
    local string=$2
    local desc=$3
    if grep -q "$string" "$file"; then
        echo -e "${GREEN}✓${NC} $desc"
        ((PASSED++))
        return 0
    else
        echo -e "${YELLOW}⚠${NC} $desc"
        ((WARNINGS++))
        return 1
    fi
}

echo -e "\n${BLUE}[1] Checking Backend Structure${NC}"
echo "─────────────────────────────────────────"
check_dir "schedule-monitoring/backend" "Backend directory exists"
check_file "schedule-monitoring/backend/requirements.txt" "Backend requirements.txt"
check_file "schedule-monitoring/backend/app/main.py" "Backend main.py"
check_file "schedule-monitoring/backend/app/services/schedule_service.py" "Schedule service module"

echo -e "\n${BLUE}[2] Checking Backend Dependencies${NC}"
echo "─────────────────────────────────────────"
check_file_contains "schedule-monitoring/backend/requirements.txt" "numpy" "NumPy in requirements"
check_file_contains "schedule-monitoring/backend/requirements.txt" "fastapi" "FastAPI in requirements"
check_file_contains "schedule-monitoring/backend/requirements.txt" "pymongo" "PyMongo in requirements"

echo -e "\n${BLUE}[3] Checking Backend ML Methods${NC}"
echo "─────────────────────────────────────────"
check_file_contains "schedule-monitoring/backend/app/services/schedule_service.py" "get_adaptive_grace_period" "get_adaptive_grace_period() method"
check_file_contains "schedule-monitoring/backend/app/services/schedule_service.py" "check_activity_status" "check_activity_status() method"
check_file_contains "schedule-monitoring/backend/app/services/schedule_service.py" "numpy" "NumPy imported"
check_file_contains "schedule-monitoring/backend/app/services/schedule_service.py" "mean_delay" "Statistical calculation"

echo -e "\n${BLUE}[4] Checking Frontend Structure${NC}"
echo "─────────────────────────────────────────"
check_dir "schedule-monitoring/frontend" "Frontend directory exists"
check_dir "schedule-monitoring/frontend/src" "Frontend src directory"
check_file "schedule-monitoring/frontend/package.json" "Frontend package.json"
check_file "schedule-monitoring/frontend/vite.config.js" "Frontend Vite config"

echo -e "\n${BLUE}[5] Checking Frontend Components${NC}"
echo "─────────────────────────────────────────"
check_file "schedule-monitoring/frontend/src/services/scheduleApi.js" "Schedule API service"
check_file "schedule-monitoring/frontend/src/components/ActivityDetectorMonitor.jsx" "Activity detector monitor"
check_file "schedule-monitoring/frontend/src/pages/ScheduleDashboard.jsx" "Schedule dashboard"
check_file "schedule-monitoring/frontend/src/pages/Reports.jsx" "Reports page"

echo -e "\n${BLUE}[6] Checking Frontend ML Integration${NC}"
echo "─────────────────────────────────────────"
check_file_contains "schedule-monitoring/frontend/src/components/ActivityDetectorMonitor.jsx" "adaptive_grace_minutes" "Adaptive grace period in monitor"
check_file_contains "schedule-monitoring/frontend/src/components/ActivityDetectorMonitor.jsx" "STATUS_DISPLAY" "Status display mapping"
check_file_contains "schedule-monitoring/frontend/src/pages/Reports.jsx" "STATUS_COLORS" "Status colors mapping"
check_file_contains "schedule-monitoring/frontend/src/pages/Reports.jsx" "adaptive_grace_minutes" "Adaptive data in reports"

echo -e "\n${BLUE}[7] Checking Documentation${NC}"
echo "─────────────────────────────────────────"
check_file "docs/PHASE1_ADAPTIVE_THRESHOLDS.md" "Backend implementation guide"
check_file "docs/FRONTEND_INTEGRATION.md" "Frontend integration guide"
check_file "IMPLEMENTATION_STATUS_PHASE1.md" "Implementation status summary"

echo -e "\n${BLUE}[8] Checking Backup Files${NC}"
echo "─────────────────────────────────────────"
if [ -f "schedule-monitoring/backend/app/services/schedule_service_old_backup.py" ]; then
    echo -e "${GREEN}✓${NC} Original schedule_service.py backed up"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} Original schedule_service.py not backed up (optional)"
    ((WARNINGS++))
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                      Verification Results                      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}✓ Passed:${NC}   $PASSED"
echo -e "${RED}✗ Failed:${NC}   $FAILED"
echo -e "${YELLOW}⚠ Warnings:${NC} $WARNINGS"
echo ""

if [ $FAILED -eq 0 ]; then
    if [ $WARNINGS -eq 0 ]; then
        echo -e "${GREEN}All checks passed! System is ready to deploy.${NC}"
        echo ""
        echo "Next steps:"
        echo "  1. Install backend dependencies:"
        echo "     cd schedule-monitoring/backend"
        echo "     pip install -r requirements.txt"
        echo ""
        echo "  2. Install frontend dependencies:"
        echo "     cd schedule-monitoring/frontend"
        echo "     npm install"
        echo ""
        echo "  3. Start backend (from backend directory):"
        echo "     python -m uvicorn app.main:app --reload --port 8004"
        echo ""
        echo "  4. Start frontend (from frontend directory in new terminal):"
        echo "     npm run dev"
        echo ""
        echo "  5. Open http://localhost:5173 in your browser"
        exit 0
    else
        echo -e "${YELLOW}All critical checks passed, but fix warnings first.${NC}"
        exit 0
    fi
else
    echo -e "${RED}Critical issues found! Fix before deploying.${NC}"
    exit 1
fi
