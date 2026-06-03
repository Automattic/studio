import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { Type } from 'typebox';
import { runGenerator } from 'cli/ai/generation/generators';
import {
	contractFromManifest,
	contractVocabulary,
	reconcileMarkup,
} from 'cli/ai/generation/identifier-contract';
import { resolveAiImagesInHtml, stripAiImagePlaceholders } from 'cli/ai/generation/images';
import { completeText, extractJson, runPooled } from 'cli/ai/generation/llm';
import { parseManifest, type PostTypePlan, type SiteManifest } from 'cli/ai/generation/manifest';
import { deriveSlug, uploadsDir } from 'cli/ai/generation/paths';
import { isSiteRunning, withDaemon, wpCli } from 'cli/ai/generation/site-wp';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

function normalizeSpecJson( spec: string ): string {
	const trimmed = spec.trim();
	try {
		return JSON.stringify( JSON.parse( trimmed ), null, 2 );
	} catch {
		return JSON.stringify( { description: trimmed }, null, 2 );
	}
}

// An item ready to publish: post type, slug, title, block-markup content, and
// (for custom post types) meta fields.
interface PreparedItem {
	postType: string;
	slug: string;
	title: string;
	content: string;
	meta: Record< string, string >;
	isHome: boolean;
}

// Page-like targets (pages + native posts) take their body from the
// page-content generator. CPT entries are generated separately with meta.
interface PageTarget {
	postType: string;
	slug: string;
	title: string;
	brief: string;
	isHome: boolean;
}

function collectPageTargets( manifest: SiteManifest ): PageTarget[] {
	const targets: PageTarget[] = [];
	const seen = new Set< string >();

	for ( const page of manifest.pages ) {
		const key = `page:${ page.slug }`;
		if ( seen.has( key ) ) {
			continue;
		}
		seen.add( key );
		targets.push( {
			postType: 'page',
			slug: page.slug,
			title: page.title,
			brief: page.brief,
			isHome: page.slug === 'home' || page.title.trim().toLowerCase() === 'home',
		} );
	}

	// Native blog posts declared in the manifest's seed list.
	for ( const item of manifest.seed ) {
		if ( item.type !== 'post' ) {
			continue;
		}
		const key = `post:${ item.slug }`;
		if ( seen.has( key ) ) {
			continue;
		}
		seen.add( key );
		targets.push( {
			postType: 'post',
			slug: item.slug,
			title: item.title,
			brief: '',
			isHome: false,
		} );
	}

	return targets;
}

interface CptEntry {
	title: string;
	content: string;
	meta: Record< string, string >;
}

// Generate realistic sample entries (title + short body + meta) for a custom
// post type. Inline prompt (no bundled fragment) keyed on the CPT's declared
// fields so the meta keys line up with what the companion plugin registered.
async function runCptEntries(
	specJson: string,
	postType: PostTypePlan,
	count: number
): Promise< CptEntry[] > {
	const fieldKeys = postType.fields.map( ( f ) => f.key );
	const fieldList = postType.fields.length
		? postType.fields.map( ( f ) => `${ f.key } (${ f.type })` ).join( ', ' )
		: '(no meta fields)';

	const raw = await completeText( {
		system: `You generate realistic sample entries for a WordPress custom post type on a generated site. Output ONLY a JSON array of exactly ${ count } objects — no prose, no code fences. Each object is {"title": string, "content": "WordPress block markup body, 2-4 core blocks (wp:paragraph, wp:heading, wp:list)", "meta": { ... }}. The meta object MUST use exactly these keys: ${
			fieldKeys.join( ', ' ) || '(none — use an empty object)'
		}. Invent plausible, domain-anchored values grounded in the site; never reference real brands or real people. No emojis.`,
		user: `Site spec (JSON):\n${ specJson }\n\nPost type: ${ postType.name } (slug: ${ postType.slug })\nMeta fields: ${ fieldList }\nGenerate ${ count } distinct entries.`,
		maxTokens: 8_000,
		temperature: 0.7,
	} );

	const parsed = JSON.parse( extractJson( raw ) ) as unknown;
	if ( ! Array.isArray( parsed ) ) {
		return [];
	}
	return parsed
		.filter( ( e ): e is Record< string, unknown > => !! e && typeof e === 'object' )
		.map( ( e ) => ( {
			title: typeof e.title === 'string' ? e.title.trim() : '',
			content: typeof e.content === 'string' ? e.content : '',
			meta:
				e.meta && typeof e.meta === 'object'
					? Object.fromEntries(
							Object.entries( e.meta as Record< string, unknown > )
								.filter( ( [ key ] ) => fieldKeys.length === 0 || fieldKeys.includes( key ) )
								.map( ( [ key, value ] ) => [ key, String( value ) ] )
					  )
					: {},
		} ) )
		.filter( ( e ) => e.title );
}

async function wpcomImagesAvailable(): Promise< boolean > {
	if ( process.env.STUDIO_WPCOM_TOKEN?.trim() ) {
		return true;
	}
	try {
		return Boolean( ( await readAuthToken() )?.accessToken );
	} catch {
		return false;
	}
}

async function findExistingPostId(
	siteId: string,
	postType: string,
	slug: string
): Promise< number | null > {
	const result = await wpCli( siteId, [
		'post',
		'list',
		`--post_type=${ postType }`,
		`--name=${ slug }`,
		'--post_status=any',
		'--format=ids',
	] );
	if ( result.exitCode !== 0 ) {
		return null;
	}
	const match = result.stdout.match( /\b\d+\b/ );
	const id = match ? Number.parseInt( match[ 0 ], 10 ) : NaN;
	return Number.isFinite( id ) && id > 0 ? id : null;
}

// WordPress root as PHP sees it. The Studio site's wp-content is the live WP
// filesystem (theme/plugin files written host-side appear in the running site),
// so a file written to <site>/wp-content/uploads/... is readable by WP-CLI at
// <ABSPATH>wp-content/uploads/... — letting us pass post content via a file
// path instead of a giant `--post_content=` arg that the IPC bus truncates.
async function getAbspath( siteId: string ): Promise< string > {
	const result = await wpCli( siteId, [ 'eval', 'echo ABSPATH;' ] );
	const value = result.stdout.trim();
	if ( ! value ) {
		throw new Error( 'Could not determine WordPress ABSPATH; cannot seed content reliably.' );
	}
	return value.endsWith( '/' ) ? value : `${ value }/`;
}

export const seedContentTool = defineTool(
	'seed_content',
	"Generates and publishes a site's pages, posts, and custom-post-type entries into the LIVE WordPress database from the manifest (content is NOT baked into the theme). Page bodies come from the composition briefs; CPT entries (from the companion plugin's post types) are generated with their meta fields so collections like products/events/team actually populate. Large content is written via a file the WP filesystem reads, avoiding WP-CLI argument truncation. AI_IMAGE placeholders are filled when logged into WordPress.com, otherwise removed. Upserts by slug (idempotent) and sets the home page as the static front page. Requires the manifest from generate_theme and a running site.",
	{
		nameOrPath: Type.String( {
			description: 'The site name or filesystem path of the target site.',
		} ),
		spec: Type.String( {
			description: 'The site spec as a JSON string (same one passed to generate_theme).',
		} ),
		manifest: Type.String( { description: 'The file manifest JSON returned by generate_theme.' } ),
		withImages: Type.Optional(
			Type.Boolean( {
				description:
					'Fill AI_IMAGE placeholders with generated imagery (default true; requires WordPress.com login). When false or not logged in, placeholders are removed instead.',
			} )
		),
	},
	async ( args ) => {
		const site = await resolveSite( args.nameOrPath );
		const specJson = normalizeSpecJson( args.spec );
		const manifest = parseManifest( args.manifest );
		const contract = contractFromManifest( manifest );
		const vocabulary = contractVocabulary( manifest );
		const withImages = args.withImages ?? true;
		const imagesOk = withImages && ( await wpcomImagesAvailable() );

		const pageTargets = collectPageTargets( manifest );
		const cptPlans = manifest.companionPlugin.needed ? manifest.companionPlugin.postTypes : [];
		if ( pageTargets.length === 0 && cptPlans.length === 0 ) {
			return textResult(
				'The manifest lists no pages, posts, or post types to seed. Nothing to do.'
			);
		}

		const siteUrl = getSiteUrl( site ).replace( /\/+$/, '' );
		const wsgUploads = uploadsDir( site.path );

		const finalizeImages = async (
			content: string,
			fileBase: string
		): Promise< { content: string; generated: number; failed: number } > => {
			if ( ! withImages ) {
				return { content, generated: 0, failed: 0 };
			}
			if ( ! imagesOk ) {
				return { content: stripAiImagePlaceholders( content ), generated: 0, failed: 0 };
			}
			const resolution = await resolveAiImagesInHtml( content, async ( bytes, ctx ) => {
				const fileName = `${ fileBase }-${ ctx.index }.png`;
				await mkdir( wsgUploads, { recursive: true } );
				await writeFile( path.join( wsgUploads, fileName ), bytes );
				return `${ siteUrl }/wp-content/uploads/wsg/${ fileName }`;
			} );
			return {
				content: resolution.html,
				generated: resolution.generated,
				failed: resolution.failed,
			};
		};

		// --- Phase 1: generate all content (no daemon held; runs for a while). ---

		const pagePrepared = await runPooled(
			pageTargets.map( ( target ) => async () => {
				try {
					const rawBody = await runGenerator( {
						name: 'page-content',
						specJson,
						task: `Page post type: ${ target.postType }\nPage slug: ${ target.slug }\nPage title: ${
							target.title
						}\nComposition brief: ${
							target.brief || '(none — infer from the spec and page title)'
						}\n\n${ vocabulary }`,
						maxTokens: 12_000,
						temperature: 0.6,
					} );
					// Reconcile any drifted block/postType identifiers to the canonical contract
					// before the markup is published.
					const body = reconcileMarkup( rawBody, contract ).html;
					const img = await finalizeImages( body, target.slug );
					const item: PreparedItem = {
						postType: target.postType,
						slug: target.slug,
						title: target.title,
						content: img.content,
						meta: {},
						isHome: target.isHome,
					};
					return {
						item,
						label: `${ target.postType }:${ target.slug }`,
						generated: img.generated,
						failed: img.failed,
						error: null as string | null,
					};
				} catch ( error ) {
					return {
						item: null as PreparedItem | null,
						label: `${ target.postType }:${ target.slug }`,
						generated: 0,
						failed: 0,
						error: error instanceof Error ? error.message : String( error ),
					};
				}
			} ),
			Math.min( Math.max( pageTargets.length, 1 ), 5 )
		);

		const cptPrepared = await runPooled(
			cptPlans.map( ( postType ) => async () => {
				try {
					const entries = await runCptEntries( specJson, postType, 4 );
					const items: PreparedItem[] = [];
					const usedSlugs = new Set< string >();
					let generated = 0;
					let failed = 0;
					for ( const entry of entries ) {
						let slug = deriveSlug( entry.title ) || postType.slug;
						const base = slug;
						let suffix = 1;
						while ( usedSlugs.has( slug ) ) {
							suffix += 1;
							slug = `${ base }-${ suffix }`;
						}
						usedSlugs.add( slug );
						const entryContent = reconcileMarkup( entry.content, contract ).html;
						const img = await finalizeImages( entryContent, `${ postType.slug }-${ slug }` );
						generated += img.generated;
						failed += img.failed;
						items.push( {
							postType: postType.slug,
							slug,
							title: entry.title,
							content: img.content,
							meta: entry.meta,
							isHome: false,
						} );
					}
					return { items, label: postType.slug, generated, failed, error: null as string | null };
				} catch ( error ) {
					return {
						items: [] as PreparedItem[],
						label: postType.slug,
						generated: 0,
						failed: 0,
						error: error instanceof Error ? error.message : String( error ),
					};
				}
			} ),
			Math.min( Math.max( cptPlans.length, 1 ), 4 )
		);

		const prepared: PreparedItem[] = [];
		const generationFailed: string[] = [];
		const cptCounts: string[] = [];
		let imagesGenerated = 0;
		let imagesFailed = 0;

		for ( const r of pagePrepared ) {
			imagesGenerated += r.generated;
			imagesFailed += r.failed;
			if ( r.item ) {
				prepared.push( r.item );
			} else {
				generationFailed.push( r.label );
			}
		}
		for ( const r of cptPrepared ) {
			imagesGenerated += r.generated;
			imagesFailed += r.failed;
			prepared.push( ...r.items );
			if ( r.error ) {
				generationFailed.push( `cpt:${ r.label }` );
			} else {
				cptCounts.push( `${ r.label }: ${ r.items.length }` );
			}
		}

		// --- Phase 2: write content files + upsert into the DB (one connection). ---

		const report = await withDaemon( async () => {
			if ( ! ( await isSiteRunning( site.id ) ) ) {
				throw new Error(
					`Site "${ site.name }" is not running. Start it with site_start, then re-run seed_content.`
				);
			}
			const abspath = await getAbspath( site.id );
			const seedDirHost = path.join( site.path, 'wp-content', 'uploads', 'wsg-seed' );
			await mkdir( seedDirHost, { recursive: true } );

			const created: string[] = [];
			const updated: string[] = [];
			const failed: string[] = [];
			let homeId: number | null = null;
			let firstPageId: number | null = null;

			for ( const item of prepared ) {
				const fileName =
					`${ item.postType }-${ item.slug }`.replace( /[^a-zA-Z0-9._-]/g, '-' ) + '.html';
				await writeFile( path.join( seedDirHost, fileName ), item.content, 'utf8' );
				// WP-CLI reads post content from this file path (no large arg over IPC).
				const wpPath = `${ abspath }wp-content/uploads/wsg-seed/${ fileName }`;

				const existingId = await findExistingPostId( site.id, item.postType, item.slug );
				let postId: number | null = existingId;

				if ( existingId ) {
					const result = await wpCli( site.id, [
						'post',
						'update',
						String( existingId ),
						wpPath,
						'--post_status=publish',
						`--post_title=${ item.title }`,
					] );
					if ( result.exitCode === 0 ) {
						updated.push( `${ item.postType }:${ item.slug }` );
					} else {
						failed.push(
							`${ item.postType }:${ item.slug } (${ ( result.stderr || result.stdout )
								.trim()
								.slice( 0, 120 ) })`
						);
						continue;
					}
				} else {
					const result = await wpCli( site.id, [
						'post',
						'create',
						wpPath,
						`--post_type=${ item.postType }`,
						`--post_name=${ item.slug }`,
						'--post_status=publish',
						`--post_title=${ item.title }`,
						'--porcelain',
					] );
					if ( result.exitCode === 0 ) {
						const match = result.stdout.match( /\b\d+\b/ );
						postId = match ? Number.parseInt( match[ 0 ], 10 ) : null;
						if ( ! ( postId && postId > 0 ) ) {
							postId = await findExistingPostId( site.id, item.postType, item.slug );
						}
						created.push( `${ item.postType }:${ item.slug }` );
					} else {
						failed.push(
							`${ item.postType }:${ item.slug } (${ ( result.stderr || result.stdout )
								.trim()
								.slice( 0, 120 ) })`
						);
						continue;
					}
				}

				if ( postId && postId > 0 ) {
					for ( const [ key, value ] of Object.entries( item.meta ) ) {
						await wpCli( site.id, [ 'post', 'meta', 'update', String( postId ), key, value ] );
					}
					if ( item.isHome ) {
						homeId = postId;
					}
					if ( item.postType === 'page' && firstPageId === null ) {
						firstPageId = postId;
					}
				}
			}

			if ( ! homeId && firstPageId && manifest.contentMode === 'homepage-and-pages' ) {
				homeId = firstPageId;
			}

			let frontPage = '';
			if ( homeId ) {
				const showOnFront = await wpCli( site.id, [ 'option', 'update', 'show_on_front', 'page' ] );
				const pageOnFront = await wpCli( site.id, [
					'option',
					'update',
					'page_on_front',
					String( homeId ),
				] );
				frontPage =
					showOnFront.exitCode === 0 && pageOnFront.exitCode === 0
						? `Set the home page (ID ${ homeId }) as the static front page.`
						: 'Could not set the static front page automatically.';
			}

			return { created, updated, failed, frontPage };
		} );

		const imageNote =
			withImages && ! imagesOk
				? 'AI images skipped — not logged into WordPress.com. Run `studio auth login`, then re-run seed_content (or run generate_image) to fill imagery. Placeholders were removed so nothing renders broken.'
				: '';

		const summary = [
			`Seeded content into ${ site.name }.`,
			`Created: ${ report.created.length ? report.created.join( ', ' ) : 'none' }`,
			`Updated: ${ report.updated.length ? report.updated.join( ', ' ) : 'none' }`,
			cptCounts.length ? `CPT entries: ${ cptCounts.join( ' · ' ) }` : '',
			generationFailed.length
				? `Content generation FAILED for: ${ generationFailed.join(
						', '
				  ) }. Re-run seed_content to fill them (upsert is idempotent).`
				: '',
			report.failed.length ? `Database write failed: ${ report.failed.join( '; ' ) }` : '',
			withImages && imagesOk
				? `AI images: ${ imagesGenerated } generated, ${ imagesFailed } failed.`
				: '',
			imageNote,
			report.frontPage,
			'',
			'NEXT: generate_image for any theme-level AI_IMAGE placeholders, then validate_and_fix_blocks + take_screenshot (viewport: "all") to verify.',
		]
			.filter( Boolean )
			.join( '\n' );

		return textResult( summary );
	}
);
