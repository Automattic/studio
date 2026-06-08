import path from 'path';
import { Type } from 'typebox';
import { compileBlock } from 'cli/ai/tools/site-generator/build-block';
import { runBlockGenerator, runGenerator } from 'cli/ai/tools/site-generator/generators';
import {
	contractFromManifest,
	contractVocabulary,
	reconcileBlockJsonName,
	sanitizeCptArchiveSlugs,
} from 'cli/ai/tools/site-generator/identifier-contract';
import { runPooled } from 'cli/ai/tools/site-generator/llm';
import { parseManifest } from 'cli/ai/tools/site-generator/manifest';
import { pluginDir, writePackageFile } from 'cli/ai/tools/site-generator/paths';
import { isSiteRunning, withDaemon, wpCli } from 'cli/ai/tools/site-generator/site-wp';
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

function renderPluginHeader( name: string, slug: string ): string {
	return `<?php
/**
 * Plugin Name: ${ name }
 * Description: Behaviour for the site — custom post types, REST routes, and build-less blocks. Lives in a plugin so it survives a theme switch.
 * Version: 0.1.0
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Text Domain: ${ slug }
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
`;
}

// The generator is told to include the header; guarantee it so WordPress
// recognises the plugin even if the model omitted it.
export function ensurePluginHeader( php: string, name: string, slug: string ): string {
	// A leading UTF-8 BOM before <?php breaks WordPress's plugin-header parser,
	// so strip it unconditionally — including when the model emitted a valid
	// header that happens to be BOM-prefixed.
	const clean = php.charCodeAt( 0 ) === 0xfeff ? php.slice( 1 ) : php;
	if ( /Plugin Name:/i.test( clean ) ) {
		return clean;
	}
	const body = clean.replace( /^\s*<\?php\s*/, '' );
	return `${ renderPluginHeader( name, slug ) }\n${ body }`;
}

export async function activatePlugin( siteId: string, slug: string ): Promise< string > {
	return withDaemon( async () => {
		if ( ! ( await isSiteRunning( siteId ) ) ) {
			return `Site is not running — plugin written but not activated. Start it (site_start), then run: wp plugin activate ${ slug }`;
		}
		const result = await wpCli( siteId, [ 'plugin', 'activate', slug ] );
		if ( result.exitCode !== 0 ) {
			const detail = ( result.stderr || result.stdout ).trim();
			return `Plugin written but activation failed${
				detail ? `: ${ detail }` : ''
			}. Activate manually with: wp plugin activate ${ slug }`;
		}
		return `Activated plugin '${ slug }'.`;
	} );
}

export const generateCompanionPluginTool = defineTool(
	'generate_companion_plugin',
	'Generates the companion plugin for a site: custom post types, taxonomies, post meta, REST routes, and JSX/React Gutenberg blocks authored under blocks/<slug>/src/ and compiled in-process to build/ via esbuild (editor uses @wordpress/* imports; front-end view.js stays plain DOM; no npm install, no webpack). Writes into wp-content/plugins/<slug>-functionality/ and activates it. This is where ALL site behaviour lives — keeping the theme pure presentation. Requires the manifest from generate_theme. No-ops when the manifest marks the companion plugin as not needed (brochure sites).',
	{
		nameOrPath: Type.String( {
			description: 'The site name or filesystem path of the target site.',
		} ),
		spec: Type.String( {
			description: 'The site spec as a JSON string (same one passed to generate_theme).',
		} ),
		manifest: Type.String( {
			description:
				'The file manifest JSON returned by generate_theme. Required — it declares the post types, REST routes, and blocks.',
		} ),
	},
	async ( args ) => {
		const site = await resolveSite( args.nameOrPath );
		const specJson = normalizeSpecJson( args.spec );
		const manifest = parseManifest( args.manifest );
		const plugin = manifest.companionPlugin;

		if ( ! plugin.needed ) {
			return textResult(
				'No companion plugin needed — the manifest marks this site as presentation-only (no custom post types, REST routes, or interactive blocks). Nothing generated.'
			);
		}

		const slug = plugin.slug;
		const dir = pluginDir( site.path, slug );
		const contract = contractFromManifest( manifest );
		const vocabulary = contractVocabulary( manifest );

		const planSummary = JSON.stringify(
			{ postTypes: plugin.postTypes, restRoutes: plugin.restRoutes, blocks: plugin.blocks },
			null,
			2
		);

		const mainPhpRaw = await runGenerator( {
			name: 'companion-plugin',
			specJson,
			task: `Plugin name: ${ plugin.name }\nPlugin slug: ${ slug }\nGenerate the main plugin PHP file. Plan to implement:\n${ planSummary }\nRegister each block with register_block_type( __DIR__ . '/blocks/<block-slug>/build' ) — blocks are compiled from src/ to build/. Register each custom post type with its EXACT key and each REST route under the namespace '${ manifest.themePrefix }/v1'.\n\n${ vocabulary }`,
			maxTokens: 12_000,
			temperature: 0.3,
		} );

		// Neutralise any CPT archive/rewrite slug that would shadow a page URL
		// (pages are the canonical collection surface; archives stay at the
		// theme-prefixed base) before the header is guaranteed and the file lands.
		const mainPhp = sanitizeCptArchiveSlugs(
			mainPhpRaw,
			manifest.pages.map( ( page ) => page.slug )
		).php;

		const written: string[] = [];
		await writePackageFile(
			dir,
			`${ slug }.php`,
			ensurePluginHeader( mainPhp, plugin.name, slug )
		);
		written.push( `${ slug }.php` );

		// Build-less blocks, generated in parallel, one directory each. A single
		// block failure must not abort the whole call and leave a half-written
		// plugin, so each is best-effort and failures are reported.
		const blockResults = await runPooled(
			plugin.blocks.map( ( block ) => async () => {
				try {
					const generated = await runBlockGenerator(
						specJson,
						`Block slug: ${ block.slug }\nBlock title: ${ block.title }\nPurpose: ${ block.purpose }\nBlock namespace (block.json "name"): ${ manifest.themePrefix }/${ block.slug } — use this EXACT name.\n\n${ vocabulary }`
					);
					return { block, files: generated.files, error: null as string | null };
				} catch ( error ) {
					return {
						block,
						files: {} as Record< string, string >,
						error: error instanceof Error ? error.message : String( error ),
					};
				}
			} ),
			8
		);

		const failedBlocks: string[] = [];
		for ( const { block, files, error } of blockResults ) {
			if ( error ) {
				failedBlocks.push( `${ block.slug } (${ error.slice( 0, 120 ) })` );
				continue;
			}
			const srcRel = `blocks/${ block.slug }/src`;
			for ( const [ rel, content ] of Object.entries( files ) ) {
				// Force the block.json name to the canonical {themePrefix}/{slug} even if
				// the generator drifted — content references must match this.
				const finalContent = rel.endsWith( 'block.json' )
					? reconcileBlockJsonName( content, block.slug, contract ).json
					: content;
				await writePackageFile( dir, `${ srcRel }/${ rel }`, finalContent );
				written.push( `${ srcRel }/${ rel }` );
			}
			// Compile the JSX src/ to build/ (esbuild, WordPress packages externalised
			// to wp.* globals). register_block_type points at build/.
			try {
				await compileBlock(
					path.join( dir, 'blocks', block.slug, 'src' ),
					path.join( dir, 'blocks', block.slug, 'build' )
				);
				written.push( `blocks/${ block.slug }/build/` );
			} catch ( compileError ) {
				failedBlocks.push(
					`${ block.slug } (compile: ${
						compileError instanceof Error
							? compileError.message.slice( 0, 120 )
							: String( compileError )
					})`
				);
			}
		}

		const activation = await activatePlugin( site.id, slug );

		const summary = [
			`Generated companion plugin '${ plugin.name }' at wp-content/plugins/${ slug }/`,
			'',
			`Post types: ${ plugin.postTypes.map( ( p ) => p.slug ).join( ', ' ) || 'none' }`,
			`REST routes: ${ plugin.restRoutes.map( ( r ) => r.path ).join( ', ' ) || 'none' }`,
			`Blocks (build-less plain JS): ${
				plugin.blocks.map( ( b ) => b.slug ).join( ', ' ) || 'none'
			}`,
			failedBlocks.length ? `Blocks that FAILED to generate: ${ failedBlocks.join( '; ' ) }` : '',
			'',
			'Files written:',
			...written.map( ( f ) => `  ${ f }` ),
			'',
			activation,
			'',
			'NEXT: seed_content to publish pages, then generate_image, then validate_and_fix_blocks + take_screenshot.',
		].join( '\n' );

		return textResult( summary );
	}
);
