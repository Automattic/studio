export function useIsValidWpCliInline( command: string ) {
	const containsWPCommand = /\bwp\s/.test( command );
	const wpSingleLine = ! /\n/.test( command );
	const wpContainsPlaceHolders = /<.*>/.test( command ) || /\[.*\]/.test( command );
	const wpHasPath = /path/i.test( command ) || /\//.test( command );
	return containsWPCommand && wpSingleLine && ! wpContainsPlaceHolders && ! wpHasPath;
}
