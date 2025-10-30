import { GRANULAR_SYNC_FOLDERS } from 'src/modules/sync/constants';

export type GranularSyncFolders = ( typeof GRANULAR_SYNC_FOLDERS )[ number ];

export type RawFileNode = {
	name: string;
	isDirectory: boolean;
	path: string;
	children?: RawFileNode[];
};
