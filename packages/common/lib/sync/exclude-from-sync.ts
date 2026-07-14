import path from 'path';
import type { Ignore } from 'ignore';

export const shouldExcludeFromSync = ( relativePath: string, deployIgnore: Ignore ): boolean => {
	const itemName = path.basename( relativePath );
	// Hide dotfiles from the sync tree UI. The remote import drops root
	// dotfiles on its own, so this keeps the tree aligned with what ends
	// up on the remote. The tree does not render deeper than plugin and
	// theme directories, so nested dotfiles aren't a concern here.
	if ( itemName.startsWith( '.' ) ) {
		return true;
	}
	return deployIgnore.ignores( relativePath );
};
