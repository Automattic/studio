import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { __ } from '@wordpress/i18n';
import { CodeBlock } from '@/components/code-block';
import { CopyButton } from '@/components/copy-button';
import { LearnMoreLink } from '@/components/learn-more';
import { Field, FieldDescription } from '@/components/ui/field';
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
