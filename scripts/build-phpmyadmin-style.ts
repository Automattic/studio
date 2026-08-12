import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import rtlcss from 'rtlcss';
import * as sass from 'sass';

const REPO_ROOT = path.join( import.meta.dirname, '..' );
const STYLE_SOURCE_PATH = path.join( REPO_ROOT, 'apps', 'cli', 'phpmyadmin', 'styles', 'studio' );
const DESIGN_TOKENS_PATH = fileURLToPath(
	import.meta.resolve( '@wordpress/theme/design-tokens.css' )
);

/**
 * Builds Studio's stylesheet into an extracted phpMyAdmin tree.
 *
 * Called from `download-wp-server-files.ts` after phpMyAdmin is unpacked —
 * that step wipes the whole directory, so the stylesheet has to be rebuilt.
 *
 * @param phpMyAdminPath Root of the extracted phpMyAdmin installation.
 */
export async function buildPhpMyAdminStyle( phpMyAdminPath: string ): Promise< void > {
	const destination = path.join( phpMyAdminPath, 'themes' );

	// Remove output from the former full-theme implementation when rebuilding
	// an existing checkout rather than a freshly downloaded phpMyAdmin tree.
	await fs.remove( path.join( destination, 'studio' ) );
	await fs.ensureDir( destination );

	const { css } = sass.compile( path.join( STYLE_SOURCE_PATH, 'scss', 'theme.scss' ), {
		style: 'compressed',
		sourceMap: false,
		loadPaths: [ path.dirname( DESIGN_TOKENS_PATH ) ],
		silenceDeprecations: [ 'import' ],
	} );

	await fs.writeFile( path.join( destination, 'studio.css' ), css );
	await fs.writeFile(
		path.join( destination, 'studio.rtl.css' ),
		rtlcss.process( css, { useCalc: true } )
	);
}

async function main(): Promise< void > {
	const phpMyAdminPath = path.join( REPO_ROOT, 'wp-files', 'phpmyadmin' );

	if ( ! ( await fs.pathExists( phpMyAdminPath ) ) ) {
		console.error(
			`[phpmyadmin-theme] ${ phpMyAdminPath } not found. Run scripts/download-wp-server-files.ts first.`
		);
		process.exit( 1 );
	}

	console.log( '[phpmyadmin-style] Building Studio stylesheet ...' );
	await buildPhpMyAdminStyle( phpMyAdminPath );
	console.log( '[phpmyadmin-style] Studio stylesheet built' );
}

// Only run when invoked directly, so importing the builder has no side effects.
if ( process.argv[ 1 ] === import.meta.filename ) {
	void main();
}
