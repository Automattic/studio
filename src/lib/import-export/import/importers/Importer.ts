export interface Importer {
	import( rootPath: string ): Promise< void >;
}
