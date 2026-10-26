const COLOR =
	/#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((?!\s*from\b)|\b(?:black|white)\b/i;
const LENGTH = /\d(?:px|rem)\b/;

// Top-level comma-separated layers of a value.
function layers( value ) {
	const out = [ '' ];
	let depth = 0;
	for ( const char of value ) {
		depth += char === '(' ? 1 : char === ')' ? -1 : 0;
		if ( char === ',' && depth === 0 ) {
			out.push( '' );
		} else {
			out[ out.length - 1 ] += char;
		}
	}
	return out;
}

// A shadow layer that casts (has a blur) is an elevation, which has tokens.
function castsShadow( layer ) {
	const lengths = layer
		.replace( /var\([^)]*\)|color-mix\(.*\)/g, '' )
		.trim()
		.split( /\s+/ )
		.filter( ( part ) => /^-?\d*\.?\d+(?:px)?$/.test( part ) );
	return lengths.length >= 3 && parseFloat( lengths[ 2 ] ) !== 0;
}

function check( property, value ) {
	// Masks paint alpha, not color.
	if ( ! /^(?:-webkit-)?mask/.test( property ) && COLOR.test( value ) ) {
		return 'color';
	}
	if ( property === 'font-size' && LENGTH.test( value ) ) {
		return 'fontSize';
	}
	// A radius derived from a token, like `calc( var( --radius-md ) + 6px )`, follows the scale.
	if (
		/^border(?:-[a-z]+)*-radius$/.test( property ) &&
		LENGTH.test( value ) &&
		! /var\(\s*--radius/.test( value )
	) {
		return 'radius';
	}
	if ( property === 'box-shadow' && layers( value ).some( castsShadow ) ) {
		return 'shadow';
	}
	if ( property === 'z-index' && /^\d+$/.test( value ) && Number( value ) >= 10 ) {
		return 'zIndex';
	}
	return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Require theme tokens for colors, font sizes, radii, elevation shadows and stacking layers in CSS.',
		},
		schema: [],
		messages: {
			color: 'Use a color token from lib/theme/tokens.css instead of a literal color.',
			fontSize: 'Use a `--text-*` token instead of a literal font size.',
			radius: 'Use a `--radius-*` token instead of a literal radius.',
			shadow: 'Use a `--shadow-*` token instead of a literal shadow.',
			zIndex: 'Use a `--z-*` token for a layer; literals are for order within a component (0–9).',
		},
	},
	create( context ) {
		return {
			Declaration( node ) {
				const value = context.sourceCode.getText( node.value ).trim();
				const messageId = check( node.property.toLowerCase(), value );
				if ( messageId ) {
					context.report( { node, messageId } );
				}
			},
		};
	},
};
