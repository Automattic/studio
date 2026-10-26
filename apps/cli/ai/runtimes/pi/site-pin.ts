import path from 'node:path';
import { siteIdOfCopy } from 'cli/ai/post-copies';
import { resolveSite } from 'cli/ai/tools/utils';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { Confirmation } from './confirmation';
import type { RemoteSite } from 'cli/ai/hosts';
import type { SiteInfo } from 'cli/ai/types';

// A request works on one site: the active site, or the first site the turn
// changes when none is active, plus any site the turn creates. A change to any
// other site waits for the user's yes, once per site, and so does creating a
// site while the request already has one: a name in the request may be a
// brand for that site or a second site, and only the user can say which.

// Tools that change the local site named by `nameOrPath`.
const LOCAL_SITE_CHANGES = new Set( [
	'site_import',
	'site_pull',
	'install_taxonomy_scripts',
	'wp_cli',
] );
const FILE_CHANGES = new Set( [ 'Write', 'Edit' ] );
// WP-CLI subcommands that only read, such as `option get` or `post list`.
const WP_CLI_READS =
	/^\s*(?:wp\s+)?(?:[\w-]+\s+){0,2}(?:get|list|status|is-active|is-installed|exists|path|version|count|pluck)(?:\s|$)/;

interface SiteTarget {
	key: string;
	label: string;
}

function localTarget( sitePath: string, name: string ): SiteTarget {
	return { key: path.resolve( sitePath ), label: `"${ name }"` };
}

function remoteTarget( site: RemoteSite, name: string ): SiteTarget {
	return { key: `${ site.host }:${ site.id }`, label: `"${ name }"` };
}

function isInside( file: string, dir: string ): boolean {
	const relative = path.relative( dir, file );
	return relative === '' || ( ! relative.startsWith( '..' ) && ! path.isAbsolute( relative ) );
}

async function targetOf( toolName: string, params: unknown ): Promise< SiteTarget | undefined > {
	const args = ( params ?? {} ) as Record< string, unknown >;
	if ( FILE_CHANGES.has( toolName ) && typeof args.path === 'string' ) {
		const file = path.resolve( STUDIO_SITES_ROOT, args.path );
		const { sites } = await readCliConfig();
		// A post's copy in Studio's workspace is the site's, as its files are.
		const copyOf = siteIdOfCopy( file );
		const site = copyOf
			? sites.find( ( candidate ) => candidate.id === copyOf )
			: sites
					.filter( ( candidate ) => isInside( file, path.resolve( candidate.path ) ) )
					.sort( ( a, b ) => b.path.length - a.path.length )[ 0 ];
		return site ? localTarget( site.path, site.name ) : undefined;
	}
	if (
		! LOCAL_SITE_CHANGES.has( toolName ) ||
		typeof args.nameOrPath !== 'string' ||
		( toolName === 'wp_cli' && WP_CLI_READS.test( String( args.command ?? '' ) ) )
	) {
		return undefined;
	}
	try {
		const site = await resolveSite( args.nameOrPath );
		return localTarget( site.path, site.name );
	} catch {
		// The tool reports the unknown site itself.
		return undefined;
	}
}

export class SitePin {
	private readonly allowed = new Set< string >();
	private requestSite?: SiteTarget;
	private newSitesAllowed = false;

	constructor( activeSite: SiteInfo | null | undefined ) {
		if ( activeSite?.remote ) {
			this.requestSite = remoteTarget( activeSite.remote, activeSite.name );
		} else if ( activeSite?.path ) {
			this.requestSite = localTarget( activeSite.path, activeSite.name );
		}
		if ( this.requestSite ) {
			this.allowed.add( this.requestSite.key );
		}
	}

	// The confirmation a change to another site needs, if any. Call `allow`
	// once the user agrees.
	async confirmationFor(
		toolName: string,
		params: unknown
	): Promise< { confirmation: Confirmation; allow: () => void } | undefined > {
		if ( toolName === 'site_create' ) {
			const name = ( params as { name?: unknown } | undefined )?.name;
			if ( ! this.requestSite || this.newSitesAllowed ) {
				return undefined;
			}
			return {
				confirmation: {
					question: `Create a new site "${ String( name ) }"? This request is about ${
						this.requestSite.label
					}.`,
					consequence: `Builds on a new site instead of ${ this.requestSite.label }.`,
				},
				allow: () => {
					this.newSitesAllowed = true;
				},
			};
		}
		const target = await targetOf( toolName, params );
		if ( ! target || this.allowed.has( target.key ) ) {
			return undefined;
		}
		if ( ! this.requestSite ) {
			this.requestSite = target;
			this.allowed.add( target.key );
			return undefined;
		}
		return {
			confirmation: {
				question: `Also change ${ target.label }? This request is about ${ this.requestSite.label }.`,
				consequence: `Lets this request change ${ target.label } as well.`,
			},
			allow: () => this.allowed.add( target.key ),
		};
	}

	// The local sites the request may change, as absolute paths: none until it has one.
	localSitePaths(): string[] {
		return [ ...this.allowed ].filter( ( key ) => ! key.startsWith( 'wpcom:' ) );
	}

	// Sites the turn creates belong to the request.
	async created( siteName: string ): Promise< void > {
		try {
			const site = await resolveSite( siteName );
			const target = localTarget( site.path, site.name );
			this.requestSite ??= target;
			this.allowed.add( target.key );
		} catch {
			// Creation failed; nothing to allow.
		}
	}
}
