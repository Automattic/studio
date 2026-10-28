import { createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff';

// A standard unified patch, the same as pi's edit tool writes.
export function generateUnifiedPatch(
	path: string,
	oldContent: string,
	newContent: string,
	contextLines = 4
): string {
	return createTwoFilesPatch( path, path, oldContent, newContent, undefined, undefined, {
		context: contextLines,
		headerOptions: FILE_HEADERS_ONLY,
	} );
}
