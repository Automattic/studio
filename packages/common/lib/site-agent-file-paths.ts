// A site's skill, relative to the site: where agents find it, then where a
// switched-off one waits. A skill is a folder, which a file manager or
// terminal opens as it is.
export function getSiteAgentFilePaths( id: string ): string[] {
	return [ `.agents/skills/${ id }`, `.agents/disabled-skills/${ id }` ];
}

export type SiteAgentFileOpenTarget = 'editor' | 'files' | 'terminal';
