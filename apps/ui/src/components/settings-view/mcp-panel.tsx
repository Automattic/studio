import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { __ } from '@wordpress/i18n';
import { CopyButton } from '@/components/copy-button';
import { LearnMoreLink } from '@/components/learn-more';
import styles from './style.module.css';

export function McpPanel() {
	const configJson = getMcpServerConfigJson();

	return (
		<div className={ styles.preferencesPanel }>
			<section className={ styles.preferenceSectionGroup }>
				<h2 className={ styles.preferenceSectionHeading }>{ __( 'MCP' ) }</h2>
				<p className={ styles.sectionIntro }>
					{ __(
						'MCP lets other AI tools talk to Studio. Use it when you want an assistant outside Studio to create, configure, or inspect your local WordPress sites through the same site controls.'
					) }{ ' ' }
					<LearnMoreLink docsLinksKey="docsMcp" />
				</p>
				<div className={ styles.codeBlockWrap }>
					<pre className={ styles.codeBlock }>{ configJson }</pre>
					<CopyButton
						text={ configJson }
						label={ __( 'Copy MCP configuration' ) }
						className={ styles.codeBlockCopyButton }
					/>
				</div>
			</section>
		</div>
	);
}
