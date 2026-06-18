import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import type { FrontendTemplate } from './types';

function renderIndexHtml( siteName: string ): string {
	const safeName = siteName.replace( /[&<>"']/g, ( c ) => `&#${ c.charCodeAt( 0 ) };` );
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${ safeName }</title>
	<style>
		body { font-family: -apple-system, system-ui, sans-serif; margin: 0; min-height: 100vh;
			display: grid; place-items: center; background: #1e1e1e; color: #f0f0f0; }
		main { max-width: 32rem; padding: 2rem; text-align: center; }
		h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
		p { color: #c3c3c3; line-height: 1.5; }
		code { background: #2f2f2f; padding: 0.1rem 0.4rem; border-radius: 4px; }
	</style>
</head>
<body>
	<main>
		<h1>${ safeName }</h1>
		<p>This is a headless WordPress site. WordPress runs as the backend, and this static
		frontend sits in front of it.</p>
		<p>Open <strong>Studio Code</strong> to build this frontend further. The WordPress REST API
		is available under <code>/wp-json</code>.</p>
	</main>
</body>
</html>
`;
}

/**
 * The built-in plain-static template: a single `public/index.html`, no build step. Authors can add
 * static files under `public/`, or add tooling at the `frontend/` project root whose build output
 * goes to `public/`.
 */
export const staticTemplate: FrontendTemplate = {
	id: 'static',
	label: 'Static HTML',
	servedSubdir: 'public',
	async scaffold( frontendDir: string, siteName: string ): Promise< void > {
		const publicDir = path.join( frontendDir, 'public' );
		await fs.promises.mkdir( publicDir, { recursive: true } );
		const indexPath = path.join( publicDir, 'index.html' );
		if ( await pathExists( indexPath ) ) {
			return;
		}
		await fs.promises.writeFile( indexPath, renderIndexHtml( siteName ), 'utf-8' );
	},
};
