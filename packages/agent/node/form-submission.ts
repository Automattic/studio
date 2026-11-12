/**
 * A form a visitor fills in on a page, sent once the way a visitor's browser
 * sends it, and where the site then holds what was typed: the rows of its
 * database that hold a marker typed into the form, and the emails Studio saved
 * for the site holding it. Studio's turn-end check of the forms a turn changed
 * (form-check.ts) and the eval's capture of a site's outcome
 * (apps/cli/ai/eval-outcome.ts) both send forms through here.
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from '@studio/agent/node/site-database';
import type { Locator, Page, Request } from 'playwright';

// What a visitor types into each kind of field.
const VISITOR: Record< string, string > = {
	text: 'Test Visitor',
	email: 'visitor@example.com',
	url: 'https://example.com',
	tel: '5555550100',
	number: '1',
};

// What a visitor types into a field, as the field asks for it: a date a month
// from now in a date field (a Jetpack date field is a text input whose
// data-format, as yy-mm-dd, its script checks), and a number within the
// field's min and max. A form whose script or browser checks the field
// otherwise refuses the visit before anything is sent (eval30 pivot: "Please
// enter a valid date.", "no less than 2").
export async function visitorValue( field: Locator ): Promise< string | undefined > {
	return field.evaluate( ( element: HTMLInputElement, visitor: Record< string, string > ) => {
		const type = ( element.getAttribute( 'type' ) || 'text' ).toLowerCase();
		const day = new Date( Date.now() + 30 * 24 * 60 * 60 * 1000 );
		const parts: Record< string, string > = {
			yy: String( day.getFullYear() ),
			mm: String( day.getMonth() + 1 ).padStart( 2, '0' ),
			dd: String( day.getDate() ).padStart( 2, '0' ),
		};
		const iso = `${ parts.yy }-${ parts.mm }-${ parts.dd }`;
		const within = ( value: string ) => {
			if ( element.min && value < element.min ) return element.min;
			if ( element.max && value > element.max ) return element.max;
			return value;
		};
		if ( type === 'date' ) return within( iso );
		if ( type === 'datetime-local' ) return within( `${ iso }T19:00` );
		if ( type === 'month' ) return within( iso.slice( 0, 7 ) );
		if ( type === 'time' ) return within( '19:00' );
		const format = element.getAttribute( 'data-format' );
		if ( type === 'text' && format && element.classList.contains( 'jp-contact-form-date' ) ) {
			return format.replace( /yy|mm|dd/g, ( part ) => parts[ part ] );
		}
		if ( type === 'number' ) {
			let value = 1;
			if ( element.min !== '' && Number( element.min ) > value ) value = Number( element.min );
			if ( element.max !== '' && Number( element.max ) < value ) value = Number( element.max );
			return String( value );
		}
		return visitor[ type ];
	}, VISITOR );
}

// The fields a visitor sees and fills, leaving out a spam trap a form hides
// from them: off the page, clipped to nothing, or hidden from assistive tech.
export async function seenFields( form: Locator, selector: string ) {
	const fields = await form.locator( selector ).all();
	const seen = await Promise.all(
		fields.map( ( field ) =>
			field.evaluate( ( element ) => {
				const box = element.getBoundingClientRect();
				if (
					element.closest( '[aria-hidden="true"]' ) ||
					box.right <= 0 ||
					box.left >= document.documentElement.scrollWidth
				) {
					return false;
				}
				for ( let parent = element.parentElement; parent; parent = parent.parentElement ) {
					const style = getComputedStyle( parent );
					const clips = style.overflow !== 'visible' || style.clip !== 'auto';
					const rect = parent.getBoundingClientRect();
					if ( clips && ( rect.width < 2 || rect.height < 2 ) ) {
						return false;
					}
				}
				return true;
			} )
		)
	);
	return fields.filter( ( _, i ) => seen[ i ] );
}

/** A form on a page, as `visitorForms` finds it. */
export interface PageForm {
	// Its index among the page's forms (document.forms).
	index: number;
	// Whether a visitor sends it: it takes text (a textarea, a text or email
	// field), and is not a search, comment, login or account form.
	visitor: boolean;
	// Its action and field names, the same for one form shown on many pages.
	signature: string;
	// What its submit button reads.
	button: string;
	// A Jetpack Forms form (jetpack/contact-form), which carries Jetpack's signed jetpack_contact_form_jwt.
	jetpack: boolean;
}

/**
 * The page's forms. A visitor's form takes text: a textarea, or a text or
 * email field. Left out are a search form (role=search, a search field, core's
 * searchform and the Search block), core's comment form (wp-comments-post.php)
 * and login form (wp-login.php), a form with a password or register field, a
 * form a visitor does not see, and a query a form sends by GET with no message
 * or email field.
 */
export async function visitorForms( page: Page ): Promise< PageForm[] > {
	return page.$$eval( 'form', ( forms ) =>
		forms.map( ( form, index ) => {
			const fields = [ ...form.elements ] as HTMLInputElement[];
			const type = ( field: Element ) => ( field.getAttribute( 'type' ) || 'text' ).toLowerCase();
			const isInput = ( field: Element ) => field.tagName === 'INPUT';
			const message = fields.some( ( field ) => field.tagName === 'TEXTAREA' );
			const email = fields.some( ( field ) => isInput( field ) && type( field ) === 'email' );
			const text = fields.some( ( field ) => isInput( field ) && type( field ) === 'text' );
			const action = form.getAttribute( 'action' ) || '';
			const core =
				!! form.closest( '[role="search"]' ) ||
				form.matches( '.search-form, .searchform, .wp-block-search, #searchform' ) ||
				form.matches( '#commentform, .comment-form, #loginform' ) ||
				/wp-comments-post\.php|wp-login\.php/.test( action );
			const search = fields.some(
				( field ) => isInput( field ) && ( type( field ) === 'search' || field.name === 's' )
			);
			const account = fields.some(
				( field ) => type( field ) === 'password' || field.name === 'register'
			);
			const query =
				( form.getAttribute( 'method' ) || '' ).toLowerCase() === 'get' && ! message && ! email;
			const submit = form.querySelector< HTMLElement >(
				'button[type="submit"], input[type="submit"], button:not([type])'
			);
			let path = action;
			try {
				path = new URL( action || location.href, location.href ).pathname;
			} catch {
				// An action that is no URL is compared as written.
			}
			return {
				index,
				visitor:
					( message || email || text ) &&
					! core &&
					! search &&
					! account &&
					! query &&
					form.checkVisibility(),
				signature: `${ path } ${ fields
					.map( ( field ) => field.name )
					.filter( Boolean )
					.sort()
					.join( ' ' ) }`,
				button: ( ( submit as HTMLInputElement | null )?.value || submit?.innerText || '' ).trim(),
				jetpack: !! form.querySelector( 'input[name="jetpack_contact_form_jwt"]' ),
			};
		} )
	);
}

/** What a visitor typed into a field, by its label; the marker reads as "a test message" ("a test address" in an email field). */
export interface Typed {
	field: string;
	value: string;
}

/** A form sent as a visitor sends it. */
export interface FormSend {
	// Whether the browser sent it to the site: a page load, or a request other than GET.
	sent: boolean;
	// The HTTP status the site answered what was sent with.
	status?: number;
	// The host off the site the form sends to, which Studio does not send to.
	offSite?: string;
	// Why the form was not sent: the message the browser or the page's script showed.
	refusal?: { by: 'browser' | 'script'; message: string; field?: string };
	// The text the page showed after that it did not before.
	appeared: string;
	afterText: string;
	typed: Typed[];
}

// The label a visitor reads for a field.
async function labelOf( field: Locator ): Promise< string > {
	return field
		.evaluate( ( element: HTMLInputElement ) =>
			(
				element.labels?.[ 0 ]?.innerText ||
				element.getAttribute( 'aria-label' ) ||
				element.getAttribute( 'placeholder' ) ||
				element.name ||
				element.type ||
				''
			)
				.replace( /\s+/g, ' ' )
				.trim()
		)
		.catch( () => '' );
}

// The lines of `after` that `before` did not have.
function newLines( before: string, after: string ): string {
	const had = new Set( before.split( '\n' ).map( ( line ) => line.trim() ) );
	return after
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( ( line ) => line && ! had.has( line ) )
		.join( ' ' )
		.slice( 0, 300 );
}

/**
 * Fills in `form` as a visitor does and presses its submit button: `marker`
 * goes where the visitor's message goes, each textarea, or, with none, the
 * email field (as `marker@example.com`) or else the first text field; the
 * other fields as visitorValue() types them; checkboxes checked and each list's
 * first option picked. A request off the site is not sent. It then waits for
 * the page to settle, `minWaitMs` at least.
 */
export async function sendForm(
	page: Page,
	form: Locator,
	marker: string,
	{ minWaitMs = 0 }: { minWaitMs?: number } = {}
): Promise< FormSend > {
	const origin = new URL( page.url() ).origin;
	const typed: Typed[] = [];
	// The fields in the order a visitor reads them.
	const fields = await seenFields( form, 'textarea:visible, input:visible' );
	const kinds = await Promise.all(
		fields.map( ( field ) =>
			field.evaluate( ( element ) =>
				element.tagName === 'TEXTAREA'
					? 'textarea'
					: ( element.getAttribute( 'type' ) || 'text' ).toLowerCase()
			)
		)
	);
	// The fields the marker goes in: each textarea, or else the email field or the first text field.
	const marked = kinds.includes( 'textarea' )
		? kinds.map( ( kind ) => kind === 'textarea' )
		: kinds.map(
				( _, i ) =>
					i === ( kinds.includes( 'email' ) ? kinds.indexOf( 'email' ) : kinds.indexOf( 'text' ) )
		  );
	for ( const [ i, field ] of fields.entries() ) {
		const kind = kinds[ i ];
		if ( kind === 'checkbox' || kind === 'radio' ) {
			await field.check().catch( () => undefined );
			continue;
		}
		if ( marked[ i ] ) {
			await field.fill( kind === 'email' ? `${ marker }@example.com` : marker );
			typed.push( {
				field: await labelOf( field ),
				value: kind === 'email' ? 'a test address' : 'a test message',
			} );
			continue;
		}
		const value = await visitorValue( field );
		if ( value !== undefined ) {
			await field.fill( value ).catch( () => undefined );
			typed.push( { field: await labelOf( field ), value } );
		}
	}
	// A visitor picks an option of each list, the first that is not a placeholder.
	for ( const field of await seenFields( form, 'select:visible' ) ) {
		const value = await field.evaluate(
			( select: HTMLSelectElement ) =>
				[ ...select.options ].find( ( option ) => option.value && ! option.disabled )?.value
		);
		if ( value ) {
			await field.selectOption( value ).catch( () => undefined );
			typed.push( { field: await labelOf( field ), value } );
		}
	}

	let offSite: string | undefined;
	let sentRequest: Request | undefined;
	let inflight = 0;
	let quietFrom = Date.now();
	const offTheSite = ( request: Request ) =>
		new URL( request.url() ).origin !== origin &&
		( request.method() !== 'GET' || request.isNavigationRequest() );
	await page.route( '**/*', ( route ) => {
		const request = route.request();
		if ( offTheSite( request ) ) {
			offSite ??= new URL( request.url() ).host;
			return route.abort();
		}
		return route.fallback();
	} );
	const onRequest = ( request: Request ) => {
		inflight++;
		if (
			! sentRequest &&
			! offTheSite( request ) &&
			( request.method() !== 'GET' ||
				( request.isNavigationRequest() && request.frame() === page.mainFrame() ) )
		) {
			sentRequest = request;
		}
	};
	const onDone = () => {
		inflight = Math.max( 0, inflight - 1 );
		quietFrom = Date.now();
	};
	page.on( 'request', onRequest );
	page.on( 'requestfinished', onDone );
	page.on( 'requestfailed', onDone );
	const before = await page.innerText( 'body' ).catch( () => '' );
	// A visitor moves on from the last field, which closes what it opened, as
	// Jetpack's date picker over the button while its field has focus.
	await page.evaluate( () => ( document.activeElement as HTMLElement | null )?.blur() );
	try {
		const button = form
			.locator( 'button[type="submit"], input[type="submit"], button:not([type])' )
			.first();
		if ( await button.count() ) {
			await button.click( { timeout: 5000 } );
		} else {
			await form.evaluate( ( element: HTMLFormElement ) => element.requestSubmit() );
		}
		const from = Date.now();
		quietFrom = from;
		while ( Date.now() - from < 15000 ) {
			await page.waitForTimeout( 100 );
			const settled = inflight === 0 && Date.now() - quietFrom >= 500;
			if ( settled && Date.now() - from >= minWaitMs ) {
				break;
			}
		}
		await page.waitForLoadState( 'load' ).catch( () => undefined );
	} finally {
		page.off( 'request', onRequest );
		page.off( 'requestfinished', onDone );
		page.off( 'requestfailed', onDone );
	}
	const afterText = await page.innerText( 'body' ).catch( () => '' );
	const sent = sentRequest !== undefined;
	const status = sentRequest
		? ( await sentRequest.response().catch( () => null ) )?.status()
		: undefined;
	const refusal =
		sent || offSite
			? undefined
			: await form
					.evaluate( ( element: HTMLFormElement ) => {
						const label = ( field: HTMLInputElement ) =>
							(
								field.labels?.[ 0 ]?.innerText ||
								field.getAttribute( 'aria-label' ) ||
								field.getAttribute( 'placeholder' ) ||
								field.name ||
								''
							)
								.replace( /\s+/g, ' ' )
								.trim();
						if ( ! element.noValidate ) {
							const invalid = ( [ ...element.elements ] as HTMLInputElement[] ).find(
								( field ) => field.willValidate && ! field.checkValidity()
							);
							if ( invalid ) {
								return {
									by: 'browser' as const,
									message: invalid.validationMessage,
									field: label( invalid ),
								};
							}
						}
						// The innermost messages the page's script shows in the form.
						const shown = [
							...element.querySelectorAll< HTMLElement >(
								'[role="alert"], [aria-live], [class*="error"], [class*="invalid"]'
							),
						].filter(
							( node ) =>
								node.checkVisibility() &&
								node.innerText.trim() &&
								! node.querySelector( 'input, textarea, select' )
						);
						const messages = [
							...new Set(
								shown
									.filter(
										( node ) =>
											! shown.some( ( other ) => other !== node && node.contains( other ) )
									)
									.map( ( node ) => node.innerText.replace( /\s+/g, ' ' ).trim() )
							),
						];
						return messages.length
							? { by: 'script' as const, message: messages.join( ' / ' ).slice( 0, 300 ) }
							: undefined;
					} )
					.catch( () => undefined );
	return {
		sent,
		status,
		offSite,
		refusal,
		appeared: newLines( before, afterText ),
		afterText: afterText.slice( 0, 2000 ),
		typed,
	};
}

/** A database row holding a marker, as `markedRows` finds it. */
export interface MarkedRow {
	table: string;
	rowid: number;
	// The row is one the site added after `tableMarks` was taken.
	created: boolean;
	// The row's primary key, when its table has a single-column one.
	key?: { column: string; value: string | number };
	// Of a post: its type and status; of meta: its key and object; of an option: its name.
	postType?: string;
	postStatus?: string;
	metaKey?: string;
	objectId?: number;
	optionName?: string;
	commentType?: string;
}

// The site's own tables, which WordPress and its plugins make with its table prefix.
function siteTables( site: { prefix: string; query: < Row >( sql: string ) => Row[] } ) {
	return site
		.query< { name: string } >( "SELECT name FROM sqlite_master WHERE type = 'table'" )
		.map( ( { name } ) => name )
		.filter( ( name ) => name.startsWith( site.prefix ) );
}

const quoted = ( name: string ) => `"${ name.replace( /"/g, '""' ) }"`;

/** The last row of each of the site's tables, by rowid, before a form is sent. */
export async function tableMarks( sitePath: string ): Promise< Record< string, number > > {
	return readWordPressSite( sitePath, ( site ) =>
		Object.fromEntries(
			siteTables( site ).map( ( table ) => [
				table,
				site.query< { last: number | null } >(
					`SELECT MAX( rowid ) AS last FROM ${ quoted( table ) }`
				)[ 0 ]?.last ?? 0,
			] )
		)
	);
}

/**
 * The rows of the site's tables holding `marker` in any column, read from its
 * SQLite database (wp-content/database/.ht.sqlite); a row past `marks` was
 * added after they were taken.
 */
export async function markedRows(
	sitePath: string,
	marker: string,
	marks: Record< string, number > = {}
): Promise< MarkedRow[] > {
	return readWordPressSite( sitePath, ( site ) =>
		siteTables( site ).flatMap( ( table ) => {
			const columns = site.query< { name: string; pk: number } >(
				`PRAGMA table_info( ${ quoted( table ) } )`
			);
			if ( ! columns.length ) {
				return [];
			}
			const keys = columns.filter( ( column ) => column.pk > 0 );
			const like = `%${ marker }%`;
			const rows = site.query< Record< string, string | number > >(
				`SELECT rowid AS studio_rowid, * FROM ${ quoted( table ) } WHERE ${ columns
					.map( ( column ) => `CAST( ${ quoted( column.name ) } AS TEXT ) LIKE ?` )
					.join( ' OR ' ) }`,
				...columns.map( () => like )
			);
			const kind = table.slice( site.prefix.length );
			return rows.map( ( row ): MarkedRow => {
				const rowid = Number( row.studio_rowid );
				return {
					table,
					rowid,
					created: rowid > ( marks[ table ] ?? 0 ),
					...( keys.length === 1 && {
						key: { column: keys[ 0 ].name, value: row[ keys[ 0 ].name ] },
					} ),
					...( kind === 'posts' && {
						postType: String( row.post_type ),
						postStatus: String( row.post_status ),
					} ),
					...( [ 'postmeta', 'commentmeta', 'usermeta', 'termmeta' ].includes( kind ) && {
						metaKey: String( row.meta_key ),
						objectId: Number( row.post_id ?? row.comment_id ?? row.user_id ?? row.term_id ?? 0 ),
					} ),
					...( kind === 'options' && { optionName: String( row.option_name ) } ),
					...( kind === 'comments' && { commentType: String( row.comment_type ) } ),
				};
			} );
		} )
	);
}

/** The emails Studio saved for the site (cli/php/sendmail.php) holding `marker`, by file. */
export async function markedEmails( directory: string, marker: string ): Promise< string[] > {
	const names = await readdir( directory ).catch( () => [] as string[] );
	const files = await Promise.all(
		names
			.filter( ( name ) => name.endsWith( '.eml' ) )
			.map( async ( name ) => {
				const file = path.join( directory, name );
				// Quoted-printable text breaks long lines with a soft break.
				const text = await readFile( file, 'utf8' ).catch( () => '' );
				return text.replace( /=\r?\n/g, '' ).includes( marker ) ? [ file ] : [];
			} )
	);
	return files.flat();
}

/** Where the site stored a marker: the post types, meta keys and options holding it, and emails. */
export function storedPlaces( rows: MarkedRow[], emails: number ) {
	const unique = ( values: Array< string | undefined > ) =>
		[ ...new Set( values ) ].filter( ( value ): value is string => value !== undefined );
	return {
		postTypes: unique( rows.map( ( row ) => row.postType ) ),
		metaKeys: unique(
			rows.filter( ( row ) => row.table.endsWith( 'postmeta' ) ).map( ( row ) => row.metaKey )
		),
		optionNames: unique( rows.map( ( row ) => row.optionName ) ),
		tables: unique( rows.map( ( row ) => row.table ) ),
		emails,
	};
}
