import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib/common.mjs';
import { launchStudio } from './lib/studio-app.mjs';
import { MANUAL_SHOTS, SHOTS } from './lib/studio-shots.mjs';

const UPLOADS_URL = 'https://developer.wordpress.com/wp-content/uploads/';

// Shown in place of the throwaway profile's home directory, e.g. in the
// "Local path" and "Default site directory" fields.
const DISPLAY_HOME = '/Users/username';

function parseArgs(argv) {
  const args = { only: null, out: null, keepProfile: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--only') {
      args.only = new Set(argv[++i].split(',').map((s) => s.trim()));
    } else if (arg === '--out') {
      args.out = path.resolve(argv[++i]);
    } else if (arg === '--keep-profile') {
      args.keepProfile = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

/**
 * Rewrites any on-screen path inside the throwaway profile so it reads like a
 * normal home directory. Only the rendered DOM changes, never the app's data.
 */
async function tidyPaths(window, homes) {
  await window.evaluate(
    ({ homes, display }) => {
      const fix = (s) => homes.reduce((out, home) => out.split(home).join(display), s);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (homes.some((h) => node.nodeValue.includes(h))) {
          node.nodeValue = fix(node.nodeValue);
        }
      }
      for (const el of document.querySelectorAll('input, textarea')) {
        if (homes.some((h) => el.value.includes(h))) {
          el.value = fix(el.value);
        }
      }
      for (const el of document.querySelectorAll('[aria-label], [title]')) {
        for (const attr of ['aria-label', 'title']) {
          const value = el.getAttribute(attr);
          if (value && homes.some((h) => value.includes(h))) {
            el.setAttribute(attr, fix(value));
          }
        }
      }
    },
    { homes, display: DISPLAY_HOME }
  );
}

async function prepareFrame(ctx, shot) {
  // Dismiss transient toasts ("Site started", …).
  for (const dismiss of await ctx.w.getByRole('button', { name: 'Dismiss' }).all()) {
    await dismiss.click().catch(() => {});
  }
  if (!shot.keepMouse) {
    await ctx.w.evaluate(() => document.activeElement?.blur?.());
    await ctx.w.mouse.move(2, 2);
  }
  await ctx.w.evaluate(() => document.fonts.ready);
  await ctx.w.waitForTimeout(shot.settle ?? 700);
  await tidyPaths(ctx.w, ctx.homes);
}

function formatIndex({ date, saved, failed }) {
  const lines = [
    `# Studio screenshots — ${date}`,
    '',
    `Captured from the installed Studio app, signed out, by \`npm run screenshots\`.`,
    `Upload to WordPress.com; a file named \`<name>.png\` becomes \`${UPLOADS_URL}YYYY/MM/<name>.png\`.`,
    '',
    '| File | Shows | Used on | Replaces |',
    '| --- | --- | --- | --- |',
  ];
  for (const shot of saved) {
    lines.push(
      `| \`${shot.name}.png\` | ${shot.description} | ${shot.pages.map((p) => `\`${p}\``).join(', ')} | ${(shot.replaces ?? []).map((r) => `\`${r}\``).join('<br>') || '—'} |`
    );
  }
  if (failed.length) {
    lines.push('', '## Failed', '');
    for (const { shot, error } of failed) {
      lines.push(`- \`${shot.name}\` — ${error}`);
    }
  }
  lines.push(
    '',
    '## Capture manually',
    '',
    'These need a WordPress.com login, a connected live site, or Studio Code output.',
    '',
    '| Shows | Used on | Replaces |',
    '| --- | --- | --- |'
  );
  for (const shot of MANUAL_SHOTS) {
    lines.push(
      `| ${shot.description} | ${shot.pages.map((p) => `\`${p}\``).join(', ')} | ${(shot.replaces ?? []).map((r) => `\`${r}\``).join('<br>') || '—'} |`
    );
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = new Date().toISOString().slice(0, 7);
  const outDir = args.out ?? path.join(ROOT, 'screenshots', 'out', date);
  await mkdir(outDir, { recursive: true });

  if (args.only) {
    const unknown = [...args.only].filter((name) => !SHOTS.some((s) => s.name === name));
    if (unknown.length) {
      throw new Error(`Unknown shot(s): ${unknown.join(', ')}`);
    }
  }

  console.log('Launching Studio with a throwaway profile...');
  const studio = await launchStudio({ firstRun: true });
  const version = await studio.app.evaluate(({ app }) => app.getVersion());
  console.log(`Studio ${version}\n`);

  const homes = [...new Set([studio.dirs.home, await realpath(studio.dirs.home)])];
  const ctx = {
    w: studio.window,
    app: studio.app,
    dirs: studio.dirs,
    homes,
    main: () => studio.window.getByRole('main').first(),
  };

  const saved = [];
  const failed = [];
  try {
    for (const shot of SHOTS) {
      const wanted = !args.only || args.only.has(shot.name);
      try {
        await shot.setup(ctx);
        if (wanted) {
          await prepareFrame(ctx, shot);
          await ctx.w.screenshot({ path: path.join(outDir, `${shot.name}.png`) });
          saved.push(shot);
          console.log(`  saved   ${shot.name}.png`);
        }
        await shot.teardown?.(ctx);
      } catch (error) {
        const message = error.message.split('\n')[0];
        failed.push({ shot, error: message });
        console.log(`  FAILED  ${shot.name}: ${message}`);
        // Later shots depend on the state this one should have left.
        console.log('  Stopping: the remaining shots depend on this step.');
        break;
      }
    }
  } finally {
    await studio.close({ keepProfile: args.keepProfile });
    if (args.keepProfile) {
      console.log(`\nProfile kept at ${studio.dirs.root}`);
    }
  }

  if (!args.only) {
    await writeFile(
      path.join(outDir, 'index.md'),
      formatIndex({ date, saved, failed })
    );
  }

  console.log(
    `\n${saved.length} screenshot(s) written to ${path.relative(ROOT, outDir)}/` +
      (failed.length ? `, ${failed.length} failed` : '')
  );
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
