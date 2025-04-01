import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

const SnapshotSchema = z.object( {
	url: z.string(),
	atomicSiteId: z.number(),
	localSiteId: z.string(),
	date: z.number(),
	name: z.string().optional(),
	userId: z.number().optional(),
} );

const UserDataSchema = z
	.object( {
		snapshots: z.array( SnapshotSchema ).optional(),
	} )
	.passthrough();

type Snapshot = z.infer< typeof SnapshotSchema >;
type UserData = {
	[ K: string ]: unknown;
	snapshots?: Snapshot[];
	sites?: Array< { id: string; path: string; name?: string } >;
	authToken?: { id: number };
};

// ToDo: Improve this to support multiple platforms
export function getAppdataPath(): string {
	const homeDir = os.homedir();
	return path.join( homeDir, 'Library', 'Application Support', 'Studio', 'appdata-v1.json' );
}

export async function readAppdata(): Promise< UserData > {
	const appDataPath = getAppdataPath();

	if ( ! fs.existsSync( appDataPath ) ) {
		throw new LoggerError( 'Appdata file not found. Please run the Studio app first.' );
	}

	try {
		const fileContent = fs.readFileSync( appDataPath, 'utf8' );
		const userData = JSON.parse( fileContent );
		const result = UserDataSchema.parse( userData );

		return result;
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		if ( error instanceof z.ZodError ) {
			throw new LoggerError( 'Invalid appdata format. Please run the Studio app again.' );
		}

		if ( error instanceof SyntaxError ) {
			throw new LoggerError( 'Appdata file is corrupted. Please run the Studio app again.' );
		}

		throw new LoggerError( 'Failed to read appdata file. Please run the Studio app again.' );
	}
}

export async function saveAppdata( userData: UserData ): Promise< void > {
	const appDataPath = getAppdataPath();

	try {
		if ( ! userData.version ) {
			userData.version = 1;
		}

		const fileContent = JSON.stringify( userData, null, 2 ) + '\n';

		fs.writeFileSync( appDataPath, fileContent, 'utf8' );
	} catch ( error ) {
		throw new LoggerError(
			`Failed to save appdata file: ${ error instanceof Error ? error.message : String( error ) }`
		);
	}
}

export async function addPreviewSiteToAppdata(
	previewUrl: string,
	atomicSiteId: number,
	siteFolder: string
): Promise< void > {
	try {
		const userData = await readAppdata();
		const site = userData.sites?.find( ( s ) => s.path === siteFolder );
		if ( ! site ) {
			return;
		}
		if ( ! userData.snapshots ) {
			userData.snapshots = [];
		}
		const snapshot: Snapshot = {
			url: previewUrl,
			atomicSiteId,
			localSiteId: site.id,
			date: Date.now(),
			name: site.name,
		};
		if ( userData.authToken?.id ) {
			snapshot.userId = userData.authToken.id;
		}
		userData.snapshots.push( snapshot );
		await saveAppdata( userData );
	} catch ( error ) {
		throw new LoggerError(
			`Failed to add preview site to appdata: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}
}
