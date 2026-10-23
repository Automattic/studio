import type { SiteAgentFileKind } from '@studio/common/lib/agent-skills';

// A site's skill or instruction file, relative to the site: where agents find
// it, then where a switched-off one waits.
export function getSiteAgentFilePaths( kind: SiteAgentFileKind, id: string ): string[] {
	return kind === 'instructions'
		? [ id, `.agents/disabled-instructions/${ id }` ]
		: [ `.agents/skills/${ id }`, `.agents/disabled-skills/${ id }` ];
}

// The folder a file manager or terminal opens for it: a skill is a folder
// already, an instruction file opens where it sits.
export function getSiteAgentFileFolder( kind: SiteAgentFileKind, relativePath: string ): string {
	return kind === 'instructions'
		? relativePath.split( '/' ).slice( 0, -1 ).join( '/' )
		: relativePath;
}

export type SiteAgentFileOpenTarget = 'editor' | 'files' | 'terminal';
