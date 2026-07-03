import { __ } from '@wordpress/i18n';
import { check, copy, Icon } from '@wordpress/icons';
import { Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { isValidElement, useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useConnector } from '@/data/core';
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

function CopyButton( { text }: { text: string } ) {
	const connector = useConnector();
	const [ copied, setCopied ] = useState( false );

	// Reset back to the idle state a short while after a successful copy.
	useEffect( () => {
		if ( ! copied ) {
			return;
		}
		const timer = setTimeout( () => setCopied( false ), 2000 );
		return () => clearTimeout( timer );
	}, [ copied ] );

	// Route through the connector (host clipboard) — the renderer's
	// `navigator.clipboard` is denied in the Electron desktop, which left the
	// copy silently failing and the button stuck on "Copy".
	const handleCopy = useCallback( () => {
		void connector.copyText( text );
		setCopied( true );
	}, [ connector, text ] );

	const copyLabel = __( 'Copy code' );
	const copiedLabel = __( 'Copied' );
	const tooltipLabel = copied ? copiedLabel : copyLabel;

	return (
		<div className={ styles.copyButtonContainer }>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<button
							type="button"
							className={ styles.copyButton }
							onClick={ handleCopy }
							aria-label={ copyLabel }
						>
							<Icon
								icon={ copied ? check : copy }
								size={ 16 }
								fill="currentColor"
								aria-hidden="true"
							/>
						</button>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ tooltipLabel }
				</Tooltip.Popup>
			</Tooltip.Root>
			<span className={ styles.visuallyHidden } role="status" aria-live="polite" aria-atomic="true">
				{ copied ? copiedLabel : '' }
			</span>
		</div>
	);
}

function CodeBlock( { children }: { children?: ReactNode } ) {
	// Strip the single trailing newline react-markdown appends to fenced code.
	const text = useMemo( () => extractText( children ).replace( /\n$/, '' ), [ children ] );

	return (
		<div className={ styles.codeBlock }>
			<pre className={ styles.pre }>{ children }</pre>
			{ text ? <CopyButton text={ text } /> : null }
		</div>
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
	pre: ( { children } ) => <CodeBlock>{ children }</CodeBlock>,
};

export function Markdown( { children, className }: { children: string; className?: string } ) {
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
		<div className={ clsx( styles.root, className ) }>
			<ReactMarkdown remarkPlugins={ [ remarkGfm ] } components={ components }>
				{ children }
			</ReactMarkdown>
		</div>
	);
}
