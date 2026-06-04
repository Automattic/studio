export interface ComposerFocusSearch {
	focusComposer?: boolean;
}

export function validateComposerFocusSearch(
	search: Record< string, unknown >
): ComposerFocusSearch {
	return search.focusComposer === true || search.focusComposer === 'true'
		? { focusComposer: true }
		: {};
}
