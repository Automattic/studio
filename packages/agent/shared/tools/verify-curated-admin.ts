import { Type } from 'typebox';
import { toBase64 } from '@studio/agent/shared/base64';
import {
	getSitePluginPath,
	readInstalledManifest,
	type CurateAdminManifest,
} from '@studio/agent/shared/curate-admin';
import { defineTool, LOCAL_CHANGE, type StudioToolDefinition } from './define-tool';
import { runWpCli } from './utils';
import type { HostPage, HostSite, StudioAgentHost } from '@studio/agent/shared/host';

type PostType = NonNullable< CurateAdminManifest[ 'postTypes' ] >[ number ];
type Setting = NonNullable< CurateAdminManifest[ 'settings' ] >[ number ];

interface Check {
	name: string;
	ok: boolean;
	detail: string;
}

const PAGES_SCREEN = 'edit.php?post_type=page';

// Whatever isn't in a Staff member's menu. A manifest can keep the first four.
const CLOSED_SCREENS = [
	'edit.php',
	'upload.php',
	'edit-comments.php',
	PAGES_SCREEN,
	'plugins.php',
	'plugin-install.php',
	'themes.php',
	'site-editor.php',
	'users.php',
	'options-general.php',
	'tools.php',
	'update-core.php',
	'edit.php?post_type=wp_navigation',
	'edit.php?post_type=wp_block',
	'edit.php?post_type=change_request',
];

// Reads, so that nothing happens if one is answered.
const CLOSED_REQUESTS = [ '/wp/v2/plugins', '/wp/v2/users?context=edit', '/wp/v2/settings' ];

const NEVER_HELD = [
	'install_plugins',
	'manage_options',
	'edit_theme_options',
	'create_users',
	'edit_users',
];

const WAIT_MS = 20_000;

const VIEWPORT = { width: 1280, height: 800 };

const createMarker = () =>
	`Curated admin check ${ crypto.getRandomValues( new Uint32Array( 1 ) )[ 0 ].toString( 16 ) }`;

// Opens a page through Studio's sign-in, as the Staff account when there is one.
// Every page signs in anew: a host may give each page its own cookies.
function getSignInPath( site: HostSite, target: string, login?: string ): string {
	const path = `/studio-auto-login?redirect_to=${ encodeURIComponent(
		`${ site.url }${ target }`
	) }`;
	return login ? `${ path }&user=${ encodeURIComponent( login ) }` : path;
}

function recordErrors() {
	window.addEventListener( 'error', ( event ) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		( ( window as any ).curateAdminErrors ??= [] ).push( event.message );
	} );
}

// Script errors are collected from every page a check opens.
interface Session {
	host: StudioAgentHost;
	site: HostSite;
	login?: string;
	errors: string[];
}

async function withPage< T >(
	session: Session,
	target: string,
	run: ( page: HostPage ) => Promise< T >
): Promise< T > {
	const { host, site, login, errors } = session;
	const page = await host.pages.open(
		{ url: `${ site.url }${ getSignInPath( site, target, login ) }` },
		{ viewport: VIEWPORT, initScript: recordErrors }
	);
	try {
		return await run( page );
	} finally {
		errors.push(
			...( await page
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.evaluate( () => ( ( window as any ).curateAdminErrors ?? [] ) as string[] )
				.catch( () => [] ) )
		);
		await page.close();
	}
}

// Requests made from inside the signed-in page carry its session, so a screen
// or route answers exactly as it would for the person signed in.
function readScreen( page: HostPage, url: string ) {
	return page.evaluate( async ( target ) => {
		const response = await fetch( target );
		const doc = new DOMParser().parseFromString( await response.text(), 'text/html' );
		const all = ( selector: string ) => Array.from( doc.querySelectorAll( selector ) );
		return {
			ok: response.ok,
			url: response.url,
			hasMenu: Boolean( doc.querySelector( '#adminmenu' ) ),
			rows: all( '#the-list a.row-title' ).map( ( link ) =>
				new URL( link.getAttribute( 'href' ) ?? '', response.url ).toString()
			),
			widgets: all( '#dashboard-widgets .postbox' ).map( ( box ) => box.id ),
			fullAdmin: Boolean( doc.querySelector( '#wp-admin-bar-curate-admin-full a' ) ),
		};
	}, url );
}

function adminScreen( page: HostPage, site: HostSite, screen: string ) {
	return readScreen( page, `${ site.url }/wp-admin/${ screen }` );
}

async function rest(
	page: HostPage,
	site: HostSite,
	method: string,
	restPath: string,
	data?: object
) {
	const [ route, query ] = restPath.split( '?' );
	const url = `${ site.url }/?rest_route=${ encodeURIComponent( route ) }`;
	const response = await page.evaluate(
		async ( request ) => {
			const nonce = await ( await fetch( request.nonceUrl ) ).text();
			const answer = await fetch( request.url, {
				method: request.method,
				headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
				body: request.data && JSON.stringify( request.data ),
			} );
			return { status: answer.status, body: await answer.text() };
		},
		{
			url: query ? `${ url }&${ query }` : url,
			nonceUrl: `${ site.url }/wp-admin/admin-ajax.php?action=rest-nonce`,
			method,
			data,
		}
	);
	return {
		status: response.status,
		ok: response.status >= 200 && response.status < 300,
		json: () => JSON.parse( response.body ) as unknown,
	};
}

async function shownOn( page: HostPage, url: string, marker: string ) {
	return page.evaluate(
		async ( request ) => ( await ( await fetch( request.url ) ).text() ).includes( request.marker ),
		{ url, marker }
	);
}

// Editors take a moment to load, and an empty post never gets blocks to wait
// for, so this settles on a pause once the post itself is known.
async function waitForEditor( page: HostPage, locked: boolean ) {
	await page.waitFor(
		locked
			? () =>
					document.body.classList.contains( 'curate-admin-locked' ) &&
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					Boolean( ( window as any ).wp?.data?.select( 'core/editor' )?.getCurrentPostId() )
			: () =>
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					Boolean( ( window as any ).wp?.data?.select( 'core/editor' )?.getCurrentPostId() ),
		WAIT_MS
	);
	await page.evaluate( () => new Promise( ( resolve ) => setTimeout( resolve, 1500 ) ) );
}

async function readLock( page: HostPage ) {
	return page.evaluate( () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { wp } = window as any;
		const editor = wp.data.select( 'core/block-editor' );
		const first = editor.getBlocks()[ 0 ]?.clientId;
		return {
			blocks: editor.getBlocks().length as number,
			editable: first ? editor.getBlockEditingMode( first ) === 'contentOnly' : false,
			insert: editor.canInsertBlockType( 'core/paragraph' ) as boolean,
			remove: Boolean( first && editor.canRemoveBlock( first ) ),
			move: Boolean( first && editor.canMoveBlock( first ) ),
			publish: Boolean(
				wp.data.select( 'core/editor' ).getCurrentPost()?._links?.[ 'wp:action-publish' ]
			),
		};
	} );
}

function describeOpenLocks( lock: Awaited< ReturnType< typeof readLock > > ) {
	return [
		lock.insert && 'adding blocks',
		lock.remove && 'removing blocks',
		lock.move && 'moving blocks',
	]
		.filter( Boolean )
		.join( ', ' );
}

// One term of each taxonomy, so a Query Loop filtered by term still finds the item.
async function firstTerms( page: HostPage, site: HostSite, slug: string ) {
	const response = await rest( page, site, 'GET', `/wp/v2/taxonomies?type=${ slug }` );
	const taxonomies = Object.values( response.json() as Record< string, { rest_base: string } > );
	const terms: Record< string, number[] > = {};
	for ( const { rest_base: base } of taxonomies ) {
		const found = ( await rest( page, site, 'GET', `/wp/v2/${ base }?per_page=1` ) ).json() as {
			id: number;
		}[];
		if ( found[ 0 ] ) {
			terms[ base ] = [ found[ 0 ].id ];
		}
	}
	return terms;
}

function metaFor( type: PostType, marker: string ) {
	const today = new Date().toISOString().slice( 0, 10 );
	return Object.fromEntries(
		( type.fields ?? [] ).map( ( field ) => [ field.key, field.type === 'date' ? today : marker ] )
	);
}

async function checkAddingAnItem(
	session: Session,
	type: PostType,
	created: number[]
): Promise< Check > {
	const name = `${ type.plural }: a new one opens ready to fill in`;
	const lock = type.templateLock ?? ( type.fields?.length ? 'contentOnly' : false );
	const locked = lock === 'contentOnly';
	const state = await withPage(
		session,
		`/wp-admin/post-new.php?post_type=${ type.slug }`,
		async ( page ) => {
			await waitForEditor( page, locked );
			created.push(
				await page.evaluate(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					() => ( window as any ).wp.data.select( 'core/editor' ).getCurrentPostId() as number
				)
			);
			return readLock( page );
		}
	);
	if ( ! locked ) {
		return { name, ok: true, detail: `${ state.blocks } blocks from its template` };
	}

	const expected =
		( type.template?.length ?? 0 ) +
		( type.fields ?? [] ).filter( ( { type: kind } ) => kind !== 'date' ).length;
	const open = describeOpenLocks( state );
	return {
		name,
		ok: ! open && state.blocks === expected,
		detail: open
			? `it should be locked, but people can still: ${ open }`
			: `${ state.blocks } of ${ expected } blocks, locked to their content`,
	};
}

async function checkPostType(
	session: Session,
	page: HostPage,
	type: PostType,
	created: number[]
): Promise< Check[] > {
	const { host, site } = session;
	const marker = createMarker();
	const saved = await rest( page, site, 'POST', `/wp/v2/${ type.slug }`, {
		title: marker,
		status: 'publish',
		meta: metaFor( type, marker ),
		...( await firstTerms( page, site, type.slug ) ),
	} );
	const name = `${ type.plural }: add one and see it on the site`;
	if ( ! saved.ok ) {
		return [ { name, ok: false, detail: `saving failed with ${ saved.status }` } ];
	}
	const { id, link } = saved.json() as { id: number; link: string };
	created.push( id );

	const places = [
		...( type.previewPath ? [ `${ site.url }${ type.previewPath }` ] : [] ),
		...( type.public ? [ link ] : [] ),
		...( type.hasArchive
			? [
					(
						await runWpCli( host, site, [
							'eval',
							`echo get_post_type_archive_link( '${ type.slug }' );`,
						] )
					).trim(),
			  ]
			: [] ),
	];
	const missing: string[] = [];
	for ( const place of places ) {
		if ( ! ( await shownOn( page, place, marker ) ) ) {
			missing.push( place );
		}
	}

	return [
		{
			name,
			ok: ! missing.length,
			detail: missing.length
				? `a saved item did not appear on ${ missing.join( ', ' ) }`
				: `appeared on ${ places.join( ', ' ) }`,
		},
		await checkAddingAnItem( session, type, created ),
	];
}

// Submits the settings form as the browser would, with its nonce and referer.
function saveSetting( page: HostPage, url: string, field: string, value: string ) {
	return page.evaluate(
		async ( request ) => {
			const response = await fetch( request.url );
			const doc = new DOMParser().parseFromString( await response.text(), 'text/html' );
			const input = doc.getElementById( request.field ) as HTMLInputElement | null;
			const form = input?.closest( 'form' );
			if ( ! input || ! form ) {
				return null;
			}
			const data = new FormData( form );
			data.set( input.name, request.value );
			const saved = await fetch( new URL( form.getAttribute( 'action' ) ?? '', response.url ), {
				method: 'POST',
				body: data,
			} );
			return saved.url;
		},
		{ url, field, value }
	);
}

async function checkSetting( page: HostPage, site: HostSite, setting: Setting ): Promise< Check > {
	const name = `${ setting.title }: change a value and see it on the site`;
	const key = setting.fields[ 0 ]?.key;
	const marker = createMarker();
	const landed = await saveSetting(
		page,
		`${ site.url }/wp-admin/admin.php?page=curate-admin-${ setting.id }`,
		`curate-admin-${ key }`,
		marker
	);
	if ( ! landed?.includes( 'settings-updated=true' ) ) {
		return { name, ok: false, detail: landed ? `saving landed on ${ landed }` : 'no form to fill' };
	}
	const place = setting.previewPath && `${ site.url }${ setting.previewPath }`;
	if ( place && ! ( await shownOn( page, place, marker ) ) ) {
		return { name, ok: false, detail: `a saved value did not appear on ${ setting.previewPath }` };
	}
	return {
		name,
		ok: true,
		detail: place ? `appeared on ${ setting.previewPath }` : 'saved',
	};
}

async function checkPages(
	session: Session,
	page: HostPage,
	entry: NonNullable< CurateAdminManifest[ 'menu' ][ 'keep' ] >[ number ]
): Promise< Check > {
	const name = 'Pages: only text and photos can change';
	const listed = ( await adminScreen( page, session.site, PAGES_SCREEN ) ).rows;
	if ( entry.only && listed.length !== entry.only.length ) {
		return {
			name,
			ok: false,
			detail: `the page list shows ${ listed.length }, expected ${ entry.only.length }`,
		};
	}
	if ( ! entry.lock || ! listed.length ) {
		return {
			name: 'Pages: the list shows the agreed pages',
			ok: true,
			detail: `${ listed.length }`,
		};
	}

	const lock = await withPage(
		session,
		listed[ 0 ].replace( session.site.url, '' ),
		async ( editor ) => {
			await waitForEditor( editor, true );
			return readLock( editor );
		}
	);
	if ( ! lock.blocks ) {
		return {
			name,
			ok: false,
			detail: 'the page has no content, so there is nothing to edit: leave it out of menu.keep',
		};
	}
	const open = describeOpenLocks( lock );
	if ( open ) {
		return { name, ok: false, detail: `people can still: ${ open }` };
	}
	return lock.publish
		? { name, ok: true, detail: 'checked in the editor' }
		: {
				name,
				ok: false,
				detail: 'saving would submit the live page for review, taking it offline',
		  };
}

async function readMenu( page: HostPage, site: HostSite ) {
	return page.evaluate( ( adminUrl ) => {
		const screenOf = ( link: Element ) =>
			( link as HTMLAnchorElement ).href.replace( adminUrl, '' );
		return {
			top: Array.from( document.querySelectorAll( '#adminmenu > li.menu-top > a' ) ).map(
				screenOf
			),
			links: Array.from(
				new Set( Array.from( document.querySelectorAll( '#adminmenu a' ) ).map( screenOf ) )
			),
		};
	}, `${ site.url }/wp-admin/` );
}

function keptScreens( manifest: CurateAdminManifest ): string[] {
	return [
		'index.php',
		'profile.php',
		...( manifest.menu.keep ?? [] ).map( ( { screen } ) => screen ),
		...( manifest.postTypes ?? [] ).map( ( { slug } ) => `edit.php?post_type=${ slug }` ),
		...( manifest.settings ?? [] ).map( ( { id } ) => `admin.php?page=curate-admin-${ id }` ),
	];
}

function checkMenu(
	manifest: CurateAdminManifest,
	{ top }: Awaited< ReturnType< typeof readMenu > >
): Check[] {
	const kept = keptScreens( manifest );
	const missing = ( manifest.audience === 'staff' ? kept : [] ).filter(
		( screen ) => ! top.includes( screen )
	);
	const hidden = manifest.menu.hide ?? [];
	const extra = top.filter( ( screen ) =>
		manifest.audience === 'staff' ? ! kept.includes( screen ) : hidden.includes( screen )
	);
	return [
		{
			name: 'The menu shows what was agreed',
			ok: ! extra.length && ! missing.length,
			detail:
				extra.length || missing.length
					? `extra: ${ extra.join( ', ' ) || 'none' }; missing: ${ missing.join( ', ' ) || 'none' }`
					: top.join( ', ' ),
		},
	];
}

// A curated menu must never lead somewhere it can't open: this is how a
// too-narrow Staff role shows up, including on Categories and Comments.
async function checkLinks( page: HostPage, site: HostSite, links: string[] ): Promise< Check > {
	const broken: string[] = [];
	for ( const link of links ) {
		const screen = await adminScreen( page, site, link );
		// A plugin's link can redirect to another of its screens. The dashboard means refused.
		const landed = new URL( screen.url ).pathname;
		const refused = /\/wp-admin\/(index\.php)?$/.test( landed ) && ! link.startsWith( 'index.php' );
		if ( ! screen.ok || refused ) {
			broken.push( link );
		}
	}
	return {
		name: 'Every link in the menu opens',
		ok: ! broken.length,
		detail: broken.length ? `these don't: ${ broken.join( ', ' ) }` : `${ links.length } links`,
	};
}

async function checkDashboard(
	page: HostPage,
	site: HostSite,
	manifest: CurateAdminManifest
): Promise< Check[] > {
	if ( ! manifest.dashboard ) {
		return [];
	}
	const shown = ( await adminScreen( page, site, 'index.php' ) ).widgets;
	const { keep = [], hide = [], widgets = [] } = manifest.dashboard;
	const custom = widgets.map( ( { id } ) => `curate_admin_${ id }` );
	const missing = custom.filter( ( id ) => ! shown.includes( id ) );
	const extra = shown.filter( ( id ) =>
		manifest.audience === 'staff'
			? ! keep.includes( id ) && ! custom.includes( id )
			: hide.includes( id )
	);
	return [
		{
			name: 'The dashboard shows what was agreed',
			ok: ! missing.length && ! extra.length,
			detail:
				missing.length || extra.length
					? `extra: ${ extra.join( ', ' ) || 'none' }; missing: ${ missing.join( ', ' ) || 'none' }`
					: shown.join( ', ' ) || 'no widgets',
		},
	];
}

// Asks WordPress directly, so a check that fails has changed nothing on the site.
async function checkCapabilities(
	host: StudioAgentHost,
	site: HostSite,
	manifest: CurateAdminManifest,
	login: string
): Promise< Check[] > {
	const kept = keptScreens( manifest );
	const pagesEntry = manifest.menu.keep?.find( ( { screen } ) => screen === PAGES_SCREEN );
	const creating = ( postType: string ) =>
		`get_post_type_object( '${ postType }' )->cap->create_posts`;
	const closed = [
		...NEVER_HELD.map( ( capability ) => `'${ capability }'` ),
		...( ! pagesEntry || pagesEntry.only || pagesEntry.lock ? [ creating( 'page' ) ] : [] ),
		...( kept.includes( 'edit.php' ) ? [] : [ creating( 'post' ) ] ),
		...( kept.includes( 'edit-comments.php' ) ? [] : [ "'moderate_comments'" ] ),
	];
	const held = JSON.parse(
		await runWpCli( host, site, [
			'eval',
			`wp_set_current_user( get_user_by( 'login', '${ login }' )->ID );
			echo wp_json_encode( array_values( array_filter( array( ${ closed.join(
				', '
			) } ), 'current_user_can' ) ) );`,
		] )
	) as string[];

	return [
		{
			name: 'Staff hold none of what stays closed',
			ok: ! held.length,
			detail: held.length ? `STAFF HOLD ${ held.join( ', ' ) }` : `${ closed.length } capabilities`,
		},
	];
}

// Staff can't save raw HTML, so a text edit would empty these blocks.
async function checkRawHtml(
	host: StudioAgentHost,
	site: HostSite,
	manifest: CurateAdminManifest
): Promise< Check[] > {
	const entry = manifest.menu.keep?.find( ( { screen } ) => screen === PAGES_SCREEN );
	if ( ! entry ) {
		return [];
	}
	const pages = await runWpCli( host, site, [
		'eval',
		`foreach ( get_posts( array( 'post_type' => 'page', 'numberposts' => -1 ) ) as $page ) { if ( has_block( 'core/html', $page ) ) { echo $page->post_name, ' '; } }`,
	] );
	const risky = pages
		.split( /\s+/ )
		.filter( ( slug ) => slug && ( ! entry.only || entry.only.includes( slug ) ) );
	return [
		{
			name: 'Saving a page keeps its markup',
			ok: ! risky.length,
			detail: risky.length
				? `saving these as staff would strip their Custom HTML blocks, so move the HTML to a template part: ${ risky.join(
						', '
				  ) }`
				: 'no Custom HTML blocks on pages staff edit',
		},
	];
}

async function checkClosed(
	host: StudioAgentHost,
	page: HostPage,
	site: HostSite,
	manifest: CurateAdminManifest,
	login: string
): Promise< Check[] > {
	const kept = keptScreens( manifest );
	const pagesEntry = manifest.menu.keep?.find( ( { screen } ) => screen === PAGES_SCREEN );
	const pages = JSON.parse(
		await runWpCli( host, site, [
			'post',
			'list',
			'--post_type=page',
			'--post_status=publish',
			'--fields=ID,post_name',
			'--format=json',
		] )
	) as { ID: number; post_name: string }[];
	const closedPage = pages.find(
		( { post_name: slug } ) => ! pagesEntry || pagesEntry.only?.includes( slug ) === false
	);

	const checks: Check[] = [];
	for ( const screen of [
		...CLOSED_SCREENS.filter( ( candidate ) => ! kept.includes( candidate ) ),
		'options.php',
		...( manifest.settings ?? [] ).map(
			( { id } ) => `options.php?option_page=curate-admin-${ id }`
		),
		...( closedPage ? [ `post.php?post=${ closedPage.ID }&action=edit` ] : [] ),
	] ) {
		const shown = await adminScreen( page, site, screen );
		const refused = ! shown.url.endsWith( screen ) || ! shown.hasMenu;
		checks.push( {
			name: `${ screen } stays closed`,
			ok: refused,
			detail: refused ? 'sent back to the dashboard' : 'STAFF CAN OPEN THIS SCREEN',
		} );
	}

	for ( const request of [
		...CLOSED_REQUESTS,
		...( kept.includes( 'edit-comments.php' ) ? [] : [ '/wp/v2/comments?context=edit' ] ),
	] ) {
		const { status } = await rest( page, site, 'GET', request );
		const refused = status === 401 || status === 403;
		checks.push( {
			name: `GET ${ request } stays closed`,
			ok: refused,
			detail: refused ? `refused with ${ status }` : `ANSWERED ${ status }`,
		} );
	}

	checks.push( ...( await checkCapabilities( host, site, manifest, login ) ) );
	return checks;
}

// With no Staff role, nothing is closed, so what matters is that nothing is lost.
async function checkFullAdmin( page: HostPage, site: HostSite ): Promise< Check[] > {
	const plugins = await adminScreen( page, site, 'plugins.php' );
	const reached = new URL( plugins.url ).pathname.endsWith( 'plugins.php' );
	return [
		{
			name: 'Administrators keep the full admin',
			ok: reached && plugins.fullAdmin,
			detail:
				reached && plugins.fullAdmin
					? 'Plugins opens, and Full admin is in the toolbar'
					: `plugins opens: ${ reached }, toolbar link: ${ plugins.fullAdmin }`,
		},
	];
}

async function runChecks(
	session: Session,
	manifest: CurateAdminManifest,
	created: number[],
	onProgress: ( message: string ) => void
): Promise< { checks: Check[]; home?: Uint8Array } > {
	const { host, site, login, errors } = session;
	return withPage( session, '/wp-admin/', async ( page ) => {
		const body = await page.evaluate( () => document.body.className ).catch( () => null );
		if ( login ) {
			const me = await rest( page, site, 'GET', '/wp/v2/users/me?context=edit' );
			const roles = me.ok ? ( me.json() as { roles: string[] } ).roles : [];
			if ( ! roles.includes( manifest.role.slug ) ) {
				throw new Error(
					`The check signed in with the roles [${ roles.join( ', ' ) }] instead of ${
						manifest.role.slug
					}, so its results would mean nothing. Restart the site and try again.`
				);
			}
		}

		const guide = host.path.join( getSitePluginPath( host, site ), 'guide' );
		const home = await page.screenshot( { format: 'jpeg', quality: 70 } );
		const menu = await readMenu( page, site );
		const checks: Check[] = [
			{
				name: 'Signing in lands on the dashboard',
				ok: Boolean( body?.includes( 'index-php' ) ),
				detail: body ? 'the dashboard' : 'no page',
			},
			...checkMenu( manifest, menu ),
			...( await checkDashboard( page, site, manifest ) ),
		];

		// Each check is a try of its own, so one failure doesn't hide the others.
		const attempt = async ( name: string, check: () => Promise< Check[] > ) => {
			onProgress( `Trying "${ name }"…` );
			try {
				checks.push( ...( await check() ) );
			} catch ( error ) {
				const detail = error instanceof Error ? error.message.split( '\n' )[ 0 ] : String( error );
				checks.push( { name, ok: false, detail } );
			}
		};

		await attempt( 'the menu', async () => [ await checkLinks( page, site, menu.links ) ] );
		for ( const type of manifest.postTypes ?? [] ) {
			await attempt( type.plural, () => checkPostType( session, page, type, created ) );
		}
		for ( const setting of manifest.settings ?? [] ) {
			await attempt( setting.title, async () => [ await checkSetting( page, site, setting ) ] );
		}
		const pagesEntry = manifest.menu.keep?.find( ( { screen } ) => screen === PAGES_SCREEN );
		if ( pagesEntry?.only || pagesEntry?.lock ) {
			await attempt( 'Pages', async () => [ await checkPages( session, page, pagesEntry ) ] );
		}
		for ( const { id, title, screen } of manifest.guide ?? [] ) {
			if ( screen ) {
				await attempt( title, async () => {
					const capture = await withPage( session, `/wp-admin/${ screen }`, ( guidePage ) =>
						guidePage.screenshot( { format: 'jpeg', quality: 70 } )
					);
					await host.files.write( host.path.join( guide, `${ id }.jpg` ), capture );
					return [];
				} );
			}
		}

		onProgress( 'Checking what stays closed…' );
		if ( login ) {
			checks.push( ...( await checkRawHtml( host, site, manifest ) ) );
		}
		checks.push(
			...( login
				? await checkClosed( host, page, site, manifest, login )
				: await checkFullAdmin( page, site ) )
		);
		const pageErrors = [
			...errors,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			...( await page.evaluate( () => ( ( window as any ).curateAdminErrors ?? [] ) as string[] ) ),
		];
		checks.push( {
			name: 'No script errors',
			ok: pageErrors.length === 0,
			detail: pageErrors.length
				? pageErrors.slice( 0, 3 ).join( ' | ' )
				: 'none on the screens it opened',
		} );
		return { checks, home };
	} );
}

// The settings the checks change, read directly so they come back exact,
// including when they were last changed, whatever happens during the checks.
async function snapshotSettings(
	host: StudioAgentHost,
	site: HostSite,
	manifest: CurateAdminManifest
) {
	const values = await Promise.all(
		( manifest.settings ?? [] ).map( async ( { option } ) => {
			const { exitCode, stdout } = await host.sites.wpCli( site, [
				'option',
				'get',
				option,
				'--format=json',
			] );
			return { option, value: exitCode === 0 ? stdout.trim() : null };
		} )
	);
	return () =>
		Promise.all(
			values.map( ( { option, value } ) =>
				host.sites.wpCli(
					site,
					value === null
						? [ 'option', 'delete', option ]
						: [ 'option', 'update', option, value, '--format=json' ]
				)
			)
		);
}

export function createVerifyCuratedAdminTool( { visionEnabled }: { visionEnabled: boolean } ) {
	return defineTool(
		'verify_curated_admin',
		"Signs in to a site's curated wp-admin and tries it for real: opens every menu link, adds an item of each post type, saves each settings page, and confirms the results reach the site. With a Staff account, it also confirms " +
			'that hidden screens, plugins, themes, users and settings stay closed, on screen and through the REST API. Saves a capture for each guide entry, and offers the user a button to open wp-admin. ' +
			'Everything it creates or changes is removed afterwards. Run it after install_curated_admin and fix every failure.',
		{
			nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
		},
		async ( args, context ) => {
			const site = await context.host.sites.resolve( args.nameOrPath );
			if ( ! ( await context.host.sites.isRunning( site ) ) ) {
				throw new Error( 'The site is not running. Start it with site_start first.' );
			}

			const manifest = await readInstalledManifest( context.host, site );
			const login = manifest.staff?.login;
			if ( manifest.audience === 'staff' && ! login ) {
				throw new Error( 'The site has no Staff account. Run install_curated_admin first.' );
			}

			const restoreSettings = await snapshotSettings( context.host, site, manifest );
			const created: number[] = [];
			let result: Awaited< ReturnType< typeof runChecks > >;
			try {
				result = await runChecks(
					{ host: context.host, site, login, errors: [] },
					manifest,
					created,
					( message ) => context.onProgress( message )
				);
			} finally {
				await restoreSettings();
				if ( created.length ) {
					await runWpCli( context.host, site, [
						'post',
						'delete',
						...created.map( String ),
						'--force',
					] );
				}
			}

			const failed = result.checks.filter( ( { ok } ) => ! ok );
			const lines = [
				failed.length
					? `${ failed.length } of ${ result.checks.length } checks FAILED as "${
							login ?? 'the administrator'
					  }". Fix these and run it again:`
					: `All ${ result.checks.length } checks passed, signed in as "${
							login ?? 'the administrator'
					  }".`,
				...failed.map( ( { name, detail } ) => `- FAIL ${ name }: ${ detail }` ),
				...result.checks
					.filter( ( { ok } ) => ok )
					.map( ( { name, detail } ) => `- ok ${ name }: ${ detail }` ),
				`Captures are saved for the guide in ${ context.host.path.join(
					getSitePluginPath( context.host, site ),
					'guide'
				) }.`,
			];

			return {
				content: [
					{ type: 'text' as const, text: lines.join( '\n' ) },
					...( visionEnabled && result.home
						? [
								{
									type: 'image' as const,
									data: toBase64( result.home ),
									mimeType: 'image/jpeg',
								},
						  ]
						: [] ),
				],
				...( failed.length
					? {}
					: {
							studioArtifacts: [
								{
									type: 'admin-link',
									widgetProps: { path: getSignInPath( site, '/wp-admin/', login ), user: login },
								},
							],
					  } ),
			};
		},
		{
			annotations: LOCAL_CHANGE,
			promptSnippet: 'Try a curated wp-admin signed in, and confirm what must stay closed does.',
		}
	);
}

export const verifyCuratedAdminTool: StudioToolDefinition = createVerifyCuratedAdminTool( {
	visionEnabled: true,
} );
