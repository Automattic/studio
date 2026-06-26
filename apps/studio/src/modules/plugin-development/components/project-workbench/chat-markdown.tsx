import { __, sprintf } from '@wordpress/i18n';
import {
	useEffect,
	useMemo,
	useState,
	type HTMLAttributes,
	type ReactNode,
	MouseEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getIpcApi } from 'src/lib/get-ipc-api';
import workbenchStyles from '../development-workbench.module.css';
import { renderFallbackCodeBlockHtml, renderMonacoCodeBlockHtml } from './monaco-highlighting';
import type { Components } from 'react-markdown';

const SAFE_URL_SCHEMES = new Set( [ 'http:', 'https:' ] );
const COLLAPSED_CODE_LINE_LIMIT = 8;
const COLLAPSED_CODE_CHARACTER_LIMIT = 900;

function isSafeExternalUrl( href: string ): boolean {
	try {
		return SAFE_URL_SCHEMES.has( new URL( href ).protocol );
	} catch {
		return false;
	}
}

function getLanguageHintFromClassName( className?: string ) {
	return className
		?.split( /\s+/ )
		.find( ( name ) => name.startsWith( 'language-' ) )
		?.replace( /^language-/, '' );
}

function inferLanguageHint( code: string ): string | undefined {
	const trimmedCode = code.trimStart();
	if ( ! trimmedCode ) {
		return undefined;
	}
	if ( trimmedCode.startsWith( '{' ) || trimmedCode.startsWith( '[' ) ) {
		return 'json';
	}
	if (
		trimmedCode.startsWith( '<?php' ) ||
		/\b(?:add_action|add_filter|function)\b/.test( code )
	) {
		return 'php';
	}
	if ( /^<\/?[A-Za-z]/.test( trimmedCode ) ) {
		return 'html';
	}
	if ( /^(?:npm|npx|wp|svn|composer|git)\s+/m.test( trimmedCode ) ) {
		return 'shell';
	}
	return undefined;
}

function getCollapsedCode( code: string ) {
	const lines = code.split( '\n' );
	const byLines =
		lines.length > COLLAPSED_CODE_LINE_LIMIT
			? lines.slice( 0, COLLAPSED_CODE_LINE_LIMIT ).join( '\n' )
			: code;

	if ( byLines.length <= COLLAPSED_CODE_CHARACTER_LIMIT ) {
		return byLines;
	}

	return byLines.slice( 0, COLLAPSED_CODE_CHARACTER_LIMIT ).trimEnd();
}

function ChatCodeBlock( { code, languageHint }: { code: string; languageHint?: string } ) {
	const normalizedCode = code.replace( /\n$/, '' );
	const collapsedCode = getCollapsedCode( normalizedCode );
	const isCollapsible = collapsedCode !== normalizedCode;
	const [ isExpanded, setIsExpanded ] = useState( false );
	const visibleCode = isCollapsible && ! isExpanded ? collapsedCode : normalizedCode;
	const effectiveLanguageHint = languageHint || inferLanguageHint( normalizedCode );
	const [ highlightedHtml, setHighlightedHtml ] = useState( () =>
		renderFallbackCodeBlockHtml( visibleCode, null, effectiveLanguageHint )
	);

	useEffect( () => {
		let isCancelled = false;
		setHighlightedHtml( renderFallbackCodeBlockHtml( visibleCode, null, effectiveLanguageHint ) );

		void renderMonacoCodeBlockHtml( visibleCode, null, effectiveLanguageHint )
			.then( ( html ) => {
				if ( ! isCancelled ) {
					setHighlightedHtml( html );
				}
			} )
			.catch( () => {
				if ( ! isCancelled ) {
					setHighlightedHtml(
						renderFallbackCodeBlockHtml( visibleCode, null, effectiveLanguageHint )
					);
				}
			} );

		return () => {
			isCancelled = true;
		};
	}, [ effectiveLanguageHint, visibleCode ] );

	return (
		<div className={ workbenchStyles.chatCodeBlock }>
			<pre className={ workbenchStyles.chatCodeBlockPre }>
				<code
					className={ `${ workbenchStyles.codeEditorHighlight } ${ workbenchStyles.codeSyntaxHighlight }` }
					dangerouslySetInnerHTML={ { __html: highlightedHtml } }
				/>
			</pre>
			{ isCollapsible && (
				<div className={ workbenchStyles.chatCodeBlockFooter }>
					<button
						type="button"
						className={ workbenchStyles.chatCodeBlockButton }
						onClick={ () => setIsExpanded( ( currentValue ) => ! currentValue ) }
					>
						{ isExpanded
							? __( 'Show less' )
							: sprintf(
									// translators: %d is the number of hidden characters in a collapsed code block.
									__( 'View more (%d hidden)' ),
									normalizedCode.length - collapsedCode.length
							  ) }
					</button>
				</div>
			) }
		</div>
	);
}

type MarkdownCodeProps = HTMLAttributes< HTMLElement > & {
	children?: ReactNode;
	ref?: unknown;
};

function ChatCode( { className, children, ref: _ref, ...props }: MarkdownCodeProps ) {
	const content = String( children ?? '' );
	const isInline = ! className && ! content.includes( '\n' );
	if ( isInline ) {
		return (
			<code className={ workbenchStyles.chatInlineCode } { ...props }>
				{ children }
			</code>
		);
	}

	return (
		<ChatCodeBlock code={ content } languageHint={ getLanguageHintFromClassName( className ) } />
	);
}

export function ChatMarkdown( { children }: { children: string } ) {
	const components = useMemo< Components >(
		() => ( {
			a: ( { children: linkChildren, href } ) => {
				const handleClick = ( event: MouseEvent< HTMLAnchorElement > ) => {
					event.preventDefault();
					if ( ! href || ! isSafeExternalUrl( href ) ) {
						return;
					}
					void getIpcApi().openURL( href );
				};
				return (
					<a
						className={ workbenchStyles.chatMarkdownLink }
						href={ href }
						onClick={ handleClick }
						target="_blank"
						rel="noreferrer noopener"
					>
						{ linkChildren }
					</a>
				);
			},
			code: ChatCode,
			pre: ( { children: preChildren } ) => <>{ preChildren }</>,
		} ),
		[]
	);

	return (
		<div className={ workbenchStyles.chatMarkdown }>
			<ReactMarkdown remarkPlugins={ [ remarkGfm ] } components={ components }>
				{ children }
			</ReactMarkdown>
		</div>
	);
}
