/**
 * Whether the forms a visitor fills in on the pages a turn changed store or
 * send what the visitor typed. The harness tells the agent Jetpack Forms saves
 * every submission, and in eval30 pivot an agent hand-tested its form with
 * curl, posting without the fields Jetpack's form sends, found nothing saved,
 * and said submissions "are captured and emailed".
 *
 * As the turn ends, on a site whose pages, templates, parts or active PHP the
 * turn changed, Studio loads the pages it changed (each published page, when
 * a template, part or code changed), and sends each distinct visitor's form on
 * them once from its browser as a visitor does (form-submission.ts): then the
 * rows of the site's database and the emails Studio saved that hold what was
 * typed are what WordPress stored or sent, and Studio deletes the rows and
 * emails the test added, so the user's site keeps no test data. A form that
 * stores nowhere, or that the browser or the page's script will not send, is
 * a problem of the turn; one that stores is said nothing of.
 */
import { readdir, stat, unlink } from 'fs/promises';
import path from 'path';
import { getSiteEmailDirectory } from '@studio/common/sites/site-email';
import { getSharedBrowser } from '@studio/agent/node/browser-utils';
import {
	markedEmails,
	markedRows,
	sendForm,
	tableMarks,
	visitorForms,
} from '@studio/agent/node/form-submission';
import { activePlugins } from '@studio/agent/node/plugins';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { RENDERED_TYPES } from '@studio/agent/node/site-markup';
import { activeThemes, themesDir } from '@studio/agent/node/themes';
import { wpEvalJson } from '@studio/agent/node/tools/utils';
import type { FormSend, MarkedRow, PageForm } from '@studio/agent/node/form-submission';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { OpenProblems } from '@studio/agent/node/open-problems';
import type { Page } from 'playwright';

const KEY = 'visitor forms';
// The pages loaded when a template, part or code changed: a site's own pages.
const MAX_PAGES = 8;
// The forms sent in one check.
const MAX_FORMS = 4;

/** A form's outcome on the pages it shows on. */
interface Finding {
	form: string;
	text: string;
}

interface PageFindings {
	address: string;
	found: Finding[];
}

/** What the turn changed on a site since `since`. */
interface Changes {
	// A template, part, pattern, menu or the active code changed: every page.
	all: boolean;
	// The URLs of the published pages and posts changed.
	urls: string[];
	// Each page's URL, for `all`.
	pages: string[];
	code: string;
}

// A time as WordPress writes a post's post_modified_gmt, to the second.
const gmt = ( ms: number ) => new Date( ms ).toISOString().slice( 0, 19 ).replace( 'T', ' ' );

// Whether a file under `dir` that `wanted` keeps changed since `since`.
async function changedUnder(
	dir: string,
	wanted: ( name: string ) => boolean,
	since: number
): Promise< boolean > {
	const folders = [ dir ];
	for ( let folder = folders.pop(); folder !== undefined; folder = folders.pop() ) {
		const entries = await readdir( folder, { withFileTypes: true } ).catch( () => [] );
		for ( const entry of entries ) {
			const at = path.join( folder, entry.name );
			if ( entry.isDirectory() ) {
				if ( entry.name !== 'node_modules' ) {
					folders.push( at );
				}
			} else if (
				entry.isFile() &&
				wanted( entry.name ) &&
				( await stat( at ).catch( () => ( { mtimeMs: 0 } ) ) ).mtimeMs >= since
			) {
				return true;
			}
		}
	}
	return false;
}

async function changesSince(
	sitePath: string,
	siteUrl: string,
	since: number,
	lastCode: string | undefined
): Promise< Changes > {
	const home = `${ siteUrl.replace( /\/$/, '' ) }/`;
	const state = await readWordPressSite( sitePath, ( site ) => {
		const front =
			site.option( 'show_on_front' ) === 'page' ? Number( site.option( 'page_on_front' ) ) : 0;
		const url = ( post: { id: number; type: string } ) =>
			post.id === front
				? home
				: `${ home }?${ post.type === 'page' ? 'page_id' : 'p' }=${ post.id }`;
		const changed = site.query< { id: number; type: string; status: string } >(
			`SELECT ID AS id, post_type AS type, post_status AS status FROM ${
				site.prefix
			}posts WHERE post_type IN (${ RENDERED_TYPES.map( () => '?' ).join(
				', '
			) }) AND post_modified_gmt >= ?`,
			...RENDERED_TYPES,
			gmt( since )
		);
		const pages = site
			.query< { id: number } >(
				`SELECT ID AS id FROM ${ site.prefix }posts WHERE post_type = 'page' AND post_status = 'publish' ORDER BY ID`
			)
			.filter( ( { id } ) => id !== front )
			.map( ( { id } ) => url( { id, type: 'page' } ) );
		return {
			themes: activeThemes( site ),
			plugins: activePlugins( site ),
			code: JSON.stringify( [ activePlugins( site ), activeThemes( site ) ] ),
			templates: changed.some( ( post ) => post.type !== 'page' && post.type !== 'post' ),
			urls: changed
				.filter(
					( post ) => ( post.type === 'page' || post.type === 'post' ) && post.status === 'publish'
				)
				.map( url ),
			pages: [ home, ...pages ].slice( 0, MAX_PAGES ),
		};
	} );
	const content = path.join( sitePath, 'wp-content' );
	const code =
		( lastCode !== undefined && lastCode !== state.code ) ||
		state.templates ||
		( await Promise.all( [
			...state.themes.map( ( theme ) =>
				changedUnder(
					themesDir( sitePath, theme ),
					( name ) => /\.(php|html)$/.test( name ),
					since
				)
			),
			...state.plugins.map( ( plugin ) =>
				plugin.includes( '/' )
					? changedUnder(
							path.join( content, 'plugins', path.dirname( plugin ) ),
							( name ) => name.endsWith( '.php' ),
							since
					  )
					: changedUnder( path.join( content, 'plugins' ), ( name ) => name === plugin, since )
			),
			changedUnder(
				path.join( content, 'mu-plugins' ),
				( name ) => name.endsWith( '.php' ),
				since
			),
		] ).then( ( found ) => found.some( Boolean ) ) );
	return { all: code, urls: state.urls, pages: state.pages, code: state.code };
}

// Deletes what a test submission added: posts, comments and users through
// WordPress, so their meta goes with them, and meta, options and other rows.
const REMOVE = `$failed = array();
foreach ( $data['posts'] as $id ) {
	if ( ! wp_delete_post( (int) $id, true ) ) { $failed[] = "post $id"; }
}
foreach ( $data['comments'] as $id ) {
	if ( ! wp_delete_comment( (int) $id, true ) ) { $failed[] = "comment $id"; }
}
if ( $data['users'] ) {
	require_once ABSPATH . 'wp-admin/includes/user.php';
	foreach ( $data['users'] as $id ) {
		if ( ! wp_delete_user( (int) $id ) ) { $failed[] = "user $id"; }
	}
}
foreach ( $data['meta'] as $meta ) {
	if ( ! delete_metadata_by_mid( $meta['type'], (int) $meta['mid'] ) ) { $failed[] = "{$meta['type']} meta {$meta['mid']}"; }
}
foreach ( $data['options'] as $name ) {
	if ( ! delete_option( $name ) ) { $failed[] = "option $name"; }
}
global $wpdb;
foreach ( $data['rows'] as $row ) {
	if ( ! $wpdb->delete( $row['table'], array( $row['column'] => $row['value'] ) ) ) { $failed[] = "a row of {$row['table']}"; }
}
// Jetpack counts the unread responses it shows in its menu.
$forms = 'Automattic\\Jetpack\\Forms\\ContactForm\\Contact_Form_Plugin';
if ( $data['posts'] && is_callable( array( $forms, 'recalculate_unread_count' ) ) ) {
	$forms::recalculate_unread_count();
}
echo wp_json_encode( array( 'failed' => $failed ) );`;

const META = /(post|comment|user|term)meta$/;

// Where a row is, as a sentence names it.
function place( row: MarkedRow, prefix: string ): string {
	const kind = row.table.slice( prefix.length );
	if ( row.postType ) return `the ${ row.postType } post ${ row.key?.value ?? '' }`.trim();
	if ( row.optionName ) return `option ${ row.optionName }`;
	if ( row.metaKey !== undefined ) return `${ kind.replace( /meta$/, '' ) } meta ${ row.metaKey }`;
	return `a row of ${ row.table }`;
}

/**
 * Removes the rows and emails a test added, and says what of the test is left:
 * rows that held other content before it, and what could not be removed.
 */
async function removeTest(
	host: StudioAgentHost,
	site: HostSite,
	rows: MarkedRow[],
	emails: string[]
): Promise< string[] > {
	const prefix = await readWordPressSite( site.path, ( wp ) => wp.prefix );
	const added = rows.filter( ( row ) => row.created );
	const id = ( row: MarkedRow ) => Number( row.key?.value );
	const of = ( kind: string ) => added.filter( ( row ) => row.table === `${ prefix }${ kind }` );
	const posts = of( 'posts' ).map( id );
	const comments = of( 'comments' ).map( id );
	const users = of( 'users' ).map( id );
	const gone = { post: posts, comment: comments, user: users, term: [] as number[] };
	const meta = added
		.filter( ( row ) => META.test( row.table ) && row.key )
		.map( ( row ) => ( {
			type: row.table.match( META )![ 1 ] as keyof typeof gone,
			mid: id( row ),
			object: row.objectId ?? 0,
		} ) )
		.filter( ( row ) => ! gone[ row.type ].includes( row.object ) );
	const options = of( 'options' ).map( ( row ) => row.optionName! );
	const core = new Set(
		[
			'posts',
			'comments',
			'users',
			'options',
			'postmeta',
			'commentmeta',
			'usermeta',
			'termmeta',
		].map( ( kind ) => `${ prefix }${ kind }` )
	);
	const other = added.filter( ( row ) => ! core.has( row.table ) );
	const left = [
		...rows
			.filter( ( row ) => ! row.created )
			.map( ( row ) => `${ place( row, prefix ) }, which held other content before the test` ),
		...other
			.filter( ( row ) => ! row.key )
			.map( ( row ) => `${ place( row, prefix ) }, a table with no single-column key` ),
	];
	const data = {
		posts,
		comments,
		users,
		meta,
		options,
		rows: other
			.filter( ( row ) => row.key )
			.map( ( row ) => ( { table: row.table, column: row.key!.column, value: row.key!.value } ) ),
	};
	if ( Object.values( data ).some( ( list ) => list.length ) ) {
		const { failed } = await wpEvalJson< { failed: string[] } >( host, site, REMOVE, data ).catch(
			( error: unknown ) => ( {
				failed: [ `the rows it added (${ error instanceof Error ? error.message : error })` ],
			} )
		);
		left.push( ...failed.map( ( what ) => `${ what }, which Studio could not delete` ) );
	}
	await Promise.all(
		emails.map( ( file ) =>
			unlink( file ).catch( () =>
				left.push( `the email ${ file }, which Studio could not delete` )
			)
		)
	);
	return left;
}

// A read of the site's database, again while the site's server writes to it.
async function unlocked< T >( read: () => Promise< T > ): Promise< T > {
	for ( let tries = 1; ; tries++ ) {
		try {
			return await read();
		} catch ( error ) {
			if ( tries >= 20 || ! /locked|busy/i.test( String( error ) ) ) {
				throw error;
			}
			await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );
		}
	}
}

// WordPress.com, which takes a Jetpack form's submission only from a connected site.
const WPCOM = /(^|\.)(wordpress\.com|wp\.com|jetpack\.com)(:\d+)?$/;

/** What the outcome of a form depends on of the site. */
interface SiteState {
	// Akismet is active, which hooks jetpack_contact_form_is_spam.
	akismet: boolean;
	// Jetpack is connected to WordPress.com.
	connected: boolean;
}

const quote = ( text: string ) => `"${ text.replace( /\s+/g, ' ' ).trim() }"`;

const typedList = ( send: FormSend ) =>
	send.typed.length
		? `Studio typed ${ send.typed
				.map( ( { field, value } ) => `${ field || 'a field' } ${ quote( value ) }` )
				.join( ', ' ) }.`
		: 'The form has no field Studio could type into.';

/** What a sent form's outcome says, or undefined when it stored what was typed. */
function outcome(
	form: PageForm,
	send: FormSend,
	rows: MarkedRow[],
	emails: string[],
	emailDir: string | undefined,
	{ akismet, connected }: SiteState
): string | undefined {
	if ( ! send.sent ) {
		if ( send.offSite && WPCOM.test( send.offSite ) && ! connected ) {
			return `it sends to ${ send.offSite }, which takes a submission only from a site connected to WordPress.com, and this site is not connected (no Jetpack connection in jetpack_options), so a visitor's submission goes nowhere; Studio did not send it.`;
		}
		if ( send.offSite ) {
			// It sends to another site, which Studio does not send test data to.
			return undefined;
		}
		const { refusal } = send;
		if ( refusal?.by === 'browser' ) {
			return `the browser did not send it; its ${ quote(
				refusal.field || 'unnamed'
			) } field fails the constraints its markup sets (HTMLFormElement.checkValidity()), and the browser showed ${ quote(
				refusal.message
			) }. ${ typedList( send ) }`;
		}
		if ( refusal ) {
			return `the page's script kept it from sending and showed ${ quote( refusal.message ) }${
				form.jetpack
					? ', as Jetpack Forms checks each field in the browser before it sends (jetpack-forms/dist/modules/form/view.js)'
					: ''
			}. ${ typedList( send ) }`;
		}
		return `pressing its button sent nothing to the site, and the page showed no message. ${ typedList(
			send
		) }`;
	}
	const then = send.appeared
		? `The page then read: ${ quote( send.appeared ) }.`
		: 'The page then showed nothing new.';
	const answered =
		send.status && send.status >= 400 ? ` The site answered HTTP ${ send.status }.` : '';
	if ( ! rows.length && ! emails.length ) {
		return `WordPress stored what was typed nowhere; no post of any type, post meta, option, comment or other row of the site's database holds it, and the site sent no email (Studio saves each one wp_mail() sends${
			emailDir ? '' : ', but found no email folder for this site'
		}).${ answered } ${ then }`;
	}
	// Kept only as a post WordPress or Jetpack holds back from the site's
	// responses: spam, trashed, or one Jetpack keeps only to send.
	const held = rows.filter(
		( row ) => row.postType && [ 'spam', 'trash', 'jp-temp-feedback' ].includes( row.postStatus! )
	);
	if (
		! emails.length &&
		held.length &&
		rows.every( ( row ) => ! row.postType || held.includes( row ) )
	) {
		const { postType, postStatus } = held[ 0 ];
		if ( form.jetpack ) {
			const why =
				postStatus === 'spam'
					? `as the jetpack_contact_form_is_spam filter judged it spam (Contact_Form_Plugin::is_spam_blocklist()${
							akismet ? ', and is_spam_akismet() with Akismet active' : ''
					  }), and Jetpack emails no spam (grunion_still_email_spam)`
					: postStatus === 'trash'
					? "as it matched the site's Disallowed Comment Keys (disallowed_keys, Contact_Form_Plugin::is_in_disallowed_list()), and sent no email for it"
					: "as the form's saveResponses is no, and no email was sent for it";
			return `Jetpack saved it only as a ${ postType } post with status ${ postStatus }, ${ why }. ${ then }`;
		}
		return `WordPress stored it only as a ${ postType } post with status ${ postStatus }, and the site sent no email. ${ then }`;
	}
	return undefined;
}

const pageAddress = ( url: string ) => {
	const { pathname, search } = new URL( url );
	return pathname + search;
};

export class FormCheck {
	// The sites calls changed since the last check.
	private readonly marked = new Set< string >();
	// Each site's last check, and the code it ran then.
	private readonly since = new Map< string, number >();
	private readonly code = new Map< string, string >();
	private readonly from = Date.now();
	// The findings of each site's forms, by the URL of the page they were found
	// on, with the page's address as it loaded.
	private readonly findings = new Map< string, Map< string, PageFindings > >();

	constructor(
		private readonly host: StudioAgentHost,
		private readonly open?: OpenProblems,
		private readonly newPage: () => Promise< Page > = async () =>
			( await getSharedBrowser() ).newPage( { viewport: { width: 1280, height: 900 } } )
	) {}

	/** After a call that can change a site. */
	changed( sitePath: string ): void {
		this.marked.add( path.resolve( sitePath ) );
	}

	/** As the turn ends: the forms on what the calls changed on each site, sent once. */
	async check(): Promise< void > {
		const sites = [ ...this.marked ];
		this.marked.clear();
		await Promise.all(
			sites.map( ( sitePath ) => this.checkSite( sitePath ).catch( () => undefined ) )
		);
	}

	private async checkSite( sitePath: string ): Promise< void > {
		const startedAt = Date.now();
		const site = await this.host.sites.findByFolder( sitePath );
		if ( ! site || ! ( await this.host.sites.isRunning( site ).catch( () => false ) ) ) {
			return;
		}
		const changes = await changesSince(
			sitePath,
			site.url,
			this.since.get( sitePath ) ?? this.from,
			this.code.get( sitePath )
		);
		this.since.set( sitePath, startedAt );
		this.code.set( sitePath, changes.code );
		const urls = [
			...new Set( changes.all ? [ ...changes.pages, ...changes.urls ] : changes.urls ),
		];
		if ( ! urls.length ) {
			return;
		}
		// The pages whose markup has a form a visitor can type into, as a quick read finds them.
		const withForms = (
			await Promise.all(
				urls.map( async ( url ) => {
					const html = await fetch( url, { signal: AbortSignal.timeout( 15000 ) } )
						.then( ( response ) => response.text() )
						.catch( () => '' );
					return /<form\b/i.test( html ) && /<(textarea|input)\b/i.test( html ) ? [ url ] : [];
				} )
			)
		).flat();
		const findings = this.findings.get( sitePath ) ?? new Map< string, PageFindings >();
		const had = findings.size > 0;
		this.findings.set( sitePath, findings );
		urls.forEach( ( url ) => findings.delete( url ) );
		if ( withForms.length ) {
			await this.sendForms( site, withForms, findings );
		}
		if ( had || findings.size ) {
			this.record( site, findings );
		}
	}

	private async sendForms(
		site: HostSite,
		urls: string[],
		findings: Map< string, PageFindings >
	): Promise< void > {
		let emailDir: string | undefined;
		try {
			emailDir = getSiteEmailDirectory( site.id );
		} catch {
			// A site id that names no folder of Studio's has no saved email.
		}
		const state = await unlocked( () =>
			readWordPressSite( site.path, ( wp ): SiteState => {
				const jetpack = wp.option( 'jetpack_options' ) as Record< string, unknown > | undefined;
				return {
					akismet: activePlugins( wp ).includes( 'akismet/akismet.php' ),
					connected: !! jetpack?.id,
				};
			} )
		);
		// Each distinct form's finding, sent once however many pages show it.
		const sent = new Map< string, Finding | undefined >();
		for ( const url of urls ) {
			let page = await this.newPage();
			try {
				await page.goto( url, { waitUntil: 'load', timeout: 30000 } );
				const address = pageAddress( page.url() );
				const forms = ( await visitorForms( page ) ).filter( ( form ) => form.visitor );
				const found: Finding[] = [];
				let fresh = true;
				for ( const form of forms ) {
					if ( ! sent.has( form.signature ) ) {
						if ( sent.size >= MAX_FORMS ) {
							continue;
						}
						if ( ! fresh ) {
							await page.close();
							page = await this.newPage();
							await page.goto( url, { waitUntil: 'load', timeout: 30000 } );
						}
						fresh = false;
						sent.set(
							form.signature,
							await this.sendOne( site, page, form, emailDir, state ).catch( () => undefined )
						);
					}
					const finding = sent.get( form.signature );
					if ( finding ) {
						found.push( finding );
					}
				}
				if ( found.length ) {
					findings.set( url, { address, found } );
				}
			} catch {
				// A page that does not load is the render check's to report.
			} finally {
				await page.close().catch( () => undefined );
			}
		}
	}

	private async sendOne(
		site: HostSite,
		page: Page,
		form: PageForm,
		emailDir: string | undefined,
		state: SiteState
	): Promise< Finding | undefined > {
		const marker = `studio-test-${ Date.now().toString( 36 ) }${ Math.random()
			.toString( 36 )
			.slice( 2, 8 ) }`;
		const marks = await unlocked( () => tableMarks( site.path ) );
		const send = await sendForm( page, page.locator( 'form' ).nth( form.index ), marker );
		const rows = await unlocked( () => markedRows( site.path, marker, marks ) );
		const emails = emailDir ? await markedEmails( emailDir, marker ) : [];
		const left = await removeTest( this.host, site, rows, emails );
		const name = `the form${ form.button ? ` whose button reads ${ quote( form.button ) }` : '' }${
			form.jetpack ? ' (Jetpack Forms)' : ''
		}`;
		// The page and its messages quote what was typed as the visitor reads it.
		const scrubbed = JSON.parse(
			JSON.stringify( send )
				.split( `${ marker }@example.com` )
				.join( 'a test address' )
				.split( marker )
				.join( 'a test message' )
		) as FormSend;
		const text = [
			outcome( form, scrubbed, rows, emails, emailDir, state ),
			left.length
				? `The test submission stays in ${ left.join(
						'; '
				  ) }; Studio deletes only the rows and emails a test adds.`
				: undefined,
		]
			.filter( Boolean )
			.join( ' ' );
		return text ? { form: name, text } : undefined;
	}

	// The site's findings as one problem, each form's once with the pages showing it.
	private record( site: HostSite, findings: Map< string, PageFindings > ): void {
		const byForm = new Map< string, { finding: Finding; pages: string[] } >();
		for ( const { address, found } of findings.values() ) {
			for ( const finding of found ) {
				const key = `${ finding.form }\n${ finding.text }`;
				const entry = byForm.get( key ) ?? { finding, pages: [] };
				entry.pages.push( address );
				byForm.set( key, entry );
			}
		}
		const lines = [ ...byForm.values() ].map(
			( { finding, pages } ) => `- ${ pages.join( ', ' ) }, ${ finding.form }: ${ finding.text }`
		);
		this.open?.record(
			site.path,
			`${ site.path }#${ KEY }`,
			lines.length
				? [
						'Studio filled in the forms a visitor sends on the pages this turn changed, and sent each once from its browser, as a visitor does, after the last change:',
						...lines,
				  ].join( '\n' )
				: undefined,
			false,
			lines
		);
	}
}
