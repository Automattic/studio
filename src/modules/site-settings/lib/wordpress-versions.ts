import semver from 'semver';

export const addWpVersionToList = (
	version: string,
	options: Array< { label: string; value: string } >
) => {
	const customVersion = { label: version, value: version };
	const currentVer = semver.coerce( version );

	// Being extra cautious here, if the version is not valid, we add it to the end of the list.
	if ( ! currentVer ) {
		options.push( customVersion );
		return;
	}

	const firstOlderVersionIndex = options.findIndex( ( compareVersion ) => {
		const compareVer = semver.coerce( compareVersion.value );
		if ( ! compareVer ) {
			return false;
		}
		return semver.gt( currentVer, compareVer );
	} );

	if ( firstOlderVersionIndex === -1 ) {
		options.push( customVersion );
	} else {
		options.splice( firstOlderVersionIndex, 0, customVersion );
	}
};
