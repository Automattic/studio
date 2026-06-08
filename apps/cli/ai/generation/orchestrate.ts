import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { compileBlock } from 'cli/ai/generation/build-block';
import { runBlockGenerator, runGenerator, runManifest } from 'cli/ai/generation/generators';
import {
	contractFromManifest,
	contractVocabulary,
	reconcileBlockJsonName,
	reconcileMarkup,
	sanitizeCptArchiveSlugs,
} from 'cli/ai/generation/identifier-contract';
import { resolveAiImagesInHtml, stripAiImagePlaceholders } from 'cli/ai/generation/images';
import { runPooled } from 'cli/ai/generation/llm';
import {
	deriveSlug,
	pluginDir,
	themeDir,
	uploadsDir,
	writePackageFile,
} from 'cli/ai/generation/paths';
import { buildSeederPhp, parseSeederResult } from 'cli/ai/generation/seed-php';
import { isSiteRunning, withDaemon, wpCli } from 'cli/ai/generation/site-wp';
import { stripRemoteFontFaces } from 'cli/ai/generation/theme-guards';
import { activatePlugin, ensurePluginHeader } from 'cli/ai/tools/generate-companion-plugin';
import { activateTheme, ensureStyleHeader, renderFunctionsPhp } from 'cli/ai/tools/generate-theme';
import {
	collectPageTargets,
	getAbspath,
	runCptEntries,
	wpcomImagesAvailable,
	type PreparedItem,
} from 'cli/ai/tools/seed-content';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import type { BlockPlan, SiteManifest } from 'cli/ai/generation/manifest';
import type { SiteData } from 'cli/lib/cli-config/core';

/**
 * Slice G — single-pool site orchestration.
 *
 * The three generation tools (generate_theme, generate_companion_plugin,
 * seed_content) each ran their own bounded LLM pool then wrote, gated by their
 * single longest call (style.css ~14k, main plugin PHP ~12k) and serialised by
 * agent turns between them. This runs ALL generation — theme files, plugin main
 * + blocks, page bodies, CPT entries — as ONE flat pool so the long-poles
 * overlap the cheap fan-out, then applies every disk/DB write in a strict
 * deferred sequence. It reuses the tools' leaf helpers verbatim (no behaviour
 * change to them); only the orchestration is new.
 */

// Discriminated-union result the writer routes by `kind` after the pool resolves.
type GenResult =
	| { kind: 'theme-file'; rel: string; content: string; error: string | null }
	| { kind: 'plugin-main'; content: string; error: string | null }
	| {
			kind: 'plugin-block';
			block: BlockPlan;
			files: Record< string, string >;
			error: string | null;
	  }
	| {
			kind: 'page';
			item: PreparedItem | null;
			label: string;
			generated: number;
			failed: number;
			error: string | null;
	  }
	| {
			kind: 'cpt';
			items: PreparedItem[];
			label: string;
			generated: number;
			failed: number;
			error: string | null;
	  };

type FinalizeImages = (
	content: string,
	fileBase: string
) => Promise< { content: string; generated: number; failed: number } >;

// Mirror of seed_content's inline finalizeImages: generate + persist AI imagery
// during apply (PNG write + src rewrite stay atomically paired per image).
function makeFinalizeImages( opts: {
	withImages: boolean;
	imagesOk: boolean;
	wsgUploads: string;
	siteUrl: string;
} ): FinalizeImages {
	return async ( content, fileBase ) => {
		if ( ! opts.withImages ) {
			return { content, generated: 0, failed: 0 };
		}
		if ( ! opts.imagesOk ) {
			return { content: stripAiImagePlaceholders( content ), generated: 0, failed: 0 };
		}
		const resolution = await resolveAiImagesInHtml( content, async ( bytes, ctx ) => {
			const fileName = `${ fileBase }-${ ctx.index }.png`;
			await mkdir( opts.wsgUploads, { recursive: true } );
			await writeFile( path.join( opts.wsgUploads, fileName ), bytes );
			return `${ opts.siteUrl }/wp-content/uploads/wsg/${ fileName }`;
		} );
		return {
			content: resolution.html,
			generated: resolution.generated,
			failed: resolution.failed,
		};
	};
}

async function finalizePreparedItemImages(
	plan: SiteGenerationPlan,
	prepared: PreparedItem[]
): Promise< { prepared: PreparedItem[]; generated: number; failed: number } > {
	if ( ! plan.withImages || prepared.length === 0 ) {
		return { prepared, generated: 0, failed: 0 };
	}

	if ( ! plan.imagesOk ) {
		return {
			prepared: prepared.map( ( item ) => ( {
				...item,
				content: stripAiImagePlaceholders( item.content ),
			} ) ),
			generated: 0,
			failed: 0,
		};
	}

	const finalizeImages = makeFinalizeImages( {
		withImages: true,
		imagesOk: true,
		wsgUploads: uploadsDir( plan.site.path ),
		siteUrl: plan.siteUrl,
	} );
	const finalized: PreparedItem[] = [];
	let generated = 0;
	let failed = 0;

	for ( const item of prepared ) {
		const result = await finalizeImages( item.content, `${ item.postType }-${ item.slug }` );
		generated += result.generated;
		failed += result.failed;
		finalized.push( { ...item, content: result.content } );
	}

	return { prepared: finalized, generated, failed };
}

function errMessage( error: unknown ): string {
	return error instanceof Error ? error.message : String( error );
}

interface BuildCtx {
	specJson: string;
	design: string;
	vocabulary: string;
	contract: ReturnType< typeof contractFromManifest >;
	finalizeImages: FinalizeImages;
}

/**
 * Assemble the single flat task list across theme + plugin + content. Order
 * keeps the two long-pole singletons (style.css, main plugin PHP) early so the
 * pool starts them immediately; every task isolates its own failure so one bad
 * call never rejects the whole pool.
 */
export function buildSiteTasks(
	manifest: SiteManifest,
	ctx: BuildCtx
): Array< () => Promise< GenResult > > {
	const { specJson, design, vocabulary, contract, finalizeImages } = ctx;
	const tasks: Array< () => Promise< GenResult > > = [];

	// THEME — theme.json, style.css (★14k long-pole), parts, templates. Each task
	// is GUARDED: a single theme-file failure must not reject the whole pool (that
	// would discard the plugin + content work too); it is routed like the rest.
	const themeTask =
		( rel: string, run: () => Promise< string > ) => async (): Promise< GenResult > => {
			try {
				return { kind: 'theme-file', rel, content: await run(), error: null };
			} catch ( error ) {
				return { kind: 'theme-file', rel, content: '', error: errMessage( error ) };
			}
		};

	tasks.push(
		themeTask( 'theme.json', () =>
			runGenerator( { name: 'theme-json', specJson, design, maxTokens: 6_000, temperature: 0.4 } )
		)
	);
	tasks.push(
		themeTask( 'style.css', async () =>
			ensureStyleHeader(
				await runGenerator( {
					name: 'style-css',
					specJson,
					design,
					maxTokens: 14_000,
					temperature: 0.5,
				} ),
				manifest.themeName,
				manifest.themeSlug
			)
		)
	);
	for ( const part of manifest.parts ) {
		tasks.push(
			themeTask( `parts/${ part }.html`, () =>
				runGenerator( {
					name: 'template-part',
					specJson,
					design,
					task: `Part: ${ part }\nLayout mode: ${ manifest.layoutMode }\n\n${ vocabulary }`,
					maxTokens: 6_000,
					temperature: 0.5,
				} )
			)
		);
	}
	for ( const template of manifest.templates ) {
		tasks.push(
			themeTask( `templates/${ template }.html`, () =>
				runGenerator( {
					name: 'template',
					specJson,
					design,
					task: `Template: ${ template }\nLayout mode: ${ manifest.layoutMode }\nContent mode: ${ manifest.contentMode }\n\n${ vocabulary }`,
					maxTokens: 6_000,
					temperature: 0.5,
				} )
			)
		);
	}

	// PLUGIN — only when needed: main PHP (★12k long-pole) + one task per block.
	const plugin = manifest.companionPlugin;
	if ( plugin.needed ) {
		const planSummary = JSON.stringify(
			{ postTypes: plugin.postTypes, restRoutes: plugin.restRoutes, blocks: plugin.blocks },
			null,
			2
		);
		tasks.push( async () => {
			try {
				const content = await runGenerator( {
					name: 'companion-plugin',
					specJson,
					task: `Plugin name: ${ plugin.name }\nPlugin slug: ${ plugin.slug }\nGenerate the main plugin PHP file. Plan to implement:\n${ planSummary }\nRegister each block with register_block_type( __DIR__ . '/blocks/<block-slug>/build' ) — blocks are compiled from src/ to build/. Register each custom post type with its EXACT key and each REST route under the namespace '${ manifest.themePrefix }/v1'.\n\n${ vocabulary }`,
					maxTokens: 12_000,
					temperature: 0.3,
				} );
				return { kind: 'plugin-main', content, error: null };
			} catch ( error ) {
				return { kind: 'plugin-main', content: '', error: errMessage( error ) };
			}
		} );
		for ( const block of plugin.blocks ) {
			tasks.push( async () => {
				try {
					const generated = await runBlockGenerator(
						specJson,
						`Block slug: ${ block.slug }\nBlock title: ${ block.title }\nPurpose: ${ block.purpose }\nBlock namespace (block.json "name"): ${ manifest.themePrefix }/${ block.slug } — use this EXACT name.\n\n${ vocabulary }`
					);
					return { kind: 'plugin-block', block, files: generated.files, error: null };
				} catch ( error ) {
					return { kind: 'plugin-block', block, files: {}, error: errMessage( error ) };
				}
			} );
		}
	}

	// CONTENT — page bodies (incl. native posts) and one task per CPT batch.
	for ( const target of collectPageTargets( manifest ) ) {
		tasks.push( async () => {
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
				const img = await finalizeImages( reconcileMarkup( rawBody, contract ).html, target.slug );
				const item: PreparedItem = {
					postType: target.postType,
					slug: target.slug,
					title: target.title,
					content: img.content,
					meta: {},
					isHome: target.isHome,
				};
				return {
					kind: 'page',
					item,
					label: `${ target.postType }:${ target.slug }`,
					generated: img.generated,
					failed: img.failed,
					error: null,
				};
			} catch ( error ) {
				return {
					kind: 'page',
					item: null,
					label: `${ target.postType }:${ target.slug }`,
					generated: 0,
					failed: 0,
					error: errMessage( error ),
				};
			}
		} );
	}
	const cptPlans = plugin.needed ? plugin.postTypes : [];
	for ( const postType of cptPlans ) {
		tasks.push( async () => {
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
					const img = await finalizeImages(
						reconcileMarkup( entry.content, contract ).html,
						`${ postType.slug }-${ slug }`
					);
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
				return { kind: 'cpt', items, label: postType.slug, generated, failed, error: null };
			} catch ( error ) {
				return {
					kind: 'cpt',
					items: [],
					label: postType.slug,
					generated: 0,
					failed: 0,
					error: errMessage( error ),
				};
			}
		} );
	}

	return tasks;
}

export interface RoutedResults {
	themeFiles: Array< { rel: string; content: string } >;
	pluginMain: string | null;
	pluginBlocks: Array< { block: BlockPlan; files: Record< string, string > } >;
	prepared: PreparedItem[];
	generationFailed: string[];
	pluginBlockGenFailures: string[];
	cptCounts: string[];
	imagesGenerated: number;
	imagesFailed: number;
}

/** Pure router: fold the flat pool results into grouped, write-ready buckets. */
export function routeResults( results: GenResult[] ): RoutedResults {
	const out: RoutedResults = {
		themeFiles: [],
		pluginMain: null,
		pluginBlocks: [],
		prepared: [],
		generationFailed: [],
		pluginBlockGenFailures: [],
		cptCounts: [],
		imagesGenerated: 0,
		imagesFailed: 0,
	};
	for ( const r of results ) {
		switch ( r.kind ) {
			case 'theme-file':
				if ( r.error ) {
					out.generationFailed.push( `theme:${ r.rel }` );
				} else {
					out.themeFiles.push( { rel: r.rel, content: r.content } );
				}
				break;
			case 'plugin-main':
				if ( r.error || ! r.content ) {
					out.generationFailed.push(
						`plugin-main${ r.error ? ` (${ r.error.slice( 0, 80 ) })` : '' }`
					);
				} else {
					out.pluginMain = r.content;
				}
				break;
			case 'plugin-block':
				if ( r.error ) {
					out.pluginBlockGenFailures.push( `${ r.block.slug } (${ r.error.slice( 0, 120 ) })` );
				} else {
					out.pluginBlocks.push( { block: r.block, files: r.files } );
				}
				break;
			case 'page':
				out.imagesGenerated += r.generated;
				out.imagesFailed += r.failed;
				if ( r.item ) {
					out.prepared.push( r.item );
				} else {
					out.generationFailed.push( r.label );
				}
				break;
			case 'cpt':
				out.imagesGenerated += r.generated;
				out.imagesFailed += r.failed;
				out.prepared.push( ...r.items );
				if ( r.error ) {
					out.generationFailed.push( `cpt:${ r.label }` );
				} else {
					out.cptCounts.push( `${ r.label }: ${ r.items.length }` );
				}
				break;
		}
	}
	return out;
}

// Single-pass seed (mirror of seed_content Phase 2): write content + manifest +
// the seeder PHP, then ONE wp eval-file upserts everything and sets the front page.
async function seedPreparedItems(
	site: SiteData,
	prepared: PreparedItem[],
	contentMode: string
): Promise< { created: string[]; updated: string[]; failed: string[]; frontPage: string } > {
	return withDaemon( async () => {
		if ( ! ( await isSiteRunning( site.id ) ) ) {
			throw new Error(
				`Site "${ site.name }" is not running. Start it with site_start, then re-run.`
			);
		}
		const abspath = await getAbspath( site.id );
		const seedDirHost = path.join( site.path, 'wp-content', 'uploads', 'wsg-seed' );
		await mkdir( seedDirHost, { recursive: true } );

		const seedItems = prepared.map( ( item ) => ( {
			postType: item.postType,
			slug: item.slug,
			title: item.title,
			contentFile: `${ item.postType }-${ item.slug }`.replace( /[^a-zA-Z0-9._-]/g, '-' ) + '.html',
			meta: item.meta,
			isHome: item.isHome,
		} ) );
		await Promise.all(
			prepared.map( ( item, i ) =>
				writeFile( path.join( seedDirHost, seedItems[ i ].contentFile ), item.content, 'utf8' )
			)
		);
		await writeFile(
			path.join( seedDirHost, '_seed-manifest.json' ),
			JSON.stringify( { items: seedItems, contentMode } )
		);
		await writeFile( path.join( seedDirHost, '_seed.php' ), buildSeederPhp(), 'utf8' );

		const seederResult = await wpCli( site.id, [
			'eval-file',
			`${ abspath }wp-content/uploads/wsg-seed/_seed.php`,
		] );
		if ( seederResult.exitCode !== 0 ) {
			throw new Error(
				`Content seeding failed: ${ ( seederResult.stderr || seederResult.stdout )
					.trim()
					.slice( 0, 200 ) }`
			);
		}
		const seeded = parseSeederResult( seederResult.stdout );
		const frontPage = seeded.homeId
			? seeded.frontSet
				? `Set the home page (ID ${ seeded.homeId }) as the static front page.`
				: 'Could not set the static front page automatically.'
			: '';
		return { created: seeded.created, updated: seeded.updated, failed: seeded.failed, frontPage };
	} );
}

export type SiteGenerationMode = 'guided' | 'one-shot';

export type SiteGenerationPhase = 'plan' | 'generate-artifacts' | 'validate' | 'apply' | 'polish';

export interface SiteGenerationServices {
	signal?: AbortSignal;
	onProgress?: ( message: string, update?: boolean ) => void;
}

export interface SiteGenerationPlan {
	phase: 'plan';
	mode: SiteGenerationMode;
	site: SiteData;
	specJson: string;
	design: string;
	manifest: SiteManifest;
	contract: ReturnType< typeof contractFromManifest >;
	vocabulary: string;
	themeSlug: string;
	themeDirectory: string;
	pluginDirectory: string;
	siteUrl: string;
	withImages: boolean;
	imagesOk: boolean;
}

export interface GeneratedSiteArtifacts {
	phase: 'generate-artifacts';
	manifest: SiteManifest;
	routed: RoutedResults;
	taskCount: number;
	imagesPersisted: boolean;
}

export interface ValidatedSiteArtifacts {
	phase: 'validate';
	styleOk: boolean;
	pluginFailed: boolean;
	blockFailures: string[];
	generationFailed: string[];
}

interface SeedReport {
	created: string[];
	updated: string[];
	failed: string[];
	frontPage: string;
}

export interface AppliedSiteGeneration {
	phase: 'apply';
	themeWritten: string[];
	pluginWritten: string[];
	blockFailures: string[];
	themeActivation: string;
	pluginActivation: string;
	seedReport: SeedReport;
	seedNote: string;
	imageNote: string;
	imagesGenerated: number;
	imagesFailed: number;
}

export interface StagedSiteGeneration {
	runId: string;
	filePath: string;
}

export interface SiteGenerationRun {
	phase: 'polish';
	mode: SiteGenerationMode;
	plan: SiteGenerationPlan;
	artifacts: GeneratedSiteArtifacts;
	validation: ValidatedSiteArtifacts;
	applied?: AppliedSiteGeneration;
	staged?: StagedSiteGeneration;
	summary: string;
}

export interface OrchestratedResult {
	manifest: SiteManifest;
	summary: string;
	mode: SiteGenerationMode;
	applied: boolean;
}

function throwIfAborted( signal?: AbortSignal ): void {
	if ( signal?.aborted ) {
		throw new Error( 'Site generation was cancelled.' );
	}
}

function reportProgress(
	services: SiteGenerationServices | undefined,
	message: string,
	update = true
): void {
	services?.onProgress?.( message, update );
}

const STAGED_GENERATION_VERSION = 1;

interface StoredSiteGenerationPlan {
	siteId: string;
	siteName: string;
	mode: SiteGenerationMode;
	specJson: string;
	design: string;
	manifest: SiteManifest;
	withImages: boolean;
}

interface StoredSiteGenerationRun {
	version: typeof STAGED_GENERATION_VERSION;
	runId: string;
	createdAt: string;
	plan: StoredSiteGenerationPlan;
	artifacts: GeneratedSiteArtifacts;
	validation: ValidatedSiteArtifacts;
}

function stagedGenerationDir(): string {
	return path.join( tmpdir(), 'studio-site-generation' );
}

function stagedGenerationPath( runId: string ): string {
	if ( ! /^[a-f0-9-]{36}$/i.test( runId ) ) {
		throw new Error( 'Invalid stagedRunId.' );
	}
	return path.join( stagedGenerationDir(), `${ runId }.json` );
}

export async function stageSiteGeneration(
	plan: SiteGenerationPlan,
	artifacts: GeneratedSiteArtifacts,
	validation: ValidatedSiteArtifacts
): Promise< StagedSiteGeneration > {
	const runId = randomUUID();
	const filePath = stagedGenerationPath( runId );
	const stored: StoredSiteGenerationRun = {
		version: STAGED_GENERATION_VERSION,
		runId,
		createdAt: new Date().toISOString(),
		plan: {
			siteId: plan.site.id,
			siteName: plan.site.name,
			mode: plan.mode,
			specJson: plan.specJson,
			design: plan.design,
			manifest: plan.manifest,
			withImages: plan.withImages,
		},
		artifacts,
		validation,
	};
	await mkdir( stagedGenerationDir(), { recursive: true } );
	await writeFile( filePath, JSON.stringify( stored ), 'utf8' );
	return { runId, filePath };
}

export async function loadStagedSiteGeneration(
	runId: string,
	site: SiteData
): Promise< {
	plan: SiteGenerationPlan;
	artifacts: GeneratedSiteArtifacts;
	validation: ValidatedSiteArtifacts;
} > {
	const filePath = stagedGenerationPath( runId );
	const stored = JSON.parse( await readFile( filePath, 'utf8' ) ) as StoredSiteGenerationRun;
	if ( stored.version !== STAGED_GENERATION_VERSION ) {
		throw new Error( 'Unsupported staged site generation payload.' );
	}
	if ( stored.plan.siteId !== site.id ) {
		throw new Error(
			`Staged generation ${ runId } belongs to "${ stored.plan.siteName }", not "${ site.name }".`
		);
	}

	const manifest = stored.plan.manifest;
	const contract = contractFromManifest( manifest );
	const plugin = manifest.companionPlugin;
	const plan: SiteGenerationPlan = {
		phase: 'plan',
		mode: stored.plan.mode,
		site,
		specJson: stored.plan.specJson,
		design: stored.plan.design,
		manifest,
		contract,
		vocabulary: contractVocabulary( manifest ),
		themeSlug: manifest.themeSlug,
		themeDirectory: themeDir( site.path, manifest.themeSlug ),
		pluginDirectory: pluginDir( site.path, plugin.slug ),
		siteUrl: getSiteUrl( site ).replace( /\/+$/, '' ),
		withImages: stored.plan.withImages,
		imagesOk: stored.plan.withImages && ( await wpcomImagesAvailable() ),
	};
	const artifacts = stored.artifacts;
	const validation = validateSiteArtifacts( plan, artifacts );

	return { plan, artifacts, validation };
}

export async function planSiteGeneration( args: {
	site: SiteData;
	specJson: string;
	design: string;
	manifest?: SiteManifest;
	withImages: boolean;
	mode?: SiteGenerationMode;
	services?: SiteGenerationServices;
} ): Promise< SiteGenerationPlan > {
	throwIfAborted( args.services?.signal );
	const { site, specJson, design } = args;
	const manifest = args.manifest ?? ( await runManifest( specJson ) );
	const contract = contractFromManifest( manifest );
	const vocabulary = contractVocabulary( manifest );
	const slug = manifest.themeSlug;
	const tDir = themeDir( site.path, slug );
	const plugin = manifest.companionPlugin;
	const pDir = pluginDir( site.path, plugin.slug );
	const withImages = args.withImages;
	const imagesOk = withImages && ( await wpcomImagesAvailable() );
	const siteUrl = getSiteUrl( site ).replace( /\/+$/, '' );
	throwIfAborted( args.services?.signal );

	return {
		phase: 'plan',
		mode: args.mode ?? 'one-shot',
		site,
		specJson,
		design,
		manifest,
		contract,
		vocabulary,
		themeSlug: slug,
		themeDirectory: tDir,
		pluginDirectory: pDir,
		siteUrl,
		withImages,
		imagesOk,
	};
}

export async function generateSiteArtifacts(
	plan: SiteGenerationPlan,
	services: SiteGenerationServices = {},
	options: { persistImages?: boolean } = {}
): Promise< GeneratedSiteArtifacts > {
	throwIfAborted( services.signal );
	const persistImages = options.persistImages ?? false;
	const finalizeImages: FinalizeImages = persistImages
		? makeFinalizeImages( {
				withImages: plan.withImages,
				imagesOk: plan.imagesOk,
				wsgUploads: uploadsDir( plan.site.path ),
				siteUrl: plan.siteUrl,
		  } )
		: async ( content ) => ( { content, generated: 0, failed: 0 } );

	// --- ONE pool: every generation call across theme + plugin + content. ---
	const tasks = buildSiteTasks( plan.manifest, {
		specJson: plan.specJson,
		design: plan.design,
		vocabulary: plan.vocabulary,
		contract: plan.contract,
		finalizeImages,
	} );
	reportProgress( services, `Generating ${ tasks.length } site artifacts...`, false );
	const results = await runPooled( tasks, {
		concurrency: 8,
		signal: services.signal,
		onProgress: ( completed ) => {
			reportProgress( services, `Generated ${ completed }/${ tasks.length } site artifacts...` );
		},
	} );
	const routed = routeResults( results );

	return {
		phase: 'generate-artifacts',
		manifest: plan.manifest,
		routed,
		taskCount: tasks.length,
		imagesPersisted: persistImages && plan.withImages && plan.imagesOk,
	};
}

export function validateSiteArtifacts(
	plan: SiteGenerationPlan,
	artifacts: GeneratedSiteArtifacts
): ValidatedSiteArtifacts {
	const routed = artifacts.routed;
	const plugin = plan.manifest.companionPlugin;
	const pluginFailed = plugin.needed && ! routed.pluginMain;
	const styleOk = routed.themeFiles.some( ( file ) => file.rel === 'style.css' );

	return {
		phase: 'validate',
		styleOk,
		pluginFailed,
		blockFailures: [ ...routed.pluginBlockGenFailures ],
		generationFailed: [ ...routed.generationFailed ],
	};
}

export async function applyGeneratedSite(
	plan: SiteGenerationPlan,
	artifacts: GeneratedSiteArtifacts,
	validation: ValidatedSiteArtifacts,
	services: SiteGenerationServices = {}
): Promise< AppliedSiteGeneration > {
	throwIfAborted( services.signal );
	const { site, manifest } = plan;
	const slug = plan.themeSlug;
	const plugin = manifest.companionPlugin;
	const routed = artifacts.routed;
	const tDir = plan.themeDirectory;
	const pDir = plan.pluginDirectory;

	// --- Deferred writes, strict order (nothing above wrote to disk/DB). ---

	// 1. Theme files (reconcile markup) + functions.php.
	reportProgress( services, 'Writing generated theme files...', false );
	const themeWritten: string[] = [];
	for ( const file of routed.themeFiles ) {
		let content = file.content;
		if ( file.rel.endsWith( '.html' ) ) {
			content = reconcileMarkup( file.content, plan.contract ).html;
		} else if ( file.rel === 'theme.json' ) {
			content = stripRemoteFontFaces( file.content ).json;
		}
		await writePackageFile( tDir, file.rel, content );
		themeWritten.push( file.rel );
	}
	await writePackageFile( tDir, 'functions.php', renderFunctionsPhp( manifest.themeName, slug ) );
	themeWritten.push( 'functions.php' );

	// 2-3. Plugin main PHP, then each block (write src/ → compile → build/).
	reportProgress( services, 'Writing and compiling generated plugin files...' );
	const pluginWritten: string[] = [];
	const blockFailures = [ ...validation.blockFailures ];
	if ( plugin.needed && routed.pluginMain ) {
		const pluginMain = sanitizeCptArchiveSlugs(
			routed.pluginMain,
			manifest.pages.map( ( page ) => page.slug )
		).php;
		await writePackageFile(
			pDir,
			`${ plugin.slug }.php`,
			ensurePluginHeader( pluginMain, plugin.name, plugin.slug )
		);
		pluginWritten.push( `${ plugin.slug }.php` );
		for ( const { block, files } of routed.pluginBlocks ) {
			const srcRel = `blocks/${ block.slug }/src`;
			for ( const [ rel, content ] of Object.entries( files ) ) {
				const finalContent = rel.endsWith( 'block.json' )
					? reconcileBlockJsonName( content, block.slug, plan.contract ).json
					: content;
				await writePackageFile( pDir, `${ srcRel }/${ rel }`, finalContent );
			}
			try {
				await compileBlock(
					path.join( pDir, 'blocks', block.slug, 'src' ),
					path.join( pDir, 'blocks', block.slug, 'build' )
				);
				pluginWritten.push( `blocks/${ block.slug }/build/` );
			} catch ( compileError ) {
				blockFailures.push(
					`${ block.slug } (compile: ${ errMessage( compileError ).slice( 0, 120 ) })`
				);
			}
		}
	}

	// 4-5. Activate theme (only if style.css was generated — WordPress won't
	// recognise a theme without it), then plugin (registers from build/, now present).
	reportProgress( services, 'Activating generated packages...' );
	const themeActivation = validation.styleOk
		? await activateTheme( site.id, slug )
		: 'Theme NOT activated — style.css generation failed; re-run generate_site (idempotent).';
	const pluginActivation =
		plugin.needed && routed.pluginMain ? await activatePlugin( site.id, plugin.slug ) : '';

	// 6. Seed content (one DB pass), after activation.
	let seedReport = {
		created: [] as string[],
		updated: [] as string[],
		failed: [] as string[],
		frontPage: '',
	};
	let seedNote = '';
	// When the plugin failed to generate, its CPTs were never registered — seeding
	// CPT entries under an unregistered post type would orphan them, so seed only
	// pages/posts in that case.
	const seedable = validation.pluginFailed
		? routed.prepared.filter( ( item ) => item.postType === 'page' || item.postType === 'post' )
		: routed.prepared;
	let imageReport = { prepared: seedable, generated: 0, failed: 0 };
	if ( seedable.length > 0 ) {
		try {
			reportProgress( services, 'Resolving generated content images...' );
			imageReport = await finalizePreparedItemImages( plan, seedable );
			const generated =
				imageReport.generated > 0 ? ` (${ imageReport.generated } images generated)` : '';
			reportProgress( services, `Preparing content seed${ generated }...` );
			seedReport = await seedPreparedItems( site, imageReport.prepared, manifest.contentMode );
		} catch ( error ) {
			seedNote = errMessage( error );
		}
	}

	const imageNote =
		plan.withImages && ! plan.imagesOk
			? 'AI images skipped — not logged into WordPress.com. Run `studio auth login`, then re-run to fill imagery.'
			: '';

	return {
		phase: 'apply',
		themeWritten,
		pluginWritten,
		blockFailures,
		themeActivation,
		pluginActivation,
		seedReport,
		seedNote,
		imageNote,
		imagesGenerated: imageReport.generated,
		imagesFailed: imageReport.failed,
	};
}

export function summarizeSiteGeneration(
	plan: SiteGenerationPlan,
	artifacts: GeneratedSiteArtifacts,
	validation: ValidatedSiteArtifacts,
	applied?: AppliedSiteGeneration,
	staged?: StagedSiteGeneration
): string {
	const { manifest } = plan;
	const plugin = manifest.companionPlugin;
	const routed = artifacts.routed;
	if ( ! applied ) {
		return [
			`Generated site artifacts for '${ manifest.themeName }' in ${ plan.mode } mode.`,
			'No files were written, no theme/plugin was activated, and no WordPress database content was changed.',
			`Theme plan: wp-content/themes/${ plan.themeSlug }/ (${ routed.themeFiles.length } generated files + functions.php planned).`,
			validation.pluginFailed
				? 'Plugin plan: FAILED to generate main PHP — review or re-run before applying.'
				: plugin.needed
				? `Plugin plan: wp-content/plugins/${ plugin.slug }/ (${ routed.pluginBlocks.length } generated blocks + main PHP planned).`
				: 'Plugin plan: none (brochure site).',
			`Content prepared for review: ${ routed.prepared.length } items.`,
			validation.blockFailures.length
				? `Blocks FAILED: ${ validation.blockFailures.join( '; ' ) }`
				: '',
			validation.generationFailed.length
				? `Generation FAILED for: ${ validation.generationFailed.join(
						', '
				  ) } (re-run is idempotent).`
				: '',
			plan.withImages
				? artifacts.imagesPersisted
					? `AI images: ${ routed.imagesGenerated } generated, ${ routed.imagesFailed } failed.`
					: 'AI images deferred until apply mode so the guided review run stays side-effect free.'
				: '',
			staged ? `STAGED_RUN_ID: ${ staged.runId }` : '',
			staged ? `Review artifact: ${ staged.filePath }` : '',
			'',
			staged
				? `NEXT: review the manifest and generated artifact plan. To apply these exact artifacts, re-run generate_site with stagedRunId: "${ staged.runId }" and apply: true.`
				: 'NEXT: review the manifest and generated direction. To apply, re-run generate_site with mode: "one-shot" or apply: true.',
			'',
			'MANIFEST (pass verbatim to the next tools):',
			JSON.stringify( manifest ),
		]
			.filter( Boolean )
			.join( '\n' );
	}

	return [
		`Generated site '${ manifest.themeName }' in one pass.`,
		`Theme: wp-content/themes/${ plan.themeSlug }/ (${ applied.themeWritten.length } files) — ${ applied.themeActivation }`,
		validation.pluginFailed
			? 'Plugin: FAILED to generate main PHP — not written or activated; CPT content skipped. Re-run generate_site.'
			: plugin.needed
			? `Plugin: wp-content/plugins/${ plugin.slug }/ (${ applied.pluginWritten.length } files) — ${ applied.pluginActivation }`
			: 'Plugin: none (brochure site).',
		! validation.pluginFailed && applied.blockFailures.length
			? `Blocks FAILED: ${ applied.blockFailures.join( '; ' ) }`
			: '',
		`Seeded — created: ${ applied.seedReport.created.length }, updated: ${
			applied.seedReport.updated.length
		}${
			applied.seedReport.failed.length
				? `, DB failed: ${ applied.seedReport.failed.join( '; ' ) }`
				: ''
		}.`,
		routed.cptCounts.length ? `CPT entries: ${ routed.cptCounts.join( ' · ' ) }` : '',
		validation.generationFailed.length
			? `Content generation FAILED for: ${ validation.generationFailed.join(
					', '
			  ) } (re-run is idempotent).`
			: '',
		plan.withImages && plan.imagesOk
			? `AI images: ${ applied.imagesGenerated } generated, ${ applied.imagesFailed } failed.`
			: '',
		applied.imageNote,
		applied.seedNote ? `Seeding error: ${ applied.seedNote }` : applied.seedReport.frontPage,
		'',
		'NEXT: generate_image for theme-level AI_IMAGE placeholders, then validate_and_fix_blocks + take_screenshot (viewport: "all") to verify.',
		'',
		'MANIFEST (pass verbatim to the next tools):',
		JSON.stringify( manifest ),
	]
		.filter( Boolean )
		.join( '\n' );
}

export async function runSiteGeneration( args: {
	site: SiteData;
	specJson: string;
	design: string;
	manifest?: SiteManifest;
	withImages: boolean;
	mode?: SiteGenerationMode;
	apply?: boolean;
	stagedRunId?: string;
	services?: SiteGenerationServices;
} ): Promise< SiteGenerationRun > {
	const services = args.services ?? {};

	if ( args.stagedRunId ) {
		reportProgress( services, 'Loading staged site generation artifacts...', false );
		const loaded = await loadStagedSiteGeneration( args.stagedRunId, args.site );
		const plan = { ...loaded.plan, mode: args.mode ?? loaded.plan.mode };
		const shouldApply = args.apply ?? true;
		const applied = shouldApply
			? await applyGeneratedSite( plan, loaded.artifacts, loaded.validation, services )
			: undefined;
		const staged = shouldApply
			? undefined
			: { runId: args.stagedRunId, filePath: stagedGenerationPath( args.stagedRunId ) };
		const summary = summarizeSiteGeneration(
			plan,
			loaded.artifacts,
			loaded.validation,
			applied,
			staged
		);

		return {
			phase: 'polish',
			mode: plan.mode,
			plan,
			artifacts: loaded.artifacts,
			validation: loaded.validation,
			applied,
			staged,
			summary,
		};
	}

	const mode = args.mode ?? ( args.apply === false ? 'guided' : 'one-shot' );
	const shouldApply = args.apply ?? mode === 'one-shot';

	reportProgress( services, 'Planning generated site architecture...', false );
	const plan = await planSiteGeneration( { ...args, mode, services } );
	const artifacts = await generateSiteArtifacts( plan, services, {
		persistImages: false,
	} );
	const validation = validateSiteArtifacts( plan, artifacts );
	const applied = shouldApply
		? await applyGeneratedSite( plan, artifacts, validation, services )
		: undefined;
	const staged = shouldApply ? undefined : await stageSiteGeneration( plan, artifacts, validation );
	const summary = summarizeSiteGeneration( plan, artifacts, validation, applied, staged );

	return {
		phase: 'polish',
		mode,
		plan,
		artifacts,
		validation,
		applied,
		staged,
		summary,
	};
}

export async function generateSite( args: {
	site: SiteData;
	specJson: string;
	design: string;
	manifest?: SiteManifest;
	withImages: boolean;
	stagedRunId?: string;
	services?: SiteGenerationServices;
} ): Promise< OrchestratedResult > {
	const run = await runSiteGeneration( {
		...args,
		mode: 'one-shot',
		apply: true,
	} );
	return {
		manifest: run.plan.manifest,
		summary: run.summary,
		mode: run.mode,
		applied: Boolean( run.applied ),
	};
}
