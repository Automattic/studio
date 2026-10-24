/**
 * What is still wrong on the sites an agent changed, checked when it ends its
 * turn: the block validation problems its calls were told about and has not
 * fixed since, and site state that only shows once every call is done, such as
 * a front page whose content WordPress never renders.
 *
 * Each problem is raised once, so the agent decides what to do with it: fix
 * it, or tell the user why it stays.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import {
	FRONT_PAGE_TEMPLATE,
	frontPageTemplateProblem,
	rendersPageContent,
} from 'cli/ai/front-page-template';
import { readSavedCopies } from 'cli/ai/saved-copies';
import { readWordPressSite } from 'cli/ai/site-database';
import { studioMessage } from 'cli/ai/studio-message';

interface OpenProblemsState {
	// The sites changed, whose state is checked at the end of the turn.
	sites: string[];
	// The latest problem of each file or post validated, while it has one.
	open: Record< string, string >;
	raised: string[];
}

export class OpenProblems {
	private readonly state: OpenProblemsState = { sites: [], open: {}, raised: [] };

	constructor(
		private readonly siteChecks: Array< ( sitePath: string ) => Promise< string | undefined > > = [
			unrenderedFrontPage,
		]
	) {}

	/** Records the latest validation of a site's file or post, open while it has a problem. */
	record( site: string, key: string, problem?: string ): void {
		if ( ! this.state.sites.includes( site ) ) {
			this.state.sites.push( site );
		}
		if ( problem ) {
			this.state.open[ key ] = problem;
		} else {
			delete this.state.open[ key ];
		}
	}

	/** The open problems not raised before, which are raised now. */
	async raise(): Promise< string[] > {
		const siteProblems = await Promise.all(
			this.state.sites.flatMap( ( site ) =>
				this.siteChecks.map( ( check ) => check( site ).catch( () => undefined ) )
			)
		);
		const problems = [ ...Object.values( this.state.open ), ...siteProblems ].filter(
			( problem ): problem is string => !! problem && ! this.state.raised.includes( problem )
		);
		this.state.raised.push( ...problems );
		return problems;
	}
}

/**
 * The message that continues a turn with open problems. It reaches the model
 * in the user's role, so it is tagged as Studio's, the way Pi tags the
 * summaries it adds; the user does not see it.
 */
export function describeOpenProblems( problems: string[] ): string {
	return (
		studioMessage( 'checks', [
			'Studio checked the sites this turn changed:',
			...problems.map( ( problem ) => `- ${ problem }` ),
		] ) ?? ''
	);
}

const bySession = new WeakMap< object, OpenProblems >();

/** The open problems of an agent session, kept across its turns. */
export function getOpenProblems( session: object ): OpenProblems {
	let open = bySession.get( session );
	if ( ! open ) {
		open = new OpenProblems();
		bySession.set( session, open );
	}
	return open;
}

/**
 * A front-page template of the active theme that renders no page's content,
 * which WordPress shows at the front page whatever Settings → Reading picks
 * (front-page-template.ts).
 */
export async function unrenderedFrontPage( sitePath: string ): Promise< string | undefined > {
	const state = await readWordPressSite( sitePath, ( site ) => {
		const saved = readSavedCopies( site ).find(
			( copy ) => copy.postType === 'wp_template' && copy.slug === 'front-page'
		);
		const post = ( id: number ) =>
			site.query< { title: string; content: string } >(
				`SELECT post_title AS title, post_content AS content FROM ${ site.prefix }posts WHERE ID = ?`,
				id
			)[ 0 ];
		const pageId =
			site.option( 'show_on_front' ) === 'page' ? Number( site.option( 'page_on_front' ) ) : 0;
		return {
			frontPage: pageId ? `page ${ pageId } "${ post( pageId )?.title ?? '' }"` : undefined,
			saved: saved && { id: saved.id, content: post( saved.id )?.content ?? '' },
			themes: [ ...new Set( [ site.option( 'stylesheet' ), site.option( 'template' ) ] ) ].filter(
				( theme ): theme is string => typeof theme === 'string' && theme !== ''
			),
		};
	} );
	if ( ! state ) {
		return undefined;
	}
	const themeDirs = state.themes.map( ( theme ) =>
		path.join( sitePath, 'wp-content', 'themes', theme )
	);
	let template = state.saved?.content;
	let source = `the front-page template saved in the Site Editor (post ${ state.saved?.id })`;
	for ( const theme of state.saved ? [] : state.themes ) {
		const file = `wp-content/themes/${ theme }/${ FRONT_PAGE_TEMPLATE }`;
		template = await readFile( path.join( sitePath, file ), 'utf8' ).catch( () => undefined );
		source = file;
		if ( template !== undefined ) {
			break;
		}
	}
	if ( template === undefined || ( await rendersPageContent( template, themeDirs ) ) !== false ) {
		return undefined;
	}
	return frontPageTemplateProblem( source, state.frontPage );
}
