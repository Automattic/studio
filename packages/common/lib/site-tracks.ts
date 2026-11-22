import { z } from 'zod';
import { readConfig, updateConfig } from './config/store';
import { arePathsEqual } from './fs-utils';
import { TRACKS_EVENTS } from './record-tracks-event';
import type { Config } from './config/schema';
import type { TracksEventName, TracksProps } from './record-tracks-event';
import type { Snapshot } from '../types/snapshot';

type SiteSelector = { siteFolder: string } | { siteId: string };
type SiteTracksProps = { site_id?: string; preview_id?: string };

// The ids of the site and preview named, minting the missing ones when `mint` is set; undefined
// when one is missing and `mint` isn't.
function tracksIds(
	{ sites, snapshots }: Pick< Config, 'sites' | 'snapshots' >,
	selector: SiteSelector,
	preview: Pick< Snapshot, 'atomicSiteId' | 'userId' > | undefined,
	mint: boolean
): SiteTracksProps | undefined {
	const site = sites.find( ( candidate ) =>
		'siteFolder' in selector
			? arePathsEqual( candidate.path, selector.siteFolder )
			: candidate.id === selector.siteId
	);
	const snapshot =
		preview &&
		snapshots.find(
			( candidate ) =>
				candidate.atomicSiteId === preview.atomicSiteId && candidate.userId === preview.userId
		);
	for ( const record of [ site, snapshot ] ) {
		if ( record && ! z.uuidv4().safeParse( record.tracksId ).success ) {
			if ( ! mint ) {
				return undefined;
			}
			record.tracksId = crypto.randomUUID();
		}
	}
	return {
		...( site ? { site_id: site.tracksId } : {} ),
		...( snapshot ? { preview_id: snapshot.tracksId } : {} ),
	};
}

// The site's and preview's anonymous Tracks ids, minted on first use: the config lock is taken
// only then.
export async function getSiteTracksProps(
	selector: SiteSelector,
	preview?: Pick< Snapshot, 'atomicSiteId' | 'userId' >
): Promise< SiteTracksProps > {
	try {
		return (
			tracksIds( await readConfig(), selector, preview, false ) ??
			( await updateConfig( ( config ) => tracksIds( config, selector, preview, true ) ?? {} ) )
		);
	} catch {
		// ID persistence must not affect the operation or suppress its event.
		return {};
	}
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
