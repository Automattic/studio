import {
	STUDIO_BASH_COMMAND_MAX_BYTES,
	STUDIO_EDIT_CALL_TARGET_BYTES,
	STUDIO_FILE_TOOL_MAX_BYTES,
} from './tool-safety';

export interface FileToolPrompt {
	promptSnippet: string;
	promptGuidelines?: string[];
}

function formatKilobytes( bytes: number ): string {
	return `${ bytes / 1024 }KB`;
}

// What the system prompt says about the file and shell tools Studio takes
// from pi, under the names Studio registers them with. Adapted from pi's own
// snippets and guidelines; the limits are the ones tool-safety.ts enforces.
export function getFileToolPrompt( toolName: string ): FileToolPrompt | undefined {
	const fileLimit = formatKilobytes( STUDIO_FILE_TOOL_MAX_BYTES );
	switch ( toolName ) {
		case 'Read':
			return {
				promptSnippet: 'Read file contents',
				promptGuidelines: [ 'Use Read to examine files instead of cat or sed.' ],
			};
		case 'Write':
			return {
				promptSnippet: 'Create or overwrite files',
				promptGuidelines: [
					'Use Write only for new files or complete rewrites.',
					`Write rejects payloads over ${ fileLimit }; split a larger file across calls.`,
				],
			};
		case 'Edit':
			return {
				promptSnippet:
					'Make precise file edits with exact text replacement, several disjoint edits in one call',
				promptGuidelines: [
					'Use Edit for precise changes: each edits[].oldText must match the file exactly and be unique in it, and stay as small as it can while still unique.',
					'Put every change you have ready for a file into one Edit call — all the anchors you can fill or a whole batch of fixes — instead of one call per anchor; each extra call costs a full round trip.',
					'Each edits[].oldText is matched against the original file, not after earlier entries are applied: do not emit overlapping or nested entries, and merge nearby changes into one.',
					`Keep an Edit call's new text under ~${ formatKilobytes(
						STUDIO_EDIT_CALL_TARGET_BYTES
					) } and split a longer fill across two or three calls; more than ${ fileLimit } across all edits[] entries is rejected.`,
				],
			};
		case 'Bash':
			return {
				promptSnippet: 'Execute shell commands (ls, grep, find, etc.)',
				promptGuidelines: [
					`Bash rejects commands over ${ formatKilobytes(
						STUDIO_BASH_COMMAND_MAX_BYTES
					) }; never use heredocs, \`cat > file <<EOF\`, or Python scripts to write large generated files — they carry the same payload-truncation risk.`,
				],
			};
		case 'Grep':
			return { promptSnippet: 'Search file contents for patterns (respects .gitignore)' };
		case 'Glob':
			return { promptSnippet: 'Find files by glob pattern (respects .gitignore)' };
		case 'Ls':
			return { promptSnippet: 'List directory contents' };
		default:
			return undefined;
	}
}
