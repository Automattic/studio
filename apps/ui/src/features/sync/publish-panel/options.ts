import { __ } from '@wordpress/i18n';
import type { PullSyncOptions, PushSyncOptions } from '@/data/core';
import type { RemoteSite } from '@studio/providers';

// A remote site the panel shows: connected ones carry when they were last synced.
export type Website = RemoteSite & {
	lastPushTimestamp?: string | null;
	lastPullTimestamp?: string | null;
};

export type PublishView = 'publish' | 'pull';
// What the panel opens on: `start` offers a new or existing site even when one is connected.
export type PanelRequest = { view: PublishView | 'start'; remoteSiteId?: Website[ 'id' ] };

// A WordPress.com site still waiting for its launch hasn't been published yet.
export function lastPublished( website: Website ) {
	return 'launchAfterPush' in website && website.launchAfterPush ? null : website.lastPushTimestamp;
}
export type PublishScope = 'all' | 'files' | 'content' | 'custom';
export type TransferDirection = 'push' | 'pull';
export type TransferOptions = { push: PushSyncOptions; pull: PullSyncOptions };

export function scopeLabel( scope: PublishScope ) {
	switch ( scope ) {
		case 'all':
			return __( 'Files, content, and settings' );
		case 'files':
			return __( 'Files only' );
		case 'content':
			return __( 'Content and settings only' );
		case 'custom':
			return __( 'Selected files and content' );
	}
}

export function presetOptions( scope: Exclude< PublishScope, 'custom' > ): TransferOptions {
	const optionsToSync: PushSyncOptions[ 'optionsToSync' ] =
		scope === 'all'
			? [ 'all' ]
			: scope === 'content'
			? [ 'sqls' ]
			: [ 'plugins', 'themes', 'uploads', 'contents' ];
	return { push: { optionsToSync }, pull: { optionsToSync } };
}

export function overwriteDescription( direction: TransferDirection, selective: boolean ) {
	if ( direction === 'push' && ! selective ) {
		return __( 'Your website will be replaced with this site as it is now.' );
	}
	return direction === 'push'
		? __( 'Selected files, content, and settings on your website will be overwritten.' )
		: __(
				'Selected files, content, and settings in WordPress Studio will be overwritten. Your website stays unchanged.'
		  );
}
