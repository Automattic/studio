export interface WordPressProvider {
	setupWordPressSite( path: string, wpVersion?: string ): Promise< boolean >;
}
