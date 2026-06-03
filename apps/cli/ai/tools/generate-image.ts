import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { resolveAiImagesInHtml } from 'cli/ai/generation/images';
import { runPooled } from 'cli/ai/generation/llm';
import { themeDir, uploadsDir } from 'cli/ai/generation/paths';
import { aspectFromHint, generateImageBytes } from 'cli/ai/generation/wpcom-image';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

const SCAN_SUBDIRS = [ 'templates', 'parts', 'patterns' ];

async function listHtmlFiles( dir: string ): Promise< string[] > {
	const out: string[] = [];
	let entries;
	try {
		entries = await readdir( dir, { withFileTypes: true } );
	} catch {
		return out;
	}
	for ( const entry of entries ) {
		const full = path.join( dir, entry.name );
		if ( entry.isDirectory() ) {
			out.push( ...( await listHtmlFiles( full ) ) );
		} else if ( /\.(html|php)$/i.test( entry.name ) ) {
			out.push( full );
		}
	}
	return out;
}

function slugifyFileName( description: string, index: number ): string {
	const base = description
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, 40 );
	return `${ base || 'image' }-${ index }`;
}

export const generateImageTool = defineTool(
	'generate_image',
	'Generates AI imagery via the WordPress.com AI proxy (Google Imagen) and fills AI_IMAGE placeholders. Two modes: (1) pass themeSlug to scan the theme\'s templates/parts/patterns for `alt="AI_IMAGE: ..."` placeholders, generate each image into the theme\'s assets/images/, and rewrite the markup in place; (2) pass an explicit prompts list to generate standalone images saved to the uploads directory, returning their URLs. Requires WordPress.com authentication.',
	{
		nameOrPath: Type.String( {
			description: 'The site name or filesystem path of the target site.',
		} ),
		themeSlug: Type.Optional(
			Type.String( {
				description:
					"Scan this theme's templates/parts/patterns for AI_IMAGE placeholders and fill them in place.",
			} )
		),
		prompts: Type.Optional(
			Type.Array(
				Type.Object( {
					description: Type.String( { description: 'What the image depicts.' } ),
					style: Type.Optional(
						Type.String( {
							description: 'Visual style, e.g. "photographic", "minimalist illustration".',
						} )
					),
					aspect: Type.Optional(
						Type.String( {
							description: 'Aspect hint, e.g. "16:9", "square", "portrait", or "1792x1024".',
						} )
					),
				} ),
				{ description: 'Explicit image prompts to generate into the uploads directory.' }
			)
		),
	},
	async ( args ) => {
		const site = await resolveSite( args.nameOrPath );
		const siteUrl = getSiteUrl( site ).replace( /\/+$/, '' );

		if ( ! args.themeSlug && ( ! args.prompts || args.prompts.length === 0 ) ) {
			throw new Error(
				'Provide either themeSlug (to scan a theme) or a prompts list (to generate standalone images).'
			);
		}

		const lines: string[] = [];

		// Mode 1: scan a theme and fill placeholders in place.
		if ( args.themeSlug ) {
			const slug = args.themeSlug;
			const root = themeDir( site.path, slug );
			const assetsRel = path.join( 'assets', 'images' );
			const assetsAbs = path.join( root, assetsRel );

			const files: string[] = [];
			for ( const sub of SCAN_SUBDIRS ) {
				files.push( ...( await listHtmlFiles( path.join( root, sub ) ) ) );
			}

			let generated = 0;
			let failed = 0;
			let touched = 0;

			for ( const file of files ) {
				const html = await readFile( file, 'utf8' );
				const resolution = await resolveAiImagesInHtml( html, async ( bytes, ctx ) => {
					const name = `${ slugifyFileName( ctx.description, ctx.index ) }.png`;
					await mkdir( assetsAbs, { recursive: true } );
					await writeFile( path.join( assetsAbs, name ), bytes );
					return `${ siteUrl }/wp-content/themes/${ slug }/${ assetsRel.replace(
						/\\/g,
						'/'
					) }/${ name }`;
				} );
				generated += resolution.generated;
				failed += resolution.failed;
				if ( resolution.html !== html ) {
					await writeFile( file, resolution.html, 'utf8' );
					touched++;
				}
			}

			lines.push(
				`Theme scan (${ slug }): ${ generated } image(s) generated, ${ failed } failed, ${ touched } file(s) updated across ${ files.length } scanned.`
			);
		}

		// Mode 2: explicit prompts → uploads.
		if ( args.prompts && args.prompts.length > 0 ) {
			const wsgUploads = uploadsDir( site.path );
			await mkdir( wsgUploads, { recursive: true } );
			let failed = 0;

			const generated = await runPooled(
				args.prompts.map( ( prompt, i ) => async (): Promise< string | null > => {
					try {
						const bytes = await generateImageBytes(
							`${ prompt.description }.${
								prompt.style ? ` Style: ${ prompt.style }.` : ''
							} High quality, no text, no watermark.`,
							aspectFromHint( prompt.aspect )
						);
						const name = `${ slugifyFileName( prompt.description, i + 1 ) }.png`;
						await writeFile( path.join( wsgUploads, name ), bytes );
						return `${ siteUrl }/wp-content/uploads/wsg/${ name }`;
					} catch {
						return null;
					}
				} ),
				6
			);
			const urls = generated.filter( ( url ): url is string => url !== null );
			failed = generated.length - urls.length;

			lines.push( `Standalone images: ${ urls.length } generated, ${ failed } failed.` );
			urls.forEach( ( url ) => lines.push( `  ${ url }` ) );
		}

		return textResult( lines.join( '\n' ) );
	}
);
