import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { __ } from '@wordpress/i18n';
import { CopyButton } from '@/components/copy-button';
import { LearnMoreLink } from '@/components/learn-more';
import { Field, FieldDescription } from '@/components/ui/field';
import { SettingsGroup, SettingsRow } from './rows';
import styles from './style.module.css';

const INSTALL_COMMAND = 'npm install -g wp-studio';

function CodeBlock( { code, label }: { code: string; label: string } ) {
	return (
		<div className={ styles.codeBlockWrap }>
			<pre className={ styles.codeBlock }>{ code }</pre>
			<CopyButton
				text={ code }
				label={ label }
				variant="plain"
				size="icon-sm"
				className={ styles.codeBlockCopyButton }
			/>
		</div>
	);
}

export function McpPanel() {
	return (
		<div className={ styles.preferencesPanel }>
			<SettingsGroup>
				<SettingsRow
					title={ __( 'MCP server' ) }
					description={
						<>
							{ __(
								'Connect other AI assistants to Studio to create, configure, and inspect your local WordPress sites.'
							) }{ ' ' }
							<LearnMoreLink docsLinksKey="docsMcp" />
						</>
					}
				/>
			</SettingsGroup>
			<SettingsGroup title={ __( 'Install instructions' ) }>
				<Field>
					<FieldDescription width="full">{ __( 'Install the Studio CLI:' ) }</FieldDescription>
					<CodeBlock code={ INSTALL_COMMAND } label={ __( 'Copy install command' ) } />
					<FieldDescription width="full">
						{ __( 'Then add this configuration to your assistant:' ) }
					</FieldDescription>
					<CodeBlock code={ getMcpServerConfigJson() } label={ __( 'Copy MCP configuration' ) } />
				</Field>
			</SettingsGroup>
		</div>
	);
}
