import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * What liberate.sh keeps about a job, which is everything WordPress.com's session does not
 * carry: its own id is the session's, and the session reports a digest of the source rather
 * than the address, so a bookmarked link needs this to say which site it was.
 */
export interface JobRecord {
	id: string;
	url: string;
	host: string;
	siteName?: string;
	/** Size of the archive, once a ready session has been asked for it. */
	bytes?: number;
	createdAt: number;
	expiresAt: number;
}

export interface JobStore {
	put( record: JobRecord ): Promise< void >;
	get( id: string ): Promise< JobRecord | undefined >;
	/** Forget records past their expiry; returns how many went. */
	prune( now?: number ): Promise< number >;
}

/**
 * Records as one small file each. Everything heavy — the capture, its progress and the
 * archive itself — stays at WordPress.com, so this holds a few hundred bytes per job and
 * can be swapped for a table wherever there is no disk.
 */
export function fileStore( dir: string ): JobStore {
	const file = ( id: string ) => path.join( dir, `${ id }.json` );
	const ready = fs.mkdir( dir, { recursive: true } );

	return {
		async put( record ) {
			await ready;
			const temp = `${ file( record.id ) }.${ randomBytes( 4 ).toString( 'hex' ) }.tmp`;
			await fs.writeFile( temp, JSON.stringify( record ) );
			await fs.rename( temp, file( record.id ) );
		},

		async get( id ) {
			const record = await fs
				.readFile( file( id ), 'utf8' )
				.then( ( contents ) => JSON.parse( contents ) as JobRecord )
				.catch( () => undefined );
			if ( record && record.expiresAt > Date.now() ) {
				return record;
			}
			if ( record ) {
				await fs.rm( file( id ), { force: true } );
			}
			return undefined;
		},

		async prune( now = Date.now() ) {
			await ready;
			const names = await fs.readdir( dir ).catch( () => [] );
			let gone = 0;
			for ( const name of names.filter( ( entry ) => entry.endsWith( '.json' ) ) ) {
				const record = await fs
					.readFile( path.join( dir, name ), 'utf8' )
					.then( ( contents ) => JSON.parse( contents ) as JobRecord )
					.catch( () => undefined );
				if ( ! record || record.expiresAt <= now ) {
					await fs.rm( path.join( dir, name ), { force: true } );
					gone++;
				}
			}
			return gone;
		},
	};
}
