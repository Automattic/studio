import { spawn, execFileSync } from 'node:child_process';
import type { Handler } from '../handler-types.js';

export const previewHandler: Handler = async (args, ctx) => {
  const { startPreview } = await import('../../lib/preview/studio.js');
  const result = await startPreview({
    outputDir: args.outputDir as string,
    themeFiles: args.themeFiles as import('../../lib/preview/types.js').ReplicaFile[] | undefined,
    blockPlugins: args.blockPlugins as import('../../lib/preview/types.js').ReplicaBlockPlugin[] | undefined,
    themeSlug: args.themeSlug as string | undefined,
    siteName: args.siteName as string | undefined,
  });
  if (result.status === 'ready' && args.open && result.url) {
    const openBrowser = () => {
      const cmd = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start'
        : 'xdg-open';
      try {
        spawn(cmd, [`${result.url}/wp-admin/`], { detached: true, stdio: 'ignore' }).unref();
      } catch { /* best-effort */ }
    };
    const openStudioApp = (): boolean => {
      try {
        if (process.platform === 'darwin') {
          spawn('open', ['-a', 'Studio'], { detached: true, stdio: 'ignore' }).unref();
          return true;
        }
        if (process.platform === 'win32') {
          spawn('cmd', ['/c', 'start', '', 'Studio'], { detached: true, stdio: 'ignore' }).unref();
          return true;
        }
        if (process.platform === 'linux') {
          const customCmd = process.env.STUDIO_APP_CMD;
          if (customCmd) {
            spawn('sh', ['-c', customCmd], { detached: true, stdio: 'ignore' }).unref();
            return true;
          }
          for (const bin of ['Studio', 'studio-app', 'wp-studio']) {
            try {
              execFileSync('which', [bin], { stdio: 'ignore', timeout: 1000 });
              spawn(bin, [], { detached: true, stdio: 'ignore' }).unref();
              return true;
            } catch { /* try next */ }
          }
        }
        return false;
      } catch { return false; }
    };
    if (result.source === 'studio' && openStudioApp()) {
      /* launched Studio app */
    } else {
      openBrowser();
    }
  }
  return ctx.textResult(result);
};
