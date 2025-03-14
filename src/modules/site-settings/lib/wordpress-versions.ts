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

	// Find the index to insert the new version according to the semver version, newest first.
	const indexToInsert = options.findIndex( ( compareVersion ) => {
		const compareVer = semver.coerce( compareVersion.value );
		if ( ! compareVer ) {
			return false;
		}
		return semver.gt( currentVer, compareVer );
	} );

	if ( indexToInsert === -1 ) {
		options.push( customVersion );
	} else {
		options.splice( indexToInsert, 0, customVersion );
	}
};
