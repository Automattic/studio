export function useIsValidWpCliInline( command: string ) {
	const containsWPCommand = /\bwp\s/.test( command );
	const wpCommandCount = ( command.match( /\bwp\s/g ) || [] ).length;
	const containsSingleWPCommand = wpCommandCount === 1;
	const wpContainsPlaceHolders = /<.*>/.test( command ) || /\[.*\]/.test( command );
	const wpHasPath = /path/i.test( command ) || /\//.test( command );
	return containsWPCommand && containsSingleWPCommand && ! wpContainsPlaceHolders && ! wpHasPath;
}
