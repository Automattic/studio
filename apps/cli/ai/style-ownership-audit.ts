import { readdir, readFile } from 'fs/promises';
import path from 'path';

const BLOCK_OPENING_COMMENT_PATTERN = /<!--\s+wp:([^\s]+)([\s\S]*?)-->/g;
const CSS_RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const CLASS_SELECTOR_PATTERN = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g;
const DECLARATION_PATTERN = /(?:^|;)\s*([-\w]+)\s*:/g;

const EDITOR_NATIVE_PROPERTIES = new Set( [
	'background',
	'background-color',
	'border',
	'border-bottom',
	'border-color',
	'border-left',
	'border-radius',
	'border-right',
	'border-top',
	'box-shadow',
	'color',
	'column-gap',
	'flex-basis',
	'font-family',
	'font-size',
	'font-style',
	'font-weight',
	'gap',
	'letter-spacing',
	'line-height',
	'margin',
	'margin-block',
	'margin-block-end',
	'margin-block-start',
	'margin-bottom',
	'margin-inline',
	'margin-inline-end',
	'margin-inline-start',
	'margin-left',
	'margin-right',
	'margin-top',
	'max-width',
	'min-width',
	'padding',
	'padding-block',
	'padding-block-end',
	'padding-block-start',
	'padding-bottom',
	'padding-inline',
	'padding-inline-end',
	'padding-inline-start',
	'padding-left',
	'padding-right',
	'padding-top',
	'row-gap',
	'text-transform',
	'width',
] );

const WORDPRESS_LAYOUT_CUSTOM_PROPERTIES = new Set( [
	'--wp--style--block-gap',
	'--wp--style--global--content-size',
	'--wp--style--global--wide-size',
] );

const EFFECT_SELECTOR_PATTERN =
	/::(?:after|before|marker|selection)|:(?:active|focus|focus-visible|hover|target|visited)\b/;

export interface StyleOwnershipWarning {
	className: string;
	filePath: string;
	line: number;
	properties: string[];
	selector: string;
	suggestion: string;
}

export interface StyleOwnershipAudit {
	cssFilesChecked: number;
	customClassCount: number;
	truncatedWarningCount: number;
	warnings: StyleOwnershipWarning[];
}

interface CustomClassUsage {
	blockName: string;
	line: number;
}

interface ThemeStyleSheet {
	contents: string;
	filePath: string;
}

function getLineNumber( contents: string, index: number ): number {
	return contents.slice( 0, index ).split( '\n' ).length;
}

function stripCommentsPreservingLines( contents: string ): string {
	return contents.replace( /\/\*[\s\S]*?\*\//g, ( comment ) => comment.replace( /[^\n]/g, ' ' ) );
}

function parseBlockCustomClasses( blockContent: string ): Map< string, CustomClassUsage[] > {
	const customClasses = new Map< string, CustomClassUsage[] >();

	for ( const match of blockContent.matchAll( BLOCK_OPENING_COMMENT_PATTERN ) ) {
		const blockName = match[ 1 ];
		let attributesJson = match[ 2 ].trim();
		if ( attributesJson.endsWith( '/' ) ) {
			attributesJson = attributesJson.slice( 0, -1 ).trim();
		}
		if ( ! attributesJson.startsWith( '{' ) ) {
			continue;
		}
		if ( ! attributesJson ) {
			continue;
		}

		let attributes: { className?: unknown };
		try {
			attributes = JSON.parse( attributesJson );
		} catch {
			continue;
		}

		if ( typeof attributes.className !== 'string' ) {
			continue;
		}

		const line = getLineNumber( blockContent, match.index ?? 0 );
		for ( const className of attributes.className.split( /\s+/ ).filter( Boolean ) ) {
			const usages = customClasses.get( className ) ?? [];
			usages.push( { blockName, line } );
			customClasses.set( className, usages );
		}
	}

	return customClasses;
}

async function findThemeStyleSheets( sitePath: string ): Promise< ThemeStyleSheet[] > {
	const themesPath = path.join( sitePath, 'wp-content', 'themes' );
	let themeEntries;
	try {
		themeEntries = await readdir( themesPath, { withFileTypes: true } );
	} catch {
		return [];
	}

	const styleSheets: ThemeStyleSheet[] = [];
	for ( const entry of themeEntries ) {
		if ( ! entry.isDirectory() ) {
			continue;
		}

		const stylePath = path.join( themesPath, entry.name, 'style.css' );
		try {
			styleSheets.push( {
				contents: await readFile( stylePath, 'utf8' ),
				filePath: path.relative( sitePath, stylePath ),
			} );
		} catch {
			// Themes do not always ship a style.css in test fixtures or partial builds.
		}
	}

	return styleSheets;
}

function parseEditorNativeProperties( declarations: string ): string[] {
	const properties = new Set< string >();
	for ( const match of declarations.matchAll( DECLARATION_PATTERN ) ) {
		const property = match[ 1 ].toLowerCase();
		if (
			EDITOR_NATIVE_PROPERTIES.has( property ) ||
			WORDPRESS_LAYOUT_CUSTOM_PROPERTIES.has( property )
		) {
			properties.add( property );
		}
	}
	return [ ...properties ].sort();
}

function getSuggestion( properties: string[] ): string {
	const hasLayout = properties.some(
		( property ) =>
			property.includes( 'width' ) ||
			property === 'flex-basis' ||
			WORDPRESS_LAYOUT_CUSTOM_PROPERTIES.has( property )
	);
	const hasSpacing = properties.some(
		( property ) =>
			property.includes( 'margin' ) ||
			property.includes( 'padding' ) ||
			property === 'gap' ||
			property === 'row-gap' ||
			property === 'column-gap'
	);
	const hasTypography = properties.some(
		( property ) =>
			property.startsWith( 'font-' ) ||
			property === 'letter-spacing' ||
			property === 'line-height' ||
			property === 'text-transform'
	);
	const hasColor = properties.some( ( property ) => property.includes( 'color' ) );

	const suggestions: string[] = [];
	if ( hasLayout ) {
		suggestions.push( 'layout.contentSize/wideSize/align' );
	}
	if ( hasSpacing ) {
		suggestions.push( 'style.spacing or theme.json spacing presets' );
	}
	if ( hasTypography ) {
		suggestions.push( 'fontSize/style.typography or theme.json typography presets' );
	}
	if ( hasColor ) {
		suggestions.push( 'palette slugs or theme.json styles' );
	}

	if ( suggestions.length === 0 ) {
		return 'prefer block attributes or theme.json when the editor exposes this styling';
	}

	return `prefer ${ suggestions.join( ', ' ) } before custom CSS`;
}

function selectorClasses( selector: string ): string[] {
	return [ ...selector.matchAll( CLASS_SELECTOR_PATTERN ) ].map( ( match ) => match[ 1 ] );
}

function auditStyleSheet(
	styleSheet: ThemeStyleSheet,
	customClasses: Map< string, CustomClassUsage[] >,
	warnings: StyleOwnershipWarning[]
): void {
	const css = stripCommentsPreservingLines( styleSheet.contents );

	for ( const match of css.matchAll( CSS_RULE_PATTERN ) ) {
		const selector = match[ 1 ].trim().replace( /\s+/g, ' ' );
		const declarations = match[ 2 ];
		if ( ! selector || EFFECT_SELECTOR_PATTERN.test( selector ) ) {
			continue;
		}

		const properties = parseEditorNativeProperties( declarations );
		if ( properties.length === 0 ) {
			continue;
		}

		for ( const className of selectorClasses( selector ) ) {
			if ( ! customClasses.has( className ) ) {
				continue;
			}

			warnings.push( {
				className,
				filePath: styleSheet.filePath,
				line: getLineNumber( css, match.index ?? 0 ),
				properties,
				selector,
				suggestion: getSuggestion( properties ),
			} );
		}
	}
}

export async function auditStyleOwnership( {
	blockContent,
	maxWarnings = 12,
	sitePath,
}: {
	blockContent: string;
	maxWarnings?: number;
	sitePath: string;
} ): Promise< StyleOwnershipAudit > {
	const customClasses = parseBlockCustomClasses( blockContent );
	const styleSheets = await findThemeStyleSheets( sitePath );
	const allWarnings: StyleOwnershipWarning[] = [];

	for ( const styleSheet of styleSheets ) {
		auditStyleSheet( styleSheet, customClasses, allWarnings );
	}

	return {
		cssFilesChecked: styleSheets.length,
		customClassCount: customClasses.size,
		truncatedWarningCount: Math.max( 0, allWarnings.length - maxWarnings ),
		warnings: allWarnings.slice( 0, maxWarnings ),
	};
}

export function formatStyleOwnershipAudit( audit: StyleOwnershipAudit ): string[] {
	if ( audit.customClassCount === 0 ) {
		return [ 'Style ownership audit: no custom block className hooks found.' ];
	}

	if ( audit.cssFilesChecked === 0 ) {
		return [
			`Style ownership audit: skipped CSS scan (${ audit.customClassCount } custom block className hook(s), no theme style.css files found).`,
		];
	}

	if ( audit.warnings.length === 0 ) {
		return [
			`Style ownership audit: checked ${ audit.cssFilesChecked } theme style.css file(s); no editor-native CSS ownership conflicts found.`,
		];
	}

	const lines = [
		`Style ownership audit: ${ audit.warnings.length } warning(s) across ${ audit.cssFilesChecked } theme style.css file(s).`,
		'Potential editor-blind styling:',
		...audit.warnings.map(
			( warning ) =>
				`  - ${ warning.filePath }:${ warning.line } \`${
					warning.selector
				}\` styles block className \`.${ warning.className }\` with ${ warning.properties.join(
					', '
				) }; ${ warning.suggestion }.`
		),
	];

	if ( audit.truncatedWarningCount > 0 ) {
		lines.push( `  - ${ audit.truncatedWarningCount } additional warning(s) omitted.` );
	}

	lines.push(
		'Review these before applying content: if the styling is color, type, spacing, or layout that the editor exposes, move it to block attributes or theme.json; keep CSS for unsupported selectors, effects, and progressive enhancement.'
	);

	return lines;
}
