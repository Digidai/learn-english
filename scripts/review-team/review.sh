#!/usr/bin/env bash
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
MODEL="sonnet"
MAX_TURNS=15
PROJECT_DIR=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPTS_DIR="$SCRIPT_DIR/prompts"

# ─── Parse args ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --model)    MODEL="$2";      shift 2 ;;
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    --dir)      PROJECT_DIR="$2"; shift 2 ;;
    *)          echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Default project dir: parent of scripts/
if [[ -z "$PROJECT_DIR" ]]; then
  PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

# ─── Unset nested-session guard ──────────────────────────────────────────────
unset CLAUDECODE 2>/dev/null || true

# ─── Verify claude CLI ──────────────────────────────────────────────────────
if ! command -v claude &>/dev/null; then
  echo "❌ 'claude' CLI not found. Install it first."
  exit 1
fi

# ─── Setup report directory ─────────────────────────────────────────────────
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
REPORT_DIR="$PROJECT_DIR/reports/$TIMESTAMP"
mkdir -p "$REPORT_DIR"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║           Code Review Agent Team                        ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Model:     $MODEL"
echo "║  Max turns: $MAX_TURNS"
echo "║  Project:   $PROJECT_DIR"
echo "║  Report:    $REPORT_DIR"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

START_TIME=$(date +%s)

# ─── Agent definitions ───────────────────────────────────────────────────────
AGENTS=(
  "01-security:security"
  "02-performance:performance"
  "03-type-safety:type-safety"
  "04-business-logic:business-logic"
  "05-cloudflare:cloudflare"
  "06-ux-frontend:ux-frontend"
)

ALLOWED_TOOLS='Read,Grep,Glob,Bash(git diff*),Bash(git log*),Bash(wc*),Bash(ls*)'

PIDS=()

# ─── Launch agents in parallel ───────────────────────────────────────────────
for agent in "${AGENTS[@]}"; do
  REPORT_NAME="${agent%%:*}"
  PROMPT_NAME="${agent##*:}"
  PROMPT_FILE="$PROMPTS_DIR/$PROMPT_NAME.md"
  OUTPUT_FILE="$REPORT_DIR/$REPORT_NAME.md"

  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "⚠️  Prompt not found: $PROMPT_FILE, skipping."
    continue
  fi

  echo "🚀 Launching agent: $REPORT_NAME"

  claude -p \
    "Review the project code in $PROJECT_DIR. Follow the instructions in your system prompt carefully. Output a structured markdown review report." \
    --allowedTools "$ALLOWED_TOOLS" \
    --output-format text \
    --max-turns "$MAX_TURNS" \
    --model "$MODEL" \
    --append-system-prompt-file "$PROMPT_FILE" \
    > "$OUTPUT_FILE" 2>/dev/null &

  PIDS+=($!)
done

echo ""
echo "⏳ Waiting for ${#PIDS[@]} agents to complete..."
echo ""

# ─── Wait for all agents ─────────────────────────────────────────────────────
FAILED=0
for i in "${!PIDS[@]}"; do
  pid=${PIDS[$i]}
  agent=${AGENTS[$i]}
  REPORT_NAME="${agent%%:*}"
  if wait "$pid"; then
    echo "✅ $REPORT_NAME completed"
  else
    echo "❌ $REPORT_NAME failed (exit code: $?)"
    FAILED=$((FAILED + 1))
  fi
done

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINUTES=$((ELAPSED / 60))
SECONDS=$((ELAPSED % 60))

echo ""
echo "⏱️  Total time: ${MINUTES}m ${SECONDS}s"

# ─── Generate FULL-REPORT.md ────────────────────────────────────────────────
FULL_REPORT="$REPORT_DIR/FULL-REPORT.md"

# Count severity levels across all reports
CRITICAL=$(grep -rci '\[CRITICAL\]' "$REPORT_DIR"/*.md 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
HIGH=$(grep -rci '\[HIGH\]' "$REPORT_DIR"/*.md 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
MEDIUM=$(grep -rci '\[MEDIUM\]' "$REPORT_DIR"/*.md 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
LOW=$(grep -rci '\[LOW\]' "$REPORT_DIR"/*.md 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')

{
  cat <<EOF
# Full Code Review Report

**Generated**: $(date +"%Y-%m-%d %H:%M:%S")
**Model**: $MODEL
**Project**: $PROJECT_DIR

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | $CRITICAL |
| 🟠 HIGH | $HIGH |
| 🟡 MEDIUM | $MEDIUM |
| 🔵 LOW | $LOW |
| **Total** | **$((CRITICAL + HIGH + MEDIUM + LOW))** |

**Review duration**: ${MINUTES}m ${SECONDS}s
**Agents**: ${#PIDS[@]} launched, $FAILED failed

---

EOF

  # Append each agent report as a section
  for agent in "${AGENTS[@]}"; do
    REPORT_NAME="${agent%%:*}"
    OUTPUT_FILE="$REPORT_DIR/$REPORT_NAME.md"
    if [[ -f "$OUTPUT_FILE" && -s "$OUTPUT_FILE" ]]; then
      echo ""
      echo "---"
      echo ""
      cat "$OUTPUT_FILE"
    else
      echo ""
      echo "---"
      echo ""
      echo "# $REPORT_NAME"
      echo ""
      echo "> ⚠️ No output (agent may have failed)"
    fi
  done
} > "$FULL_REPORT"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Review Complete!                                       ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  🔴 CRITICAL: $CRITICAL"
echo "║  🟠 HIGH:     $HIGH"
echo "║  🟡 MEDIUM:   $MEDIUM"
echo "║  🔵 LOW:      $LOW"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  📄 Full report: $FULL_REPORT"
echo "╚══════════════════════════════════════════════════════════╝"
