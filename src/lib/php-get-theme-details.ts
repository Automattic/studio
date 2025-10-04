import { z } from 'zod';
import { getWpLoadPath } from 'src/lib/wordpress-provider';
import type { WordPressServerProcess } from 'src/lib/wordpress-provider/types';

const themeDetailsSchema = z.object( {
	name: z.string().catch( '' ),
	path: z.string(),
	slug: z.string(),
	isBlockTheme: z.boolean(),
	supportsWidgets: z.boolean(),
	supportsMenus: z.boolean(),
} );

export async function phpGetThemeDetails(
	server: WordPressServerProcess
): Promise< StartedSiteDetails[ 'themeDetails' ] > {
	if ( ! server.php ) {
		throw Error( 'PHP is not instantiated' );
	}

	const perfStart = performance.now();

	try {
		// Try to use the persistent mu-plugin API endpoint if available (Playground CLI)
		if ( server.php.request ) {
			console.log( '[PERF] phpGetThemeDetails: Using persistent API endpoint' );

			const response = await server.php.request( {
				url: '/?studio-admin-api',
				method: 'POST',
				body: {
					action: 'get_theme_details',
				},
			} );

			console.log(
				`[PERF] phpGetThemeDetails: Total time ${ ( performance.now() - perfStart ).toFixed( 2 ) }ms`
			);

			const themeDetailsParsed = JSON.parse( response.text );
			return themeDetailsSchema.parse( themeDetailsParsed );
		}

		// Fallback to runPhp for WP-Now
		console.log( '[PERF] phpGetThemeDetails: Using fallback runPhp method' );
		const wpLoadPath = getWpLoadPath( server );

		const themeDetailsPhp = `<?php
		require_once('${ wpLoadPath }');
		$theme = wp_get_theme();
		echo json_encode([
			'name' => $theme->get('Name'),
			'path' => $theme->get_stylesheet_directory(),
			'slug' => $theme->get_stylesheet(),
			'isBlockTheme' => $theme->is_block_theme(),
			'supportsWidgets' => current_theme_supports('widgets'),
			'supportsMenus' => get_registered_nav_menus() || current_theme_supports('menus'),
		]);
		`;

		const themeDetailsRaw = await server.runPhp( {
			code: themeDetailsPhp,
		} );

		console.log(
			`[PERF] phpGetThemeDetails: Total time ${ ( performance.now() - perfStart ).toFixed( 2 ) }ms`
		);

		const themeDetailsParsed = JSON.parse( themeDetailsRaw );
		return themeDetailsSchema.parse( themeDetailsParsed );
	} catch ( error ) {
		console.error( 'Failed to get theme details:', error );
		return undefined;
	}
}
