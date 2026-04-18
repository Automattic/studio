import { app } from 'electron';
import path from 'path';
import {
	deleteAiSession as deleteAiSessionFromStore,
	listAiSessions as listAiSessionsFromStore,
	loadAiSession as loadAiSessionFromStore,
} from '@studio/common/ai/sessions/store';
import type { AiSessionSummary, LoadedAiSession } from '@studio/common/ai/sessions/types';

// The sessions directory is shared with the CLI. The CLI hardcodes
// `<Library/Application Support|APPDATA>/Studio/sessions`; `userData` resolves
// to `<appData>/<appName>` which matches because `appName` is derived from
// `productName: "Studio"` in package.json.
export function getAiSessionsRootDirectory(): string {
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		return path.join( process.env.E2E_APP_DATA_PATH, 'Studio', 'sessions' );
	}
	return path.join( app.getPath( 'userData' ), 'sessions' );
}

export async function listAiSessions(): Promise< AiSessionSummary[] > {
	return listAiSessionsFromStore( getAiSessionsRootDirectory() );
}

export async function loadAiSession( sessionIdOrPrefix: string ): Promise< LoadedAiSession > {
	return loadAiSessionFromStore( getAiSessionsRootDirectory(), sessionIdOrPrefix );
}

export async function deleteAiSession( sessionIdOrPrefix: string ): Promise< AiSessionSummary > {
	return deleteAiSessionFromStore( getAiSessionsRootDirectory(), sessionIdOrPrefix );
}
