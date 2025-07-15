import { isValidWordPressVersion } from 'src/lib/wordpress-provider';

export function isWordPressDevVersion( version: string ): boolean {
	// Match nightly build patterns that end with a build number
	// Examples: 6.8-alpha1-12345, 6.8-beta2-59979, 6.8-dev-12345, 6.8-59979
	return /^\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9]+)*-\d+$/.test( version );
}

export function isWordPressBetaVersion( version: string ): boolean {
	return version.includes( 'beta' ) || version.includes( 'RC' );
}

export function getWordPressVersionUrl( version: string ) {
	if ( isWordPressDevVersion( version ) ) {
		return 'https://wordpress.org/nightly-builds/wordpress-latest.zip';
	}

	if ( ! isValidWordPressVersion( version ) ) {
		throw new Error(
			'Unrecognized WordPress version. Please use "latest" or numeric versions such as "6.2", "6.0.1", "6.2-beta1", or "6.2-RC1"'
		);
	}
	return `https://wordpress.org/wordpress-${ version }.zip`;
}
