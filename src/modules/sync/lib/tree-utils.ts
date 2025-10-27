import { SYNC_EXCLUSIONS } from '../constants';

export const shouldExcludeFromSync = ( itemName: string, relativePath: string ): boolean => {
	if ( itemName.startsWith( '.' ) ) {
		return true;
	}

	if ( SYNC_EXCLUSIONS.includes( itemName ) ) {
		return true;
	}

	if ( relativePath.includes( 'mu-plugins' ) && itemName === 'sqlite-database-integration' ) {
		return true;
	}

	return false;
};

export const shouldLimitDepth = ( relativePath: string ): boolean => {
	const normalizedPath = relativePath.replace( /^wp-content\//, '' );

	if ( normalizedPath.match( /^plugins\/[^/]+$/ ) ) {
		return true;
	}

	if ( normalizedPath.match( /^themes\/[^/]+$/ ) ) {
		return true;
	}

	return false;
};
