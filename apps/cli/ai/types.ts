export interface AskUserQuestion {
	question: string;
	options: { label: string; description: string }[];
	allowFreeForm?: boolean;
}

export type AskUserHandler = (
	questions: AskUserQuestion[]
) => Promise< Record< string, string > >;

export interface SiteInfo {
	name: string;
	path: string;
	running: boolean;
	remote?: boolean;
	url?: string;
	wpcomSiteId?: number;
	// Self-hosted sites are flagged `remote` and carry the id of their saved
	// connection in cli.json; credentials (Application Password) are resolved
	// from the config at turn time and never stored on SiteInfo.
	selfHostedSite?: boolean;
	selfHostedSiteId?: string;
}
