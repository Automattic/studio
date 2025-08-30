import { __ } from '@wordpress/i18n';
import { type WordPressVersion } from './versions';

export interface WordPressVersionGroup {
	label: string;
	versions: WordPressVersion[];
	id: string;
}

export function getGroupedWordPressVersions(
	versions: WordPressVersion[]
): WordPressVersionGroup[] {
	const latestVersion = versions.find( ( v ) => v.value === 'latest' );
	const betaVersions = versions.filter( ( v ) => v.isBeta || v.isDevelopment );
	const stableVersions = versions.filter(
		( v ) => ! v.isBeta && ! v.isDevelopment && v.value !== 'latest'
	);

	const groups: WordPressVersionGroup[] = [
		{
			id: 'auto-updating',
			label: __( 'Auto-updating' ),
			versions: latestVersion ? [ { ...latestVersion, label: 'latest' } ] : [],
		},
		{
			id: 'beta-nightly',
			label: __( 'Beta & Nightly' ),
			versions: betaVersions,
		},
		{
			id: 'stable',
			label: __( 'Stable Versions' ),
			versions: stableVersions,
		},
	];

	return groups;
}
