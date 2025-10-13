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

	try {
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

		const themeDetailsParsed = JSON.parse( themeDetailsRaw );
		return themeDetailsSchema.parse( themeDetailsParsed );
	} catch ( error ) {
		console.error( 'Failed to get theme details:', error );
		return undefined;
	}
}
