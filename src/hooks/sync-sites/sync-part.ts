const SYNC_PARTS = [ 'all', 'themes', 'plugins', 'uploads', 'sqls', 'contents' ] as const;

export type SyncPart = ( typeof SYNC_PARTS )[ number ];

export const isSyncPart = ( value: string ): value is SyncPart => {
	return SYNC_PARTS.includes( value as SyncPart );
};
