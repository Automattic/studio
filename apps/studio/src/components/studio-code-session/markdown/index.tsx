import { __ } from '@wordpress/i18n';
import { check, copy, Icon } from '@wordpress/icons';
import { isValidElement, useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Tooltip } from 'src/components/tooltip';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import styles from './style.module.css';
import type { MouseEvent, ReactNode } from 'react';
import type { Components } from 'react-markdown';

// Only hand http(s) links to the OS. Guards against the agent emitting links
// with other schemes (e.g. `vscode://`, `smb://`, `file://`) that would
// otherwise be opened by the system handler on click.
const SAFE_URL_SCHEMES = new Set( [ 'http:', 'https:' ] );

function isSafeExternalUrl( href: string ): boolean {
	try {
		return SAFE_URL_SCHEMES.has( new URL( href ).protocol );
	} catch {
		// Relative or malformed — never hand to the OS.
		return false;
	}
}

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
	const [ copied, setCopied ] = useState( false );

	// Reset back to the idle state a short while after a successful copy.
	useEffect( () => {
		if ( ! copied ) {
			return;
		}
		const timer = setTimeout( () => setCopied( false ), 2000 );
		return () => clearTimeout( timer );
	}, [ copied ] );

	const handleCopy = useCallback( () => {
		void getIpcApi().copyText( text );
		setCopied( true );
	}, [ text ] );

	const copyLabel = __( 'Copy code' );
	const copiedLabel = __( 'Copied' );
	const tooltipLabel = copied ? copiedLabel : copyLabel;

	return (
		<div className={ styles.copyButtonContainer }>
			<Tooltip text={ tooltipLabel }>
				<button
					type="button"
					className={ styles.copyButton }
					onClick={ handleCopy }
					aria-label={ copyLabel }
				>
					<Icon icon={ copied ? check : copy } size={ 16 } fill="currentColor" aria-hidden="true" />
				</button>
			</Tooltip>
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
	const components = useMemo< Components >( () => {
		return {
			...baseComponents,
			// Electron swallows plain `target="_blank"` navigations — route clicks
			// through the IPC bridge so links open in the system browser.
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
	}, [] );

	return (
		<div className={ cx( styles.root, className ) }>
			<ReactMarkdown remarkPlugins={ [ remarkGfm ] } components={ components }>
				{ children }
			</ReactMarkdown>
		</div>
	);
}
