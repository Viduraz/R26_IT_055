#!/bin/bash

# Quick Start Script for Phase 1 Implementation
# Run this to start the entire system with one command

set -e  # Exit on error

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       Phase 1: Adaptive Thresholds - Quick Start               ║"
echo "║              SecureElderCare System                            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if MongoDB is running
echo -e "${BLUE}[1] Checking MongoDB Connection...${NC}"
if ! command -v mongod &> /dev/null; then
    echo -e "${YELLOW}⚠  MongoDB not found. Please ensure MongoDB is installed and running.${NC}"
    echo "   Install: brew install mongodb-community"
    echo "   Start: mongod (in separate terminal)"
else
    echo -e "${GREEN}✓${NC} MongoDB found"
fi

# Check Python
echo -e "\n${BLUE}[2] Checking Python Environment...${NC}"
python_version=$(python3 --version 2>&1 | awk '{print $2}')
if [[ "$python_version" > "3.7" ]]; then
    echo -e "${GREEN}✓${NC} Python $python_version"
else
    echo -e "${RED}✗${NC} Python $python_version (need 3.8+)"
    exit 1
fi

# Check Node.js
echo -e "\n${BLUE}[3] Checking Node.js...${NC}"
node_version=$(node --version 2>&1)
if command -v node &> /dev/null; then
    echo -e "${GREEN}✓${NC} Node.js $node_version"
else
    echo -e "${RED}✗${NC} Node.js not found"
    exit 1
fi

# Install backend dependencies
echo -e "\n${BLUE}[4] Installing Backend Dependencies...${NC}"
cd schedule-monitoring/backend
pip install -q -r requirements.txt 2>/dev/null
echo -e "${GREEN}✓${NC} Backend dependencies installed"

# Install frontend dependencies
echo -e "\n${BLUE}[5] Installing Frontend Dependencies...${NC}"
cd ../frontend
npm install -q 2>/dev/null
echo -e "${GREEN}✓${NC} Frontend dependencies installed"

# Return to project root
cd ../..

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                  System Ready to Start                         ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

echo -e "${BLUE}Starting Services...${NC}"
echo ""
echo "Backend will start on:  http://localhost:8004"
echo "Frontend will start on: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop any service"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down services...${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true
    wait $FRONTEND_PID 2>/dev/null || true
    echo -e "${GREEN}✓${NC} All services stopped"
}

trap cleanup EXIT

# Start backend
echo -e "${BLUE}Starting Backend...${NC}"
cd schedule-monitoring/backend
python -m uvicorn app.main:app --reload --port 8004 > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✓${NC} Backend PID: $BACKEND_PID"

# Wait for backend to start
sleep 3

# Start frontend
echo -e "${BLUE}Starting Frontend...${NC}"
cd ../frontend
npm run dev > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}✓${NC} Frontend PID: $FRONTEND_PID"

# Wait for frontend to start
sleep 3

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                   Services Running!                           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}✓ Backend running:${NC}  http://localhost:8004/api/schedule/health"
echo -e "${GREEN}✓ Frontend running:${NC} http://localhost:5173"
echo ""
echo "Next steps:"
echo "  1. Open browser to http://localhost:5173"
echo "  2. Navigate to Schedule Dashboard"
echo "  3. Click 'Show Detector' button"
echo "  4. Perform an activity (wave arms, sit down, walk)"
echo "  5. Watch adaptive grace period display in real-time"
echo ""
echo "To view logs:"
echo "  Backend:  tail -f /tmp/backend.log"
echo "  Frontend: tail -f /tmp/frontend.log"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Keep running
wait $BACKEND_PID $FRONTEND_PID
