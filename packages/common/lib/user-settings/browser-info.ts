import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { browserConfig, type BrowserInfo } from './browser';
import { getBrowserPath, readPreferredBrowser } from './open-browser';

const execFileAsync = promisify( execFile );

export async function readBrowserInfo(): Promise< BrowserInfo | null > {
	const browser = await readPreferredBrowser();
	if ( ! browser ) {
		return null;
	}
	const info: BrowserInfo = { name: browserConfig[ browser ].name };
	const bundle = getBrowserPath( browser );
	if ( ! bundle || process.platform !== 'darwin' ) {
		return info;
	}
	const temp = await mkdtemp( path.join( os.tmpdir(), 'studio-browser-icon-' ) );
	try {
		const { stdout } = await execFileAsync( 'plutil', [
			'-extract',
			'CFBundleIconFile',
			'raw',
			'-o',
			'-',
			path.join( bundle, 'Contents/Info.plist' ),
		] );
		const icon = path.basename( stdout.trim() );
		const source = path.join(
			bundle,
			'Contents/Resources',
			path.extname( icon ) ? icon : `${ icon }.icns`
		);
		const output = path.join( temp, 'icon.png' );
		await execFileAsync( 'sips', [ '-s', 'format', 'png', '-Z', '32', source, '--out', output ] );
		info.icon = `data:image/png;base64,${ ( await readFile( output ) ).toString( 'base64' ) }`;
	} catch {
		/* The generic icon remains available when the app has no readable icon. */
	} finally {
		await rm( temp, { recursive: true, force: true } );
	}
	return info;
}
