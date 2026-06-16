#!/bin/bash
set -e

# Installs singularity CLI globally
# Usage: curl -fsSL https://raw.githubusercontent.com/tylerdotai/singularity/singularity-base/install.sh | bash
# Supports SINGULARITY_BRANCH env var to install a different branch (default: singularity-base)
# Supports SINGULARITY_VERSION env var to pin a GitHub release version
# Supports --uninstall flag to remove

INSTALL_DIR="${HOME}/.local/share/singularity"
BIN_DIR="${HOME}/.local/bin"
CACHE_DIR="${HOME}/.cache/singularity"

main() {
  if [ "$1" = "--uninstall" ]; then
    uninstall
    exit 0
  fi

  ensure_dependencies
  install_singularity
  print_next_steps
}

ensure_dependencies() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi

  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash

  # Source bun env
  BUN_INSTALL="${HOME}/.bun"
  if [ -f "${BUN_INSTALL}/bin/bun" ]; then
    export BUN_INSTALL
    export PATH="${BUN_INSTALL}/bin:${PATH}"
  fi

  if ! command -v bun >/dev/null 2>&1; then
    echo "Failed to install Bun. Please install Bun manually: https://bun.sh" >&2
    exit 1
  fi

  echo "Bun installed successfully."
}

install_singularity() {
  local version="${SINGULARITY_VERSION:-latest}"
  local branch="${SINGULARITY_BRANCH:-singularity-base}"
  local repo="tylerdotai/singularity"

  echo "Installing Singularity (branch: ${branch})..."

  mkdir -p "${INSTALL_DIR}"
  mkdir -p "${BIN_DIR}"
  mkdir -p "${CACHE_DIR}"

  local cli_dir="${CACHE_DIR}/cli-build"

  if [ -d "$(dirname "$0")/packages/singularity-cli" ]; then
    rm -rf "${cli_dir}"
    cp -r "$(dirname "$0")" "${cli_dir}"
    (cd "${cli_dir}" && bun install --frozen-lockfile 2>/dev/null || bun install)
  else
    local download_url="https://github.com/${repo}/archive/refs/heads/${branch}.tar.gz"
    rm -rf "${cli_dir}"
    mkdir -p "${cli_dir}"
    curl -fsSL "${download_url}" | tar xz -C "${cli_dir}" --strip-components=1
    (cd "${cli_dir}" && bun install --frozen-lockfile 2>/dev/null || bun install)
  fi

  rm -f "${BIN_DIR}/singularity"
  cat > "${BIN_DIR}/singularity" <<WRAPPER
#!/usr/bin/env bash
cd "${cli_dir}"
exec bun run "./packages/singularity-cli/src/main.ts" "\$@"
WRAPPER
  chmod +x "${BIN_DIR}/singularity"

  echo "Singularity installed! Run: singularity setup"
}

print_next_steps() {
  echo ""
  echo ""
  echo "To install in the future, run:"
  echo "  curl -fsSL https://raw.githubusercontent.com/tylerdotai/singularity/singularity-base/install.sh | bash"
}

uninstall() {
  echo "Uninstalling Singularity..."

  rm -f "${BIN_DIR}/singularity"
  rm -rf "${INSTALL_DIR}"
  rm -rf "${CACHE_DIR}"

  echo "Singularity uninstalled."
}

main "$@"