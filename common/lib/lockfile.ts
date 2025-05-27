import lockfile from 'lockfile';

export function lockFileAsync( LOCKFILE_PATH: string, options: lockfile.Options ) {
	return new Promise< void >( ( resolve, reject ) => {
		lockfile.lock( LOCKFILE_PATH, options, ( err ) => {
			if ( err ) {
				reject( err );
			} else {
				resolve();
			}
		} );
	} );
}

export function unlockFileAsync( LOCKFILE_PATH: string ) {
	return new Promise< void >( ( resolve, reject ) => {
		lockfile.unlock( LOCKFILE_PATH, ( err ) => {
			if ( err ) {
				reject( err );
			} else {
				resolve();
			}
		} );
	} );
}
