/**
 * Types for WordPress server processes.
 */

export type AllowedPHPVersion = string;

export interface WordPressServerProcess {
	url: string;
	php?: {
		documentRoot: string;
		request?: ( options: {
			url: string;
			method: string;
			body: Record< string, string >;
		} ) => Promise< { text: string } >;
	};
	start( siteId?: string ): Promise< void >;
	stop(): Promise< void >;
}
