import { describe, it, expect } from 'vitest';
import { buildCacheBustMuPlugin, CACHE_BUST_MU_PLUGIN_PATH } from '../default-exporter';

describe( 'CACHE_BUST_MU_PLUGIN_PATH', () => {
	it( 'lands in mu-plugins so it auto-loads without activation', () => {
		expect( CACHE_BUST_MU_PLUGIN_PATH ).toBe( 'wp-content/mu-plugins/studio-asset-cache-bust.php' );
	} );
} );

describe( 'buildCacheBustMuPlugin', () => {
	const token = 'studio-1718560000000';

	it( 'embeds the per-push token as the asset version', () => {
		const php = buildCacheBustMuPlugin( token );
		expect( php ).toContain( `define( 'STUDIO_ASSET_CACHE_BUST_VERSION', '${ token }' )` );
	} );

	it( 'filters both style and script srcs at runtime', () => {
		const php = buildCacheBustMuPlugin( token );
		expect( php ).toContain(
			"add_filter( 'style_loader_src', 'studio_asset_cache_bust_src', 9999 )"
		);
		expect( php ).toContain(
			"add_filter( 'script_loader_src', 'studio_asset_cache_bust_src', 9999 )"
		);
	} );

	it( 'only versions local assets, leaving external URLs untouched', () => {
		const php = buildCacheBustMuPlugin( token );
		expect( php ).toContain( '/wp-content/' );
		expect( php ).toContain( '/wp-includes/' );
		expect( php ).toContain( "add_query_arg( 'ver', STUDIO_ASSET_CACHE_BUST_VERSION, $src )" );
	} );

	it( 'sanitizes the token so it cannot break out of the PHP string literal', () => {
		const php = buildCacheBustMuPlugin( "abc'; system('x'); //" );
		expect( php ).toContain( "define( 'STUDIO_ASSET_CACHE_BUST_VERSION', 'abcsystemx' )" );
		expect( php ).not.toContain( 'system(' );
	} );

	it( 'guards against direct access and double definition', () => {
		const php = buildCacheBustMuPlugin( token );
		expect( php ).toContain( "defined( 'ABSPATH' ) || exit;" );
		expect( php ).toContain( "if ( ! defined( 'STUDIO_ASSET_CACHE_BUST_VERSION' ) )" );
	} );
} );
