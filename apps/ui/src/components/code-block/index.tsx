import { clsx } from 'clsx';
import { Fragment, useEffect, useState } from 'react';
import styles from './style.module.css';
import type { ComponentProps } from 'react';
import type { ThemedToken } from 'shiki/core';

/**
 * Code, highlighted once its language's grammar loads. `children` sit in the
 * block above the code, like a header or a copy button.
 */
export function CodeBlock( {
	code,
	language,
	className,
	children,
	...props
}: ComponentProps< 'div' > & { code: string; language?: string } ) {
	const [ highlighted, setHighlighted ] = useState< {
		code: string;
		lines: ThemedToken[][];
	} | null >( null );

	useEffect( () => {
		if ( ! language ) {
			return;
		}
		let current = true;
		void import( './highlight' )
			.then( ( { highlight } ) => highlight( code, language ) )
			.then( ( lines ) => {
				if ( current && lines ) {
					setHighlighted( { code, lines } );
				}
			} )
			// Highlighting is cosmetic; the plain code stays.
			.catch( () => undefined );
		return () => {
			current = false;
		};
	}, [ language, code ] );

	// While a reply streams, the last highlighted prefix stays colored and only
	// the new tail shows plain until it catches up.
	const shown = highlighted && code.startsWith( highlighted.code ) ? highlighted : null;

	return (
		<div
			data-slot="code-block"
			data-language={ language }
			className={ clsx( styles.block, className ) }
			{ ...props }
		>
			{ children }
			<pre className={ styles.pre }>
				<code>
					{ shown
						? shown.lines.map( ( line, index ) => (
								<Fragment key={ index }>
									{ index > 0 ? '\n' : null }
									{ line.map( ( token, tokenIndex ) => (
										<span key={ tokenIndex } style={ { color: token.color } }>
											{ token.content }
										</span>
									) ) }
								</Fragment>
						  ) )
						: null }
					{ code.slice( shown?.code.length ?? 0 ) }
				</code>
			</pre>
		</div>
	);
}
