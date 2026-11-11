import { z } from 'zod';
import {
	CLI_CONFIG_VERSION,
	lockCliConfigFile,
	readCliConfigFileRaw,
	writeCliConfigFileRaw,
	unlockCliConfigFile,
} from './cli-config-file';
import { arePathsEqual } from './fs-utils';
import { TRACKS_EVENTS } from './record-tracks-event';
import type { TracksEventName, TracksProps } from './record-tracks-event';
import type { Snapshot } from '../types/snapshot';

const configSchema = z
	.object( {
		version: z.literal( CLI_CONFIG_VERSION ),
		sites: z
			.array(
				z
					.object( {
						id: z.string(),
						path: z.string(),
						tracksId: z.string().optional(),
					} )
					.passthrough()
			)
			.default( [] ),
		snapshots: z
			.array(
				z
					.object( {
						atomicSiteId: z.number(),
						userId: z.number().optional(),
						tracksId: z.string().optional(),
					} )
					.passthrough()
			)
			.default( [] ),
	} )
	.passthrough();

type TracksConfig = z.infer< typeof configSchema >;
type SiteSelector = { siteFolder: string } | { siteId: string };
type SiteTracksProps = { site_id?: string; preview_id?: string };

// The CLI supplies its typed config accessors; other hosts patch the raw config
// under the same lock, preserving fields outside this helper's schema.
export function createSiteTracksPropsResolver<
	Config extends {
		sites: Array< { id: string; path: string; tracksId?: string } >;
		snapshots: Array< { atomicSiteId: number; userId?: number; tracksId?: string } >;
	},
>( store: {
	lock: () => Promise< void >;
	read: () => Promise< Config >;
	save: ( config: Config ) => Promise< void >;
	unlock: () => Promise< void >;
} ) {
	return async (
		selector: SiteSelector,
		preview?: Pick< Snapshot, 'atomicSiteId' | 'userId' >
	): Promise< SiteTracksProps > => {
		try {
			await store.lock();
			try {
				const config = await store.read();
				const site = config.sites.find( ( candidate ) =>
					'siteFolder' in selector
						? arePathsEqual( candidate.path, selector.siteFolder )
						: candidate.id === selector.siteId
				);
				const snapshot =
					preview &&
					config.snapshots.find(
						( candidate ) =>
							candidate.atomicSiteId === preview.atomicSiteId && candidate.userId === preview.userId
					);
				let changed = false;
				for ( const record of [ site, snapshot ] ) {
					if ( record && ! z.uuidv4().safeParse( record.tracksId ).success ) {
						record.tracksId = crypto.randomUUID();
						changed = true;
					}
				}
				if ( changed ) await store.save( config );
				return {
					...( site ? { site_id: site.tracksId } : {} ),
					...( snapshot ? { preview_id: snapshot.tracksId } : {} ),
				};
			} finally {
				await store.unlock();
			}
		} catch {
			// ID persistence must not affect the operation or suppress its event.
			return {};
		}
	};
}

export async function getSiteTracksProps(
	selector: SiteSelector,
	preview?: Pick< Snapshot, 'atomicSiteId' | 'userId' >
): Promise< SiteTracksProps > {
	return createSiteTracksPropsResolver< TracksConfig >( {
		lock: lockCliConfigFile,
		read: async () => configSchema.parse( await readCliConfigFileRaw() ),
		save: writeCliConfigFileRaw,
		unlock: unlockCliConfigFile,
	} )( selector, preview );
}

export async function resolveSiteTracksEventProps(
	event: TracksEventName,
	props: TracksProps,
	siteId?: string
): Promise< TracksProps > {
	if (
		event !== TRACKS_EVENTS.SYNC_CONNECT &&
		event !== TRACKS_EVENTS.SYNC_PUSH &&
		event !== TRACKS_EVENTS.SITE_EXPORT &&
		event !== TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED
	) {
		return props;
	}
	// Caller-supplied identifiers are lookup context only, never event properties.
	const { site_id: _siteId, preview_id: _previewId, ...rest } = props;
	return {
		...rest,
		...( typeof siteId === 'string' ? await getSiteTracksProps( { siteId } ) : {} ),
	};
}
