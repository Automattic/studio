import semver from 'semver';

type Option = { label: string; value: string };

export const addWpVersionToList = ( newOption: Option, options: Option[] ): Option[] => {
	const currentVer = semver.coerce( newOption.value );

	// Being extra cautious here, if the version is not valid, we add it to the end of the list.
	if ( ! currentVer ) {
		return [ ...options, newOption ];
	}

	const firstOlderVersionIndex = options.findIndex( ( compareVersion ) => {
		const compareVer = semver.coerce( compareVersion.value );
		return compareVer && semver.gt( currentVer, compareVer );
	} );

	if ( firstOlderVersionIndex === -1 ) {
		return [ ...options, newOption ];
	} else {
		return [
			...options.slice( 0, firstOlderVersionIndex ),
			newOption,
			...options.slice( firstOlderVersionIndex ),
		];
	}
};
