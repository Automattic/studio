import { AGENT_APP_NAMES } from '@studio/common/lib/agent-apps';
import { __ } from '@wordpress/i18n';
import { useAgentApps, useConnectAgentApp } from '@/data/queries/use-agent-apps';
import { AppIcon } from '@/features/sites';
import { McpIcon } from '@/lib/icons';
import { Button } from '@/lib/ui';
import { connectedBadge, SettingsGroup, SettingsRow } from './rows';
import styles from './style.module.css';
import type { AgentApp, AgentAppId } from '@/data/core';

function getDescription( id: AgentAppId ): string {
	switch ( id ) {
		case 'claude-code':
			return __(
				'Installs the WordPress Studio plugin. Start a new Claude Code session to use it.'
			);
		case 'codex':
			return __(
				'Installs the WordPress Studio plugin in Codex. Restart the ChatGPT app to use it.'
			);
		case 'cursor':
			return __( 'Installs the WordPress Studio plugin. Start a new Cursor chat to use it.' );
		case 'grok-build':
			return __(
				'Installs the WordPress Studio plugin. Start a new Grok Build session to use it.'
			);
	}
}

function AgentAppRow( { app }: { app: AgentApp } ) {
	const connect = useConnectAgentApp();
	const connected = app.installed && app.connected;
	return (
		<SettingsRow
			title={ AGENT_APP_NAMES[ app.id ] }
			icon={
				<AppIcon
					app={ app.id }
					fallback={
						<span className={ styles.appIconFallback }>
							<McpIcon />
						</span>
					}
				/>
			}
			badge={ connected ? connectedBadge() : null }
			description={ app.installed ? getDescription( app.id ) : __( 'Not found on this computer.' ) }
			error={ connect.error?.message }
		>
			{ connected ? null : (
				// Disabled rather than `loading`, which keeps the button's full opacity.
				<Button
					variant="outline"
					disabled={ ! app.installed || connect.isPending }
					aria-busy={ connect.isPending || undefined }
					onClick={ () => connect.mutate( app.id ) }
				>
					{ connect.isPending ? __( 'Connecting…' ) : __( 'Connect' ) }
				</Button>
			) }
		</SettingsRow>
	);
}

export function AgentAppsSection() {
	const { data: apps } = useAgentApps();
	if ( ! apps ) {
		return null;
	}
	return (
		<SettingsGroup title={ __( 'Agent apps' ) }>
			{ apps.map( ( app ) => (
				<AgentAppRow key={ app.id } app={ app } />
			) ) }
		</SettingsGroup>
	);
}
