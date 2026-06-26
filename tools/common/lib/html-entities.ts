const htmlEntityReplacements: Record< string, string > = {
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	nbsp: ' ',
	quot: '"',
	lsquo: "'",
	rsquo: "'",
	ldquo: '"',
	rdquo: '"',
	ndash: '-',
	mdash: '-',
};

export function decodeHtmlEntities( value: string ): string {
	if ( ! value.includes( '&' ) ) {
		return value;
	}

	return value.replace(
		/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,
		( entity, encodedValue: string ) => {
			const normalizedValue = encodedValue.toLowerCase();
			if ( normalizedValue.startsWith( '#x' ) ) {
				const codePoint = Number.parseInt( normalizedValue.slice( 2 ), 16 );
				return Number.isFinite( codePoint ) ? String.fromCodePoint( codePoint ) : entity;
			}

			if ( normalizedValue.startsWith( '#' ) ) {
				const codePoint = Number.parseInt( normalizedValue.slice( 1 ), 10 );
				return Number.isFinite( codePoint ) ? String.fromCodePoint( codePoint ) : entity;
			}

			return htmlEntityReplacements[ normalizedValue ] ?? entity;
		}
	);
}
