import { SYNC_EXCLUSIONS } from './constants';
import type { SyncOption } from '@studio/common/types/sync';

export const shouldExcludeFromSync = ( itemName: string ): boolean => {
	if ( itemName.startsWith( '.' ) ) {
		return true;
	}

	if ( SYNC_EXCLUSIONS.includes( itemName ) ) {
		return true;
	}

	return false;
};

export const shouldLimitDepth = ( relativePath: string ): boolean => {
	const normalizedPath = relativePath.replace( /^wp-content\//, '' );

	// Match plugins/plugin-name or plugins/plugin-name/
	if ( normalizedPath.match( /^plugins\/[^/]+\/?$/ ) ) {
		return true;
	}

	// Match themes/theme-name or themes/theme-name/
	if ( normalizedPath.match( /^themes\/[^/]+\/?$/ ) ) {
		return true;
	}

	// Match mu-plugins/mu-plugin or mu-plugins/mu-plugin/
	if ( normalizedPath.match( /^mu-plugins\/[^/]+\/?$/ ) ) {
		return true;
	}

	return false;
};

export function categorizePath( relativePath: string ): SyncOption {
	if ( relativePath.startsWith( 'plugins/' ) || relativePath === 'plugins' ) {
		return 'plugins';
	}
	if ( relativePath.startsWith( 'themes/' ) || relativePath === 'themes' ) {
		return 'themes';
	}
	if ( relativePath.startsWith( 'uploads/' ) || relativePath === 'uploads' ) {
		return 'uploads';
	}
	return 'contents';
}
