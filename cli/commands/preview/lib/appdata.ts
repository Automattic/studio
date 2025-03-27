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

const UserDataSchema = z.object( {
	version: z.number().optional(),
	sites: z.array( z.any() ).optional(),
	snapshots: z.array( SnapshotSchema ).optional(),
	authToken: z.any().optional(),
	locale: z.string().optional(),
} );

type Snapshot = z.infer< typeof SnapshotSchema >;
type UserData = z.infer< typeof UserDataSchema >;

// ToDo: Improve this to support multiple platforms
export function getAppdataPath(): string {
	const homeDir = os.homedir();
	return path.join( homeDir, 'Library', 'Application Support', 'Studio', 'appdata-v1.json' );
}

export async function readAppdata( action: string ): Promise< UserData > {
	const appDataPath = getAppdataPath();

	if ( ! fs.existsSync( appDataPath ) ) {
		throw new LoggerError( 'Appdata file not found. Please run the Studio app first.', action );
	}

	try {
		const fileContent = fs.readFileSync( appDataPath, 'utf8' );
		const userData = JSON.parse( fileContent );
		const result = UserDataSchema.safeParse( userData );

		if ( ! result.success ) {
			throw new LoggerError( `Invalid appdata format. Please run the Studio app again.`, action );
		}

		return result.data;
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		if ( error instanceof z.ZodError ) {
			throw new LoggerError( `Invalid appdata format. Please run the Studio app again.`, action );
		}

		if ( error instanceof SyntaxError ) {
			throw new LoggerError(
				'Appdata file is corrupted. Please run the Studio app again.',
				action
			);
		}

		throw new LoggerError(
			'Failed to read appdata file. Please run the Studio app again.',
			action
		);
	}
}

export async function saveAppdata( userData: UserData, action: string ): Promise< void > {
	const appDataPath = getAppdataPath();

	try {
		// Check all required properties
		if ( ! userData.version ) {
			userData.version = 1;
		}

		// Create a deep copy to avoid reference issues
		const dataToSave = JSON.parse( JSON.stringify( userData ) );
		const fileContent = JSON.stringify( dataToSave, null, 2 ) + '\n';

		// Write the file
		fs.writeFileSync( appDataPath, fileContent, 'utf8' );
	} catch ( error ) {
		throw new LoggerError(
			`Failed to save appdata file: ${ error instanceof Error ? error.message : String( error ) }`,
			action
		);
	}
}

export async function addPreviewSiteToAppdata(
	previewUrl: string,
	atomicSiteId: number,
	siteFolder: string,
	action: string
): Promise< void > {
	try {
		// Read the existing appdata
		const userData = await readAppdata( action );
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
		await saveAppdata( userData, action );
	} catch ( error ) {
		throw new LoggerError(
			`Failed to add preview site to appdata: ${
				error instanceof Error ? error.message : String( error )
			}`,
			action
		);
	}
}
