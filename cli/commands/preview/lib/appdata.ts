import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

const snapshotSchema = z.object( {
	url: z.string(),
	atomicSiteId: z.number(),
	localSiteId: z.string(),
	date: z.number(),
	name: z.string().optional(),
	userId: z.number().optional(),
} );

const siteSchema = z
	.object( {
		id: z.string(),
		path: z.string(),
		name: z.string().optional(),
	} )
	.passthrough();

const userDataSchema = z
	.object( {
		snapshots: z.array( snapshotSchema ).optional(),
		sites: z.array( siteSchema ).optional(),
		authToken: z
			.object( {
				accessToken: z.string().min( 1, 'Access token cannot be empty' ),
				id: z.number(),
			} )
			.optional(),
	} )
	.passthrough();

type Snapshot = z.infer< typeof snapshotSchema >;
type UserData = z.infer< typeof userDataSchema >;

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
		const result = userDataSchema.parse( userData );

		return result;
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		if ( error instanceof z.ZodError ) {
			throw new LoggerError( 'Invalid appdata format. Please run the Studio app again.', error );
		}

		if ( error instanceof SyntaxError ) {
			throw new LoggerError( 'Appdata file is corrupted. Please run the Studio app again.', error );
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
		if ( ! userData.snapshots ) {
			userData.snapshots = [];
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
