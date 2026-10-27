import { copyFile, cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

// The build `npm run package` writes to apps/studio/out/ in this repo, or on
// macOS the installed app when there is no build.
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const PACKAGED_APP = path.join(
  REPO_ROOT,
  'apps/studio/out',
  `Studio-${process.platform}-${process.arch}`,
  { darwin: 'Studio.app/Contents/MacOS/Studio', linux: 'studio', win32: 'Studio.exe' }[
    process.platform
  ] ?? ''
);
export const DEFAULT_STUDIO_APP =
  existsSync(PACKAGED_APP) || process.platform !== 'darwin'
    ? PACKAGED_APP
    : '/Applications/Studio.app/Contents/MacOS/Studio';

// An unpackaged build (`STUDIO_APP_DIR=apps/studio`) runs in a copy of the
// repo's Electron, for when `npm run package` isn't available (on macOS it
// needs Xcode). A production build looks for the CLI and a Node binary in the
// app's resources, so the copy gets links to `apps/cli/dist/cli` and this Node.
const ELECTRON_DIST = path.join(REPO_ROOT, 'node_modules/electron/dist');
const ELECTRON_LAYOUT = {
  darwin: { exe: 'Electron.app/Contents/MacOS/Electron', resources: 'Electron.app/Contents/Resources' },
  linux: { exe: 'electron', resources: 'resources' },
  win32: { exe: 'electron.exe', resources: 'resources' },
}[process.platform];

async function prepareElectron(dir) {
  if (!existsSync(path.join(ELECTRON_DIST, ELECTRON_LAYOUT.exe))) {
    throw new Error(
      `Electron not found in ${ELECTRON_DIST}. Run \`node node_modules/electron/install.js\` at the repo root.`
    );
  }
  await cp(ELECTRON_DIST, dir, { recursive: true, verbatimSymlinks: true });
  const resources = path.join(dir, ELECTRON_LAYOUT.resources);
  await mkdir(path.join(resources, 'bin'), { recursive: true });
  const node = path.join(resources, 'bin', path.basename(process.execPath));
  await (process.platform === 'win32' ? copyFile(process.execPath, node) : symlink(process.execPath, node));
  await symlink(path.join(REPO_ROOT, 'apps/cli/dist/cli'), path.join(resources, 'cli'), 'junction');
  return path.join(dir, ELECTRON_LAYOUT.exe);
}

// `ORIENTATION_GUIDE_VERSION` and `WHATS_NEW_VERSION` in the Studio source,
// apps/ui/src/features/onboarding/onboarding-guide/ (2 and 1 as of 2.0).
const ORIENTATION_GUIDE_VERSION = 2;
const WHATS_NEW_VERSION = 1;

/**
 * Initial `app.json` (Desktop state) for a launch. `firstRun` starts on the
 * Welcome dialog; otherwise onboarding and both guides are marked done.
 */
function buildAppConfig({ firstRun, appData }) {
  return {
    ...(firstRun
      ? {}
      : {
          onboardingCompleted: true,
          onboardingHints: { tourDismissedVersion: ORIENTATION_GUIDE_VERSION },
          whatsNewSeenVersion: WHATS_NEW_VERSION,
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
  appDir = process.env.STUDIO_APP_DIR,
  executablePath = appDir ? null : process.env.STUDIO_APP || DEFAULT_STUDIO_APP,
  firstRun = false,
  appData = {},
  width = 1280,
  height = 800,
  profileDir,
} = {}) {
  if (!appDir && (!executablePath || !existsSync(executablePath))) {
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
  if (appDir) {
    executablePath = await prepareElectron(path.join(root, 'electron'));
  }
  // Studio 2.0 keeps its state in `app.json` and `shared.json` under
  // DEV_CONFIG_DIR. The screenshot steps match English accessible names;
  // without a saved locale Studio falls back to the OS language.
  await writeFile(
    path.join(dirs.sharedConfig, 'shared.json'),
    JSON.stringify({ version: 1, locale: 'en' }, null, 2)
  );
  await writeFile(
    path.join(dirs.sharedConfig, 'app.json'),
    JSON.stringify(buildAppConfig({ firstRun, appData }), null, 2)
  );

  const app = await electron.launch({
    executablePath,
    args: [
      ...(appDir ? [path.resolve(REPO_ROOT, appDir)] : []),
      `--user-data-dir=${dirs.userData}`,
    ],
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
