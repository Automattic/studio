import { decodeHtmlEntities } from '@studio/common/lib/html-entities';
import workbenchStyles from '../development-workbench.module.css';
import type { DiffHunk } from './types';
import type { DevelopmentProjectValidationFinding } from '@studio/common/types/publishing';

type MonacoApi = typeof import('monaco-editor');
type BasicLanguageModule = {
	conf: Parameters< MonacoApi[ 'languages' ][ 'setLanguageConfiguration' ] >[ 1 ];
	language: Parameters< MonacoApi[ 'languages' ][ 'setMonarchTokensProvider' ] >[ 1 ];
};
type DocumentWithCommandSupport = Document & {
	queryCommandSupported?: ( commandId: string ) => boolean;
};
export type ValidationLineMetadata = {
	severity: DevelopmentProjectValidationFinding[ 'severity' ];
	message: string;
};
export type ValidationLineMap = Map< number, ValidationLineMetadata >;
export type AiPatchLineMetadata = {
	type: 'add' | 'delete';
};
export type AiPatchLineMap = Map< number, AiPatchLineMetadata >;
export type AiPatchLineMapSide = 'before' | 'after';
export type ValidationHoverState = ValidationLineMetadata & {
	line: number;
	x: number;
	y: number;
};

export const CODE_EDITOR_FONT_FAMILY =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
export const EMPTY_VALIDATION_FINDINGS: DevelopmentProjectValidationFinding[] = [];
export const EMPTY_AI_PATCH_HUNKS: DiffHunk[] = [];
const WORDPRESS_README_LANGUAGE = 'wordpress-readme';
const VALIDATION_SEVERITY_WEIGHT: Record<
	DevelopmentProjectValidationFinding[ 'severity' ],
	number
> = {
	info: 1,
	warning: 2,
	error: 3,
};
let monacoPromise: Promise< MonacoApi > | null = null;
const registeredLanguages = new Set< string >();
const basicLanguageLoaders: Record< string, () => Promise< BasicLanguageModule > > = {
	css: () => import( 'monaco-editor/esm/vs/basic-languages/css/css.js' ),
	html: () => import( 'monaco-editor/esm/vs/basic-languages/html/html.js' ),
	ini: () => import( 'monaco-editor/esm/vs/basic-languages/ini/ini.js' ),
	javascript: () => import( 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js' ),
	markdown: () => import( 'monaco-editor/esm/vs/basic-languages/markdown/markdown.js' ),
	php: () => import( 'monaco-editor/esm/vs/basic-languages/php/php.js' ),
	scss: () => import( 'monaco-editor/esm/vs/basic-languages/scss/scss.js' ),
	shell: () => import( 'monaco-editor/esm/vs/basic-languages/shell/shell.js' ),
	typescript: () => import( 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js' ),
	xml: () => import( 'monaco-editor/esm/vs/basic-languages/xml/xml.js' ),
	yaml: () => import( 'monaco-editor/esm/vs/basic-languages/yaml/yaml.js' ),
};

function getMonacoLanguage( filePath?: string | null ): string {
	const lowerPath = filePath?.toLowerCase() ?? '';
	const extension = lowerPath.split( '.' ).pop() ?? '';

	if ( lowerPath.endsWith( 'readme.txt' ) ) {
		return WORDPRESS_README_LANGUAGE;
	}

	if ( lowerPath.endsWith( '.md' ) ) {
		return 'markdown';
	}

	switch ( extension ) {
		case 'css':
			return 'css';
		case 'html':
		case 'htm':
			return 'html';
		case 'ini':
			return 'ini';
		case 'js':
		case 'mjs':
		case 'jsx':
			return 'javascript';
		case 'json':
			return 'json';
		case 'php':
			return 'php';
		case 'scss':
			return 'scss';
		case 'sh':
			return 'shell';
		case 'svg':
		case 'xml':
			return 'xml';
		case 'ts':
		case 'tsx':
			return 'typescript';
		case 'yaml':
		case 'yml':
			return 'yaml';
		default:
			return 'plaintext';
	}
}

function getMonacoLanguageFromHint( languageHint?: string | null ): string | undefined {
	const normalizedHint = languageHint
		?.toLowerCase()
		.replace( /^language-/, '' )
		.trim();
	if ( ! normalizedHint ) {
		return undefined;
	}

	switch ( normalizedHint ) {
		case 'bash':
		case 'shell':
		case 'sh':
		case 'zsh':
			return 'shell';
		case 'htm':
		case 'html':
			return 'html';
		case 'javascript':
		case 'js':
		case 'jsx':
			return 'javascript';
		case 'json':
			return 'json';
		case 'markdown':
		case 'md':
			return 'markdown';
		case 'php':
			return 'php';
		case 'readme':
		case 'wordpress-readme':
		case 'wp-readme':
			return WORDPRESS_README_LANGUAGE;
		case 'scss':
			return 'scss';
		case 'text':
		case 'txt':
		case 'plaintext':
			return 'plaintext';
		case 'typescript':
		case 'ts':
		case 'tsx':
			return 'typescript';
		case 'xml':
		case 'svg':
			return 'xml';
		case 'yaml':
		case 'yml':
			return 'yaml';
		default:
			return undefined;
	}
}

function getMonacoLanguageForSnippet( filePath: string | null, languageHint?: string | null ) {
	return getMonacoLanguageFromHint( languageHint ) ?? getMonacoLanguage( filePath );
}

function ensureQueryCommandSupported() {
	const hostDocument = document as DocumentWithCommandSupport;
	if ( typeof hostDocument.queryCommandSupported === 'function' ) {
		return;
	}

	hostDocument.queryCommandSupported = () => false;
}

function loadMonacoTokenizer() {
	if ( ! monacoPromise ) {
		ensureQueryCommandSupported();
		monacoPromise = import( 'monaco-editor/esm/vs/editor/editor.api.js' );
	}
	return monacoPromise;
}

export function offsetForLineColumn( value: string, line: number, column: number ) {
	const lines = value.split( '\n' );
	const targetLine = Math.max( 1, Math.min( lines.length, Number( line ) || 1 ) );
	const targetColumn = Math.max( 1, Number( column ) || 1 );
	let offset = 0;
	for ( let index = 0; index < targetLine - 1; index += 1 ) {
		offset += lines[ index ].length + 1;
	}
	return Math.min( value.length, offset + targetColumn - 1 );
}

function escapeHtml( value: string ) {
	return value
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

function getValidationFindingMessage( finding: DevelopmentProjectValidationFinding ) {
	const message = decodeHtmlEntities( finding.message );
	return finding.code ? `${ finding.code }: ${ message }` : message;
}

export function getValidationLineMap(
	findings: DevelopmentProjectValidationFinding[]
): ValidationLineMap {
	const lineMap: ValidationLineMap = new Map();

	for ( const finding of findings ) {
		if ( ! finding.line || finding.line < 1 ) {
			continue;
		}

		const existing = lineMap.get( finding.line );
		const message = getValidationFindingMessage( finding );
		if ( ! existing ) {
			lineMap.set( finding.line, {
				severity: finding.severity,
				message,
			} );
			continue;
		}

		const severity =
			VALIDATION_SEVERITY_WEIGHT[ finding.severity ] >
			VALIDATION_SEVERITY_WEIGHT[ existing.severity ]
				? finding.severity
				: existing.severity;
		lineMap.set( finding.line, {
			severity,
			message: `${ existing.message }\n${ message }`,
		} );
	}

	return lineMap;
}

export function getAiPatchLineMap(
	hunks: DiffHunk[],
	side: AiPatchLineMapSide = 'after'
): AiPatchLineMap {
	const lineMap: AiPatchLineMap = new Map();

	for ( const hunk of hunks ) {
		for ( const line of hunk.lines ) {
			if ( line.type === 'context' ) {
				continue;
			}

			if ( side === 'before' && line.type === 'delete' && line.oldNumber ) {
				lineMap.set( line.oldNumber, { type: 'delete' } );
			}

			if ( side === 'after' && line.type === 'add' && line.newNumber ) {
				lineMap.set( line.newNumber, { type: 'add' } );
			}
		}
	}

	return lineMap;
}

function getCodeEditorLineClassName(
	validationMetadata?: ValidationLineMetadata,
	aiPatchMetadata?: AiPatchLineMetadata
) {
	return [
		workbenchStyles.codeEditorLine,
		validationMetadata && workbenchStyles.codeEditorLineWithFinding,
		validationMetadata?.severity === 'error' && workbenchStyles.codeEditorLineError,
		validationMetadata?.severity === 'warning' && workbenchStyles.codeEditorLineWarning,
		validationMetadata?.severity === 'info' && workbenchStyles.codeEditorLineInfo,
		aiPatchMetadata && workbenchStyles.codeEditorLineWithPatch,
		aiPatchMetadata?.type === 'add' && workbenchStyles.codeEditorLinePatchAdd,
		aiPatchMetadata?.type === 'delete' && workbenchStyles.codeEditorLinePatchDelete,
	]
		.filter( Boolean )
		.join( ' ' );
}

function wrapHighlightedLines(
	lines: string[],
	validationLineMap: ValidationLineMap,
	aiPatchLineMap: AiPatchLineMap
) {
	return lines
		.map( ( lineHtml, index ) => {
			const lineNumber = index + 1;
			const validationMetadata = validationLineMap.get( lineNumber );
			const aiPatchMetadata = aiPatchLineMap.get( lineNumber );
			const className = getCodeEditorLineClassName( validationMetadata, aiPatchMetadata );
			const title = validationMetadata
				? ` title="${ escapeHtml( validationMetadata.message ) }"`
				: '';
			return `<span class="${ escapeHtml( className ) }"${ title }>${ lineHtml }</span>`;
		} )
		.join( '' );
}

function getTokenClassName( tokenType: string ) {
	const type = tokenType.toLowerCase();
	if ( type.includes( 'wp-readme.title' ) ) {
		return workbenchStyles.readmeTokenTitle;
	}
	if ( type.includes( 'wp-readme.section' ) ) {
		return workbenchStyles.readmeTokenSection;
	}
	if ( type.includes( 'wp-readme.subsection' ) ) {
		return workbenchStyles.readmeTokenSubsection;
	}
	if ( type.includes( 'wp-readme.fieldvalue' ) ) {
		return workbenchStyles.readmeTokenFieldValue;
	}
	if ( type.includes( 'wp-readme.field' ) ) {
		return workbenchStyles.readmeTokenField;
	}
	if ( type.includes( 'wp-readme.delimiter' ) ) {
		return workbenchStyles.readmeTokenDelimiter;
	}
	if ( type.includes( 'wp-readme.listmarker' ) ) {
		return workbenchStyles.readmeTokenListMarker;
	}
	if ( type.includes( 'wp-readme.inlinecode' ) ) {
		return workbenchStyles.readmeTokenInlineCode;
	}
	if ( type.includes( 'wp-readme.codeblock' ) ) {
		return workbenchStyles.readmeTokenCodeBlock;
	}
	if ( type.includes( 'wp-readme.link' ) ) {
		return workbenchStyles.readmeTokenLink;
	}
	if ( type.includes( 'wp-readme.url' ) ) {
		return workbenchStyles.readmeTokenUrl;
	}
	if ( type.includes( 'wp-readme.command' ) ) {
		return workbenchStyles.readmeTokenCommand;
	}
	if ( type.includes( 'wp-readme.shortcode' ) ) {
		return workbenchStyles.readmeTokenShortcode;
	}
	if ( type.includes( 'wp-readme.quote' ) ) {
		return workbenchStyles.readmeTokenQuote;
	}
	if ( type.includes( 'wp-readme.strong' ) ) {
		return workbenchStyles.readmeTokenStrong;
	}
	if ( type.includes( 'wp-readme.emphasis' ) ) {
		return workbenchStyles.readmeTokenEmphasis;
	}
	if ( type.includes( 'comment' ) ) {
		return workbenchStyles.codeTokenComment;
	}
	if ( type.includes( 'string.key' ) ) {
		return workbenchStyles.codeTokenVariable;
	}
	if ( type.includes( 'string' ) || type.includes( 'regexp' ) ) {
		return workbenchStyles.codeTokenString;
	}
	if ( type.includes( 'keyword' ) ) {
		return workbenchStyles.codeTokenKeyword;
	}
	if ( type.includes( 'number' ) ) {
		return workbenchStyles.codeTokenNumber;
	}
	if ( type.includes( 'variable' ) ) {
		return workbenchStyles.codeTokenVariable;
	}
	if ( type.includes( 'tag' ) || type.includes( 'attribute.name' ) ) {
		return workbenchStyles.codeTokenTag;
	}
	if ( type.includes( 'delimiter' ) || type.includes( 'operator' ) || type.includes( 'bracket' ) ) {
		return workbenchStyles.codeTokenPunctuation;
	}
	return undefined;
}

function renderPatternHighlightedLine(
	line: string,
	pattern: RegExp,
	getClassName: ( token: string ) => string | undefined
) {
	const tokens: string[] = [];
	let cursor = 0;
	for ( const match of line.matchAll( pattern ) ) {
		if ( match.index === undefined ) {
			continue;
		}
		if ( match.index > cursor ) {
			tokens.push( escapeHtml( line.slice( cursor, match.index ) ) );
		}
		const token = match[ 0 ];
		const className = getClassName( token );
		tokens.push(
			className
				? `<span class="${ escapeHtml( className ) }">${ escapeHtml( token ) }</span>`
				: escapeHtml( token )
		);
		cursor = match.index + token.length;
	}
	if ( cursor < line.length ) {
		tokens.push( escapeHtml( line.slice( cursor ) ) );
	}
	return tokens.join( '' ) || escapeHtml( line || ' ' );
}

const jsonTokenPattern =
	/"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|[{}[\],:]/gi;
const codeTokenPattern =
	/(\/\/.*|#.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\$[A-Za-z_][\w]*|\b(?:abstract|add_action|add_filter|array|as|async|await|break|case|catch|class|const|continue|default|define|echo|else|elseif|export|extends|false|finally|for|foreach|from|function|if|implements|import|interface|let|match|namespace|new|null|private|protected|public|require|require_once|return|self|static|switch|this|throw|trait|true|try|use|var|while|yield)\b|\b\d+(?:\.\d+)?\b|<\/?[A-Za-z][^>\n]*>|<\?php|\?>|[{}[\]().,;:=>+\-*/!&|]+)/g;
const readmeInlinePattern =
	/(\[[^\]\n]+\]:\s*(?:https?:\/\/|mailto:|#)[^\s]+|\[[^\]\n]+\]\([^)]+\)|(?:https?:\/\/|mailto:)[^\s)]+|\b(?:pressship|npx|wp|svn|npm|composer)\s+[^\n`]+|`[^`\n]+`|\*\*[^*\n][\s\S]*?\*\*|\*[^*\s\n][^*\n]*\*|\[(?:youtube|vimeo|wpvideo|playlist|audio|video)\b[^\]\n]*\]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;

function getWordPressReadmeTokenClassName( token: string ) {
	if ( /^\[[^\]\n]+\]:\s*(?:https?:\/\/|mailto:|#)/i.test( token ) ) {
		return workbenchStyles.readmeTokenLink;
	}
	if ( /^\[[^\]\n]+\]\([^)]+\)$/.test( token ) ) {
		return workbenchStyles.readmeTokenLink;
	}
	if ( /^(?:https?:\/\/|mailto:)/i.test( token ) ) {
		return workbenchStyles.readmeTokenUrl;
	}
	if ( /^\b(?:pressship|npx|wp|svn|npm|composer)\s+/i.test( token ) ) {
		return workbenchStyles.readmeTokenCommand;
	}
	if ( /^`[^`\n]+`$/.test( token ) ) {
		return workbenchStyles.readmeTokenInlineCode;
	}
	if ( /^\*\*[^*\n][\s\S]*?\*\*$/.test( token ) ) {
		return workbenchStyles.readmeTokenStrong;
	}
	if ( /^\*[^*\s\n][^*\n]*\*$/.test( token ) ) {
		return workbenchStyles.readmeTokenEmphasis;
	}
	if ( /^\[(?:youtube|vimeo|wpvideo|playlist|audio|video)\b[^\]\n]*\]$/i.test( token ) ) {
		return workbenchStyles.readmeTokenShortcode;
	}
	return workbenchStyles.readmeTokenUrl;
}

function renderWordPressReadmeInlineTokens( line: string ) {
	return renderPatternHighlightedLine(
		line,
		readmeInlinePattern,
		getWordPressReadmeTokenClassName
	);
}

function renderWordPressReadmeHighlightedLine( line: string ) {
	const wholeLineRules: Array< [ RegExp, string ] > = [
		[ /^\s*={3}\s*.*?\s*={3}\s*$/, workbenchStyles.readmeTokenTitle ],
		[ /^\s*={2}\s*.*?\s*={2}\s*$/, workbenchStyles.readmeTokenSection ],
		[ /^\s*=\s*.*?\s*=\s*$/, workbenchStyles.readmeTokenSubsection ],
		[ /^\s{4,}.*$/, workbenchStyles.readmeTokenCodeBlock ],
		[ /^\t.*$/, workbenchStyles.readmeTokenCodeBlock ],
		[ /^(\s*>)(.*)$/, workbenchStyles.readmeTokenQuote ],
	];

	for ( const [ pattern, className ] of wholeLineRules ) {
		if ( pattern.test( line ) ) {
			return `<span class="${ escapeHtml( className ) }">${ escapeHtml( line || ' ' ) }</span>`;
		}
	}

	const fieldMatch = line.match( /^([A-Za-z][A-Za-z0-9 /.-]*)(:)(.*)$/ );
	if ( fieldMatch ) {
		return [
			`<span class="${ escapeHtml( workbenchStyles.readmeTokenField ) }">${ escapeHtml(
				fieldMatch[ 1 ]
			) }</span>`,
			`<span class="${ escapeHtml( workbenchStyles.readmeTokenDelimiter ) }">${ escapeHtml(
				fieldMatch[ 2 ]
			) }</span>`,
			`<span class="${ escapeHtml( workbenchStyles.readmeTokenFieldValue ) }">${ escapeHtml(
				fieldMatch[ 3 ]
			) }</span>`,
		].join( '' );
	}

	const listMatch = line.match( /^(\s*)([*+-]|\d+\.)(\s+)(.*)$/ );
	if ( listMatch ) {
		return [
			escapeHtml( listMatch[ 1 ] ),
			`<span class="${ escapeHtml( workbenchStyles.readmeTokenListMarker ) }">${ escapeHtml(
				listMatch[ 2 ]
			) }</span>`,
			escapeHtml( listMatch[ 3 ] ),
			renderWordPressReadmeInlineTokens( listMatch[ 4 ] ),
		].join( '' );
	}

	return renderWordPressReadmeInlineTokens( line );
}

function getFallbackTokenClassName( token: string, language: string ) {
	if ( language === 'json' ) {
		if ( /^"/.test( token ) ) {
			return token.endsWith( '"' ) && /"$/.test( token ) && ! /\\?"$/.test( token.slice( 0, -1 ) )
				? workbenchStyles.codeTokenString
				: workbenchStyles.codeTokenVariable;
		}
		if ( /^(true|false|null)$/i.test( token ) ) {
			return workbenchStyles.codeTokenKeyword;
		}
		if ( /^-?\d/.test( token ) ) {
			return workbenchStyles.codeTokenNumber;
		}
		return workbenchStyles.codeTokenPunctuation;
	}

	if ( /^\/\/|^#|^\/\*/.test( token ) ) {
		return workbenchStyles.codeTokenComment;
	}
	if ( /^['"`]/.test( token ) ) {
		return workbenchStyles.codeTokenString;
	}
	if ( token.startsWith( '$' ) ) {
		return workbenchStyles.codeTokenVariable;
	}
	if ( /^\d/.test( token ) ) {
		return workbenchStyles.codeTokenNumber;
	}
	if ( /^<\/?|^<\?php|^\?>/.test( token ) ) {
		return workbenchStyles.codeTokenTag;
	}
	if ( /^[{}[\]().,;:=>+\-*/!&|]+$/.test( token ) ) {
		return workbenchStyles.codeTokenPunctuation;
	}
	return workbenchStyles.codeTokenKeyword;
}

function renderFallbackHighlightedLine( line: string, language: string ) {
	if ( language === WORDPRESS_README_LANGUAGE ) {
		return renderWordPressReadmeHighlightedLine( line );
	}

	if ( language !== 'json' && /^\s*(?:\/\*|\*|\/\/|#)/.test( line ) ) {
		return `<span class="${ escapeHtml( workbenchStyles.codeTokenComment ) }">${ escapeHtml(
			line || ' '
		) }</span>`;
	}

	const pattern = language === 'json' ? jsonTokenPattern : codeTokenPattern;
	return renderPatternHighlightedLine( line, pattern, ( token ) =>
		getFallbackTokenClassName( token, language )
	);
}

function renderFallbackHighlightedHtml(
	value: string,
	language: string,
	validationLineMap: ValidationLineMap,
	aiPatchLineMap: AiPatchLineMap
) {
	const content = value || ' ';
	const normalizedContent = content.replace( /\r\n/g, '\n' ).replace( /\r/g, '\n' );
	if ( language === 'plaintext' ) {
		return wrapHighlightedLines(
			normalizedContent.split( '\n' ).map( ( line ) => escapeHtml( line || ' ' ) ),
			validationLineMap,
			aiPatchLineMap
		);
	}

	return wrapHighlightedLines(
		normalizedContent
			.split( '\n' )
			.map( ( line ) => renderFallbackHighlightedLine( line, language ) ),
		validationLineMap,
		aiPatchLineMap
	);
}

function renderTokenizedLine(
	line: string,
	tokens: ReturnType< MonacoApi[ 'editor' ][ 'tokenize' ] >[ number ],
	language: string
) {
	if ( tokens.length === 0 ) {
		return renderFallbackHighlightedLine( line, language );
	}

	const hasClassifiedTokens = tokens.some( ( token ) => getTokenClassName( token.type ) );
	if ( ! hasClassifiedTokens ) {
		return renderFallbackHighlightedLine( line, language );
	}

	let html = '';
	for ( let index = 0; index < tokens.length; index += 1 ) {
		const token = tokens[ index ];
		const nextOffset = tokens[ index + 1 ]?.offset ?? line.length;
		const text = line.slice( token.offset, nextOffset );
		if ( ! text ) {
			continue;
		}
		const className = getTokenClassName( token.type );
		html += className
			? `<span class="${ escapeHtml( className ) }">${ escapeHtml( text ) }</span>`
			: escapeHtml( text );
	}

	return html || escapeHtml( line || ' ' );
}

async function loadMonacoLanguage( monaco: MonacoApi, language: string ) {
	if ( language === 'plaintext' || registeredLanguages.has( language ) ) {
		return;
	}

	if ( language === WORDPRESS_README_LANGUAGE ) {
		registerWordPressReadmeLanguage( monaco );
		registeredLanguages.add( language );
		return;
	}

	const loader = basicLanguageLoaders[ language ];
	if ( ! loader ) {
		return;
	}

	if ( ! monaco.languages.getLanguages().some( ( candidate ) => candidate.id === language ) ) {
		monaco.languages.register( { id: language } );
	}

	const { conf, language: monarchLanguage } = await loader();
	monaco.languages.setLanguageConfiguration( language, conf );
	monaco.languages.setMonarchTokensProvider( language, monarchLanguage );
	registeredLanguages.add( language );
}

function registerWordPressReadmeLanguage( monaco: MonacoApi ) {
	if (
		! monaco.languages
			.getLanguages()
			.some( ( candidate ) => candidate.id === WORDPRESS_README_LANGUAGE )
	) {
		monaco.languages.register( {
			id: WORDPRESS_README_LANGUAGE,
			aliases: [ 'WordPress Readme', WORDPRESS_README_LANGUAGE ],
			extensions: [ '.txt' ],
			filenames: [ 'readme.txt' ],
		} );
	}

	monaco.languages.setLanguageConfiguration( WORDPRESS_README_LANGUAGE, {
		brackets: [
			[ '[', ']' ],
			[ '(', ')' ],
			[ '`', '`' ],
		],
		autoClosingPairs: [
			{ open: '`', close: '`' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
		],
		surroundingPairs: [
			{ open: '`', close: '`' },
			{ open: '*', close: '*' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
		],
		wordPattern: /(-?\d+(?:\.\d+)*)|([^\s`~!@#$%^&*()=+[{\]}\\|;:'",.<>/?]+)/g,
	} );

	monaco.languages.setMonarchTokensProvider( WORDPRESS_README_LANGUAGE, {
		defaultToken: 'wp-readme.text',
		tokenizer: {
			root: [
				[ /^\s*={3}\s*.*?\s*={3}\s*$/, 'wp-readme.title' ],
				[ /^\s*={2}\s*.*?\s*={2}\s*$/, 'wp-readme.section' ],
				[ /^\s*=\s*.*?\s*=\s*$/, 'wp-readme.subsection' ],
				[
					/^(\s*)([*+-])(\s+)/,
					[ 'wp-readme.whitespace', 'wp-readme.listMarker', 'wp-readme.whitespace' ],
				],
				[
					/^(\s*)(\d+\.)(\s+)/,
					[ 'wp-readme.whitespace', 'wp-readme.listMarker', 'wp-readme.whitespace' ],
				],
				[ /^\s{4,}.*$/, 'wp-readme.codeBlock' ],
				[ /^\t.*$/, 'wp-readme.codeBlock' ],
				[ /^(\s*>)(.*)$/, [ 'wp-readme.quote', 'wp-readme.quote' ] ],
				[
					/^([A-Za-z][A-Za-z0-9 /.-]*)(:)(.*)$/,
					[ 'wp-readme.field', 'wp-readme.delimiter', 'wp-readme.fieldValue' ],
				],
				[ /\[[^\]\n]+\]:\s*(?:https?:\/\/|mailto:|#)[^\s]+/, 'wp-readme.link' ],
				[ /\[[^\]\n]+\]\([^)]+\)/, 'wp-readme.link' ],
				[ /(?:https?:\/\/|mailto:)[^\s)]+/, 'wp-readme.url' ],
				[ /\b(?:pressship|npx|wp|svn|npm|composer)\s+[^\n`]+/, 'wp-readme.command' ],
				[ /`[^`\n]+`/, 'wp-readme.inlineCode' ],
				[ /\*\*[^*\n][\s\S]*?\*\*/, 'wp-readme.strong' ],
				[ /\*[^*\s\n][^*\n]*\*/, 'wp-readme.emphasis' ],
				[ /\[(?:youtube|vimeo|wpvideo|playlist|audio|video)\b[^\]\n]*\]/i, 'wp-readme.shortcode' ],
				[ /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'wp-readme.url' ],
			],
		},
	} );
}

function renderHighlightedHtml(
	monaco: MonacoApi,
	value: string,
	language: string,
	validationLineMap: ValidationLineMap,
	aiPatchLineMap: AiPatchLineMap
) {
	const content = value || ' ';
	const normalizedContent = content.replace( /\r\n/g, '\n' ).replace( /\r/g, '\n' );
	const lines = normalizedContent.split( '\n' );
	const tokenizedLines = monaco.editor.tokenize( normalizedContent, language );
	return wrapHighlightedLines(
		lines.map( ( line, index ) =>
			renderTokenizedLine( line, tokenizedLines[ index ] ?? [], language )
		),
		validationLineMap,
		aiPatchLineMap
	);
}

export function renderFallbackEditorHtml(
	value: string,
	filePath: string | null,
	validationLineMap: ValidationLineMap,
	aiPatchLineMap: AiPatchLineMap
) {
	return renderFallbackHighlightedHtml(
		value,
		getMonacoLanguage( filePath ),
		validationLineMap,
		aiPatchLineMap
	);
}

export function renderFallbackCodeLineHtml( line: string, filePath: string | null ) {
	const language = getMonacoLanguage( filePath );
	if ( language === 'plaintext' ) {
		return escapeHtml( line || ' ' );
	}
	return renderFallbackHighlightedLine( line, language );
}

export function renderFallbackCodeBlockHtml(
	value: string,
	filePath: string | null,
	languageHint?: string | null
) {
	const language = getMonacoLanguageForSnippet( filePath, languageHint );
	const content = value || ' ';
	const normalizedContent = content.replace( /\r\n/g, '\n' ).replace( /\r/g, '\n' );
	if ( language === 'plaintext' ) {
		return escapeHtml( normalizedContent );
	}

	return normalizedContent
		.split( '\n' )
		.map( ( line ) => renderFallbackHighlightedLine( line, language ) )
		.join( '\n' );
}

export async function renderMonacoCodeLineHtml( line: string, filePath: string | null ) {
	const language = getMonacoLanguage( filePath );
	const monaco = await loadMonacoTokenizer();
	await loadMonacoLanguage( monaco, language );
	const tokenizedLines = monaco.editor.tokenize( line || ' ', language );
	return renderTokenizedLine( line, tokenizedLines[ 0 ] ?? [], language );
}

export async function renderMonacoCodeBlockHtml(
	value: string,
	filePath: string | null,
	languageHint?: string | null
) {
	const language = getMonacoLanguageForSnippet( filePath, languageHint );
	const monaco = await loadMonacoTokenizer();
	await loadMonacoLanguage( monaco, language );
	const content = value || ' ';
	const normalizedContent = content.replace( /\r\n/g, '\n' ).replace( /\r/g, '\n' );
	const lines = normalizedContent.split( '\n' );
	const tokenizedLines = monaco.editor.tokenize( normalizedContent, language );
	return lines
		.map( ( line, index ) => renderTokenizedLine( line, tokenizedLines[ index ] ?? [], language ) )
		.join( '\n' );
}

export async function renderMonacoEditorHtml(
	value: string,
	filePath: string | null,
	validationLineMap: ValidationLineMap,
	aiPatchLineMap: AiPatchLineMap
) {
	const language = getMonacoLanguage( filePath );
	const monaco = await loadMonacoTokenizer();
	await loadMonacoLanguage( monaco, language );
	return renderHighlightedHtml( monaco, value, language, validationLineMap, aiPatchLineMap );
}
