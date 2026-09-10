export interface AskUserQuestion {
	question: string;
	// `image` is an absolute path to a rendered preview shown above the options.
	options: { label: string; description: string; image?: string }[];
	allowFreeForm?: boolean;
}

export type AskUserHandler = (
	questions: AskUserQuestion[]
) => Promise< Record< string, string > >;

export interface SiteInfo {
	// Local site id from the registry. Optional: sites replayed from events
	// written before siteId existed only carry the path.
	id?: string;
	name: string;
	path: string;
	running: boolean;
	remote?: boolean;
	url?: string;
	wpcomSiteId?: number;
}
