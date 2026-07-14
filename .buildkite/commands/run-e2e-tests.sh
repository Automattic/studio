#!/usr/bin/env bash
set -euo pipefail

trap 'echo "Termination signal received — failing the job."; exit 1' TERM INT

PLATFORM=${1:?Expected platform to be provided as first parameter}
ARCH=${2:?Expected architecture to be provided as second parameter}

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
if [ "$PLATFORM" = "linux" ]; then
  # Linux runs inside a Debian Node container on the shared `default` queue.
  # The a8c-ci-toolkit cache helpers (hash_file, restore_cache) only exist on
  # the host, so install-node-dependencies.sh can't run here. Also install
  # Electron's runtime libraries plus xvfb (CI agents are headless) and the
  # browser dependencies Playwright would otherwise fetch via `npx playwright
  # install-deps` — same set, but apt is faster than letting Playwright shell
  # out to it again.
  apt-get -o Acquire::Retries=3 update
  apt-get install -y --no-install-recommends \
    xvfb \
    xauth \
    libcap2-bin \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    libxss1
  npm ci --unsafe-perm --no-audit --no-progress --maxsockets 1
else
  bash .buildkite/commands/install-node-dependencies.sh
fi

echo '--- :inbox_tray: Prepare e2e fixtures'
if [ "$PLATFORM" = "linux" ]; then
  # The a8c-ci-toolkit cache helpers aren't available inside the Linux
  # container (see the npm install note above), so fixtures download fresh
  # each run. The prep script re-verifies hashes, so this stays correct.
  npm run e2e:fixtures -- --require
else
  # Cache the verified downloads keyed on the manifest, so editing
  # test-fixtures/manifest.json invalidates the cache. The prep script
  # re-verifies every SHA-256 even on a cache hit, so a stale or corrupt
  # cache self-heals rather than failing the run.
  FIXTURES_CACHE_KEY="$BUILDKITE_PIPELINE_SLUG-e2e-fixtures-$(hash_file test-fixtures/manifest.json)"
  restore_cache "$FIXTURES_CACHE_KEY"
  npm run e2e:fixtures -- --require
  save_cache test-fixtures/downloads "$FIXTURES_CACHE_KEY"
fi

export IS_DEV_BUILD=true

# Map platform names to electron-forge platform values
case "$PLATFORM" in
  mac)
    FORGE_PLATFORM="darwin"
    ;;
  windows)
    FORGE_PLATFORM="win32"
    ;;
  linux)
    FORGE_PLATFORM="linux"
    ;;
  *)
    echo "Unknown platform: $PLATFORM"
    exit 1
    ;;
esac

# Use `electron-forge package` instead of `npm run make:*` for E2E tests.
# `make` creates signed distributables (installers), which requires code signing setup.
# `package` creates an unsigned app bundle, sufficient for E2E testing.
echo "--- :package: Package app for testing ($PLATFORM-$ARCH)"
npm -w studio-app run package -- --arch="$ARCH" --platform="$FORGE_PLATFORM"

if [ "$PLATFORM" = "linux" ]; then
  # The packaged app under apps/studio/out was created by electron-forge
  # running as root with restrictive default perms — the node user (which
  # runs Playwright below) gets EACCES on scandir without this. `X` (capital)
  # keeps directories traversable and existing executables executable,
  # without making every regular file executable.
  echo '--- :wrench: Open packaged app perms for non-root test user'
  chmod -R go+rX apps/studio/out

  # Chromium's setuid sandbox helper (`chrome-sandbox`) requires real-root
  # ownership + setuid bit. Under Docker user-namespace remapping, the
  # container's "root" isn't real-root, so the kernel doesn't honor setuid
  # and Chromium aborts on the misconfigured helper. Removing the helper
  # makes Chromium skip the SUID path and fall through to the user-
  # namespace sandbox, which doesn't need setuid.
  rm -f "apps/studio/out/Studio-linux-${ARCH}/chrome-sandbox"

  # Grant cap_net_bind_service to the bundled node so the proxy daemon can
  # listen on privileged ports 80/443 without running as root — mirrors the
  # DEB postinst hook (apps/studio/installers/linux/postinst.sh), which
  # doesn't run for `electron-forge package` output. Without this, custom-
  # domain HTTP/HTTPS tests fail to bind in the non-root test process.
  BUNDLED_NODE="apps/studio/out/Studio-linux-${ARCH}/resources/bin/node"
  if [ -x "$BUNDLED_NODE" ]; then
    echo '--- :shield: Grant cap_net_bind_service to bundled node'
    setcap 'cap_net_bind_service=+ep' "$BUNDLED_NODE" || \
      echo "warning: setcap failed on $BUNDLED_NODE; privileged-port tests may fail to bind." >&2
  fi
fi

echo '--- :mag: Verify CLI build artifacts'
CLI_DIST="apps/cli/dist/cli"
missing=()
for f in reprint-child.mjs main.mjs wp-files/reprint/reprint.phar; do
  [ -f "$CLI_DIST/$f" ] || missing+=("$f")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing CLI build artifacts in $CLI_DIST: ${missing[*]}"
  exit 1
fi
echo "All required CLI build artifacts present."

echo '--- :playwright: Run End To End Tests'

# Electron needs a display server to launch. CI Linux agents are headless,
# so wrap with xvfb-run to provide a virtual display.
if [ "$PLATFORM" = "linux" ]; then
  # Run Playwright as the non-root `node` user (uid 1000, present in
  # node:bookworm). Electron's main delegate aborts with a FATAL on
  # `geteuid() == 0` in every helper subprocess; --no-sandbox from the
  # parent argv doesn't reliably propagate to all helper types, so the
  # only robust workaround is to not be root for the test invocation.
  #
  # We can't chown /workdir because Docker user-namespace remapping on
  # this agent denies cross-namespace chown even for container root.
  # Instead, redirect Playwright's output to /tmp (which node owns) and
  # copy results back to /workdir as root afterwards so the Buildkite
  # artifact uploader finds them under the configured artifact_paths.
  rm -rf /tmp/test-results
  mkdir -p /tmp/test-results
  chown node:node /tmp/test-results

  # TODO(rsm-2593): --max-failures=1 is a temporary debug aid so the suite
  # bails on the first failing test instead of retrying through all of them
  # (~40 min on a broken Electron launch). Remove before merging.
  # Install only Chromium, not Firefox/Webkit. Our tests drive Electron via
  # Playwright's `_electron` API, but `test()` from `@playwright/test` still
  # auto-spins a Chromium-headless-shell for the default `page` fixture even
  # when the test body never touches it — so a Chromium install is required.
  # Skipping Firefox/Webkit avoids the noisy "missing dependencies"
  # validation against libs (gstreamer/flite/gtk-4/libavif/etc.) we don't
  # need. Run inside the `su node` block so the browser lands in the same
  # `~/.cache/ms-playwright` that the test process reads from.
  test_exit=0
  su -s /bin/bash node -c '
    set -euo pipefail
    cd /workdir
    echo "Installing Playwright Chromium..."
    npx playwright install chromium
    echo "Running Playwright tests..."
    # Explicit screen size: xvfb-run defaults to 1280x1024, which can leave
    # right-edge content (e.g. the preferences Save button) below the fold
    # for the split-pane settings layout. 1920x1080 matches a typical
    # desktop and avoids relying on scroll-into-view.
    inner_exit=0
    xvfb-run -a -s "-screen 0 1920x1080x24" \
      npx playwright test --max-failures=1 --output=/tmp/test-results || inner_exit=$?
    # On failure, collect daemon logs into /tmp/test-results (copied to the
    # artifact dir below). $HOME here is the node user that ran the tests.
    if [ "$inner_exit" -ne 0 ] && [ -d "$HOME/.studio/daemon/logs" ]; then
      cp -r "$HOME/.studio/daemon/logs" /tmp/test-results/daemon-logs || true
    fi
    exit "$inner_exit"
  ' || test_exit=$?

  if [ -d /tmp/test-results ]; then
    echo '--- :file_folder: Copy test results for artifact upload'
    mkdir -p test-results
    cp -r /tmp/test-results/. test-results/ || true
  fi

  exit "$test_exit"
else
  echo 'Installing Playwright browsers...'
  npx playwright install

  echo 'Running Playwright tests...'
  # Capture the exit code so a failure doesn't trip `set -e` before we collect
  # the daemon logs (~/.studio/daemon/logs) for artifact upload.
  test_exit=0
  npx playwright test || test_exit=$?

  if [ "$test_exit" -ne 0 ] && [ -d "$HOME/.studio/daemon/logs" ]; then
    mkdir -p test-results/daemon-logs
    cp -r "$HOME/.studio/daemon/logs/." test-results/daemon-logs/ || true
  fi

  exit "$test_exit"
fi
