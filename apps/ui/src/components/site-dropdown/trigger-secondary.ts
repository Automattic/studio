import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { formatRelativeTime } from '@/lib/format-relative-time';
import type { Snapshot, SyncSite } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

const MINUTE_MS = 60_000;

export type TriggerSecondaryTone = 'neutral' | 'pending' | 'success' | 'error';

export type TriggerSecondary = {
	label: string;
	tone: TriggerSecondaryTone;
};

type TriggerSecondaryOptions = {
	activity: SyncActivity | null;
	activeEnvironment: 'local' | 'live';
	liveSite?: SyncSite;
	previewSnapshot?: Snapshot;
};

export function getSyncActivityLabel( activity: SyncActivity ): string {
	if ( activity.kind === 'pending' ) {
		if ( activity.direction === 'preview' ) {
			return __( 'Publishing preview…' );
		}

		if ( activity.direction === 'push' ) {
			switch ( activity.phase ) {
				case 'uploading':
					return __( 'Uploading to live…' );
				case 'creating-backup':
					return __( 'Backing up live site…' );
				case 'applying':
					return __( 'Applying live changes…' );
				case 'finishing':
					return __( 'Finishing live sync…' );
			}
		}

		return activity.direction === 'push' ? __( 'Publishing to live…' ) : __( 'Pulling from live…' );
	}

	if ( activity.kind === 'success' ) {
		if ( activity.direction === 'preview' ) {
			return __( 'Preview published' );
		}
		return activity.direction === 'push' ? __( 'Published to live' ) : __( 'Pulled from live' );
	}

	if ( activity.direction === 'preview' ) {
		return __( 'Publishing preview failed' );
	}
	return activity.direction === 'push'
		? __( 'Publishing to live failed' )
		: __( 'Pulling from live failed' );
}

function getSyncActivityTone( activity: SyncActivity ): TriggerSecondaryTone {
	if ( activity.kind === 'pending' ) {
		return 'pending';
	}
	return activity.kind === 'success' ? 'success' : 'error';
}

function formatTimestampPhrase(
	timestampMs: number,
	nowLabel: string,
	formatAgo: ( relativeTime: string ) => string
): string | null {
	if ( ! Number.isFinite( timestampMs ) ) {
		return null;
	}

	const timestamp = new Date( timestampMs );
	if ( Number.isNaN( timestamp.getTime() ) ) {
		return null;
	}

	if ( Math.max( 0, Date.now() - timestampMs ) < MINUTE_MS ) {
		return nowLabel;
	}

	return formatAgo( formatRelativeTime( timestamp.toISOString() ) );
}

function formatIsoTimestampPhrase(
	isoTimestamp: string | null | undefined,
	nowLabel: string,
	formatAgo: ( relativeTime: string ) => string
): string | null {
	if ( ! isoTimestamp ) {
		return null;
	}

	return formatTimestampPhrase( Date.parse( isoTimestamp ), nowLabel, formatAgo );
}

function getPreviewLabel( previewSnapshot: Snapshot | undefined ): string | null {
	if ( ! previewSnapshot ) {
		return null;
	}

	if ( isSnapshotExpired( previewSnapshot ) ) {
		return __( 'Preview expired' );
	}

	return formatTimestampPhrase(
		previewSnapshot.date,
		__( 'Preview updated now' ),
		( relativeTime ) =>
			sprintf(
				// translators: %s: compact relative time, e.g. "4m" or "2h".
				__( 'Preview updated %s ago' ),
				relativeTime
			)
	);
}

function getPushLabel( liveSite: SyncSite | undefined ): string | null {
	return formatIsoTimestampPhrase(
		liveSite?.lastPushTimestamp,
		__( 'Pushed just now' ),
		( relativeTime ) =>
			sprintf(
				// translators: %s: compact relative time, e.g. "4m" or "2h".
				__( 'Pushed %s ago' ),
				relativeTime
			)
	);
}

function getPullLabel( liveSite: SyncSite | undefined ): string | null {
	return formatIsoTimestampPhrase(
		liveSite?.lastPullTimestamp,
		__( 'Pulled just now' ),
		( relativeTime ) =>
			sprintf(
				// translators: %s: compact relative time, e.g. "4m" or "2h".
				__( 'Pulled %s ago' ),
				relativeTime
			)
	);
}

export function getSiteDropdownSecondary( {
	activity,
	activeEnvironment,
	liveSite,
	previewSnapshot,
}: TriggerSecondaryOptions ): TriggerSecondary {
	if ( activity ) {
		return {
			label: getSyncActivityLabel( activity ),
			tone: getSyncActivityTone( activity ),
		};
	}

	const liveSyncLabel = getPushLabel( liveSite ) ?? getPullLabel( liveSite );

	if ( activeEnvironment === 'live' ) {
		return {
			label: liveSyncLabel ?? __( 'Live site' ),
			tone: 'neutral',
		};
	}

	return {
		label: getPreviewLabel( previewSnapshot ) ?? liveSyncLabel ?? __( 'Local preview' ),
		tone: 'neutral',
	};
}
