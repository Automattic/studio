import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { getFrontendTemplate, scaffoldFrontend } from '../templates';
import type { SiteFrontend } from '@studio/common/lib/site-frontend';

vi.mock( 'cli/lib/frontend/server', () => ( { detectNodeRuntime: vi.fn() } ) );

function frontendFor( framework: SiteFrontend[ 'framework' ], frontendPath = '/tmp/frontend' ) {
	return {
		path: frontendPath,
		kind: framework === 'static' ? 'static' : 'command',
		framework,
		port: 3000,
		api: 'rest',
	} satisfies SiteFrontend;
}

const context = ( framework: SiteFrontend[ 'framework' ] ) => ( {
	siteName: 'My "Headless" <Site>',
	packageName: 'my-headless-site-frontend',
	wordpressUrl: 'http://localhost:8881',
	frontend: frontendFor( framework ),
} );

describe( 'frontend templates', () => {
	it( 'writes a static page that reads posts in the browser', () => {
		const files = getFrontendTemplate( 'static' )( context( 'static' ) );

		expect( Object.keys( files ).sort() ).toEqual( [
			'.gitignore',
			'AGENTS.md',
			'public/index.html',
			'public/studio.config.js',
		] );
		expect( files[ 'public/index.html' ] ).toContain(
			'window.WORDPRESS_URL = "http://localhost:8881";'
		);
		expect( files[ 'public/index.html' ] ).toContain( "'/wp-json/wp/v2' + path" );
		expect( files[ 'public/index.html' ] ).toContain( '/posts?_embed' );
		expect( files[ 'public/index.html' ] ).toContain(
			'<title>My &quot;Headless&quot; &lt;Site&gt;</title>'
		);
		expect( files[ 'public/studio.config.js' ] ).toContain( '"http://localhost:8881"' );
	} );

	it( 'writes an Astro project with a REST data layer', () => {
		const files = getFrontendTemplate( 'astro' )( context( 'astro' ) );

		expect( JSON.parse( files[ 'package.json' ] ) ).toMatchObject( {
			name: 'my-headless-site-frontend',
			scripts: { dev: 'astro dev' },
			dependencies: { astro: '^5.0.0' },
		} );
		expect( files[ 'src/lib/wordpress.ts' ] ).toContain( 'import.meta.env.WORDPRESS_URL' );
		expect( files[ 'src/pages/posts/[slug].astro' ] ).toContain( 'getStaticPaths' );
		expect( files[ 'README.md' ] ).toContain( 'TODO' );
		expect( files[ 'AGENTS.md' ] ).toContain( 'http://localhost:8881' );
	} );

	it( 'writes a Next.js project with draft and revalidate routes', () => {
		const files = getFrontendTemplate( 'next' )( context( 'next' ) );

		expect( JSON.parse( files[ 'package.json' ] ).dependencies.next ).toBe( '^16.0.0' );
		expect( files[ 'next.config.ts' ] ).toContain( 'remotePatterns' );
		expect( files[ 'app/api/draft/route.ts' ] ).toContain( 'process.env.STUDIO_PREVIEW_SECRET' );
		expect( files[ 'app/api/draft/route.ts' ] ).toContain( '.enable()' );
		expect( files[ 'app/api/revalidate/route.ts' ] ).toContain( 'x-studio-revalidate-secret' );
		expect( files[ 'app/api/revalidate/route.ts' ] ).toContain( 'revalidatePath' );
		expect( files[ 'lib/wordpress.ts' ] ).toContain( "'Basic '" );
		expect( files[ 'lib/wordpress.ts' ] ).toContain( '/^\\d+$/' );
		expect( files[ '.gitignore' ] ).toContain( '.env*.local' );
	} );

	it( 'scaffolds into the frontend folder without overwriting existing files', async () => {
		const frontendPath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-scaffold-' ) );
		try {
			fs.writeFileSync( path.join( frontendPath, 'README.md' ), 'mine' );

			const written = await scaffoldFrontend(
				frontendFor( 'next', frontendPath ),
				'Site',
				'http://localhost:8881/'
			);

			expect( written ).not.toContain( 'README.md' );
			expect( written ).toContain( 'app/api/draft/route.ts' );
			expect( fs.readFileSync( path.join( frontendPath, 'README.md' ), 'utf8' ) ).toBe( 'mine' );
			expect(
				fs.existsSync( path.join( frontendPath, 'app', 'posts', '[slug]', 'page.tsx' ) )
			).toBe( true );
		} finally {
			fs.rmSync( frontendPath, { recursive: true, force: true } );
		}
	} );
} );
