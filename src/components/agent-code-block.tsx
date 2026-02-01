import { __ } from '@wordpress/i18n';
import { ExtraProps } from 'react-markdown';
import { CopyTextButton } from 'src/components/copy-text-button';

export type AgentCodeBlockProps = JSX.IntrinsicElements[ 'code' ] & ExtraProps;

/**
 * Extract language name from className (e.g., "language-javascript" -> "javascript")
 */
function getLanguageFromClassName( className?: string ): string | null {
	if ( ! className ) {
		return null;
	}
	const match = /language-(\w+)/.exec( className );
	return match ? match[ 1 ] : null;
}

/**
 * Format language name for display
 */
function formatLanguageName( language: string ): string {
	const languageMap: Record< string, string > = {
		js: 'JavaScript',
		javascript: 'JavaScript',
		ts: 'TypeScript',
		typescript: 'TypeScript',
		jsx: 'JSX',
		tsx: 'TSX',
		php: 'PHP',
		css: 'CSS',
		scss: 'SCSS',
		html: 'HTML',
		json: 'JSON',
		yaml: 'YAML',
		yml: 'YAML',
		sh: 'Shell',
		bash: 'Bash',
		sql: 'SQL',
		md: 'Markdown',
		markdown: 'Markdown',
		xml: 'XML',
		python: 'Python',
		py: 'Python',
		ruby: 'Ruby',
		rb: 'Ruby',
		go: 'Go',
		rust: 'Rust',
		java: 'Java',
		c: 'C',
		cpp: 'C++',
		csharp: 'C#',
		swift: 'Swift',
		kotlin: 'Kotlin',
	};
	return languageMap[ language.toLowerCase() ] || language.toUpperCase();
}

export function AgentCodeBlock( { children, className, node, ...props }: AgentCodeBlockProps ) {
	const content = String( children ).replace( /\n$/, '' );
	const language = getLanguageFromClassName( className );
	const isInline =
		! node?.position?.start.line || node?.position?.start.line === node?.position?.end.line;

	// Inline code - just render as simple code element
	// Using inline styles to override .assistant-markdown code CSS
	if ( isInline && ! language ) {
		return (
			<code
				style={ {
					backgroundColor: '#f3f4f6',
					padding: '0.125rem 0.375rem',
					borderRadius: '0.25rem',
					fontSize: '0.875rem',
					fontFamily: 'ui-monospace, monospace',
					whiteSpace: 'normal',
				} }
				{ ...props }
			>
				{ children }
			</code>
		);
	}

	// Block code with header
	// Using inline styles to override .assistant-markdown pre/code CSS
	return (
		<div className="my-3 rounded-[2px] border border-gray-200 overflow-hidden">
			{ /* Header */ }
			<div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 border-b border-gray-200">
				<span className="text-xs font-medium text-gray-600">
					{ language ? formatLanguageName( language ) : __( 'Code' ) }
				</span>
				<CopyTextButton
					text={ content }
					label={ __( 'Copy' ) }
					copyConfirmation={ __( 'Copied!' ) }
					showText={ true }
					variant="link"
					className="!text-xs !text-gray-500 hover:!text-gray-700"
					iconSize={ 14 }
				/>
			</div>
			{ /* Code content */ }
			<pre
				style={ {
					margin: 0,
					borderRadius: 0,
					overflowX: 'auto',
					backgroundColor: '#f9fafb',
				} }
			>
				<code
					className={ className || '' }
					style={ {
						display: 'block',
						padding: '0.75rem',
						fontSize: '0.875rem',
						backgroundColor: 'transparent',
						color: '#1f2937',
						whiteSpace: 'pre-wrap',
					} }
					{ ...props }
				>
					{ content }
				</code>
			</pre>
		</div>
	);
}
