export type AnnotationTool = 'select' | 'draw';

export function getAnnotationToolShortcut( event: KeyboardEvent ): AnnotationTool | null {
	if (
		event.defaultPrevented ||
		event.repeat ||
		event.metaKey ||
		event.ctrlKey ||
		event.altKey ||
		event.shiftKey ||
		event.isComposing ||
		event.keyCode === 229 ||
		event.getModifierState?.( 'AltGraph' )
	)
		return null;
	const key = /^[a-z]$/i.test( event.key )
		? event.key.toLowerCase()
		: event.code.startsWith( 'Key' )
		? event.code.slice( 3 ).toLowerCase()
		: event.key;
	return key === 'v' ? 'select' : key === 'd' ? 'draw' : null;
}
