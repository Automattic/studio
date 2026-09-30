import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { loadCaptureEngine, loadHostAcceptanceRuntime } from 'cli/lib/import-runtime';
import type { SiteData } from 'cli/lib/cli-config/core';

export const IMPORT_ACCEPTANCE_SCHEMA = 'studio/import-acceptance/v1';
export type ImportAcceptanceSummary = {
	schema: typeof IMPORT_ACCEPTANCE_SCHEMA;
	status: 'accepted' | 'pending' | 'failed';
	reason?: string;
	reportPath: string;
};

const digest = ( bytes: string | Buffer ) =>
	crypto.createHash( 'sha256' ).update( bytes ).digest( 'hex' );
const read = ( file: string ) => JSON.parse( fs.readFileSync( file, 'utf8' ) );

type ParsedBlock = {
	name: string;
	attributes: Record< string, unknown >;
	innerBlocks?: ParsedBlock[];
};
type RestPost = { id: number; link: string; content: { raw: string } };
type RestMedia = {
	id: number;
	source_url: string;
	mime_type?: string;
	media_details?: { width?: number; height?: number };
};
type RestType = { rest_namespace: string; rest_base: string };
type WordPressWindow = Window & {
	wp: {
		apiFetch: < T >( options: { path: string } ) => Promise< T >;
		blocks: { parse( content: string ): ParsedBlock[] };
	};
};

export function findCaptureRoot( source: string ): string | undefined {
	for ( const directory of [ source, path.dirname( source ) ] ) {
		try {
			if (
				read( path.join( directory, 'capture-receipt.json' ) ).schema ===
				'data-liberation/capture-receipt/v1'
			)
				return directory;
		} catch {
			/* This source is not a retained DLA capture. */
		}
	}
	return undefined;
}

/** Scope comes from capture-time route identities, not today's live source. */
export function acceptanceScopeFromCapture(
	reference: {
		scope: { sourceUrls: string[] };
		entries: Array< { sourceUrl: string; route?: string } >;
	},
	interactions?: { pages?: Array< { states?: Array< { dialog?: unknown; status?: string } > } > }
) {
	if ( ! Array.isArray( reference.entries ) || ! Array.isArray( reference.scope?.sourceUrls ) )
		throw new Error( 'Frozen capture scope is unavailable.' );
	const canonical = ( url: string ) => {
		const value = new URL( url );
		value.hash = '';
		value.pathname = value.pathname.replace( /\/$/, '' ) || '/';
		return value.href;
	};
	const observed = new Set(
		reference.entries
			.filter( ( entry ) => entry.route )
			.map( ( entry ) => canonical( entry.sourceUrl ) )
	);
	if ( reference.scope.sourceUrls.some( ( url ) => ! observed.has( canonical( url ) ) ) )
		throw new Error( 'Frozen capture has unobserved source routes.' );
	const routes = [
		...new Set( reference.entries.flatMap( ( entry ) => ( entry.route ? [ entry.route ] : [] ) ) ),
	];
	if ( ! routes.length ) throw new Error( 'Frozen capture has no portable routes.' );
	const states = [ 'baseline' ];
	if (
		interactions?.pages?.some(
			( page ) => page.states?.some( ( state ) => state.dialog && state.status === 'captured' )
		)
	)
		states.push( 'dialog-open' );
	return { routes, widths: [ 390, 768, 1440 ], states };
}

export function isImportAccepted( sitePath: string ): boolean {
	try {
		const summary = read( path.join( sitePath, '.studio-acceptance', 'summary.json' ) );
		return summary.schema === IMPORT_ACCEPTANCE_SCHEMA && summary.status === 'accepted';
	} catch {
		return false;
	}
}

/** A thin caller adapter. SSI owns evaluation, rendering and editor persistence. */
export async function reviewImportedSite(
	site: SiteData,
	result: Record< string, unknown >,
	captureRoot?: string
): Promise< ImportAcceptanceSummary > {
	const root = path.join( site.path, '.studio-acceptance' );
	const inputs = path.join( root, 'inputs' );
	fs.mkdirSync( inputs, { recursive: true } );
	const reportPath = path.join( root, 'existing-runtime-acceptance.json' );
	const summary: ImportAcceptanceSummary = {
		schema: IMPORT_ACCEPTANCE_SCHEMA,
		status: 'pending',
		reportPath: path.join( root, 'summary.json' ),
	};
	const save = (
		status: ImportAcceptanceSummary[ 'status' ],
		reason?: string
	): ImportAcceptanceSummary => {
		summary.status = status;
		summary.reason = reason;
		fs.writeFileSync(
			path.join( root, 'summary.json' ),
			`${ JSON.stringify( summary, null, 2 ) }\n`
		);
		return summary;
	};
	if ( ! captureRoot ) return save( 'pending', 'source_capture_required' );
	if ( ! site.running ) return save( 'pending', 'running_candidate_required' );
	let preview: { url: string; close(): Promise< void > } | undefined;
	let browser: Awaited< ReturnType< typeof chromium.launch > > | undefined;
	try {
		const referencePath = path.join( captureRoot, 'fidelity-reference.json' );
		if ( ! fs.existsSync( referencePath ) )
			return save( 'pending', 'frozen_source_evidence_required' );
		const reference = read( referencePath );
		const captureReceipt = read( path.join( captureRoot, 'capture-receipt.json' ) );
		let interactions;
		try {
			interactions = read( path.join( captureRoot, 'interaction-states.json' ) );
		} catch {
			/* No declared dialog observations. */
		}
		const scope = acceptanceScopeFromCapture( reference, interactions );
		const engine = await loadCaptureEngine();
		if ( ! engine.entryPath || ! engine.checkFidelity || ! engine.serveCapture )
			return save( 'pending', 'frozen_fidelity_preview_api_required' );
		const host = await loadHostAcceptanceRuntime( site.path );
		const write = ( name: string, value: unknown ) => {
			const file = path.join( inputs, name );
			fs.writeFileSync( file, `${ JSON.stringify( value, null, 2 ) }\n` );
			return { path: name, sha256: digest( fs.readFileSync( file ) ) };
		};
		const manifest = write( 'scope.json', scope );
		const candidateOrigin = new URL( getSiteUrl( site ) ).origin;
		const sourceReport = String( result.report_path ?? '' );
		const mappedReport = sourceReport.startsWith( '/wordpress/' )
			? path.join( site.path, sourceReport.slice( '/wordpress/'.length ) )
			: path.resolve( sourceReport );
		const realSite = fs.realpathSync( site.path );
		if ( ! fs.realpathSync( mappedReport ).startsWith( `${ realSite }${ path.sep }` ) )
			return save( 'pending', 'import_report_not_bound_to_site' );
		const report = read( mappedReport );
		const identity = result.materialization_receipt_summary as
			| { plan_identity?: { hash?: string } }
			| undefined;
		if (
			! /^[a-f0-9]{64}$/.test( identity?.plan_identity?.hash ?? '' ) ||
			report.plan_identity?.hash !== identity?.plan_identity?.hash ||
			! report.import_run_id
		)
			return save( 'pending', 'materialization_report_identity_mismatch' );
		fs.copyFileSync( mappedReport, path.join( inputs, 'import-report.json' ) );
		const importReport = {
			path: 'import-report.json',
			sha256: digest( fs.readFileSync( mappedReport ) ),
		};
		const referenceRef = {
			path: 'fidelity-reference.json',
			sha256: digest( fs.readFileSync( referencePath ) ),
		};
		const runtimeIdentity = `data-liberation:${ engine.version }`;
		const runtimeValidation = write( 'runtime.json', {
			schema: 'static-site-importer/dla-runtime-validation/v1',
			runtime_identity: runtimeIdentity,
			public_entry_sha256: digest( fs.readFileSync( engine.entryPath ) ),
			status: 'passed',
			frozen_capture: true,
			materialization_no_origin_visits: true,
			verification: 'verified_release_public_frozen_api',
			version: engine.version,
		} );
		const candidateIdentity = write( 'candidate.json', {
			candidate_origin: candidateOrigin,
			import_run_id: report.import_run_id,
			reference_sha256: referenceRef.sha256,
			manifest_sha256: manifest.sha256,
			importer: { version: host.version, host_sha256: host.sha256 },
		} );
		const imported = result.pages as Record< string, number > | undefined;
		if ( ! imported || result.pages_truncated )
			return save( 'pending', 'complete_imported_post_receipt_required' );
		const sources = new Map< string, number >();
		for ( const route of captureReceipt.routes ?? [] ) {
			const portable = reference.entries.find(
				( entry: { sourceUrl: string; route?: string } ) => entry.sourceUrl === route.url
			)?.route;
			if ( portable && Number.isInteger( imported[ route.path ] ) )
				sources.set( portable, imported[ route.path ] );
		}
		if ( scope.routes.some( ( route ) => ! sources.has( route ) ) )
			return save( 'pending', 'capture_route_post_binding_required' );
		preview = await engine.serveCapture( captureRoot );
		browser = await chromium.launch( { headless: true } );
		const page = await browser.newPage();
		const firstId = [ ...sources.values() ][ 0 ];
		await page.goto(
			`${ candidateOrigin }/studio-auto-login?redirect_to=${ encodeURIComponent(
				`/wp-admin/post.php?post=${ firstId }&action=edit`
			) }`,
			{ waitUntil: 'domcontentloaded' }
		);
		await page.waitForFunction(
			() =>
				typeof ( window as unknown as WordPressWindow ).wp?.apiFetch === 'function' &&
				typeof ( window as unknown as WordPressWindow ).wp?.blocks?.parse === 'function'
		);
		const discovered = await page.evaluate(
			async ( ids: number[] ) => {
				const wp = ( window as unknown as WordPressWindow ).wp;
				const user = await wp.apiFetch< { id: number } >( {
					path: '/wp/v2/users/me?context=edit',
				} );
				const types = await wp.apiFetch< Record< string, RestType > >( {
					path: '/wp/v2/types?context=edit',
				} );
				const bases = Object.values( types )
					.filter( ( type ) => type.rest_namespace === 'wp/v2' )
					.map( ( type ) => type.rest_base );
				const posts: Array< { id: number; base: string; post: RestPost } > = [];
				for ( const id of ids ) {
					for ( const base of bases ) {
						try {
							const post = await wp.apiFetch< RestPost >( {
								path: `/wp/v2/${ base }/${ id }?context=edit`,
							} );
							posts.push( { id, base, post } );
							break;
						} catch {
							/* Try the other declared REST types. */
						}
					}
				}
				const media = await wp.apiFetch< RestMedia[] >( {
					path: '/wp/v2/media?context=edit&per_page=100',
				} );
				return { editorId: user.id, posts, media };
			},
			[ ...sources.values() ]
		);
		const routeToPost = await page.evaluate(
			( { posts, media, routes } ) => {
				const result = [];
				for ( const [ route, id ] of routes ) {
					const found = posts.find( ( post ) => post.id === id );
					if ( ! found || new URL( found.post.link ).pathname !== route ) continue;
					const blocks: ParsedBlock[] = [];
					const walk = ( rows: ParsedBlock[] ): void =>
						rows.forEach( ( block ) => {
							blocks.push( block );
							walk( block.innerBlocks ?? [] );
						} );
					walk(
						( window as unknown as WordPressWindow ).wp.blocks.parse( found.post.content.raw )
					);
					const identify = ( block: ParsedBlock ) => {
						for ( const attribute of [ 'className', 'anchor', 'alt', 'content', 'id', 'url' ] ) {
							const value = block.attributes[ attribute ];
							if ( ( typeof value !== 'string' && typeof value !== 'number' ) || value === '' )
								continue;
							if (
								blocks.filter(
									( other ) => other.name === block.name && other.attributes[ attribute ] === value
								).length === 1
							)
								return { identityAttribute: attribute, attributeValue: value };
						}
					};
					const text = blocks.find(
						( block ) =>
							[ 'core/paragraph', 'core/heading' ].includes( block.name ) &&
							block.attributes.content &&
							identify( block )
					);
					const image = blocks.find(
						( block ) =>
							block.name === 'core/image' &&
							Number.isInteger( block.attributes.id ) &&
							identify( block )
					);
					const replacement = media.find(
						( item ) =>
							item.id !== image?.attributes.id &&
							item.mime_type?.startsWith( 'image/' ) &&
							( item.media_details?.width ?? 0 ) > 0 &&
							( item.media_details?.height ?? 0 ) > 0
					);
					result.push( {
						route,
						postId: id,
						postType: found.base,
						mainRegions: blocks.filter(
							( block ) => block.name === 'core/group' && block.attributes.tagName === 'main'
						).length,
						presentationMap: undefined as string | undefined,
						...( text
							? { text: { blockName: text.name, ...identify( text ), attribute: 'content' } }
							: {} ),
						...( image && replacement
							? {
									image: {
										blockName: image.name,
										...identify( image ),
										urlAttribute: 'url',
										idAttribute: 'id',
										attachmentId: replacement.id,
										frontendSelector:
											typeof image.attributes.alt === 'string' &&
											image.attributes.alt &&
											blocks.filter(
												( block ) =>
													block.name === 'core/image' &&
													block.attributes.alt === image.attributes.alt
											).length === 1
												? `main img[alt=${ JSON.stringify( image.attributes.alt ) }]`
												: `main img[src=${ JSON.stringify( replacement.source_url ) }]`,
									},
							  }
							: {} ),
					} );
				}
				return result;
			},
			{ posts: discovered.posts, media: discovered.media, routes: [ ...sources ] }
		);
		// Source and candidate identities must agree before a presentation mapping
		// is emitted. The SSI oracle still measures the real editor correspondence.
		for ( const mapping of routeToPost ) {
			if ( mapping.mainRegions !== 1 ) continue;
			const source = await browser.newPage();
			const candidate = await browser.newPage();
			try {
				await source.goto( new URL( mapping.route, preview.url ).href, {
					waitUntil: 'domcontentloaded',
				} );
				await candidate.goto( new URL( mapping.route, candidateOrigin ).href, {
					waitUntil: 'domcontentloaded',
				} );
				if (
					( await source.locator( 'main' ).count() ) !== 1 ||
					( await candidate.locator( 'main' ).count() ) !== 1
				)
					continue;
				const file = write( `presentation-${ mapping.postId }.json`, {
					schema: 'static-site-importer/editor-presentation-map/v1',
					targets: [
						{
							id: 'main-content',
							role: 'region',
							selectors: { source: 'main', frontend: 'main', editor: 'main' },
							containers: { source: 'main', frontend: 'main', editor: 'main' },
						},
					],
				} );
				mapping.presentationMap = path.join( inputs, file.path );
			} finally {
				await source.close();
				await candidate.close();
			}
		}
		await browser.close();
		browser = undefined;
		const evaluated = await host.runExistingRuntimeAcceptance( {
			directory: captureRoot,
			manifest: path.join( inputs, manifest.path ),
			outputDirectory: root,
			evidenceRoot: inputs,
			candidateOrigin,
			portableOrigin: preview.url,
			candidateIdentity,
			reference: referenceRef,
			importRunId: report.import_run_id,
			importReport,
			runtimeModule: engine.entryPath,
			runtimeIdentity,
			runtimeValidation,
			editorId: discovered.editorId,
			authProvider: 'studio-auto-login',
			routeToPost,
			candidateInventory: async ( { page }: { page: import('playwright').Page } ) => {
				await page.goto(
					`${ candidateOrigin }/studio-auto-login?redirect_to=${ encodeURIComponent(
						`/wp-admin/post.php?post=${ firstId }&action=edit`
					) }`
				);
				await page.waitForFunction(
					() => typeof ( window as unknown as WordPressWindow ).wp?.apiFetch === 'function'
				);
				return page.evaluate( async ( bases ) => {
					const rows = [];
					for ( const item of bases ) {
						const post = await ( window as unknown as WordPressWindow ).wp.apiFetch< RestPost >( {
							path: `/wp/v2/${ item.postType }/${ item.postId }?context=edit`,
						} );
						rows.push( {
							route: new URL( post.link ).pathname,
							postId: post.id,
							postType: item.postType,
						} );
					}
					return rows;
				}, routeToPost );
			},
		} );
		const consumed = host.consumeExistingRuntimeAcceptance( root, evaluated );
		summary.reportPath = reportPath;
		return save(
			consumed.status === 'accepted'
				? 'accepted'
				: consumed.status === 'failed'
				? 'failed'
				: 'pending'
		);
	} catch ( error ) {
		return save(
			'pending',
			error instanceof Error ? error.message : 'acceptance_evidence_unavailable'
		);
	} finally {
		try {
			await browser?.close();
		} catch {
			save( 'failed', 'review_browser_cleanup_failed' );
		}
		try {
			await preview?.close();
		} catch {
			save( 'failed', 'capture_preview_cleanup_failed' );
		}
	}
}
