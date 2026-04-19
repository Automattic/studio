import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './style.module.css';
import type { Components } from 'react-markdown';

const components: Components = {
	h1: ( { children } ) => <h1 className={ styles.h1 }>{ children }</h1>,
	h2: ( { children } ) => <h2 className={ styles.h2 }>{ children }</h2>,
	h3: ( { children } ) => <h3 className={ styles.h3 }>{ children }</h3>,
	h4: ( { children } ) => <h4 className={ styles.h4 }>{ children }</h4>,
	p: ( { children } ) => <p className={ styles.p }>{ children }</p>,
	ul: ( { children } ) => <ul className={ styles.ul }>{ children }</ul>,
	ol: ( { children } ) => <ol className={ styles.ol }>{ children }</ol>,
	li: ( { children } ) => <li className={ styles.li }>{ children }</li>,
	a: ( { children, href } ) => (
		<a className={ styles.a } href={ href } target="_blank" rel="noreferrer noopener">
			{ children }
		</a>
	),
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
	code: ( { className, children, ...props } ) => {
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

export function Markdown( { children }: { children: string } ) {
	return (
		<div className={ styles.root }>
			<ReactMarkdown remarkPlugins={ [ remarkGfm ] } components={ components }>
				{ children }
			</ReactMarkdown>
		</div>
	);
}
