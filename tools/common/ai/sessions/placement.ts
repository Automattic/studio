import { mkdir } from 'node:fs/promises';
import path from 'node:path';
// Atomic (temp-file + rename) reads/writes, same as `shared-config`, so a crash
// mid-write can't corrupt app.json — important since it holds desktop UI state.
import { readFile, writeFile } from 'atomically';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getAppConfigLockFilePath, getAppConfigPath } from '@studio/common/lib/well-known-paths';
import type { StudioChatArtifactData } from '@studio/common/ai/chat-artifacts';
import type { AiSessionSummary } from '@studio/common/ai/sessions/types';

/**
 * AI session "placement" — which local site a session created/owns.
 *
 * Shared between the desktop app and the `studio ui` server so both record and
 * read placement identically. It lives in `app.json` under `aiSessionPlacements`
 * and is written under the same lockfile the desktop's user-data writes use
 * (`getAppConfigLockFilePath`), so concurrent desktop + server writes coordinate
 * rather than clobber. Reads/writes touch only the `aiSessionPlacements` key and
 * preserve every other field verbatim.
 */

export interface AiSessionSitePlacement {
	kind: 'site';
	siteId: string;
	sitePath: string;
	siteName: string;
}

export interface AiSessionPlacementUpdatedEvent {
	sessionId: string;
	placement: AiSessionSitePlacement;
}

type AppConfigShape = {
	aiSessionPlacements?: Record< string, AiSessionSitePlacement >;
	[ key: string ]: unknown;
};

async function readAppConfig(): Promise< AppConfigShape > {
	try {
		return JSON.parse( await readFile( getAppConfigPath(), 'utf-8' ) ) as AppConfigShape;
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return {};
		}
		throw error;
	}
}

async function writeAppConfig( config: AppConfigShape ): Promise< void > {
	// Match the desktop's `saveUserData` formatting (2-space indent + trailing
	// newline) so the two writers don't produce noisy diffs against each other.
	await writeFile( getAppConfigPath(), JSON.stringify( config, null, 2 ) + '\n', 'utf-8' );
}

async function lockAppConfig(): Promise< void > {
	const lockfilePath = getAppConfigLockFilePath();
	await mkdir( path.dirname( lockfilePath ), { recursive: true } );
	await lockFileAsync( lockfilePath, { stale: LOCKFILE_STALE_TIME, wait: LOCKFILE_WAIT_TIME } );
}

async function unlockAppConfig(): Promise< void > {
	await unlockFileAsync( getAppConfigLockFilePath() );
}

export async function readAiSessionPlacements(): Promise<
	Record< string, AiSessionSitePlacement >
> {
	const config = await readAppConfig();
	return config.aiSessionPlacements ?? {};
}

export async function readAiSessionPlacement(
	sessionId: string
): Promise< AiSessionSitePlacement | undefined > {
	const placements = await readAiSessionPlacements();
	return placements[ sessionId ];
}

export async function setAiSessionSitePlacement(
	sessionId: string,
	placement: Omit< AiSessionSitePlacement, 'kind' >
): Promise< AiSessionSitePlacement > {
	try {
		await lockAppConfig();
		const config = await readAppConfig();
		const nextPlacement: AiSessionSitePlacement = { kind: 'site', ...placement };
		config.aiSessionPlacements = {
			...( config.aiSessionPlacements ?? {} ),
			[ sessionId ]: nextPlacement,
		};
		await writeAppConfig( config );
		return nextPlacement;
	} finally {
		await unlockAppConfig();
	}
}

export async function deleteAiSessionPlacement( sessionId: string ): Promise< void > {
	try {
		await lockAppConfig();
		const config = await readAppConfig();
		if ( ! config.aiSessionPlacements?.[ sessionId ] ) {
			return;
		}
		const { [ sessionId ]: _deleted, ...remaining } = config.aiSessionPlacements;
		config.aiSessionPlacements = Object.keys( remaining ).length > 0 ? remaining : undefined;
		await writeAppConfig( config );
	} finally {
		await unlockAppConfig();
	}
}

export function hydrateAiSessionSummaryWithPlacement(
	summary: AiSessionSummary,
	placement?: AiSessionSitePlacement
): AiSessionSummary {
	if ( ! placement ) {
		return { ...summary, ownerSitePath: undefined, ownerSiteName: undefined };
	}
	return { ...summary, ownerSitePath: placement.sitePath, ownerSiteName: placement.siteName };
}

// Extracts a created-site placement from a `chat.artifact` event, if the agent
// emitted a site-preview widget for a site it just created.
export function getCreatedSiteFromArtifact(
	artifact: StudioChatArtifactData
): Omit< AiSessionSitePlacement, 'kind' > | undefined {
	for ( const widget of artifact.widgets ) {
		if ( widget.type !== 'site-preview' ) {
			continue;
		}
		const { siteId, sitePath, siteName } = widget.widgetProps;
		if (
			typeof siteId === 'string' &&
			typeof sitePath === 'string' &&
			typeof siteName === 'string'
		) {
			return { siteId, sitePath, siteName };
		}
	}
	return undefined;
}
