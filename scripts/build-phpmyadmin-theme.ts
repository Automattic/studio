import path from 'path';
import fs from 'fs-extra';
import rtlcss from 'rtlcss';
import * as sass from 'sass';

const REPO_ROOT = path.join( import.meta.dirname, '..' );
const THEME_SOURCE_PATH = path.join( REPO_ROOT, 'apps', 'cli', 'phpmyadmin', 'themes', 'studio' );
const NODE_MODULES_PATH = path.join( REPO_ROOT, 'node_modules' );

// Copied verbatim; everything else in the theme is compiled from `scss/`.
const STATIC_ENTRIES = [ 'theme.json', 'screen.png', 'img', 'jquery' ];

/**
 * Installs Studio's phpMyAdmin theme into an extracted phpMyAdmin tree.
 *
 * Called from `download-wp-server-files.ts` after phpMyAdmin is unpacked —
 * that step wipes the whole directory, so the theme has to be re-installed
 * every time rather than left in place.
 *
 * @param phpMyAdminPath Root of the extracted phpMyAdmin installation.
 */
export async function buildPhpMyAdminTheme( phpMyAdminPath: string ): Promise< void > {
	const destination = path.join( phpMyAdminPath, 'themes', 'studio' );

	await fs.remove( destination );
	await fs.ensureDir( path.join( destination, 'css' ) );

	for ( const entry of STATIC_ENTRIES ) {
		await fs.copy( path.join( THEME_SOURCE_PATH, entry ), path.join( destination, entry ) );
	}

	// Bootstrap 5.3 can emit its dark mode either behind `[data-bs-theme=dark]`
	// or behind `prefers-color-scheme`. Studio needs the latter: phpMyAdmin 5.2
	// has no colour-mode switcher to set that attribute, so an attribute-keyed
	// dark mode would never engage. It is set here rather than in the theme's
	// own `_variables.scss` because on phpMyAdmin 6.0 — which does have a
	// switcher — the attribute form is the right one, and the theme source is
	// shared with that version.
	const entrypoint = `$color-mode-type: media-query;\n@import "theme";\n`;

	// `loadPaths` resolves both that `@import "theme"` and the theme's own
	// `@import "bootstrap/scss/…"`, so neither has to know where it sits.
	const { css } = sass.compileString( entrypoint, {
		loadPaths: [ path.join( THEME_SOURCE_PATH, 'scss' ), NODE_MODULES_PATH ],
		style: 'compressed',
		sourceMap: false,
		// Deprecations raised by Bootstrap's own Sass and by the phpMyAdmin
		// partials this theme inherits — not by anything we can fix here, and
		// otherwise printed on every `npm install`. Revisit when Bootstrap
		// ships a Sass-module build.
		silenceDeprecations: [ 'import', 'global-builtin', 'color-functions', 'if-function' ],
	} );

	await fs.writeFile( path.join( destination, 'css', 'theme.css' ), css );
	await fs.writeFile(
		path.join( destination, 'css', 'theme.rtl.css' ),
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

	console.log( '[phpmyadmin-theme] Building Studio theme ...' );
	await buildPhpMyAdminTheme( phpMyAdminPath );
	console.log( '[phpmyadmin-theme] Studio theme built' );
}

// Only run when invoked directly, so importing the builder has no side effects.
if ( process.argv[ 1 ] === import.meta.filename ) {
	void main();
}
