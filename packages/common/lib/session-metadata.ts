import { readConfig, updateConfig } from './config/store';
import type { ConfigSession } from './config/schema';

/**
 * What Studio keeps about each Studio Code session besides its transcript: the user's title,
 * archived and unread state, and the site it belongs to.
 */

export type SessionMetadata = ConfigSession;

function prune( metadata: SessionMetadata ): void {
	if ( ! metadata.archived ) {
		delete metadata.archived;
	}
	if ( ! metadata.unread ) {
		delete metadata.unread;
	}
	if ( ! metadata.title?.trim() ) {
		delete metadata.title;
	}
	if ( ! metadata.placement ) {
		delete metadata.placement;
	}
}

export async function readSessionsMetadata(): Promise< Record< string, SessionMetadata > > {
	return ( await readConfig() ).sessions;
}

export async function readSessionMetadata(
	sessionId: string
): Promise< SessionMetadata | undefined > {
	return ( await readSessionsMetadata() )[ sessionId ];
}

export async function updateSessionMetadata(
	sessionId: string,
	patch: Partial< SessionMetadata >
): Promise< SessionMetadata | undefined > {
	return updateConfig( ( { sessions } ) => {
		const metadata = { ...sessions[ sessionId ], ...patch };
		prune( metadata );
		if ( Object.keys( metadata ).length ) {
			sessions[ sessionId ] = metadata;
		} else {
			delete sessions[ sessionId ];
		}
		return sessions[ sessionId ];
	} );
}

export async function deleteSessionMetadata( ...sessionIds: string[] ): Promise< void > {
	await updateConfig( ( { sessions } ) => {
		for ( const sessionId of sessionIds ) {
			delete sessions[ sessionId ];
		}
	} );
}
