import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectPortableCarryArtifact } from './portable-carry-artifact.js';

describe( 'projectPortableCarryArtifact', () => {
	it( 'replaces raw routes with scoped carry documents and retains localized assets', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'portable-carry-' ) );
		mkdirSync( join( outputDir, 'html' ) );
		mkdirSync( join( outputDir, 'screenshots' ) );
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<main>captured</main>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.test/': { slug: 'homepage' } },
			} )
		);
		writeFileSync(
			join( outputDir, 'output.wxr' ),
			'<rss><channel><link>https://example.test/</link><item>' +
				'<title>Example</title><link>https://example.test/</link>' +
				'<wp:post_type>page</wp:post_type><wp:post_name>home</wp:post_name>' +
				'</item></channel></rss>'
		);
		writeFileSync(
			join( outputDir, 'capture-receipt.json' ),
			JSON.stringify( {
				routes: [
					{ url: 'https://example.test/', path: 'website/index.html' },
					{ url: 'https://example.test/product/item', path: 'website/product/item/index.html' },
				],
			} )
		);
		const artifactPath = join( outputDir, 'artifact.json' );
		writeFileSync(
			artifactPath,
			JSON.stringify( {
				schema: 'blocks-engine/php-transformer/site-artifact/v1',
				entrypoint: 'website/index.html',
				files: [
					{
						path: 'website/index.html',
						content:
							'<link rel="canonical" href="/"><header class="header"><a href="/">Header</a></header><main><section class="hero">Hero</section></main><footer>Footer</footer>',
					},
					{
						path: 'website/product/item/index.html',
						content: '<main><h1>Unlisted Product</h1><div class="hero">Product</div></main>',
					},
					{ path: 'website/source.css', content: '.hero{color:red}.header{color:blue}' },
					{ path: 'website/media/hero.jpg', content_base64: 'aW1hZ2U=', encoding: 'base64' },
				],
			} )
		);

		projectPortableCarryArtifact( outputDir, artifactPath );

		const artifact = JSON.parse( readFileSync( artifactPath, 'utf8' ) );
		expect( artifact.theme_materialization ).toBe( 'classic' );
		expect( artifact.provenance.provider ).toBe( 'data-liberation/carry-reconstruction' );
		const files = new Map< string, { path: string; content?: string } >(
			artifact.files.map( ( file: { path: string; content?: string } ) => [ file.path, file ] )
		);
		expect( files.has( 'website/media/hero.jpg' ) ).toBe( true );
		expect( files.has( 'website/source.css' ) ).toBe( false );
		expect( files.get( 'website/index.html' )?.content ).toContain(
			'class="lib-carry-site lib-carry-page-home"'
		);
		expect( files.get( 'website/index.html' )?.content ).toContain( 'Header' );
		expect( files.get( 'website/index.html' )?.content ).toContain( 'Footer' );
		expect( files.get( 'website/index.html' )?.content ).toContain( 'href="/index.html"' );
		expect( files.get( 'website/index.html' )?.content ).not.toContain( 'rel="canonical"' );
		expect( files.get( 'website/product/item/index.html' )?.content ).toContain(
			'lib-carry-page-item'
		);
		const carryCss = artifact.files
			.filter( ( file: { path: string } ) => file.path.endsWith( '.css' ) )
			.map( ( file: { content: string } ) => file.content )
			.join( '\n' );
		expect( carryCss ).toContain( ':where(.lib-carry-site.lib-carry-page-home) .hero' );
		expect( carryCss ).not.toContain( 'body.lib-carry-site' );
	} );
} );
