import { randomBytes } from 'crypto';
import path from 'path';
import { Type } from 'typebox';
import { getSharedBrowser } from '@studio/agent/node/browser-utils';
import {
	getSitePluginPath,
	readInstalledManifest,
	type CurateAdminManifest,
} from '@studio/agent/node/curate-admin';
import { defineTool, LOCAL_CHANGE, type StudioToolDefinition } from './define-tool';
import { runWpCli } from './utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';

type Browser = Awaited< ReturnType< typeof getSharedBrowser > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;
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

const createMarker = () => `Curated admin check ${ randomBytes( 3 ).toString( 'hex' ) }`;

async function adminPage( page: Page, site: HostSite, screen: string ) {
	return page.goto( `${ site.url }/wp-admin/${ screen }`, {
		waitUntil: 'domcontentloaded',
		timeout: WAIT_MS,
	} );
}

async function rest( page: Page, site: HostSite, method: string, restPath: string, data?: object ) {
	const nonce = await (
		await page.request.get( `${ site.url }/wp-admin/admin-ajax.php?action=rest-nonce` )
	).text();
	const [ route, query ] = restPath.split( '?' );
	const url = `${ site.url }/?rest_route=${ encodeURIComponent( route ) }`;
	return page.request.fetch( query ? `${ url }&${ query }` : url, {
		method,
		headers: { 'X-WP-Nonce': nonce },
		data,
	} );
}

async function shownOn( page: Page, url: string, marker: string ) {
	return ( await ( await page.request.get( url ) ).text() ).includes( marker );
}

// Editors take a moment to load, and an empty post never gets blocks to wait
// for, so this settles on a pause once the post itself is known.
async function openEditor( page: Page, url: string, locked: boolean ) {
	await page.goto( url, { waitUntil: 'domcontentloaded', timeout: WAIT_MS } );
	await page.waitForFunction(
		( isLocked ) =>
			( ! isLocked || document.body.classList.contains( 'curate-admin-locked' ) ) &&
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			( window as any ).wp?.data?.select( 'core/editor' )?.getCurrentPostId(),
		locked,
		{ timeout: WAIT_MS }
	);
	await page.waitForTimeout( 1500 );
}

async function readLock( page: Page ) {
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
async function firstTerms( page: Page, site: HostSite, slug: string ) {
	const response = await rest( page, site, 'GET', `/wp/v2/taxonomies?type=${ slug }` );
	const taxonomies = Object.values(
		( await response.json() ) as Record< string, { rest_base: string } >
	);
	const terms: Record< string, number[] > = {};
	for ( const { rest_base: base } of taxonomies ) {
		const found = ( await (
			await rest( page, site, 'GET', `/wp/v2/${ base }?per_page=1` )
		).json() ) as { id: number }[];
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
	page: Page,
	site: HostSite,
	type: PostType,
	created: number[]
): Promise< Check > {
	const name = `${ type.plural }: a new one opens ready to fill in`;
	const lock = type.templateLock ?? ( type.fields?.length ? 'contentOnly' : false );
	const locked = lock === 'contentOnly';
	await openEditor( page, `${ site.url }/wp-admin/post-new.php?post_type=${ type.slug }`, locked );
	const state = await readLock( page );
	created.push(
		await page.evaluate(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			() => ( window as any ).wp.data.select( 'core/editor' ).getCurrentPostId() as number
		)
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
	host: StudioAgentHost,
	page: Page,
	site: HostSite,
	type: PostType,
	created: number[]
): Promise< Check[] > {
	const marker = createMarker();
	const saved = await rest( page, site, 'POST', `/wp/v2/${ type.slug }`, {
		title: marker,
		status: 'publish',
		meta: metaFor( type, marker ),
		...( await firstTerms( page, site, type.slug ) ),
	} );
	const name = `${ type.plural }: add one and see it on the site`;
	if ( ! saved.ok() ) {
		return [ { name, ok: false, detail: `saving failed with ${ saved.status() }` } ];
	}
	const { id, link } = ( await saved.json() ) as { id: number; link: string };
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
		await checkAddingAnItem( page, site, type, created ),
	];
}

async function checkSetting( page: Page, site: HostSite, setting: Setting ): Promise< Check > {
	const name = `${ setting.title }: change a value and see it on the site`;
	const key = setting.fields[ 0 ]?.key;
	const marker = createMarker();
	await adminPage( page, site, `admin.php?page=curate-admin-${ setting.id }` );
	await page.fill( `#curate-admin-${ key }`, marker );
	await Promise.all( [
		page.waitForURL( /settings-updated=true/, { timeout: WAIT_MS } ),
		page.click( '#submit' ),
	] );
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
	page: Page,
	site: HostSite,
	entry: NonNullable< CurateAdminManifest[ 'menu' ][ 'keep' ] >[ number ]
): Promise< Check > {
	const name = 'Pages: only text and photos can change';
	await adminPage( page, site, PAGES_SCREEN );
	const listed = await page
		.locator( '#the-list a.row-title' )
		.evaluateAll( ( links ) => links.map( ( link ) => ( link as HTMLAnchorElement ).href ) );
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

	await openEditor( page, listed[ 0 ], true );
	const lock = await readLock( page );
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

async function readMenu( page: Page, site: HostSite ) {
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
async function checkLinks( page: Page, site: HostSite, links: string[] ): Promise< Check > {
	const broken: string[] = [];
	for ( const link of links ) {
		const response = await adminPage( page, site, link );
		// A plugin's link can redirect to another of its screens. The dashboard means refused.
		const landed = new URL( page.url() ).pathname;
		const refused = /\/wp-admin\/(index\.php)?$/.test( landed ) && ! link.startsWith( 'index.php' );
		if ( ! response?.ok() || refused ) {
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
	page: Page,
	site: HostSite,
	manifest: CurateAdminManifest
): Promise< Check[] > {
	if ( ! manifest.dashboard ) {
		return [];
	}
	await adminPage( page, site, 'index.php' );
	const shown = await page
		.locator( '#dashboard-widgets .postbox' )
		.evaluateAll( ( boxes ) => boxes.map( ( box ) => box.id ) );
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
	page: Page,
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
		await adminPage( page, site, screen );
		const refused =
			! page.url().endsWith( screen ) || ( await page.locator( '#adminmenu' ).count() ) === 0;
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
		const status = ( await rest( page, site, 'GET', request ) ).status();
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
async function checkFullAdmin( page: Page, site: HostSite ): Promise< Check[] > {
	await adminPage( page, site, 'plugins.php' );
	const reached = new URL( page.url() ).pathname.endsWith( 'plugins.php' );
	const toggle = await page.locator( '#wp-admin-bar-curate-admin-full a' ).count();
	return [
		{
			name: 'Administrators keep the full admin',
			ok: reached && toggle > 0,
			detail:
				reached && toggle > 0
					? 'Plugins opens, and Full admin is in the toolbar'
					: `plugins opens: ${ reached }, toolbar link: ${ toggle > 0 }`,
		},
	];
}

// Opens wp-admin through Studio's sign-in, as the Staff account when there is one.
function getAdminPath( site: HostSite, login?: string ): string {
	const path = `/studio-auto-login?redirect_to=${ encodeURIComponent(
		`${ site.url }/wp-admin/`
	) }`;
	return login ? `${ path }&user=${ encodeURIComponent( login ) }` : path;
}

async function runChecks(
	host: StudioAgentHost,
	site: HostSite,
	manifest: CurateAdminManifest,
	login: string | undefined,
	created: number[],
	onProgress: ( message: string ) => void
): Promise< { checks: Check[]; home?: Buffer } > {
	const browser = await getSharedBrowser();
	const context = await browser.newContext( {
		viewport: { width: 1280, height: 800 },
		ignoreHTTPSErrors: true,
	} );
	const page = await context.newPage();
	const errors: string[] = [];
	page.on( 'pageerror', ( error ) => errors.push( error.message ) );

	try {
		await page.goto( `${ site.url }${ getAdminPath( site, login ) }`, {
			waitUntil: 'domcontentloaded',
			timeout: WAIT_MS,
		} );
		const body = await page
			.locator( 'body' )
			.getAttribute( 'class' )
			.catch( () => null );
		if ( login ) {
			const me = await rest( page, site, 'GET', '/wp/v2/users/me?context=edit' );
			const roles = me.ok() ? ( ( await me.json() ) as { roles: string[] } ).roles : [];
			if ( ! roles.includes( manifest.role.slug ) ) {
				throw new Error(
					`The check signed in with the roles [${ roles.join( ', ' ) }] instead of ${
						manifest.role.slug
					}, so its results would mean nothing. Restart the site and try again.`
				);
			}
		}

		const guide = path.join( getSitePluginPath( site ), 'guide' );
		const home = await page.screenshot( { type: 'jpeg', quality: 70 } );
		const menu = await readMenu( page, site );
		const checks: Check[] = [
			{
				name: 'Signing in lands on the dashboard',
				ok: Boolean( body?.includes( 'index-php' ) ),
				detail: page.url(),
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

		await attempt( 'the menu', async () => {
			const before = errors.length;
			const result = await checkLinks( page, site, menu.links );
			// Plugins' own screens aren't what this is checking.
			errors.length = before;
			return [ result ];
		} );
		for ( const type of manifest.postTypes ?? [] ) {
			await attempt( type.plural, () => checkPostType( host, page, site, type, created ) );
		}
		for ( const setting of manifest.settings ?? [] ) {
			await attempt( setting.title, async () => [ await checkSetting( page, site, setting ) ] );
		}
		const pagesEntry = manifest.menu.keep?.find( ( { screen } ) => screen === PAGES_SCREEN );
		if ( pagesEntry?.only || pagesEntry?.lock ) {
			await attempt( 'Pages', async () => [ await checkPages( page, site, pagesEntry ) ] );
		}
		for ( const { id, title, screen } of manifest.guide ?? [] ) {
			if ( screen ) {
				await attempt( title, async () => {
					await adminPage( page, site, screen );
					await page.screenshot( {
						path: path.join( guide, `${ id }.jpg` ),
						type: 'jpeg',
						quality: 70,
					} );
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
		checks.push( {
			name: 'No script errors',
			ok: errors.length === 0,
			detail: errors.length ? errors.slice( 0, 3 ).join( ' | ' ) : 'none on any screen',
		} );
		return { checks, home };
	} finally {
		await context.close();
	}
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

			const manifest = await readInstalledManifest( site );
			const login = manifest.staff?.login;
			if ( manifest.audience === 'staff' && ! login ) {
				throw new Error( 'The site has no Staff account. Run install_curated_admin first.' );
			}

			const restoreSettings = await snapshotSettings( context.host, site, manifest );
			const created: number[] = [];
			let result: Awaited< ReturnType< typeof runChecks > >;
			try {
				result = await runChecks( context.host, site, manifest, login, created, ( message ) =>
					context.onProgress( message )
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
				`Captures are saved for the guide in ${ path.join( getSitePluginPath( site ), 'guide' ) }.`,
			];

			return {
				content: [
					{ type: 'text' as const, text: lines.join( '\n' ) },
					...( visionEnabled && result.home
						? [
								{
									type: 'image' as const,
									data: result.home.toString( 'base64' ),
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
									widgetProps: { path: getAdminPath( site, login ), user: login },
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
