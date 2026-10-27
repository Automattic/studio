import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

export const DEFAULT_STUDIO_APP =
  process.platform === 'darwin'
    ? '/Applications/Studio.app/Contents/MacOS/Studio'
    : null;

// `ORIENTATION_GUIDE_VERSION` in the Studio source,
// apps/ui/src/data/onboarding/orientation-guide.ts (2 as of 1.23).
const ORIENTATION_GUIDE_VERSION = 2;

/**
 * Initial `appdata-v1.json` for a launch. `firstRun` starts on the Welcome
 * screen; otherwise onboarding and the orientation guide are marked done.
 */
function buildAppData({ firstRun, appData }) {
  return {
    version: 1,
    // The screenshot steps match English accessible names; without a saved
    // locale Studio falls back to the OS language.
    locale: 'en',
    sites: [],
    snapshots: [],
    ...(firstRun
      ? {}
      : {
          onboardingCompleted: true,
          onboardingHints: { tourDismissedVersion: ORIENTATION_GUIDE_VERSION },
        }),
    ...appData,
  };
}

/**
 * Launches the installed Studio app against a throwaway profile.
 *
 * Studio's E2E mode (the `E2E_*` env vars, honoured by release builds) points
 * its app data, home, and CLI config at temp directories, and
 * `--user-data-dir` gives Electron its own single-instance lock so this runs
 * alongside a Studio the user already has open. Nothing in the user's real
 * profile is read or written.
 *
 * The CLI daemon and its events socket get their own directory too, so the
 * user's running Studio keeps its connection. Windows daemons use fixed,
 * system-wide pipe names that cannot be isolated this way.
 */
export async function launchStudio({
  executablePath = process.env.STUDIO_APP || DEFAULT_STUDIO_APP,
  firstRun = false,
  appData = {},
  width = 1280,
  height = 800,
  profileDir,
} = {}) {
  if (!executablePath || !existsSync(executablePath)) {
    throw new Error(
      `Studio app not found at "${executablePath}". Set STUDIO_APP to the Studio executable.`
    );
  }

  const root = profileDir ?? (await mkdtemp(path.join(tmpdir(), 'studio-docs-shots-')));
  const dirs = {
    root,
    appData: path.join(root, 'appData'),
    home: path.join(root, 'home'),
    cliConfig: path.join(root, 'cliConfig'),
    sharedConfig: path.join(root, 'sharedConfig'),
    userData: path.join(root, 'userData'),
  };
  // Kept short and directly under tmpdir: the daemon's sockets are Unix domain
  // sockets, limited to ~104 characters on macOS.
  dirs.daemon = await mkdtemp(path.join(tmpdir(), 'sdd-'));
  for (const dir of Object.values(dirs)) {
    await mkdir(dir, { recursive: true });
  }
  await mkdir(path.join(dirs.appData, 'Studio'), { recursive: true });
  await writeFile(
    path.join(dirs.appData, 'Studio', 'appdata-v1.json'),
    JSON.stringify(buildAppData({ firstRun, appData }), null, 2)
  );

  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${dirs.userData}`],
    env: {
      ...process.env,
      DEV_CONFIG_DIR: dirs.sharedConfig,
      E2E: 'true',
      E2E_APP_DATA_PATH: dirs.appData,
      E2E_HOME_PATH: dirs.home,
      E2E_CLI_CONFIG_PATH: dirs.cliConfig,
      E2E_SHARED_CONFIG_PATH: dirs.sharedConfig,
      // Takes precedence over E2E_SHARED_CONFIG_PATH when inherited.
      DEV_CONFIG_DIR: dirs.sharedConfig,
      STUDIO_PROCESS_MANAGER_HOME: dirs.daemon,
    },
    timeout: 60_000,
  });

  const window = await app.firstWindow({ timeout: 60_000 });
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setContentSize(size.width, size.height);
      win?.center();
    },
    { width, height }
  );
  await window.waitForLoadState('domcontentloaded');

  return {
    app,
    window,
    dirs,
    async close({ keepProfile = false } = {}) {
      // Quitting Studio stops its daemon when no sites are running.
      await app.close().catch(() => {});
      await rm(dirs.daemon, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
      if (!keepProfile && !profileDir) {
        await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
      }
    },
  };
}
