/**
 * The themes a call broke, as WordPress lists them. WP_Theme reads a theme
 * from its style.css header and its index template, and lists it as broken
 * with the reason in WP_Theme::errors() (wp-includes/class-wp-theme.php): no
 * stylesheet, no templates/index.html or index.php for a standalone theme, a
 * parent that is not installed. A broken theme cannot be activated, and an
 * active one missing its files is switched for WP_DEFAULT_THEME
 * (validate_current_theme() in wp-includes/theme.php).
 *
 * When what WP_Theme lists errors from changes, as a style.css rewritten
 * without its Template header does, Studio asks WordPress for the theme's
 * errors and reports a theme that was whole before the call and is now
 * broken, until it is not: one the site had when Studio first read it, or one
 * WordPress has listed as whole since. A theme still being made is left to
 * blockTheme, which says what it needs.
 */
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { readThemeHeader } from '@studio/agent/node/themes';
import { runWpCli } from '@studio/agent/node/tools/utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { ChangeReport, SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

// A version's files, then what is known of them: '' for a theme being made.
const STATUS = '#';
// The site had the theme when Studio first read it.
const HAD = 'had';
const OK = 'ok';
const REPORTED = 'reported';

const ERRORS = ( themes: string[] ) => `
$errors = array();
foreach ( ${ JSON.stringify( themes ) } as $slug ) {
	$error = wp_get_theme( $slug )->errors();
	$errors[ $slug ] = is_wp_error( $error ) ? wp_strip_all_tags( $error->get_error_message() ) : '';
}
echo 'THEME_ERRORS=' . wp_json_encode( (object) $errors );`;

async function errorsOf(
	host: StudioAgentHost,
	site: HostSite,
	themes: string[]
): Promise< Record< string, string > > {
	const output = await runWpCli( host, site, [ 'eval', ERRORS( themes ) ] );
	return JSON.parse(
		output.slice( output.indexOf( 'THEME_ERRORS=' ) + 'THEME_ERRORS='.length )
	) as Record< string, string >;
}

const exists = ( file: string ) => stat( file ).then( Boolean, () => false );

// What WP_Theme lists a theme's errors from: its style.css and its Template
// header, its index templates, and its parent.
async function filesVersion( root: string, theme: string ): Promise< string > {
	const themes = path.join( root, 'wp-content', 'themes' );
	const dir = path.join( themes, theme );
	const parent = await readThemeHeader( root, theme, 'Template' ).catch( () => '' );
	const facts = await Promise.all( [
		exists( path.join( dir, 'style.css' ) ),
		exists( path.join( dir, 'index.php' ) ),
		exists( path.join( dir, 'templates/index.html' ) ),
		parent ? exists( path.join( themes, parent, 'style.css' ) ) : false,
		parent ? readThemeHeader( root, parent, 'Template' ).catch( () => '' ) : '',
	] );
	return JSON.stringify( [ parent, ...facts ] );
}

const filesOf = ( version: string | undefined ) => version?.split( STATUS )[ 0 ];
const statusOf = ( version: string | undefined ) => version?.split( STATUS )[ 1 ] ?? '';

export const themeErrors: SiteChangeSource = {
	name: 'theme-errors',
	async read( sitePath, last ) {
		const entries = await readdir( path.join( sitePath, 'wp-content', 'themes' ), {
			withFileTypes: true,
		} ).catch( () => [] );
		const versions: Versions = {};
		for ( const entry of entries.filter( ( candidate ) => candidate.isDirectory() ) ) {
			const files = await filesVersion( sitePath, entry.name );
			// What is known holds while the files are the same.
			const known = ! last
				? HAD
				: filesOf( last[ entry.name ] ) === files
				? statusOf( last[ entry.name ] )
				: '';
			versions[ entry.name ] = `${ files }${ STATUS }${ known }`;
		}
		return versions;
	},
	async check( site, before, after, host ) {
		const changed = Object.keys( after ).filter(
			( theme ) => filesOf( before[ theme ] ) !== filesOf( after[ theme ] )
		);
		if ( ! changed.length ) {
			return { reports: [] };
		}
		let errors: Record< string, string >;
		try {
			errors = await errorsOf( host, site, changed );
		} catch {
			// A site WordPress cannot load for says nothing, as what runs it reports that.
			return { reports: [] };
		}
		const next: Versions = { ...after };
		const reports: ChangeReport[] = [];
		for ( const theme of changed ) {
			const error = errors[ theme ] ?? '';
			const was = statusOf( before[ theme ] );
			// A theme never whole is still being made, and left to blockTheme.
			const reported = !! error && [ HAD, OK, REPORTED ].includes( was );
			const known = reported ? REPORTED : error ? '' : OK;
			next[ theme ] = `${ filesOf( after[ theme ] ) }${ STATUS }${ known }`;
			if ( reported || ( was === REPORTED && ! error ) ) {
				reports.push( {
					key: `theme errors ${ theme }`,
					problem: reported
						? `${ site.name }: WordPress lists the theme ${ theme } (wp-content/themes/${ theme }) as broken: "${ error }" (WP_Theme::errors() in wp-includes/class-wp-theme.php). WordPress activates no broken theme, and switches an active one missing its files for WP_DEFAULT_THEME (validate_current_theme() in wp-includes/theme.php).`
						: undefined,
				} );
			}
		}
		return { reports, next };
	},
};
