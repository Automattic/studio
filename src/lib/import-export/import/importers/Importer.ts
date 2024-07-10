import { DbConfig } from '../types';

export interface Importer {
	import( rootPath: string, dbConfig: DbConfig ): Promise< void >;
}
