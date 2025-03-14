import { DEFAULT_WORDPRESS_VERSION } from 'vendor/wp-now/src/constants';
import { isValidWordPressVersion } from 'vendor/wp-now/src/wp-playground-wordpress/is-valid-wordpress-version';

export function getWordPressVersionUrl( version = DEFAULT_WORDPRESS_VERSION ) {
	// Development versions have patterns like "6.8-beta2-59979"
	if ( version.match( /^\d+\.\d+-[a-zA-Z0-9]+-\d+$/ ) ) {
		return 'https://wordpress.org/nightly-builds/wordpress-latest.zip';
	}

	if ( ! isValidWordPressVersion( version ) ) {
		throw new Error(
			'Unrecognized WordPress version. Please use "latest" or numeric versions such as "6.2", "6.0.1", "6.2-beta1", or "6.2-RC1"'
		);
	}

	return `https://wordpress.org/wordpress-${ version }.zip`;
}
