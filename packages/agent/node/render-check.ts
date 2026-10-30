/**
 * Studio renders the pages a session's calls changed, as a visitor's browser
 * loads them at desktop and mobile, and states what it found: what is broken
 * on them, or that nothing is. An agent that would otherwise screenshot each
 * page at each viewport to learn whether it works, and again after each fix,
 * hears it on its next call.
 *
 * A call that changes what a site renders (its theme's files, its posts, the
 * options that choose them) starts a render of the site's front page and
 * published pages in the background; a render a later change makes stale is
 * dropped, and the site is rendered again. What the site had as Studio first
 * saw it is the user's site as it was, not the session's to raise, as
 * OpenProblems keeps a site's problems as first seen.
 */
import { createHash } from 'crypto';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { readVersions } from '@studio/agent/node/post-content-check';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { forgetRenders, inspectPage, VIEWPORTS } from '@studio/agent/node/tools/screenshot-helpers';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { OpenProblems } from '@studio/agent/node/open-problems';
import type { PageInspection } from '@studio/agent/node/tools/screenshot-helpers';

// The front page and the first published pages: a site's own pages, not a shop's catalogue.
const MAX_PAGES = 6;
// Page loads at once, so a render does not take the machine from the agent.
const CONCURRENCY = 4;

type Viewport = keyof typeof VIEWPORTS;
type Inspect = ( url: string, viewport: Viewport ) => Promise< PageInspection >;

interface PageResult {
	url: string;
	viewport: Viewport;
	problems: string[];
}

interface SiteState {
	// What the site renders from, as last read.
	fingerprint: string;
	// The problems of the site as first seen, by page and kind.
	firstSeen: Promise< Set< string > >;
	running?: Promise< void >;
	again: boolean;
	verdict?: string;
}

// A problem by page, viewport and kind, without the measures that move as the page changes.
const problemKey = ( page: { url: string; viewport: Viewport }, problem: string ) =>
	`${ new URL( page.url ).pathname } ${ page.viewport } ${ problem.replace( /\d+/g, '#' ) }`;

export class RenderCheck {
	private readonly sites = new Map< string, SiteState >();

	constructor(
		private readonly host: StudioAgentHost,
		private readonly open?: OpenProblems,
		private readonly inspect: Inspect = ( url, viewport ) =>
			inspectPage( url, VIEWPORTS[ viewport ] )
	) {}

	/**
	 * Before a call on a site: the first time, renders the site as it is, whose
	 * problems are the user's, and waits for it, so the call changes nothing it
	 * renders first. A site the session created had none. A turn starts this
	 * for its active site, so its first call seldom waits.
	 */
	async seen( sitePath: string, { created = false }: { created?: boolean } = {} ): Promise< void > {
		const known = this.sites.get( sitePath );
		if ( known ) {
			await known.firstSeen;
			return;
		}
		const state: SiteState = {
			fingerprint: '',
			firstSeen: Promise.resolve( new Set() ),
			again: false,
		};
		state.firstSeen = ( async () => {
			state.fingerprint = await fingerprint( sitePath );
			const pages = created ? [] : await this.render( sitePath ).catch( () => undefined );
			return new Set(
				( pages ?? [] ).flatMap( ( page ) =>
					page.problems.map( ( problem ) => problemKey( page, problem ) )
				)
			);
		} )();
		this.sites.set( sitePath, state );
		await state.firstSeen;
	}

	/** After a call on a site: renders it again when what it renders from changed. */
	async changed( sitePath: string ): Promise< void > {
		const state = this.sites.get( sitePath );
		if ( ! state ) {
			return this.seen( sitePath );
		}
		await state.firstSeen;
		const now = await fingerprint( sitePath );
		if ( now === state.fingerprint ) {
			return;
		}
		state.fingerprint = now;
		forgetRenders();
		if ( state.running ) {
			state.again = true;
			return;
		}
		const run = async () => {
			try {
				do {
					state.again = false;
					await this.check( sitePath, state ).catch( () => undefined );
				} while ( state.again );
			} finally {
				state.running = undefined;
			}
		};
		state.running = run();
	}

	/** The verdicts that have come since the last call, each once. */
	takeReports(): string {
		const verdicts = [ ...this.sites.values() ].flatMap( ( state ) =>
			state.verdict ? [ state.verdict ] : []
		);
		this.sites.forEach( ( state ) => ( state.verdict = undefined ) );
		return verdicts.join( '\n' );
	}

	/** Waits for every render under way, as the turn ends. */
	async settle(): Promise< void > {
		await Promise.all( [ ...this.sites.values() ].map( ( state ) => state.running ) );
	}

	private async check( sitePath: string, state: SiteState ): Promise< void > {
		const renderedFrom = state.fingerprint;
		const pages = await this.render( sitePath );
		if ( ! pages || state.fingerprint !== renderedFrom ) {
			return;
		}
		const firstSeen = await state.firstSeen;
		const found = pages.flatMap( ( page ) =>
			page.problems
				.filter( ( problem ) => ! firstSeen.has( problemKey( page, problem ) ) )
				.map(
					( problem ) => `- ${ new URL( page.url ).pathname } (${ page.viewport }): ${ problem }`
				)
		);
		const paths = [ ...new Set( pages.map( ( page ) => new URL( page.url ).pathname ) ) ];
		const rendered = `Studio rendered ${ paths.join(
			', '
		) } at desktop and mobile, as a visitor's browser loads them, after the last change`;
		const problem = found.length
			? [ `${ rendered }. What a visitor gets that the site did not have before:`, ...found ].join(
					'\n'
			  )
			: undefined;
		this.open?.record( sitePath, `${ sitePath }#rendered pages`, problem );
		state.verdict =
			problem ??
			`${ rendered }: each page loads, PHP prints no errors, every image loads, and nothing is wider than the screen${
				firstSeen.size ? ', past what the site had before' : ''
			}.`;
	}

	// Each page at each viewport, while the site's server runs.
	private async render( sitePath: string ): Promise< PageResult[] | undefined > {
		const site = await this.host.sites.findByFolder( sitePath );
		if ( ! site || ! ( await this.host.sites.isRunning( site ).catch( () => false ) ) ) {
			return undefined;
		}
		const urls = await pageUrls( sitePath, site.url );
		const jobs = urls.flatMap( ( url ) =>
			( Object.keys( VIEWPORTS ) as Viewport[] ).map( ( viewport ) => ( { url, viewport } ) )
		);
		const results: PageResult[] = [];
		let taken = 0;
		const next = async (): Promise< void > => {
			const at = taken++;
			const job = jobs[ at ];
			if ( ! job ) {
				return;
			}
			const inspection = await this.inspect( job.url, job.viewport ).catch(
				( error: unknown ) => ( {
					url: job.url,
					problems: [
						`The page did not load: ${ error instanceof Error ? error.message : error }.`,
					],
				} )
			);
			results[ at ] = { ...inspection, viewport: job.viewport };
			return next();
		};
		await Promise.all( Array.from( { length: CONCURRENCY }, next ) );
		return results;
	}
}

// The front page, then the published pages the front page is not.
async function pageUrls( sitePath: string, siteUrl: string ): Promise< string[] > {
	const home = `${ siteUrl.replace( /\/$/, '' ) }/`;
	const pages = await readWordPressSite( sitePath, ( site ) =>
		site
			.query< { id: number } >(
				`SELECT ID AS id FROM ${ site.prefix }posts WHERE post_type = 'page' AND post_status = 'publish' ORDER BY ID`
			)
			.map( ( { id } ) => id )
			.filter(
				( id ) =>
					! (
						site.option( 'show_on_front' ) === 'page' &&
						Number( site.option( 'page_on_front' ) ) === id
					)
			)
	).catch( () => [] as number[] );
	return [ home, ...pages.map( ( id ) => `${ home }?page_id=${ id }` ) ].slice( 0, MAX_PAGES );
}

// What a site renders from: its posts, the options that choose its theme,
// front page and plugins, and every file of its active themes.
async function fingerprint( sitePath: string ): Promise< string > {
	const options = await readWordPressSite( sitePath, ( site ) =>
		[ 'template', 'stylesheet', 'show_on_front', 'page_on_front', 'active_plugins' ].map(
			( name ) => JSON.stringify( site.option( name ) ?? null )
		)
	).catch( () => [] as string[] );
	const themes = [ ...new Set( options.slice( 0, 2 ).map( ( value ) => JSON.parse( value ) ) ) ]
		.filter( ( theme ): theme is string => typeof theme === 'string' && theme !== '' )
		.map( ( theme ) => path.join( sitePath, 'wp-content', 'themes', theme ) );
	const files = ( await Promise.all( themes.map( fileVersions ) ) ).flat();
	return createHash( 'sha256' )
		.update(
			JSON.stringify( [ options, await readVersions( sitePath ).catch( () => ( {} ) ), files ] )
		)
		.digest( 'hex' );
}

async function fileVersions( dir: string ): Promise< string[] > {
	const entries = await readdir( dir, { recursive: true, withFileTypes: true } ).catch( () => [] );
	return Promise.all(
		entries
			.filter( ( entry ) => entry.isFile() )
			.map( async ( entry ) => {
				const file = path.join( entry.parentPath, entry.name );
				const { mtimeMs, size } = await stat( file ).catch( () => ( { mtimeMs: 0, size: 0 } ) );
				return `${ file } ${ mtimeMs } ${ size }`;
			} )
	).then( ( versions ) => versions.sort() );
}
