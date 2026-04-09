import * as child_process from 'child_process';

/**
 * Get the most recent release tag (excluding pre-release tags)
 * @returns {string} The latest release tag or empty string if none found
 */
export const getLatestTag = () => {
	try {
		// Fetch all tags to ensure they're available
		child_process.execSync( 'git fetch --tags --force', { stdio: 'pipe' } );

		// Get the latest reachable release tag that is not a beta tag
		const latestReleaseTag = child_process
			.execSync( 'git tag --list "v*" --sort=-version:refname | grep -v "\\-beta" | head -1' )
			.toString()
			.trim();

		return latestReleaseTag || '';
	} catch ( error ) {
		// If no tags exist, return empty string
		return '';
	}
};

/**
 * Get commit count since the last tag
 * @param {string} latestTag - The tag to count commits from
 * @returns {number} Number of commits since the tag, or total commits if no tag
 */
export const getCommitCount = ( latestTag ) => {
	try {
		if ( latestTag ) {
			return parseInt(
				child_process.execSync( `git rev-list ${ latestTag }..HEAD --count` ).toString().trim(),
				10
			);
		}
		// If no tags exist, count all commits
		return parseInt( child_process.execSync( 'git rev-list --count HEAD' ).toString().trim(), 10 );
	} catch ( error ) {
		throw new Error( 'Failed to get commit count: ' + error.message );
	}
};
