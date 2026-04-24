import fs from 'fs';
import nodePath from 'node:path';
import { readFile, writeFile } from 'atomically';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '../constants';
import { isErrnoException } from './is-errno-exception';
import { lockFileAsync, unlockFileAsync } from './lockfile';
import { getAppConfigLockFilePath, getAppConfigPath } from './well-known-paths';

export interface AppUserData {
	version: 1;
	siteMetadata: Record< string, unknown >;
	betaFeatures?: Record< string, boolean >;
	[ key: string ]: unknown;
}

export const EMPTY_APP_USER_DATA: AppUserData = {
	version: 1,
	siteMetadata: {},
};

export interface LoadUserDataOptions {
	onInvalidJson?: ( error: SyntaxError, fileContents: string, filePath: string ) => void;
}

export async function loadUserData< T = AppUserData >(
	options?: LoadUserDataOptions
): Promise< T > {
	const filePath = getAppConfigPath();

	try {
		const asString = await readFile( filePath, 'utf-8' );
		try {
			const parsed = JSON.parse( asString );
			const { siteMetadata, ...data } = parsed;
			return { ...data, version: 1, siteMetadata: siteMetadata ?? {} } as T;
		} catch ( err ) {
			if ( err instanceof SyntaxError ) {
				options?.onInvalidJson?.( err, asString, filePath );
			}
			throw err;
		}
	} catch ( err ) {
		if ( isErrnoException( err ) && err.code === 'ENOENT' ) {
			return EMPTY_APP_USER_DATA as T;
		}
		throw err;
	}
}

export async function saveUserData< T = AppUserData >( data: T ): Promise< void > {
	const filePath = getAppConfigPath();
	const asString = JSON.stringify( data, null, 2 ) + '\n';
	await writeFile( filePath, asString, 'utf-8' );
}

const LOCKFILE_PATH = getAppConfigLockFilePath();

export async function lockAppdata() {
	const dir = nodePath.dirname( LOCKFILE_PATH );
	if ( ! fs.existsSync( dir ) ) {
		fs.mkdirSync( dir, { recursive: true } );
	}
	return lockFileAsync( LOCKFILE_PATH, { stale: LOCKFILE_STALE_TIME, wait: LOCKFILE_WAIT_TIME } );
}

export async function unlockAppdata() {
	return unlockFileAsync( LOCKFILE_PATH );
}
