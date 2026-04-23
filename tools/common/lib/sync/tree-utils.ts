import type { SyncOption } from '@studio/common/types/sync';
import type { Ignore } from 'ignore';

export const shouldExcludeFromSync = ( relativePath: string, deployIgnore: Ignore ): boolean => {
	const itemName = relativePath.split( '/' ).pop() || '';
	// Hide dotfiles from the sync tree UI. The remote import drops root
	// dotfiles on its own, so this keeps the tree aligned with what ends
	// up on the remote. The tree does not render deeper than plugin and
	// theme directories, so nested dotfiles aren't a concern here.
	if ( itemName.startsWith( '.' ) ) {
		return true;
	}
	return deployIgnore.ignores( relativePath );
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
