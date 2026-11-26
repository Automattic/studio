import type { PullSyncOptions, PushSyncOptions } from '@/data/core';

export type PublishScope = 'all' | 'files' | 'content' | 'custom';
export type TransferDirection = 'push' | 'pull';
export type TransferOptions = { push: PushSyncOptions; pull: PullSyncOptions };

export function presetOptions( scope: Exclude< PublishScope, 'custom' > ): TransferOptions {
	const optionsToSync: PushSyncOptions[ 'optionsToSync' ] =
		scope === 'all'
			? [ 'all' ]
			: scope === 'content'
			? [ 'sqls' ]
			: [ 'plugins', 'themes', 'uploads', 'contents' ];
	return { push: { optionsToSync }, pull: { optionsToSync } };
}
