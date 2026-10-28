/**
 * A copy of the content of each post WordPress renders, as a file in Studio's
 * workspace for the site, outside the site's folder so it never travels with
 * the site: <config>/workspace/<site id>/<post type>/<ID>.html.
 *
 * A change to a copy, by any tool or script, is saved to its post as an
 * administrator's save in the editor saves it (savePost() in
 * site-markup.ts), which then checks it as it checks any saved post. A
 * change to a post, in the editor or by any route, rewrites its copy. When a
 * copy and its post both changed, the post stands: the copy is rewritten from
 * it, and the copy's change is kept in <ID>.unsaved.html.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { readFile, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { RENDERED, RENDERED_TYPES, savePost } from '@studio/agent/node/site-markup';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { ChangeReport, SiteChangeSource, Versions } from '@studio/agent/node/site-changes';
import type { WordPressSite } from '@studio/agent/node/site-database';

const MANIFEST = '.copies.json';

// Each copy's post version and content hash when Studio last wrote or saved it.
type Manifest = Record< string, { type: string; post: string; file: string } >;

interface Post {
	id: number;
	type: string;
	version: string;
}

export function workspaceRoot(): string {
	return path.join( getConfigDirectory(), 'workspace' );
}

const workspaceOfSite = ( siteId: string ) => path.join( workspaceRoot(), siteId );

async function workspaceOf(
	host: StudioAgentHost,
	sitePath: string
): Promise< string | undefined > {
	const site = await host.sites.findByFolder( sitePath );
	return site?.id ? workspaceOfSite( site.id ) : undefined;
}

/** The ID of the site whose workspace holds `file`, if one does. */
export function siteIdOfCopy( file: string ): string | undefined {
	const relative = path.relative( workspaceRoot(), path.resolve( file ) );
	const [ id ] = relative.split( path.sep );
	return id && ! relative.startsWith( '..' ) && ! path.isAbsolute( relative ) ? id : undefined;
}

const hash = ( content: string ) => createHash( 'sha1' ).update( content ).digest( 'hex' );

const copyOf = ( workspace: string, post: Pick< Post, 'id' | 'type' > ) =>
	path.join( workspace, post.type, `${ post.id }.html` );

function readPosts( site: WordPressSite ): Post[] {
	return site.query< Post >(
		`SELECT ID AS id, post_type AS type, post_modified_gmt || ' ' || length(post_content) AS version
		FROM ${ site.prefix }posts WHERE ${ RENDERED }`,
		...RENDERED_TYPES
	);
}

function readContent( site: WordPressSite, id: number ): string {
	return (
		site.query< { content: string } >(
			`SELECT post_content AS content FROM ${ site.prefix }posts WHERE ID = ?`,
			id
		)[ 0 ]?.content ?? ''
	);
}

async function readManifest( workspace: string ): Promise< Manifest > {
	return JSON.parse(
		await readFile( path.join( workspace, MANIFEST ), 'utf8' ).catch( () => '{}' )
	);
}

async function writeCopy( file: string, content: string ): Promise< void > {
	mkdirSync( path.dirname( file ), { recursive: true } );
	await writeFile( file, content, 'utf8' );
}

async function readCopy( file: string ): Promise< string | undefined > {
	return readFile( file, 'utf8' ).catch( () => undefined );
}

/**
 * The workspace folder of the site at `sitePath`, which Studio fills with its
 * posts' copies from the next check on. Undefined for a folder Studio doesn't
 * manage.
 */
async function openWorkspace(
	host: StudioAgentHost,
	sitePath: string
): Promise< string | undefined > {
	const workspace = await workspaceOf( host, sitePath );
	if ( workspace ) {
		mkdirSync( workspace, { recursive: true } );
	}
	return workspace;
}

// Stated, and the workspace opened, for a site with posts to copy.
export async function postCopiesFact(
	site: WordPressSite,
	host: StudioAgentHost
): Promise< string | undefined > {
	if ( ! readPosts( site ).length ) {
		return undefined;
	}
	const workspace = await openWorkspace( host, site.root );
	return workspace
		? `Post content, as WordPress saves it: ${ workspace }/<post type>/<ID>.html, for ${ RENDERED_TYPES.join(
				', '
		  ) }. Studio saves a change to one to its post as the editor saves it (wp_update_post()), and rewrites it when the post changes.`
		: undefined;
}

export const postCopies: SiteChangeSource = {
	name: 'post copies',
	saves: true,
	// Writes the copy of each post that has none, or whose post changed while
	// the copy did not, and returns each post's version and its copy's hash.
	async read( sitePath, _last, host ) {
		const workspace = await workspaceOf( host, sitePath );
		if ( ! workspace || ! existsSync( workspace ) ) {
			return {};
		}
		const manifest = await readManifest( workspace );
		const versions: Versions = {};
		await readWordPressSite( sitePath, async ( site ) => {
			const posts = readPosts( site );
			const kept = new Set( posts.map( ( post ) => String( post.id ) ) );
			// A post deleted or trashed takes its copy with it.
			for ( const [ id, { type } ] of Object.entries( manifest ) ) {
				if ( ! kept.has( id ) ) {
					await rm( copyOf( workspace, { id: Number( id ), type } ), { force: true } );
					delete manifest[ id ];
				}
			}
			for ( const post of posts ) {
				const file = copyOf( workspace, post );
				const copy = await readCopy( file );
				const last = manifest[ post.id ];
				const untouched = copy !== undefined && last && hash( copy ) === last.file;
				if ( copy === undefined || ! last || ( untouched && last.post !== post.version ) ) {
					const content = readContent( site, post.id );
					await writeCopy( file, content );
					manifest[ post.id ] = { type: post.type, post: post.version, file: hash( content ) };
					versions[ post.id ] = `${ post.type } ${ post.version } ${ hash( content ) }`;
					continue;
				}
				versions[ post.id ] = `${ post.type } ${ post.version } ${ hash( copy ) }`;
			}
		} );
		await writeFile( path.join( workspace, MANIFEST ), JSON.stringify( manifest ), 'utf8' );
		return versions;
	},
	// Saves each copy changed since Studio wrote it to its post, unless the
	// post changed too.
	async check( site, _before, after, host ) {
		const workspace = workspaceOfSite( site.id );
		if ( ! existsSync( workspace ) ) {
			return { reports: [] };
		}
		const manifest = await readManifest( workspace );
		const reports: ChangeReport[] = [];
		const next: Versions = { ...after };
		for ( const [ id, version ] of Object.entries( after ) ) {
			const [ type, ...rest ] = version.split( ' ' );
			const copyHash = rest.pop();
			const postVersion = rest.join( ' ' );
			const last = manifest[ id ];
			if ( ! last || last.file === copyHash ) {
				continue;
			}
			const file = copyOf( workspace, { id: Number( id ), type } );
			const label = `${ site.name } ${ type } ${ id }`;
			if ( last.post !== postVersion ) {
				const unsaved = path.join( path.dirname( file ), `${ id }.unsaved.html` );
				await rename( file, unsaved );
				const content = await readWordPressSite( site.path, ( wp ) =>
					readContent( wp, Number( id ) )
				);
				await writeCopy( file, content );
				manifest[ id ] = { type, post: postVersion, file: hash( content ) };
				next[ id ] = `${ type } ${ postVersion } ${ hash( content ) }`;
				reports.push( {
					key: `copy ${ id }`,
					problem: `${ label } changed in WordPress after Studio wrote ${ file }, so Studio kept the post: ${ file } now holds it, and the copy's change is in ${ unsaved }.`,
				} );
				continue;
			}
			try {
				await savePost( host, site, Number( id ), file );
			} catch ( error ) {
				reports.push( {
					key: `copy ${ id }`,
					problem: `${ label }: Studio could not save ${ file } to it: ${
						error instanceof Error ? error.message : String( error )
					}`,
				} );
				continue;
			}
			const saved = await readWordPressSite( site.path, ( wp ) =>
				readPosts( wp ).find( ( post ) => String( post.id ) === id )
			);
			manifest[ id ] = { type, post: saved?.version ?? postVersion, file: copyHash ?? '' };
			next[ id ] = `${ type } ${ manifest[ id ].post } ${ copyHash }`;
			reports.push( {
				key: `copy ${ id }`,
				summary: `${ label }: Studio saved ${ file } to it (wp_update_post())`,
			} );
		}
		await writeFile( path.join( workspace, MANIFEST ), JSON.stringify( manifest ), 'utf8' );
		return { reports, next };
	},
};
