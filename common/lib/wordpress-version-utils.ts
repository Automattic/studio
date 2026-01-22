/**
 * Checks if the given version string is a valid WordPress version.
 *
 * The Regex is based on the releases on https://wordpress.org/download/releases/#betas
 * The version string can be one of the following formats:
 * - "latest"
 * - "nightly"
 * - "x.y" (x and y are integers) e.g. "6.2"
 * - "x.y.z" (x, y and z are integers) e.g. "6.2.1"
 * - "x.y.z-betaN" (N is an integer) e.g. "6.2.1-beta1"
 * - "x.y.z-RCN" (N is an integer) e.g. "6.2-RC1"
 *
 * @param version The version string to check.
 * @returns A boolean value indicating whether the version string is a valid WordPress version.
 */
export function isValidWordPressVersion( version: string ): boolean {
	const versionPattern =
		/^latest$|^nightly$|^(?:(\d+)\.(\d+)(?:\.(\d+))?)((?:-beta(?:\d+)?)|(?:-RC(?:\d+)?))?$/;
	return versionPattern.test( version );
}

export function isWordPressDevVersion( version: string ): boolean {
	// Match 'nightly' keyword or nightly build patterns that end with a build number
	// Examples: nightly, 6.8-alpha1-12345, 6.8-beta2-59979, 6.8-dev-12345, 6.8-59979
	return version === 'nightly' || /^\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9]+)*-\d+$/.test( version );
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

export function isWordPressVersionAtLeast( version: string, minimumVersion: string ): boolean {
	if ( version === 'latest' || version === 'nightly' ) {
		return true;
	}

	// For dev/beta versions with hyphens, extract the base version
	// e.g., "6.4-beta1" -> "6.4", "6.8-RC1-59979" -> "6.8"
	let versionToCompare = version;
	if ( version.includes( '-' ) ) {
		versionToCompare = version.split( '-' )[ 0 ];
	}

	// Compare semantic versions
	const parseVersion = ( v: string ) => v.split( '.' ).map( Number );
	const provided = parseVersion( versionToCompare );
	const minimum = parseVersion( minimumVersion );

	for ( let i = 0; i < Math.max( provided.length, minimum.length ); i++ ) {
		const p = provided[ i ] || 0;
		const m = minimum[ i ] || 0;

		if ( p < m ) {
			return false;
		}
		if ( p > m ) {
			return true;
		}
	}

	// Versions are equal
	return true;
}
