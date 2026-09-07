import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useMemo } from 'react';
import { useConnector } from '@/data/core';
import { useAppUpdateStatus } from '@/data/queries/use-app-update';
import type { AppUpdateStatus } from '@/data/core';

export interface PersistentMessage {
	id: string;
	intent: 'info' | 'success' | 'warning' | 'error';
	title: string;
	description?: string;
	cta?: { label: string; onClick: () => void };
}

// Dismissals are session-only by design: the cache entry isn't persisted and
// never refetches, so it lives until the app restarts — and restarting installs
// the pending update, which removes the card's reason to exist. If a future
// message must outlive restarts (e.g. server announcements), that's the point
// to add persisted dismissal storage.
const DISMISSED_MESSAGES_QUERY_KEY = [ 'dismissed-messages' ] as const;

/**
 * The target version is often unknown mid-download: Electron's updater doesn't name it
 * until the download ends.
 */
function describeVersionChange(
	currentVersion: string | null,
	newVersion: string | null,
	{ fallback }: { fallback?: string } = {}
): string | undefined {
	if ( currentVersion && newVersion ) {
		return sprintf(
			/* translators: 1: current version, e.g. "1.20.0". 2: new version, e.g. "1.21.0". */
			__( 'Updating from %1$s to %2$s.' ),
			currentVersion,
			newVersion
		);
	}
	if ( currentVersion ) {
		return sprintf(
			/* translators: %s: current version number, e.g. "1.20.0". */
			__( 'Updating from %s.' ),
			currentVersion
		);
	}
	return fallback;
}

export function deriveUpdateMessages(
	status: AppUpdateStatus | undefined,
	onInstall: () => void
): PersistentMessage[] {
	if ( status?.state === 'downloading' ) {
		return [
			{
				// Stable across the feed lookup resolving: a version-scoped id would change
				// mid-download and resurrect a card the user had dismissed.
				id: 'app-update-downloading',
				intent: 'info',
				title: __( 'Downloading update' ),
				description: describeVersionChange( status.currentVersion, status.newVersion ),
			},
		];
	}

	if ( status?.state === 'ready' ) {
		const version = status.newVersion;
		return [
			{
				// Version-scoped id so a dismissal re-arms for the next release.
				id: version ? `app-update:${ version }` : 'app-update',
				intent: 'info',
				title: version
					? sprintf(
							/* translators: %s: app version number. */
							__( 'Studio %s is ready to install' ),
							version
					  )
					: __( 'A Studio update is ready to install' ),
				description: describeVersionChange( status.currentVersion, version, {
					fallback: __( 'Restart to finish updating.' ),
				} ),
				cta: { label: __( 'Restart now' ), onClick: onInstall },
			},
		];
	}

	if ( status?.state === 'error' ) {
		return [
			{
				id: 'app-update-error',
				intent: 'error',
				title: __( "Couldn't update Studio" ),
				description:
					status.detail ?? __( 'Studio will try again the next time it checks for updates.' ),
			},
		];
	}

	return [];
}

export function useActivePersistentMessages(): {
	messages: PersistentMessage[];
	dismiss: ( message: PersistentMessage ) => void;
} {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const updateStatus = useAppUpdateStatus();
	const { data: dismissedIds = [] } = useQuery( {
		queryKey: DISMISSED_MESSAGES_QUERY_KEY,
		queryFn: () => [] as string[],
		staleTime: Infinity,
		meta: { persist: false },
	} );

	const sources = useMemo(
		() => deriveUpdateMessages( updateStatus.data, () => void connector.installAppUpdate() ),
		[ updateStatus.data, connector ]
	);

	const messages = useMemo(
		() => sources.filter( ( message ) => ! dismissedIds.includes( message.id ) ),
		[ sources, dismissedIds ]
	);

	return {
		messages,
		dismiss: ( message: PersistentMessage ) => {
			queryClient.setQueryData( DISMISSED_MESSAGES_QUERY_KEY, ( current: string[] | undefined ) =>
				current?.includes( message.id ) ? current : [ ...( current ?? [] ), message.id ]
			);
		},
	};
}
