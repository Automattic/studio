export interface FileToolPrompt {
	promptSnippet: string;
}

// What the system prompt's tool list says about the file and shell tools
// Studio takes from pi, under the names Studio registers them with. How big
// each call may be is enforced by the payload limits in tool-safety.ts.
const FILE_TOOL_SNIPPETS: Record< string, string > = {
	Read: 'Read file contents',
	Write: 'Create or overwrite files',
	Edit: 'Make precise file edits with exact text replacement, several disjoint edits in one call',
	Bash: 'Execute shell commands (ls, grep, find, etc.)',
	Grep: 'Search file contents for patterns (respects .gitignore)',
	Glob: 'Find files by glob pattern (respects .gitignore)',
	Ls: 'List directory contents',
};

export function getFileToolPrompt( toolName: string ): FileToolPrompt | undefined {
	const promptSnippet = FILE_TOOL_SNIPPETS[ toolName ];
	return promptSnippet ? { promptSnippet } : undefined;
}
