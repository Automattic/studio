export function getRenderedText( rendered: string | { rendered?: string } | null | undefined ) {
	const html = typeof rendered === 'string' ? rendered : rendered?.rendered;
	if ( ! html ) {
		return '';
	}

	const template = document.createElement( 'template' );
	template.innerHTML = html;
	return template.content.textContent?.trim() ?? '';
}
