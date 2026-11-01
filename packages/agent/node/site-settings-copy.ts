/**
 * A copy of the site's settings a new site is set up with, as a file in
 * Studio's workspace for the site: <config>/workspace/<site id>/settings.json,
 * holding the options Settings > General and Settings > Reading save
 * (blogname, blogdescription, show_on_front, page_on_front, page_for_posts).
 *
 * A change to the copy is saved to the options as those screens save them
 * (update_option()); a page may be named by its slug as well as its ID, and the
 * copy is rewritten with the ID. A change to the options rewrites the copy.
 * When both changed, the options stand: the copy is rewritten from them, and
 * its change is kept in settings.unsaved.json.
 */
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
import { workspaceRoot } from '@studio/agent/node/post-copies';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { AS_ADMINISTRATOR, wpEvalJson } from '@studio/agent/node/tools/utils';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { SiteChangeSource, Versions } from '@studio/agent/node/site-changes';
import type { WordPressSite } from '@studio/agent/node/site-database';

export const SETTINGS_COPY = 'settings.json';
const MANIFEST = '.settings.json';
const KEY = 'settings';

// The options the copy holds, in the order Settings shows them.
const OPTIONS = [
	'blogname',
	'blogdescription',
	'show_on_front',
	'page_on_front',
	'page_for_posts',
] as const;
const PAGE_OPTIONS = [ 'page_on_front', 'page_for_posts' ];

const hash = ( content: string ) => createHash( 'sha1' ).update( content ).digest( 'hex' );

// The title and tagline as Settings > General shows them: sanitize_option()
// saves them through esc_html(), and the field shows the characters it escaped.
const ENTITIES: Record< string, string > = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#039;': "'",
};
const unescaped = ( value: string ) =>
	value.replace( /&(amp|lt|gt|quot|#039);/g, ( entity ) => ENTITIES[ entity ] );

function readSettings( site: WordPressSite ): string {
	const settings = Object.fromEntries(
		OPTIONS.map( ( name ) => {
			const value = site.option( name ) ?? '';
			return [
				name,
				PAGE_OPTIONS.includes( name ) ? Number( value ) || 0 : unescaped( String( value ) ),
			];
		} )
	);
	return `${ JSON.stringify( settings, null, '\t' ) }\n`;
}

async function workspaceOf( host: StudioAgentHost, sitePath: string ) {
	const site = await host.sites.findByFolder( sitePath );
	return site?.id ? path.join( workspaceRoot(), site.id ) : undefined;
}

const readText = ( file: string ) => readFile( file, 'utf8' ).catch( () => undefined );

async function readManifest( workspace: string ): Promise< { options?: string; file?: string } > {
	return JSON.parse( ( await readText( path.join( workspace, MANIFEST ) ) ) ?? '{}' );
}

async function writeCopy( workspace: string, content: string ) {
	await writeFile( path.join( workspace, SETTINGS_COPY ), content, 'utf8' );
	await writeFile(
		path.join( workspace, MANIFEST ),
		JSON.stringify( { options: hash( content ), file: hash( content ) } ),
		'utf8'
	);
}

// Saves the options the copy changed, each as Settings saves it, with a page
// named by its slug saved as its ID; refuses a page that does not exist.
const SAVE_SETTINGS = `${ AS_ADMINISTRATOR }
$saved = array();
foreach ( $data as $name => $value ) {
	if ( in_array( $name, array( 'page_on_front', 'page_for_posts' ), true ) && ! is_numeric( $value ) ) {
		$page = get_page_by_path( (string) $value );
		if ( ! $page ) { fwrite( STDERR, "$name: no page has the slug $value." ); exit( 1 ); }
		$value = $page->ID;
	}
	if ( in_array( $name, array( 'page_on_front', 'page_for_posts' ), true ) && $value && 'page' !== get_post_type( (int) $value ) ) {
		fwrite( STDERR, "$name: no page has the ID $value." ); exit( 1 );
	}
	update_option( $name, $value );
	$saved[] = $name;
}
echo wp_json_encode( array( 'saved' => $saved ) );`;

export const siteSettingsCopy: SiteChangeSource = {
	name: 'settings copy',
	saves: true,
	// Writes the copy when it is missing, or when the options changed while the
	// copy did not, and returns the options' and the copy's hashes.
	async read( sitePath, _last, host ): Promise< Versions > {
		const workspace = await workspaceOf( host, sitePath );
		if ( ! workspace || ! existsSync( workspace ) ) {
			return {};
		}
		const options = await readWordPressSite( sitePath, readSettings );
		const copy = await readText( path.join( workspace, SETTINGS_COPY ) );
		const manifest = await readManifest( workspace );
		const untouched = copy !== undefined && hash( copy ) === manifest.file;
		if ( copy === undefined || ( untouched && manifest.options !== hash( options ) ) ) {
			await writeCopy( workspace, options );
			return { [ KEY ]: `${ hash( options ) } ${ hash( options ) }` };
		}
		return { [ KEY ]: `${ hash( options ) } ${ hash( copy ) }` };
	},
	async check( site, before, after, host ) {
		const workspace = path.join( workspaceRoot(), site.id );
		const [ optionsHash, copyHash ] = ( after[ KEY ] ?? '' ).split( ' ' );
		const manifest = existsSync( workspace ) ? await readManifest( workspace ) : {};
		// Unchanged, or as it was when Studio last could not save it.
		if ( ! copyHash || copyHash === manifest.file || before[ KEY ] === after[ KEY ] ) {
			return { reports: [] };
		}
		const file = path.join( workspace, SETTINGS_COPY );
		const reread = async () => {
			const options = await readWordPressSite( site.path, readSettings );
			await writeCopy( workspace, options );
			return { [ KEY ]: `${ hash( options ) } ${ hash( options ) }` };
		};
		if ( optionsHash !== manifest.options ) {
			const unsaved = path.join( workspace, 'settings.unsaved.json' );
			await rename( file, unsaved );
			return {
				reports: [
					{
						key: 'settings copy',
						problem: `${ site.name }'s settings changed in WordPress after Studio wrote ${ file }, so Studio kept them: ${ file } now holds them, and the copy's change is in ${ unsaved }.`,
					},
				],
				next: await reread(),
			};
		}
		const was = JSON.parse( await readWordPressSite( site.path, readSettings ) );
		let changed: Record< string, unknown >;
		try {
			const copy = JSON.parse( ( await readText( file ) ) ?? '' );
			changed = Object.fromEntries(
				OPTIONS.filter(
					( name ) => name in copy && String( copy[ name ] ) !== String( was[ name ] )
				).map( ( name ) => [ name, copy[ name ] ] )
			);
		} catch ( error ) {
			return {
				reports: [
					{
						key: 'settings copy',
						problem: `Studio could not save ${ file } to ${ site.name }'s settings: ${
							error instanceof Error ? error.message : String( error )
						}`,
					},
				],
			};
		}
		try {
			const { saved } = Object.keys( changed ).length
				? await wpEvalJson< { saved: string[] } >( host, site, SAVE_SETTINGS, changed )
				: { saved: [] };
			const next = await reread();
			return {
				reports: saved.length
					? [
							{
								key: 'settings copy',
								summary: `${ site.name }: Studio saved ${ saved.join(
									', '
								) } from ${ file } (update_option()).`,
							},
					  ]
					: [],
				next,
			};
		} catch ( error ) {
			return {
				reports: [
					{
						key: 'settings copy',
						problem: `Studio could not save ${ file } to ${ site.name }'s settings: ${
							error instanceof Error ? error.message : String( error )
						}`,
					},
				],
			};
		}
	},
};
