import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SCENES_DIR, isUrl, readJson } from './paths.ts';
import { Scene, describeIssues, type SceneSite } from './schema.ts';

export interface ResolvedSite {
	id: string;
	name: string;
	slug: string;
	// Absolute paths, or a URL for `blueprint`.
	import?: string;
	blueprint?: string;
	design?: string;
	// Has content of its own, so it starts with Studio.
	content: boolean;
}

export interface LoadedScene {
	name: string;
	file: string | null;
	dir: string;
	sites: ResolvedSite[];
	// The site scripts open on, if any has content.
	open: ResolvedSite | null;
	account: {
		wpcomSites?: string;
		previewSites?: string;
		aiQuota?: string;
		aiTopUpPricing?: string;
	};
	chats?: string;
	agentTurns?: string;
	files?: string;
}

export function slugify( label: string ) {
	return label
		.toLowerCase()
		.trim()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}

/** A stable site id for a slug, so a scene needs no ids of its own. */
export function idForSlug( slug: string ) {
	const hex = createHash( 'sha1' ).update( `studio-capture:${ slug }` ).digest( 'hex' );
	return [
		hex.slice( 0, 8 ),
		hex.slice( 8, 12 ),
		`5${ hex.slice( 13, 16 ) }`,
		( ( parseInt( hex.slice( 16, 18 ), 16 ) & 0x3f ) | 0x80 ).toString( 16 ) + hex.slice( 18, 20 ),
		hex.slice( 20, 32 ),
	].join( '-' );
}

/** A scene file by path, or a bundled scene by name (`scenes/<name>/scene.json`). */
export function sceneFile( ref: string, relativeTo = process.cwd() ) {
	const bundled = path.join( SCENES_DIR, ref, 'scene.json' );
	if ( ! ref.includes( '/' ) && ! ref.endsWith( '.json' ) && existsSync( bundled ) ) {
		return bundled;
	}
	return path.resolve( relativeTo, ref );
}

/**
 * Resolves a parsed scene against the folder it was read from: every path in
 * it is relative to that folder, and sites without an id or slug get stable
 * ones from their name.
 */
export function resolveScene( scene: Scene, dir: string, file: string | null ): LoadedScene {
	const local = ( value?: string ) => ( value ? path.resolve( dir, value ) : undefined );
	const slugs = new Set< string >();
	const sites = scene.sites.map( ( site: SceneSite ): ResolvedSite => {
		const slug = site.slug ?? slugify( site.name );
		if ( slugs.has( slug ) ) {
			throw new Error( `Scene ${ scene.name }: two sites have the slug "${ slug }"` );
		}
		slugs.add( slug );
		return {
			id: site.id ?? idForSlug( slug ),
			name: site.name,
			slug,
			import: local( site.import ),
			blueprint:
				site.blueprint && ( isUrl( site.blueprint ) ? site.blueprint : local( site.blueprint ) ),
			design: local( site.design ),
			content: Boolean( site.import || site.blueprint ),
		};
	} );
	const open = scene.open
		? sites.find( ( site ) => site.slug === scene.open )
		: sites.find( ( site ) => site.content );
	if ( scene.open && ! open ) {
		throw new Error( `Scene ${ scene.name }: no site "${ scene.open }" to open on` );
	}
	return {
		name: scene.name,
		file,
		dir,
		sites,
		open: open ?? null,
		account: {
			wpcomSites: local( scene.account?.wpcomSites ),
			previewSites: local( scene.account?.previewSites ),
			aiQuota: local( scene.account?.aiQuota ),
			aiTopUpPricing: local( scene.account?.aiTopUpPricing ),
		},
		chats: local( scene.chats ),
		agentTurns: local( scene.agentTurns ),
		files: local( scene.files ),
	};
}

function parseScene( data: unknown, source: string ): Scene {
	const parsed = Scene.safeParse( data );
	if ( ! parsed.success ) {
		throw new Error(
			`${ source } is not a valid scene:\n  ${ describeIssues( parsed.error, data ).join(
				'\n  '
			) }`
		);
	}
	return parsed.data;
}

export async function loadScene( ref: string, relativeTo?: string ): Promise< LoadedScene > {
	const file = sceneFile( ref, relativeTo );
	const scene = parseScene( await readJson( file ), file );
	return resolveScene( scene, path.dirname( file ), file );
}

/**
 * A one-site scene made from a Blueprint (a path or URL), so a Blueprint can
 * be captured without writing a scene: the site is named after the
 * Blueprint's `meta.title`, or "My WordPress Website".
 */
export async function sceneFromBlueprint( blueprint: string ): Promise< LoadedScene > {
	const source = isUrl( blueprint ) ? blueprint : path.resolve( blueprint );
	const text = isUrl( source )
		? await fetch( source ).then( ( response ) => {
				if ( ! response.ok ) {
					throw new Error( `Fetching ${ source } failed: ${ response.status }` );
				}
				return response.text();
		  } )
		: await readFile( source, 'utf8' );
	const { meta } = JSON.parse( text ) as { meta?: { title?: string } };
	const name = meta?.title?.trim() || 'My WordPress Website';
	return resolveScene(
		{ name: slugify( name ), sites: [ { name, blueprint: source } ] },
		isUrl( source ) ? process.cwd() : path.dirname( source ),
		null
	);
}
