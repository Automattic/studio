import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Screenshots captured from a single first-run session of the installed
 * Studio app, signed out. They run in order and each step builds on the
 * state the previous one left (onboarding → site creation → site views →
 * app settings), so `--only` filters which files are saved, not which steps
 * run.
 *
 * `pages` are the mirrored docs pages that use the shot; `replaces` are the
 * current images (under https://developer.wordpress.com/wp-content/uploads/)
 * the shot is meant to replace.
 */
export const SHOTS = [
  {
    name: 'welcome',
    description: 'First-run Welcome screen',
    pages: ['index.md'],
    async setup({ w }) {
      await w.getByRole('heading', { name: 'WordPress Studio', level: 1 }).waitFor();
    },
  },
  {
    name: 'tour-sites',
    description: 'Tour: "Sites run right on your machine"',
    pages: ['index.md'],
    async setup({ w }) {
      await w.getByRole('button', { name: 'Skip', exact: true }).click();
      await w.getByRole('heading', { name: 'Sites run right on your machine' }).waitFor();
    },
  },
  {
    name: 'tour-log-in',
    description: 'Tour: "Build with Studio Code", with Log in with WordPress.com and Skip log in',
    pages: ['index.md'],
    async setup({ w }) {
      await w.getByRole('button', { name: 'Continue', exact: true }).click();
      await w.getByRole('heading', { name: 'Build with Studio Code' }).waitFor();
    },
  },
  {
    name: 'add-a-site',
    description: 'Add a site: Create a new site / Connect a site / Import from a backup',
    pages: ['sites.md', 'import-export.md', 'blueprints/index.md'],
    replaces: ['2025/01/new-studio-site.png', '2025/10/new-studio-site.png'],
    async setup({ w }) {
      await w.getByRole('button', { name: 'Skip log in' }).click();
      await w.getByRole('heading', { name: 'Add a site', level: 1 }).waitFor();
      await waitForBlueprints(w);
      await waitForImages(w.getByRole('region', { name: 'Start from a Blueprint' }));
    },
  },
  {
    name: 'blueprints-library',
    description: 'Add a site → Start from a Blueprint (blueprints library and Upload a Blueprint)',
    pages: ['blueprints/index.md'],
    replaces: ['2025/10/build-new-site.png', '2025/10/blueprints-gallery.png'],
    async setup({ w }) {
      const library = w.getByRole('region', { name: 'Start from a Blueprint' });
      await scrollToTop(w.getByRole('heading', { name: 'Start from a Blueprint' }));
      await waitForImages(library);
    },
  },
  {
    name: 'create-site-from-blueprint',
    description: 'Create a new site from the WooCommerce blueprint',
    pages: ['blueprints/index.md'],
    replaces: ['2025/10/studio-add-site-name-settings-16-1.jpg'],
    async setup({ w }) {
      await w.getByRole('button', { name: /^WooCommerce Create your next online store/ }).click();
      await w.getByRole('button', { name: 'Create site from Blueprint' }).waitFor();
    },
    async teardown({ w }) {
      await w.getByRole('button', { name: 'Back', exact: true }).click();
      await w.getByRole('heading', { name: 'Add a site', level: 1 }).waitFor();
    },
  },
  {
    name: 'create-site',
    description: 'Create a new site: site name and Advanced settings',
    pages: ['sites.md'],
    async setup({ w }) {
      await w.getByRole('link', { name: /^Create a new site/ }).click();
      await w.getByRole('heading', { name: 'Create a new site', level: 1 }).waitFor();
    },
  },
  {
    name: 'create-site-advanced',
    description: 'Create a new site → Advanced settings (WordPress version, PHP environment)',
    pages: ['sites.md', 'php-runtimes.md'],
    async setup({ w }) {
      await w.getByRole('button', { name: 'Advanced settings' }).click();
      await scrollToTop(w.getByText('Site details', { exact: true }).first());
    },
  },
  {
    name: 'create-site-https',
    description: 'Create a new site → Advanced settings → Domain with Use custom domain and Enable HTTPS',
    pages: ['ssl-in-studio.md'],
    replaces: ['2025/03/studio-custom-domain-ssl-docs.jpg'],
    async setup({ w }) {
      await w.getByRole('checkbox', { name: 'Use custom domain' }).check();
      await w.getByRole('checkbox', { name: 'Enable HTTPS' }).check();
      await scrollToBottom(w.getByRole('checkbox', { name: 'Enable HTTPS' }));
    },
    async teardown({ w }) {
      await w.getByRole('checkbox', { name: 'Enable HTTPS' }).uncheck();
      await w.getByRole('checkbox', { name: 'Use custom domain' }).uncheck();
    },
  },
  {
    name: 'orientation-guide',
    description: 'Orientation guide, page 1, shown after the first site is created',
    pages: ['index.md'],
    async setup({ w }) {
      await w.getByRole('button', { name: 'Create site', exact: true }).click();
      await w
        .getByRole('dialog', { name: 'Welcome to WordPress Studio' })
        .waitFor({ timeout: 180_000 });
      await waitForSiteRunning(w);
    },
    async teardown({ w }) {
      const guide = w.getByRole('dialog');
      for (let i = 0; i < 5; i++) {
        const done = guide.getByRole('button', { name: 'Let’s go' });
        if (await done.count()) {
          await done.click();
          break;
        }
        await guide.getByRole('button', { name: 'Next' }).click();
        await w.waitForTimeout(400);
      }
      await guide.waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'main-window-signed-out',
    description: 'Main window, signed out: sidebar, Log in with WordPress.com, and the site preview',
    pages: ['index.md', 'sites.md'],
    replaces: ['2024/04/selective-sync-connect-site-main.jpg', '2025/01/studio-start-dot.jpg'],
    // Not paused: pausing overlays a large play button on the feature demo.
    settle: 2_500,
    async setup({ w }) {
      await w.getByRole('tab', { name: 'Studio Code' }).click().catch(() => {});
    },
  },
  {
    name: 'site-status-tooltip',
    description: 'Sidebar site status toggle (start/stop) with its tooltip',
    pages: ['sites.md'],
    replaces: ['2025/01/studio-start-dot-hover.jpg'],
    keepMouse: true,
    async setup({ w }) {
      await w.getByRole('button', { name: /^Site status: Running/ }).hover();
      await w.waitForTimeout(1_200);
    },
  },
  {
    name: 'site-overview',
    description: 'Site overview → Overview tab (About, WP Admin, Shortcuts, Open in…, Manage)',
    pages: [
      'sites.md',
      'import-export.md',
      'frequently-asked-questions.md',
      'debugging/index.md',
    ],
    replaces: ['2025/01/studio-site-overview-2.jpg', '2025/01/studio-open-site.jpg'],
    async setup({ w, main }) {
      await w
        .getByRole('complementary')
        .first()
        .getByRole('button', { name: 'Site overview' })
        .click();
      await main().getByRole('tab', { name: 'Overview' }).waitFor();
      await main().getByRole('button', { name: 'Hide preview' }).click();
      await w.waitForTimeout(500);
    },
  },
  {
    name: 'delete-site-dialog',
    description: 'Delete site confirmation (from Site overview → Manage → Delete)',
    pages: ['sites.md'],
    replaces: ['2025/01/studio-delete-site-2.jpg'],
    async setup({ w, main }) {
      await main().getByRole('button', { name: 'Delete', exact: true }).click();
      await w.getByRole('alertdialog').waitFor();
    },
    async teardown({ w }) {
      await w.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
      await w.getByRole('alertdialog').waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'import-overwrite-dialog',
    description: 'Import a backup into an existing site: the overwrite confirmation',
    pages: ['import-export.md'],
    async setup({ w, dirs }) {
      // An empty zip is enough to reach the confirmation; the import is cancelled.
      const backup = path.join(dirs.root, 'backup.zip');
      await writeFile(backup, Buffer.from('504b0506' + '00'.repeat(18), 'hex'));
      await w.locator('input[type=file][accept*=".wpress"]').first().setInputFiles(backup);
      await w.getByRole('alertdialog', { name: /^Overwrite/ }).waitFor();
    },
    async teardown({ w }) {
      await w.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
      await w.getByRole('alertdialog').waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'site-settings',
    description: 'Site overview → Settings tab (Site details, WordPress version)',
    pages: ['sites.md'],
    replaces: ['2025/01/studio-site-settings-2.jpg', '2025/01/studio-edit-site-new.jpg'],
    async setup({ main }) {
      await main().getByRole('tab', { name: 'Settings' }).click();
      await main().getByRole('tabpanel', { name: 'Settings' }).waitFor();
    },
  },
  {
    name: 'site-settings-php',
    description: 'Site settings → PHP environment (PHP version, PHP runtime, File access)',
    pages: ['php-runtimes.md', 'sites.md'],
    replaces: [
      '2026/06/screenshot-2026-06-23-at-10.43.25-edited.png',
      '2026/06/screenshot-2026-06-23-at-10.43.40-edited.png',
    ],
    async setup({ main }) {
      await scrollToTop(main().getByText('PHP environment', { exact: true }));
    },
  },
  {
    name: 'site-settings-domain',
    description: 'Site settings → Domain with Use custom domain and Enable HTTPS (not saved)',
    pages: ['ssl-in-studio.md'],
    async setup({ main }) {
      await main().getByRole('checkbox', { name: 'Use custom domain' }).check();
      await main().getByRole('checkbox', { name: 'Enable HTTPS' }).check();
      await scrollToBottom(main().getByRole('checkbox', { name: 'Enable HTTPS' }));
    },
    async teardown({ main }) {
      await main().getByRole('checkbox', { name: 'Enable HTTPS' }).uncheck();
      await main().getByRole('checkbox', { name: 'Use custom domain' }).uncheck();
    },
  },
  {
    name: 'site-debugging',
    description: 'Site overview → Debugging tab with Enable Xdebug ticked (not saved)',
    pages: ['xdebug.md', 'debugging/index.md'],
    async setup({ main }) {
      await main().getByRole('tab', { name: 'Debugging' }).click();
      await main().getByRole('checkbox', { name: 'Enable Xdebug' }).check();
    },
    async teardown({ main }) {
      await main().getByRole('checkbox', { name: 'Enable Xdebug' }).uncheck();
    },
  },
  {
    name: 'preview-destinations',
    description: 'Site preview address menu: Front end / WP Admin / Database (phpMyAdmin)',
    pages: ['debugging/index.md'],
    async setup({ w, main }) {
      await main().getByRole('tab', { name: 'Overview' }).click();
      await main().getByRole('button', { name: 'Show preview' }).click();
      await w.getByRole('button', { name: 'Preview shortcuts' }).click();
      await w.getByRole('dialog', { name: 'Preview shortcuts' }).waitFor();
    },
    async teardown({ w }) {
      await w.keyboard.press('Escape');
      const menu = w.getByRole('dialog', { name: 'Preview shortcuts' });
      if (await menu.isVisible()) {
        await w.mouse.click(400, 700);
      }
      await menu.waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'site-stopped',
    description: 'A stopped site: sidebar start button and Start site in the preview',
    pages: ['sites.md'],
    replaces: ['2025/01/studio-stopped-2.jpg'],
    async setup({ w }) {
      await w.getByRole('button', { name: /^Site status: Running/ }).click();
      await w
        .getByRole('button', { name: /^Site status: Stopped/ })
        .waitFor({ timeout: 60_000 });
    },
  },
  {
    name: 'app-settings',
    description: 'App settings → Settings (Appearance, Preferred editor and terminal, …)',
    pages: ['sites.md'],
    replaces: ['2025/01/studio-open-preferences-2.jpg', '2025/01/studio-editor-preferences-2.jpg'],
    async setup({ w }) {
      await w.getByRole('button', { name: 'App settings' }).click();
      await w.getByRole('tabpanel', { name: 'Settings' }).waitFor();
    },
  },
  {
    name: 'app-settings-account',
    description: 'App settings → Settings → Account, with WordPress.com Log in',
    pages: ['index.md'],
    async setup({ w }) {
      await scrollToTop(w.getByRole('heading', { name: 'Account', exact: true }));
    },
  },
  {
    name: 'app-settings-ai',
    description: 'App settings → AI (Studio Code toggle, Anthropic API key, Instructions)',
    pages: ['studio-code/index.md'],
    async setup({ w }) {
      await openSettingsTab(w, 'AI');
    },
  },
  {
    name: 'app-settings-usage-signed-out',
    description: 'App settings → Usage, signed out: "Sign in to do more with Studio"',
    pages: ['index.md'],
    async setup({ w }) {
      await openSettingsTab(w, 'Usage');
    },
  },
  {
    name: 'app-settings-skills',
    description: 'App settings → Skills',
    pages: ['agent-skills-wordpress-studio.md'],
    replaces: ['2026/04/screenshot-2026-04-21-at-14.49.53.png'],
    async setup({ w }) {
      await openSettingsTab(w, 'Skills');
    },
  },
  {
    name: 'app-settings-mcp',
    description: 'App settings → MCP',
    pages: ['mcp-on-studio.md'],
    replaces: ['2026/04/screenshot-2026-04-17-at-11.10.34.png'],
    async setup({ w }) {
      await openSettingsTab(w, 'MCP');
    },
  },
];

/**
 * Shots that need a WordPress.com login, a connected live site, or Studio
 * Code output, so they are captured by hand.
 */
export const MANUAL_SHOTS = [
  {
    description: 'Studio Code chat pane for a selected site',
    pages: ['studio-code/index.md'],
    replaces: ['2026/04/studio-code-desktop-wordpress-studio-1.png'],
  },
  {
    description: 'Composer: model picker (Fast / Balanced / Strong) and AI credits meter',
    pages: ['studio-code/index.md'],
  },
  {
    description: 'Composer: Add skill or attachment → Upload attachment',
    pages: ['studio-code/index.md'],
  },
  {
    description: 'Limited-beta access notice with Apply for access',
    pages: ['studio-code/index.md'],
  },
  {
    description: 'App settings → Usage, signed in (AI credits, preview sites, Delete all preview sites)',
    pages: ['preview-sites.md', 'studio-code/index.md'],
    replaces: ['2025/01/studio-site-preview-site-delete-all.jpg'],
  },
  {
    description: 'Site dropdown → Previews list (New preview, copy URL, update, rename, delete)',
    pages: ['preview-sites.md'],
    replaces: [
      '2025/01/studio-site-preview-site.jpg',
      '2025/01/studio-site-preview-site-rename.jpg',
    ],
  },
  {
    description: 'Connect a live site picker (WordPress.com and Pressable)',
    pages: ['sync.md'],
    replaces: ['2025/01/selective-sync-connect.jpg'],
  },
  {
    description: 'Site dropdown → Live sites with Push to live / Pull from live and last-synced times',
    pages: ['sync.md'],
  },
  {
    description: 'Pull from live with specific files and folders',
    pages: ['sync.md'],
    replaces: ['2025/01/selective-sync-pull-specific-folders-v2.jpg'],
  },
  {
    description: 'Push to live with specific files',
    pages: ['sync.md'],
    replaces: ['2025/01/selective-sync-push-specific-files.jpg'],
  },
];

async function waitForBlueprints(w) {
  await w
    .getByText('Loading Blueprints…')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => {});
}

async function waitForSiteRunning(w) {
  // A CSS locator, because modal dialogs hide the sidebar from role queries.
  await w
    .locator('button[aria-label^="Site status: Running"]')
    .waitFor({ timeout: 120_000 });
}

async function openSettingsTab(w, name) {
  await w.getByRole('tab', { name, exact: true }).click();
  await w.getByRole('tabpanel', { name }).waitFor();
}

// Both scroll helpers move the element's nearest scrolling ancestor directly:
// `scrollIntoView` lands elements under Studio's sticky headers and footers.
function scrollParent(el) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return document.scrollingElement;
}

/** Scrolls so `locator` sits a little below the top of its scroll area. */
async function scrollToTop(locator, offset = 40) {
  await locator.evaluate(
    (el, { offset, scrollParentSource }) => {
      const parent = new Function(`return ${scrollParentSource}`)()(el);
      const top = el.getBoundingClientRect().top - parent.getBoundingClientRect().top;
      parent.scrollTo({ top: parent.scrollTop + top - offset, behavior: 'instant' });
    },
    { offset, scrollParentSource: scrollParent.toString() }
  );
}

/** Scrolls the scroll area that contains `locator` all the way down. */
async function scrollToBottom(locator) {
  await locator.evaluate(
    (el, { scrollParentSource }) => {
      const parent = new Function(`return ${scrollParentSource}`)()(el);
      parent.scrollTo({ top: parent.scrollHeight, behavior: 'instant' });
    },
    { scrollParentSource: scrollParent.toString() }
  );
}

/** Waits until every image inside `locator` has finished loading. */
async function waitForImages(locator) {
  await locator.evaluate(async (el) => {
    const images = [...el.querySelectorAll('img')];
    for (const img of images) {
      img.loading = 'eager';
    }
    const loaded = images.map((img) =>
      img.complete
        ? null
        : new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          })
    );
    const timeout = new Promise((resolve) => setTimeout(resolve, 20_000));
    await Promise.race([Promise.all(loaded), timeout]);
  });
}
