import type { PickedElement } from './types';

export function detectWpBlockType( el: Element ): string | null {
	if ( el instanceof HTMLElement && el.dataset.type ) {
		return el.dataset.type;
	}
	let current: Element | null = el;
	for ( let i = 0; i < 5 && current && current !== current.ownerDocument.body; i++ ) {
		if ( current.className && typeof current.className === 'string' ) {
			const match = current.className.match( /wp-block-([a-z0-9-]+)/ );
			if ( match ) {
				return 'core/' + match[ 1 ];
			}
		}
		current = current.parentElement;
	}
	return null;
}

export function generateSelector( el: Element ): string {
	const parts: string[] = [];
	let current: Element | null = el;
	while ( current && current !== current.ownerDocument.body && current !== current.ownerDocument.documentElement ) {
		let part = current.tagName.toLowerCase();
		if ( current.id ) {
			parts.unshift( part + '#' + current.id );
			break;
		}
		const parent = current.parentElement;
		if ( parent ) {
			const siblings = Array.from( parent.children ).filter( ( c ) => c.tagName === current!.tagName );
			if ( siblings.length > 1 ) {
				const index = siblings.indexOf( current ) + 1;
				part += ':nth-child(' + index + ')';
			}
		}
		parts.unshift( part );
		current = current.parentElement;
	}
	return parts.join( ' > ' );
}

export function getKeyStyles( el: Element ): Record< string, string > {
	const computed = el.ownerDocument.defaultView!.getComputedStyle( el );
	const keys = [
		'fontSize', 'fontWeight', 'fontFamily', 'color', 'backgroundColor',
		'padding', 'margin', 'display', 'position', 'width', 'height',
		'textAlign', 'lineHeight', 'borderRadius',
	];
	const styles: Record< string, string > = {};
	for ( const key of keys ) {
		const val = computed.getPropertyValue(
			key.replace( /[A-Z]/g, ( m ) => '-' + m.toLowerCase() )
		);
		if (
			val && val !== 'auto' && val !== 'normal' && val !== 'none' &&
			val !== '0px' && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent'
		) {
			styles[ key ] = val;
		}
	}
	return styles;
}

export function getAncestors( el: Element ): string[] {
	const chain: string[] = [];
	let current = el.parentElement;
	while ( current && current !== current.ownerDocument.documentElement ) {
		let label = current.tagName.toLowerCase();
		if ( current.id ) {
			label += '#' + current.id;
		} else if ( current.className && typeof current.className === 'string' ) {
			const cls = current.className.split( /\s+/ )[ 0 ];
			if ( cls ) {
				label += '.' + cls;
			}
		}
		chain.unshift( label );
		current = current.parentElement;
	}
	return chain;
}

export function captureElement( el: Element ): PickedElement {
	const rect = el.getBoundingClientRect();
	return {
		tagName: el.tagName,
		selector: generateSelector( el ),
		outerHTML: el.outerHTML.slice( 0, 2000 ),
		innerText: ( ( el as HTMLElement ).innerText || '' ).slice( 0, 500 ),
		computedStyles: getKeyStyles( el ),
		boundingRect: {
			x: Math.round( rect.x ),
			y: Math.round( rect.y ),
			width: Math.round( rect.width ),
			height: Math.round( rect.height ),
		},
		wpBlockType: detectWpBlockType( el ),
		ancestors: getAncestors( el ),
	};
}
