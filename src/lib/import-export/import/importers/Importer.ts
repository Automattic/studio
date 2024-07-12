import { BackupContents } from '../types';

export interface MetaFileData {
	phpVersion: string;
	wordpressVersion: string;
}

export interface ImporterResult extends Omit< BackupContents, 'metaFile' > {
	meta?: MetaFileData;
}

export interface Importer {
	import( rootPath: string ): Promise< ImporterResult >;
	getBackupContents(): BackupContents;
}
