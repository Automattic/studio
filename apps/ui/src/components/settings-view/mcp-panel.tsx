import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { __ } from '@wordpress/i18n';
import { CopyButton } from '@/components/copy-button';
import { LearnMoreLink } from '@/components/learn-more';
import styles from './style.module.css';

export function McpSection() {
	const configJson = getMcpServerConfigJson();

	return (
		<section className={ styles.card }>
			<div className={ styles.cardHeader }>
				<div className={ styles.cardHeaderText }>
					<h2 className={ styles.cardTitle }>{ __( 'MCP' ) }</h2>
					<p className={ styles.cardDescription }>
						{ __(
							'MCP lets other AI tools talk to Studio. Use it when you want an assistant outside Studio to create, configure, or inspect your local WordPress sites through the same site controls.'
						) }{ ' ' }
						<LearnMoreLink docsLinksKey="docsMcp" />
					</p>
				</div>
			</div>
			<div className={ styles.codeBlockWrap }>
				<pre className={ styles.codeBlock }>{ configJson }</pre>
				<CopyButton
					text={ configJson }
					label={ __( 'Copy MCP configuration' ) }
					className={ styles.codeBlockCopyButton }
				/>
			</div>
		</section>
	);
}
