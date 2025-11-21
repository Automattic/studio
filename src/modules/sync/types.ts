export type RawDirectoryEntry = {
	name: string;
	isDirectory: boolean;
	path: string;
	children?: RawDirectoryEntry[];
};

export type SyncModalMode = 'push' | 'pull' | 'connect';
