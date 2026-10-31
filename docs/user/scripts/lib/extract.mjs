import { createTurndownService } from './turndown-rules.mjs';

const turndownService = createTurndownService();

// Runs our own ported Turndown config against an already-extracted, already-cleaned
// content HTML fragment (the same shape the site's own click handler builds), so this
// exercises exactly the piece of logic we independently reimplemented.
export function htmlFragmentToMarkdown( contentHtml, title ) {
	let markdown = turndownService.turndown( contentHtml || '' );
	if ( title ) {
		markdown = `# ${ title }\n\n${ markdown }`;
	}
	return markdown;
}
