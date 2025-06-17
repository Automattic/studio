export const SYNC_OPTIONS = {
	all: 'all',
	themes: 'themes',
	plugins: 'plugins',
	uploads: 'uploads',
	sqls: 'sqls',
	contents: 'contents',
} as const;

export type SyncOption = keyof typeof SYNC_OPTIONS;

export const isSyncOption = ( value: string ): value is SyncOption => {
	return Object.keys( SYNC_OPTIONS ).includes( value );
};
