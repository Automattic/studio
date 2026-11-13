import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { __ } from '@wordpress/i18n';
import { CopyButton } from '@/features/chats';
import { LearnMoreLink } from '@/features/onboarding';
import { CodeBlock, Field, FieldDescription } from '@/lib/ui';
import { AgentAppsSection } from './agent-apps-section';
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

function ManualMcpSetup() {
	return (
		<SettingsGroup title={ __( 'Manual MCP setup' ) } settingId="mcp-server">
			<Field>
				<FieldDescription width="full">
					{ __( 'Install the WordPress Studio CLI.' ) }
				</FieldDescription>
				<CopyableCode
					code={ INSTALL_COMMAND }
					language="bash"
					label={ __( 'Copy install command' ) }
				/>
				<FieldDescription width="full">
					{ __( 'Then add this configuration to your app.' ) }
				</FieldDescription>
				<CopyableCode
					code={ getMcpServerConfigJson() }
					language="json"
					label={ __( 'Copy MCP configuration' ) }
				/>
			</Field>
		</SettingsGroup>
	);
}

export function ExternalAppsPanel() {
	return (
		<div className={ styles.preferencesPanel }>
			<SettingsGroup settingId="external-ai-apps">
				<SettingsRow
					title={ __( 'Use WordPress Studio with your agents' ) }
					description={
						<>
							{ __(
								'Use your preferred AI agent to create sites, make changes, and check your work. Install the WordPress Studio plugin to give it access to your local sites.'
							) }{ ' ' }
							<LearnMoreLink docsLinksKey="docsMcp" />
						</>
					}
				/>
			</SettingsGroup>
			<AgentAppsSection />
			<ManualMcpSetup />
		</div>
	);
}
