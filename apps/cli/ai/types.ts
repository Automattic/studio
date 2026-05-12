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
}
