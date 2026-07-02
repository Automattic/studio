import lockfile from 'lockfile';

export function lockFileAsync( lockfilePath: string, options: lockfile.Options ) {
	return new Promise< void >( ( resolve, reject ) => {
		lockfile.lock( lockfilePath, options, ( err ) => {
			if ( err ) {
				reject( err );
			} else {
				resolve();
			}
		} );
	} );
}

export function unlockFileAsync( lockfilePath: string ) {
	return new Promise< void >( ( resolve, reject ) => {
		lockfile.unlock( lockfilePath, ( err ) => {
			if ( err ) {
				reject( err );
			} else {
				resolve();
			}
		} );
	} );
}
