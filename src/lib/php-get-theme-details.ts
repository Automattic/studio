import * as Sentry from '@sentry/electron/main';
import { WPNowServer } from '../../vendor/wp-now/src';

export async function phpGetThemeDetails(
	php: WPNowServer[ 'php' ]
): Promise< StartedSiteDetails[ 'themeDetails' ] > {
	let themeDetails = null;
	const themeDetailsPhp = `<?php
    require_once('${ php.documentRoot }/wp-load.php');
    $theme = wp_get_theme();
    echo json_encode([
        'name' => $theme->get('Name'),
        'uri' => $theme->get('ThemeURI'),
        'path' => $theme->get_stylesheet_directory(),
        'slug' => $theme->get_stylesheet(),
		'isBlockTheme' => $theme->is_block_theme(),
    ]);
    `;
	try {
		const currentTheme = (
			await php.run( {
				code: themeDetailsPhp,
			} )
		).text;
		themeDetails = JSON.parse( currentTheme );
	} catch ( error ) {
		Sentry.captureException( error );
		themeDetails = null;
	}
	return themeDetails;
}
