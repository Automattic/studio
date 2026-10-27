import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Screenshots captured from a single first-run session of Studio 2.0, signed
 * out. They run in order and each step builds on the state the previous one
 * left (welcome → Add site → site creation → workspace → site menu → Settings
 * → stopped site), so `--only` filters which files are saved, not which steps
 * run.
 *
 * `pages` are the mirrored docs pages that use the shot; `replaces` are the
 * current images (under https://developer.wordpress.com/wp-content/uploads/)
 * the shot is meant to replace. `desktopOnly` shots show UI the browser build
 * (`studio ui`) doesn't have.
 */

export const SITE_NAME = 'My WordPress Website';

export const SHOTS = [
  {
    name: 'welcome',
    description: 'First-run Welcome to WordPress Studio dialog',
    pages: ['index.md'],
    replaces: ['2024/04/welcome.png'],
    desktopOnly: true,
    async setup({ w }) {
      await w.getByRole('alertdialog', { name: 'Welcome to WordPress Studio' }).waitFor();
    },
    async teardown({ w }) {
      await w.getByRole('button', { name: 'Continue without an account' }).click();
      await w
        .getByRole('alertdialog', { name: 'Welcome to WordPress Studio' })
        .waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'add-site',
    description: 'Add site dialog: Create / Connect / Import, Blueprint categories, Choose a starting point',
    pages: ['sites.md', 'blueprints/index.md'],
    replaces: ['2025/01/add-a-site.png'],
    async setup(ctx) {
      await openAddSite(ctx);
      await waitForBlueprints(ctx.w);
      await waitForImages(addSiteDialog(ctx.w));
    },
  },
  {
    name: 'blueprints-library',
    description: 'Add site → Blueprints → Business category',
    pages: ['blueprints/index.md'],
    replaces: ['2025/10/blueprints-library.png'],
    async setup({ w }) {
      await addSiteTab(w, 'Business').click();
      await waitForBlueprints(w);
      await waitForImages(addSiteDialog(w));
    },
  },
  {
    name: 'blueprint-details',
    description: 'A Blueprint’s details, with Preview in browser and Create site',
    pages: ['blueprints/index.md'],
    replaces: ['2025/10/create-site-from-blueprint.png'],
    async setup({ w }) {
      await addSiteDialog(w).locator('[data-blueprint-slug]').first().click();
      const preview = w.getByRole('button', { name: 'Preview in browser' });
      await preview.waitFor();
      await waitForImages(w.getByRole('dialog').filter({ has: preview }));
    },
    async teardown({ w }) {
      await w.getByRole('button', { name: 'Back to Blueprints' }).click();
      await addSiteTab(w, 'Business').waitFor();
    },
  },
  {
    name: 'add-site-connect',
    description: 'Add site → Connect, signed out',
    pages: ['sync.md'],
    async setup({ w }) {
      await addSiteTab(w, 'Connect').click();
      await w.getByRole('heading', { name: 'Connect a site' }).waitFor();
    },
  },
  {
    name: 'add-site-import',
    description: 'Add site → Import: Drop a WordPress backup here / Choose file',
    pages: ['import-export.md'],
    replaces: ['2025/01/add-a-site-1.png'],
    async setup({ w }) {
      await addSiteTab(w, 'Import').click();
      await w.getByText('Drop a WordPress backup here.').waitFor();
    },
  },
  {
    name: 'create-site',
    description: 'Create your site: Site name and What should we create?',
    pages: ['sites.md'],
    async setup({ w }) {
      await addSiteTab(w, 'Create').click();
      await w.getByRole('button', { name: 'Start with Blank site' }).click();
      const name = w.getByRole('textbox', { name: 'Site name' });
      await name.fill(SITE_NAME);
      await name.blur();
    },
  },
  {
    name: 'create-site-advanced',
    description: 'Create your site → Advanced settings (local path, WordPress and PHP versions, file access)',
    pages: ['sites.md', 'php-runtimes.md'],
    replaces: ['2025/01/create-site-advanced.png'],
    async setup({ w }) {
      await w.getByRole('button', { name: 'Advanced settings' }).click();
      await scrollToTop(w.getByRole('textbox', { name: 'Local path' }), 80);
    },
  },
  {
    name: 'create-site-https',
    description: 'Create your site → Advanced settings with Use custom domain and Enable HTTPS',
    pages: ['ssl-in-studio.md'],
    replaces: ['2025/03/create-site-https.png'],
    async setup({ w }) {
      await setToggle(w, 'Use custom domain', true);
      await setToggle(w, 'Enable HTTPS', true);
      await scrollToTop(w.getByRole('switch', { name: 'Use custom domain' }), 120);
    },
    async teardown({ w }) {
      await setToggle(w, 'Enable HTTPS', false);
      await setToggle(w, 'Use custom domain', false);
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
      const guide = w.getByRole('dialog', { name: /Welcome to WordPress Studio|Build by asking|See your site/ });
      for (let i = 0; i < 5; i++) {
        const done = w.getByRole('button', { name: 'Let’s go' });
        if (await done.count()) {
          await done.click();
          break;
        }
        await w.getByRole('button', { name: 'Next', exact: true }).click();
        await w.waitForTimeout(400);
      }
      await guide.waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'main-window-signed-out',
    description: 'Main window, signed out: sidebar, Studio Code chat, and the site preview',
    pages: ['index.md', 'studio-code/index.md'],
    replaces: ['2024/04/main-window-signed-out.png'],
    settle: 2_500,
    async setup({ w }) {
      await waitForPreview(w);
    },
  },
  {
    name: 'composer-add-menu',
    description: 'Chat box + menu: Add files, Auto-start, Connect AI providers, and Skills',
    pages: ['studio-code/index.md'],
    async setup({ w }) {
      await w.getByRole('button', { name: 'Add', exact: true }).click();
      await w.getByText('Add files', { exact: true }).waitFor();
    },
    async teardown({ w }) {
      await w.keyboard.press('Escape');
      await w.getByText('Add files', { exact: true }).waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'command-palette',
    description: 'Command palette (⌘K)',
    pages: ['index.md'],
    async setup({ w }) {
      await w.keyboard.press('ControlOrMeta+K');
      await w.getByRole('combobox', { name: 'Search commands' }).waitFor();
    },
    async teardown({ w }) {
      await w.keyboard.press('Escape');
      await w.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'preview-destinations',
    description: 'Site preview address bar shortcuts: Front end / WordPress Admin / Database',
    pages: ['sites.md', 'debugging/index.md', 'frequently-asked-questions.md'],
    replaces: ['2026/04/preview-destinations.png'],
    async setup({ w }) {
      await w.getByRole('textbox', { name: 'Address' }).click();
      await w.getByRole('dialog', { name: 'Preview shortcuts' }).waitFor();
    },
    async teardown({ w }) {
      await w.keyboard.press('Escape');
      await w.getByRole('dialog', { name: 'Preview shortcuts' }).waitFor({ state: 'hidden' });
      await w.getByRole('textbox', { name: 'Address' }).blur();
    },
  },
  {
    name: 'site-status-button',
    description: 'Sidebar site row with its Stop button and tooltip',
    pages: ['sites.md'],
    replaces: ['2025/01/site-status-tooltip.png'],
    keepMouse: true,
    async setup({ w }) {
      await siteStatusButton(w, 'Stop').hover();
      await w.waitForTimeout(1_200);
    },
  },
  {
    name: 'site-menu',
    description: 'The site menu, opened from the site icon at the top of the chat',
    pages: ['sites.md'],
    replaces: ['2025/01/sidebar-site-menu.png'],
    async setup({ w }) {
      await openSiteMenu(w);
    },
  },
  {
    name: 'site-menu-open-in',
    description: 'Site menu → Open in (browser, file manager, editor, terminal, phpMyAdmin)',
    pages: ['sites.md', 'frequently-asked-questions.md'],
    // Moving the mouse away closes the hover-opened submenu.
    keepMouse: true,
    async setup({ w }) {
      await openSubmenu(w, 'Open in', 'phpMyAdmin');
    },
  },
  {
    name: 'site-menu-export',
    description: 'Site menu → Export (Export site / Export database)',
    pages: ['import-export.md'],
    replaces: ['2025/01/site-overview-1.png'],
    // Moving the mouse away closes the hover-opened submenu.
    keepMouse: true,
    async setup({ w }) {
      await openSubmenu(w, 'Export', 'Export database');
    },
    async teardown({ w }) {
      await closeMenus(w);
    },
  },
  {
    name: 'delete-site-dialog',
    description: 'Delete site confirmation, with Also move files and database to Trash',
    pages: ['sites.md'],
    replaces: ['2025/01/delete-site-dialog.png'],
    async setup({ w }) {
      // From the sidebar row's context menu: closing the site menu at the top
      // of the chat refocuses its button, whose tooltip then shows under the
      // dialog.
      await closeMenus(w);
      await w.getByText(SITE_NAME, { exact: true }).first().click({ button: 'right' });
      await w.getByRole('menuitem', { name: 'Delete site' }).click();
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
    replaces: ['2025/01/import-overwrite-dialog.png'],
    async setup({ w, dirs }) {
      // An empty zip is enough to reach the confirmation; the import is cancelled.
      // The site menu's file input is the one that also accepts .sql dumps.
      // It sits outside the menu popup, so the menu needn't be open.
      const backup = path.join(dirs.root, 'backup.zip');
      await writeFile(backup, Buffer.from('504b0506' + '00'.repeat(18), 'hex'));
      await w.locator('input[type=file][accept*=".sql"]').first().setInputFiles(backup);
      await w.getByRole('alertdialog', { name: /^Overwrite/ }).waitFor();
    },
    async teardown({ w }) {
      await w.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
      await w.getByRole('alertdialog').waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'site-settings',
    description: 'Settings dialog, Site scope → Settings (site name, WordPress version, local domain, credentials)',
    pages: ['sites.md'],
    replaces: ['2025/01/site-settings.png'],
    async setup({ w }) {
      await openSiteMenu(w);
      await w.getByRole('menuitem', { name: 'Settings', exact: true }).click();
      await settingsPanel(w, 'Settings').waitFor();
    },
  },
  {
    name: 'site-settings-domain',
    description: 'Site settings → Local domain with Use custom domain and Enable HTTPS (not saved)',
    pages: ['ssl-in-studio.md'],
    async setup({ w }) {
      const panel = settingsPanel(w, 'Settings');
      await setToggle(panel, 'Use custom domain', true);
      await setToggle(panel, 'Enable HTTPS', true);
      await scrollToTop(panel.getByText('Local domain', { exact: true }));
    },
    async teardown({ w }) {
      await discardSettings(w);
    },
  },
  {
    name: 'site-settings-debug',
    description: 'Site settings → Debug with Xdebug turned on (not saved)',
    pages: ['xdebug.md', 'debugging/index.md'],
    replaces: ['2026/01/site-debugging.png'],
    async setup({ w }) {
      await openSettingsSection(w, 'Debug');
      await setToggle(settingsPanel(w, 'Debug'), 'Xdebug', true);
    },
    async teardown({ w }) {
      await discardSettings(w);
    },
  },
  {
    name: 'site-settings-php',
    description: 'Site settings → PHP (PHP version, File access)',
    pages: ['php-runtimes.md', 'sites.md'],
    replaces: ['2025/01/site-settings-php.png'],
    async setup({ w }) {
      await openSettingsSection(w, 'PHP');
    },
  },
  {
    name: 'settings-general',
    description: 'Settings dialog, Studio scope → General (language, code editor, terminal, …)',
    pages: ['sites.md'],
    replaces: ['2025/01/app-settings.png'],
    async setup({ w }) {
      await w.getByRole('tablist', { name: 'Settings scope' }).getByRole('tab', { name: 'Studio' }).click();
      await settingsPanel(w, 'General').waitFor();
    },
  },
  {
    name: 'settings-studio-cli',
    description: 'Settings → General → Studio CLI for terminal',
    pages: ['cli.md'],
    replaces: ['2025/05/app-settings-account.png'],
    desktopOnly: true,
    async setup({ w }) {
      await scrollToTop(settingsPanel(w, 'General').getByText('Studio CLI for terminal', { exact: true }), 120);
    },
  },
  {
    name: 'settings-ai-providers',
    description: 'Settings → AI Providers (WordPress.com and Anthropic)',
    pages: ['studio-code/index.md'],
    replaces: ['2026/04/app-settings-ai.png'],
    async setup({ w }) {
      await openSettingsSection(w, 'AI Providers');
    },
  },
  {
    name: 'settings-skills',
    description: 'Settings → Skills',
    pages: ['agent-skills-wordpress-studio.md'],
    replaces: ['2026/04/app-settings-skills.png'],
    async setup({ w }) {
      await openSettingsSection(w, 'Skills');
    },
  },
  {
    name: 'settings-mcp',
    description: 'Settings → MCP (install instructions and MCP configuration)',
    pages: ['mcp-on-studio.md'],
    replaces: ['2026/04/app-settings-mcp.png'],
    async setup({ w }) {
      await openSettingsSection(w, 'MCP');
    },
  },
  {
    name: 'settings-keyboard',
    description: 'Settings → Keyboard (shortcuts)',
    pages: ['index.md'],
    async setup({ w }) {
      await openSettingsSection(w, 'Keyboard');
    },
    async teardown({ w }) {
      await w.getByRole('button', { name: 'Close settings' }).click();
      await w.getByRole('tablist', { name: 'Settings sections' }).waitFor({ state: 'hidden' });
    },
  },
  {
    name: 'site-stopped',
    description: 'A stopped site: Start button in the sidebar and the saved preview image',
    pages: ['sites.md'],
    replaces: ['2025/01/site-stopped.png'],
    settle: 1_500,
    async setup({ w }) {
      await siteStatusButton(w, 'Stop').click();
      await siteStatusButton(w, 'Start').waitFor({ timeout: 60_000 });
    },
  },
];

/**
 * Shots that need a WordPress.com login, a connected live site, or Studio
 * Code output, so they are captured by hand.
 */
export const MANUAL_SHOTS = [
  {
    description: 'Studio Code chat for a selected site, with a reply in the transcript',
    pages: ['studio-code/index.md'],
    replaces: ['2026/04/studio-code.png'],
  },
  {
    description: 'Chat box: model menu (Fast / Balanced / Strong) with the AI credits remaining',
    pages: ['studio-code/index.md'],
  },
  {
    description: 'Share panel with Create preview',
    pages: ['preview-sites.md'],
    replaces: ['2025/01/studio-site-new-preview-1.png'],
  },
  {
    description: 'Share panel with a ready preview: image, Preview link, Copy link, Update preview',
    pages: ['preview-sites.md'],
    replaces: ['2025/01/studio-new-site-preview-link.png'],
  },
  {
    description: 'Share panel → Preview actions menu (New preview, Rename…, Delete preview)',
    pages: ['preview-sites.md'],
    replaces: ['2025/01/studio-preview-more-actions.png'],
  },
  {
    description: 'Settings → Sharing, signed in (live previews, preview sites used)',
    pages: ['preview-sites.md'],
    replaces: ['2025/01/studio-delete-all-preview-sites.png'],
  },
  {
    description: 'Settings → Usage, signed in (AI credits, Preview sites, Delete all preview sites menu)',
    pages: ['preview-sites.md', 'studio-code/index.md'],
  },
  {
    description: 'Publish panel → Choose website (WordPress.com and Pressable sites)',
    pages: ['sync.md'],
    replaces: ['2025/01/studio-connect-live-site.png'],
  },
  {
    description: 'Pull changes with Include → Choose files…',
    pages: ['sync.md'],
    replaces: ['2025/01/studio-pull-selective.png'],
  },
  {
    description: 'Publish panel with Include → Choose files…',
    pages: ['sync.md'],
    replaces: ['2025/01/studio-selective-push.png'],
  },
];

function addSiteDialog(w) {
  return w.getByRole('dialog').filter({
    has: w.getByRole('tablist', { name: 'Ways to add a site' }),
  });
}

function addSiteTab(w, name) {
  return w.getByRole('tablist', { name: 'Ways to add a site' }).getByRole('tab', { name, exact: true });
}

/** Opens Add site unless Studio already opened it (it does when there are no sites). */
async function openAddSite({ w }) {
  const tabs = w.getByRole('tablist', { name: 'Ways to add a site' });
  await tabs.waitFor({ timeout: 10_000 }).catch(async () => {
    await w.getByRole('button', { name: 'Add site' }).first().click();
    await tabs.waitFor();
  });
}

function settingsPanel(w, name) {
  return w.getByRole('tabpanel', { name, exact: true });
}

async function openSettingsSection(w, name) {
  await w.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name, exact: true }).click();
  await settingsPanel(w, name).waitFor();
}

/** Undoes unsaved site settings so later shots start clean. */
async function discardSettings(w) {
  const discard = w.getByRole('button', { name: 'Discard' });
  if (await discard.count()) {
    await discard.click();
    await discard.waitFor({ state: 'hidden' });
  }
}

async function openSiteMenu(w) {
  await closeMenus(w);
  await w.getByRole('button', { name: `Site actions for ${SITE_NAME}` }).click();
  await w.getByRole('menuitem', { name: 'Delete site' }).waitFor();
}

/**
 * Opens a site menu submenu and waits for one of its items. The site menu is
 * reopened first: while another submenu is open, it blocks hovering the rest
 * of the menu.
 */
async function openSubmenu(w, trigger, item) {
  await openSiteMenu(w);
  const submenu = w.getByRole('menuitem', { name: trigger, exact: true });
  await submenu.hover();
  const target = w.getByRole('menuitem', { name: item, exact: true });
  await target.waitFor({ timeout: 2_000 }).catch(async () => {
    await submenu.click();
    await target.waitFor();
  });
}

async function closeMenus(w) {
  for (let i = 0; i < 3 && (await w.getByRole('menu').count()); i++) {
    await w.keyboard.press('Escape');
    await w.waitForTimeout(150);
  }
}

async function setToggle(scope, label, on) {
  const control = scope.getByRole('switch', { name: label, exact: true });
  if ((await control.getAttribute('aria-checked')) !== String(on)) {
    await control.click();
  }
  await control.and(control.page().locator(`[aria-checked="${on}"]`)).waitFor();
}

async function waitForBlueprints(w) {
  await w
    .getByText('Loading Blueprints…')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => {});
}

async function waitForSiteRunning(w) {
  // A CSS locator, because modal dialogs hide the sidebar from role queries.
  await w
    .locator(`button[aria-label="Stop ${SITE_NAME}"]`)
    .first()
    .waitFor({ timeout: 120_000 });
}

/**
 * The sidebar's start/stop button. A new site is pinned, so it is listed under
 * both Pinned and Sites; the first is the Pinned row at the top.
 */
function siteStatusButton(w, action) {
  return w.getByRole('button', { name: `${action} ${SITE_NAME}`, exact: true }).first();
}

async function waitForPreview(w) {
  await w
    .getByText('Loading site preview')
    .waitFor({ state: 'hidden', timeout: 60_000 })
    .catch(() => {});
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
