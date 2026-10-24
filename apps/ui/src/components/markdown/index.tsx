import { __ } from '@wordpress/i18n';
import { isValidElement, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '@/components/code-block';
import { CopyButton } from '@/components/copy-button';
import { useConnector } from '@/data/core';
import { CODE_TEXT_ATTRIBUTE } from '@/hooks/use-text-context-menu';
import styles from './style.module.css';
import type { MouseEvent, ReactNode } from 'react';
import type { Components } from 'react-markdown';

/** Recursively collect the plain-text content of a React node tree. */
function extractText( node: ReactNode ): string {
	if ( typeof node === 'string' ) {
		return node;
	}
	if ( typeof node === 'number' ) {
		return String( node );
	}
	if ( Array.isArray( node ) ) {
		return node.map( extractText ).join( '' );
	}
	if ( isValidElement< { children?: ReactNode } >( node ) ) {
		return extractText( node.props.children );
	}
	return '';
}

function MarkdownCodeBlock( { children }: { children?: ReactNode } ) {
	// Strip the single trailing newline react-markdown appends to fenced code.
	const text = useMemo( () => extractText( children ).replace( /\n$/, '' ), [ children ] );
	const className = isValidElement< { className?: string } >( children )
		? children.props.className
		: undefined;
	const language = /language-([\w-]+)/.exec( className ?? '' )?.[ 1 ];
	return (
		<CodeBlock
			className={ styles.codeBlock }
			code={ text }
			language={ language }
			{ ...{ [ CODE_TEXT_ATTRIBUTE ]: text } }
		>
			<div className={ styles.codeHeader }>
				<span>{ language ?? 'text' }</span>
				{ text ? (
					<CopyButton
						className={ styles.codeCopy }
						text={ text }
						label={ __( 'Copy' ) }
						variant="plain"
					/>
				) : null }
			</div>
		</CodeBlock>
	);
}

const baseComponents: Components = {
	h1: ( { children } ) => <h1 className={ styles.h1 }>{ children }</h1>,
	h2: ( { children } ) => <h2 className={ styles.h2 }>{ children }</h2>,
	h3: ( { children } ) => <h3 className={ styles.h3 }>{ children }</h3>,
	h4: ( { children } ) => <h4 className={ styles.h4 }>{ children }</h4>,
	p: ( { children } ) => <p className={ styles.p }>{ children }</p>,
	ul: ( { children } ) => <ul className={ styles.ul }>{ children }</ul>,
	ol: ( { children } ) => <ol className={ styles.ol }>{ children }</ol>,
	li: ( { children } ) => <li className={ styles.li }>{ children }</li>,
	blockquote: ( { children } ) => (
		<blockquote className={ styles.blockquote }>{ children }</blockquote>
	),
	hr: () => <hr className={ styles.hr } />,
	table: ( { children } ) => (
		<div className={ styles.tableWrap }>
			<table className={ styles.table }>{ children }</table>
		</div>
	),
	th: ( { children } ) => <th className={ styles.th }>{ children }</th>,
	td: ( { children } ) => <td className={ styles.td }>{ children }</td>,
	code: ( { className, children, ref: _ref, ...props } ) => {
		// Inline code: no language class, no embedded newline.
		const isInline = ! className && ! String( children ).includes( '\n' );
		if ( isInline ) {
			return (
				<code className={ styles.codeInline } { ...props }>
					{ children }
				</code>
			);
		}
		return (
			<code className={ className } { ...props }>
				{ children }
			</code>
		);
	},
	pre: ( { children } ) => <MarkdownCodeBlock>{ children }</MarkdownCodeBlock>,
};

export function Markdown( { children }: { children: string } ) {
	const connector = useConnector();

	const components = useMemo< Components >( () => {
		return {
			...baseComponents,
			// Electron swallows plain `target="_blank"` navigations — route clicks
			// through the connector so links open in the system browser.
			a: ( { children: linkChildren, href } ) => {
				const handleClick = ( event: MouseEvent< HTMLAnchorElement > ) => {
					if ( ! href ) {
						return;
					}
					event.preventDefault();
					void connector.openExternalUrl( href );
				};
				return (
					<a
						className={ styles.a }
						href={ href }
						onClick={ handleClick }
						target="_blank"
						rel="noreferrer noopener"
					>
						{ linkChildren }
					</a>
				);
			},
		};
	}, [ connector ] );

	return (
		<div className={ styles.root }>
			<ReactMarkdown remarkPlugins={ [ remarkGfm ] } components={ components }>
				{ children }
			</ReactMarkdown>
		</div>
	);
}
