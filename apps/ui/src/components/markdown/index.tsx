import { clsx } from 'clsx';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useConnector } from '@/data/core';
import styles from './style.module.css';
import type { MouseEvent } from 'react';
import type { Components } from 'react-markdown';

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
	pre: ( { children } ) => <pre className={ styles.pre }>{ children }</pre>,
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
