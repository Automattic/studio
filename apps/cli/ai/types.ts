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
	// SSH sites are flagged `remote` like WP.com sites but carry the id of
	// their saved connection in cli.json; the connection details are resolved
	// from the config at turn time and never stored on SiteInfo.
	sshSite?: boolean;
	sshSiteId?: string;
}
