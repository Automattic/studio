const SYNC_OPTIONS = [ 'all', 'themes', 'plugins', 'uploads', 'sqls', 'contents' ] as const;

export type SyncOption = ( typeof SYNC_OPTIONS )[ number ];

export const isSyncOption = ( value: string ): value is SyncOption => {
	return SYNC_OPTIONS.includes( value as SyncOption );
};
