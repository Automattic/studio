import TurndownService from 'turndown';

// Ported 1:1 from the site's own copy-page click handler (found in its JS bundle),
// so this produces the same output as clicking "Copy page" in a browser.
export function createTurndownService() {
	const service = new TurndownService( {
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
		emDelimiter: '*',
	} );

	service.addRule( 'fencedCodeBlock', {
		filter: ( node, options ) =>
			options.codeBlockStyle === 'fenced' &&
			node.nodeName === 'PRE' &&
			node.firstChild &&
			node.firstChild.nodeName === 'CODE',
		replacement: ( content, node ) => {
			const codeEl = node.firstChild;
			const match = ( codeEl.getAttribute( 'class' ) || '' ).match( /(?:lang|language)-(\S+)/ );
			return (
				'\n\n```' +
				( match ? match[ 1 ] : '' ) +
				'\n' +
				codeEl.textContent.replace( /\n$/, '' ) +
				'\n```\n\n'
			);
		},
	} );

	service.addRule( 'table', {
		filter: 'table',
		replacement: ( content, node ) => {
			const rows = Array.from( node.querySelectorAll( 'tr' ) );
			if ( ! rows.length ) return content;
			const cells = rows.map( ( row ) =>
				Array.from( row.querySelectorAll( 'th, td' ) ).map( ( cell ) =>
					cell.textContent
						.trim()
						.replace( /\\/g, '\\\\' )
						.replace( /\|/g, '\\|' )
						.replace( /\n/g, ' ' )
				)
			);
			const colCount = Math.max( ...cells.map( ( row ) => row.length ) );
			cells.forEach( ( row ) => {
				while ( row.length < colCount ) row.push( '' );
			} );
			const header = cells[ 0 ];
			const divider = header.map( () => '---' );
			const bodyRows = cells.slice( 1 );
			const renderRow = ( row ) => '| ' + row.join( ' | ' ) + ' |';
			return (
				'\n\n' +
				[ renderRow( header ), renderRow( divider ), ...bodyRows.map( renderRow ) ].join( '\n' ) +
				'\n\n'
			);
		},
	} );

	service.addRule( 'tableCell', {
		filter: [ 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td' ],
		replacement: ( content ) => content,
	} );

	// The site's bundled Turndown version doesn't markdown-escape alt/title text
	// (unlike the current npm `turndown` release) — override to match exactly.
	const cleanAttribute = ( value ) => ( value ? value.replace( /(\n+\s*)+/g, '\n' ) : '' );
	service.addRule( 'image', {
		filter: 'img',
		replacement: ( content, node ) => {
			const alt = cleanAttribute( node.getAttribute( 'alt' ) );
			const src = node.getAttribute( 'src' ) || '';
			const title = cleanAttribute( node.getAttribute( 'title' ) );
			const titlePart = title ? ` "${ title }"` : '';
			return src ? `![${ alt }](${ src }${ titlePart })` : '';
		},
	} );

	return service;
}
