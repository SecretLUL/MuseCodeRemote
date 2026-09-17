#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="SecretLUL"
REPO_NAME="MuseCodeRemote"
BRANCH="main"
RAW_BASE="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}"

echo "════════════════════════════════════════════════════════════"
echo "  ⚡ Installing Muse Code Remote (MCR) CLI                  "
echo "════════════════════════════════════════════════════════════"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: Python 3 is required to run Muse Code Remote." >&2
  exit 1
fi

if [[ $EUID -eq 0 ]]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="${HOME}/.local/bin"
fi

mkdir -p "$INSTALL_DIR"
TARGET="${INSTALL_DIR}/mcr"

echo "Downloading MCR daemon into ${TARGET}..."
curl -fsSL "${RAW_BASE}/client/mcr" -o "$TARGET"
chmod +x "$TARGET"

if [[ -f "${INSTALL_DIR}/muse-remote" ]]; then
  rm -f "${INSTALL_DIR}/muse-remote"
fi
ln -s "$TARGET" "${INSTALL_DIR}/muse-remote"

echo "✓ Successfully installed: ${TARGET}"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo ""
    echo "Notice: ${INSTALL_DIR} is not in your current PATH."
    echo "Add it to your shell configuration (e.g. ~/.bashrc or ~/.zshrc):"
    echo "  export PATH=\"\$PATH:${INSTALL_DIR}\""
    ;;
esac

echo ""
echo "To start Muse Code Remote, simply run:"
echo "  mcr"
echo "════════════════════════════════════════════════════════════"
