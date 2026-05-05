import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getStaticSiteImporterPluginPath } from '../paths';

describe( 'dependency path helpers', () => {
	afterEach( () => {
		delete process.env.STUDIO_STATIC_SITE_IMPORTER_PLUGIN_PATH;
	} );

	it( 'uses the requested Static Site Importer plugin path when provided', () => {
		process.env.STUDIO_STATIC_SITE_IMPORTER_PLUGIN_PATH =
			'/tmp/static-site-importer-worktree';

		expect( getStaticSiteImporterPluginPath() ).toBe( '/tmp/static-site-importer-worktree' );
	} );

	it( 'falls back to the bundled Static Site Importer plugin path', () => {
		expect( getStaticSiteImporterPluginPath() ).toContain(
			path.join( 'wp-files', 'static-site-importer' )
		);
	} );
} );
