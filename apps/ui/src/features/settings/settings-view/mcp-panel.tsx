import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { __ } from '@wordpress/i18n';
import { CopyButton } from '@/features/chats';
import { LearnMoreLink } from '@/features/settings/learn-more';
import { CodeBlock, Field, FieldDescription } from '@/lib/ui';
import { SettingsGroup, SettingsRow } from './rows';
import styles from './style.module.css';

const INSTALL_COMMAND = 'npm install -g wp-studio';

function CopyableCode( {
	code,
	language,
	label,
}: {
	code: string;
	language: string;
	label: string;
} ) {
	return (
		<CodeBlock code={ code } language={ language }>
			<CopyButton
				text={ code }
				label={ label }
				size="icon-sm"
				className={ styles.codeBlockCopyButton }
			/>
		</CodeBlock>
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
								'Connect other AI assistants to WordPress Studio to create, configure, and inspect your local WordPress sites.'
							) }{ ' ' }
							<LearnMoreLink docsLinksKey="docsMcp" />
						</>
					}
				/>
			</SettingsGroup>
			<SettingsGroup title={ __( 'Install instructions' ) }>
				<Field>
					<FieldDescription width="full">{ __( 'Install the Studio CLI:' ) }</FieldDescription>
					<CopyableCode
						code={ INSTALL_COMMAND }
						language="bash"
						label={ __( 'Copy install command' ) }
					/>
					<FieldDescription width="full">
						{ __( 'Then add this configuration to your assistant:' ) }
					</FieldDescription>
					<CopyableCode
						code={ getMcpServerConfigJson() }
						language="json"
						label={ __( 'Copy MCP configuration' ) }
					/>
				</Field>
			</SettingsGroup>
		</div>
	);
}
