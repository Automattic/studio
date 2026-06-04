import fs from 'fs';
import { copyFile, mkdir } from 'fs/promises';
import path from 'path';
import { runManifest } from 'cli/ai/generation/generators';
import {
	contractFromManifest,
	findRegisteredPostTypes,
	validateMarkup,
} from 'cli/ai/generation/identifier-contract';
import { createSiteTool } from 'cli/ai/tools/create-site';
import { deleteSiteTool } from 'cli/ai/tools/delete-site';
import { generateCompanionPluginTool } from 'cli/ai/tools/generate-companion-plugin';
import { generateDesignPreviewsTool } from 'cli/ai/tools/generate-design-previews';
import { generateImageTool } from 'cli/ai/tools/generate-image';
import { generateSiteTool } from 'cli/ai/tools/generate-site';
import { generateThemeTool } from 'cli/ai/tools/generate-theme';
import { seedContentTool } from 'cli/ai/tools/seed-content';
import { takeScreenshotTool } from 'cli/ai/tools/take-screenshot';
import { resolveSite } from 'cli/ai/tools/utils';
import { validateAndFixBlocksTool } from 'cli/ai/tools/validate-and-fix-blocks';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { evalSiteName, isDeletableEvalSite } from './safety';
import {
	analyzeCustomBlocks,
	checkExpectations,
	countBlocks,
	parseScreenshotPaths,
	parseValidation,
	type BlockCounts,
	type CaseResult,
} from './scorecard';
import type { EvalSpec } from './specs';
import type { SiteManifest } from 'cli/ai/generation/manifest';

export interface RunCaseOptions {
	runId: string;
	withImages: boolean;
	merged: boolean;
	keepSite: boolean;
	artifactsDir: string;
	log: ( message: string ) => void;
}

type ToolResultLike = { content: Array< { type: string; text?: string } > };

function toolText( result: ToolResultLike ): string {
	return result.content
		.filter( ( c ) => c.type === 'text' && typeof c.text === 'string' )
		.map( ( c ) => c.text as string )
		.join( '\n' );
}

function listHtmlFiles( dir: string ): string[] {
	try {
		return fs
			.readdirSync( dir )
			.filter( ( f ) => /\.html$/i.test( f ) )
			.map( ( f ) => path.join( dir, f ) )
			.sort();
	} catch {
		return [];
	}
}

function listSubdirs( dir: string ): string[] {
	try {
		return fs
			.readdirSync( dir, { withFileTypes: true } )
			.filter( ( e ) => e.isDirectory() )
			.map( ( e ) => e.name )
			.sort();
	} catch {
		return [];
	}
}

/**
 * Runs the full generation pipeline against one throwaway site, deterministically
 * (no agent), timing each stage and assembling a scorecard. A failed stage is
 * recorded and the run proceeds; the throwaway site is always torn down (unless
 * `keepSite`), gated by the `wsg-eval-` prefix guard.
 */
export async function runCase( spec: EvalSpec, opts: RunCaseOptions ): Promise< CaseResult > {
	const specJson = JSON.stringify( spec.spec );
	const siteName = evalSiteName( spec.caseId, opts.runId );
	const stageTimingsMs: Record< string, number > = {};
	const errors: { stage: string; message: string }[] = [];

	const result: CaseResult = { caseId: spec.caseId, siteName, ok: false, stageTimingsMs, errors };

	const time = async < T >( stage: string, fn: () => Promise< T > ): Promise< T | undefined > => {
		const startedAt = Date.now();
		try {
			opts.log( `  ${ spec.caseId }: ${ stage }…` );
			const value = await fn();
			stageTimingsMs[ stage ] = Date.now() - startedAt;
			return value;
		} catch ( error ) {
			stageTimingsMs[ stage ] = Date.now() - startedAt;
			const message = error instanceof Error ? error.message : String( error );
			errors.push( { stage, message } );
			opts.log( `  ${ spec.caseId }: ${ stage } FAILED — ${ message.slice( 0, 160 ) }` );
			return undefined;
		}
	};

	let siteCreated = false;
	let manifest: SiteManifest | undefined;

	try {
		// 1. Throwaway site (creates + starts).
		await time( 'createSite', async () => {
			await createSiteTool.rawHandler( { name: siteName } );
			siteCreated = true;
		} );
		if ( ! siteCreated ) {
			return finalize( result );
		}

		const site = await resolveSite( siteName );
		const siteUrl = getSiteUrl( site ).replace( /\/+$/, '' );

		// 2. Manifest.
		manifest = await time( 'manifest', () => runManifest( specJson ) );
		if ( manifest ) {
			result.manifest = {
				themeSlug: manifest.themeSlug,
				layoutMode: manifest.layoutMode,
				contentMode: manifest.contentMode,
				pages: manifest.pages.length,
				needsCompanionPlugin: manifest.companionPlugin.needed,
				plannedBlocks: manifest.companionPlugin.blocks.map( ( b ) => b.slug ),
				postTypes: manifest.companionPlugin.postTypes.map( ( p ) => p.slug ),
				restRoutes: manifest.companionPlugin.restRoutes.map( ( r ) => r.path ),
			};
		}
		const manifestJson = manifest ? JSON.stringify( manifest ) : undefined;

		// 3. Design directions → take design-1.html as the chosen direction.
		let design = '';
		await time( 'designPreviews', async () => {
			await generateDesignPreviewsTool.rawHandler( {
				nameOrPath: siteName,
				spec: specJson,
				directions: 2,
			} );
			const previewPath = path.join( site.path, 'design', 'design-1.html' );
			design = fs.existsSync( previewPath ) ? fs.readFileSync( previewPath, 'utf8' ) : '';
		} );

		// 4. Theme.
		if ( opts.merged ) {
			await time( 'site', () =>
				generateSiteTool.rawHandler( {
					nameOrPath: siteName,
					spec: specJson,
					design: design || undefined,
					manifest: manifestJson,
					withImages: opts.withImages,
				} )
			);
		}

		// 4. Theme (legacy path).
		if ( ! opts.merged )
			await time( 'theme', () =>
				generateThemeTool.rawHandler( {
					nameOrPath: siteName,
					spec: specJson,
					design: design || undefined,
					manifest: manifestJson,
				} )
			);

		// 5. Companion plugin (only when the manifest needs one).
		if ( ! opts.merged && manifest?.companionPlugin.needed && manifestJson ) {
			await time( 'companionPlugin', () =>
				generateCompanionPluginTool.rawHandler( {
					nameOrPath: siteName,
					spec: specJson,
					manifest: manifestJson,
				} )
			);
		}

		// 6. Seed content into the live DB.
		if ( ! opts.merged && manifestJson ) {
			await time( 'seed', () =>
				seedContentTool.rawHandler( {
					nameOrPath: siteName,
					spec: specJson,
					manifest: manifestJson,
					withImages: opts.withImages,
				} )
			);
		}

		// 7. Theme imagery (optional / requires wp.com login).
		if ( opts.withImages && manifest ) {
			await time( 'images', () =>
				generateImageTool.rawHandler( { nameOrPath: siteName, themeSlug: manifest!.themeSlug } )
			);
		}

		// 8. Measure block usage on disk (core + custom).
		const themeDir = manifest
			? path.join( site.path, 'wp-content', 'themes', manifest.themeSlug )
			: '';
		const seedDir = path.join( site.path, 'wp-content', 'uploads', 'wsg-seed' );
		const measuredFiles = [
			...( themeDir ? listHtmlFiles( path.join( themeDir, 'templates' ) ) : [] ),
			...( themeDir ? listHtmlFiles( path.join( themeDir, 'parts' ) ) : [] ),
			...listHtmlFiles( seedDir ),
		];
		const byFile: Record< string, BlockCounts > = {};
		let totalBlocks = 0;
		let totalWpHtml = 0;
		for ( const file of measuredFiles ) {
			const rel = path.relative( site.path, file );
			const counts = countBlocks( fs.readFileSync( file, 'utf8' ) );
			byFile[ rel ] = counts;
			totalBlocks += counts.total;
			totalWpHtml += counts.wpHtml;
		}
		result.coreBlocks = { byFile, totalBlocks, totalWpHtml };

		if ( manifest?.companionPlugin.needed ) {
			const pluginSlug = manifest.companionPlugin.slug;
			const generatedBlockSlugs = listSubdirs(
				path.join( site.path, 'wp-content', 'plugins', pluginSlug, 'blocks' )
			);
			result.customBlocks = analyzeCustomBlocks( manifest.companionPlugin, generatedBlockSlugs );

			// Verify the generated PHP actually registers the manifest's CPT keys.
			// A register_post_type drift orphans seeded entries even when content
			// references are canonical — the gap validateMarkup cannot see.
			const cptKeys = manifest.companionPlugin.postTypes.map( ( postType ) => postType.slug );
			let registered: string[] = [];
			try {
				registered = findRegisteredPostTypes(
					fs.readFileSync(
						path.join( site.path, 'wp-content', 'plugins', pluginSlug, `${ pluginSlug }.php` ),
						'utf8'
					)
				);
			} catch {
				registered = [];
			}
			result.cptsNotRegistered =
				registered.length > 0 ? cptKeys.filter( ( key ) => ! registered.includes( key ) ) : [];
		}

		// Identifier-contract check: after reconciliation, no custom-block reference
		// or Query Loop postType in the shipped markup should resolve to nothing
		// registered. Any residual here is a render bug (the class that left the
		// reservation block blank and the menu query showing the default post).
		if ( manifest ) {
			const contract = contractFromManifest( manifest );
			const identifierViolations: { file: string; type: string; ref: string }[] = [];
			for ( const file of measuredFiles ) {
				const rel = path.relative( site.path, file );
				for ( const v of validateMarkup( fs.readFileSync( file, 'utf8' ), contract, rel ) ) {
					identifierViolations.push( { file: rel, type: v.type, ref: v.ref } );
				}
			}
			result.identifierViolations = identifierViolations;
		}

		// 9. Validate block markup in the real editor (observational — pass content,
		//    do not mutate the generated files).
		await time( 'validate', async () => {
			const validationByFile: Record< string, { valid: number; total: number } > = {};
			let totalValid = 0;
			let totalValidated = 0;
			for ( const file of measuredFiles ) {
				const rel = path.relative( site.path, file );
				const res = await validateAndFixBlocksTool.rawHandler( {
					nameOrPath: siteName,
					content: fs.readFileSync( file, 'utf8' ),
				} );
				const parsed = parseValidation( toolText( res ) );
				if ( parsed ) {
					validationByFile[ rel ] = parsed;
					totalValid += parsed.valid;
					totalValidated += parsed.total;
				}
			}
			result.validation = { byFile: validationByFile, totalValid, totalBlocks: totalValidated };
		} );

		// 10. Screenshot (desktop + mobile); copy artifacts into the run dir.
		await time( 'screenshot', async () => {
			const res = await takeScreenshotTool.rawHandler( { url: siteUrl, viewport: 'all' } );
			const tempPaths = parseScreenshotPaths( toolText( res ) );
			await mkdir( opts.artifactsDir, { recursive: true } );
			const saved: string[] = [];
			for ( const tempPath of tempPaths ) {
				const dest = path.join(
					opts.artifactsDir,
					`${ spec.caseId }-${ path.basename( tempPath ) }`
				);
				try {
					await copyFile( tempPath, dest );
					saved.push( path.relative( opts.artifactsDir, dest ) );
				} catch {
					saved.push( tempPath );
				}
			}
			result.screenshots = saved;
		} );

		result.expectationsFailed = checkExpectations( spec.expects, result );
	} finally {
		if ( siteCreated && ! opts.keepSite ) {
			await time( 'teardown', async () => {
				if ( ! isDeletableEvalSite( siteName ) ) {
					throw new Error( `Refusing to delete non-eval site "${ siteName }".` );
				}
				await deleteSiteTool.rawHandler( { nameOrPath: siteName, deleteFiles: true } );
			} );
		}
	}

	return finalize( result );
}

function finalize( result: CaseResult ): CaseResult {
	result.ok = result.errors.length === 0;
	return result;
}
