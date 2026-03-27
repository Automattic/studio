const FRIENDLY_NAMES: Record< string, string > = {
	h1: 'Heading',
	h2: 'Heading',
	h3: 'Heading',
	h4: 'Heading',
	h5: 'Heading',
	h6: 'Heading',
	p: 'Paragraph',
	a: 'Link',
	img: 'Image',
	button: 'Button',
	input: 'Input field',
	nav: 'Navigation',
	header: 'Header',
	footer: 'Footer',
	section: 'Section',
	div: 'Block',
	span: 'Text',
	ul: 'List',
	ol: 'List',
	li: 'List item',
	form: 'Form',
	table: 'Table',
	video: 'Video',
	audio: 'Audio',
};

export function getFriendlyDescription( tagName: string, wpBlockType: string | null, innerText: string ): string {
	const tag = tagName.toLowerCase();
	let description = FRIENDLY_NAMES[ tag ] || tag.toUpperCase() + ' element';

	if ( wpBlockType ) {
		const blockLabel = wpBlockType.replace( 'core/', '' ).replace( /-/g, ' ' );
		description = blockLabel.charAt( 0 ).toUpperCase() + blockLabel.slice( 1 ) + ' block';
	}

	const textPreview = innerText.slice( 0, 100 ).trim();
	if ( textPreview ) {
		const ellipsis = innerText.length > 100 ? '\u2026' : '';
		return `${ description }: \u201C${ textPreview }${ ellipsis }\u201D`;
	}

	return description;
}
