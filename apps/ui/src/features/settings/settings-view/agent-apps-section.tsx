import { AGENT_APP_NAMES } from '@studio/common/lib/agent-apps';
import { __, sprintf } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useAgentApps, useConnectAgentApp } from '@/data/queries/use-agent-apps';
import { AppIcon } from '@/features/sites';
import { PlugIcon } from '@/lib/icons';
import { Button, LogoTile } from '@/lib/ui';
import { connectedBadge, SettingsGroup, SettingsRow } from './rows';
import styles from './style.module.css';
import type { AgentApp, AgentAppId } from '@/data/core';

const PLUGIN_GUIDES: Record< AgentAppId, string > = {
	'claude-code': 'https://github.com/Automattic/studio-plugins#install-in-claude-code',
	codex: 'https://github.com/Automattic/studio-plugins#install-in-codex',
	cursor: 'https://cursor.com/docs/plugins',
	'grok-build': 'https://docs.x.ai/build/features/skills-plugins-marketplaces',
};

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
	const connector = useConnector();
	const connect = useConnectAgentApp();
	const connected = app.installed && app.connected;
	const isUpdate = !! app.updateStatus;
	const pending = connect.isPending || app.updateStatus === 'updating';
	const showAction = ! connected || isUpdate || connect.isPending || connect.error;
	const getActionLabel = () => {
		if ( ! app.installed ) {
			return __( 'Not installed' );
		}
		if ( pending ) {
			return isUpdate ? __( 'Updating…' ) : __( 'Connecting…' );
		}
		if ( isUpdate ) {
			return connect.error || app.updateStatus === 'failed' ? __( 'Retry update' ) : __( 'Update' );
		}
		return connect.error ? __( 'Retry' ) : __( 'Connect' );
	};
	return (
		<SettingsRow
			title={ AGENT_APP_NAMES[ app.id ] }
			badge={ connected ? connectedBadge() : null }
			icon={
				<AppIcon
					app={ app.id }
					fallback={
						<LogoTile>
							<PlugIcon />
						</LogoTile>
					}
				/>
			}
			description={
				<>
					{ getDescription( app.id ) }{ ' ' }
					<Button
						variant="inline-link"
						size="inline"
						aria-label={ sprintf(
							// translators: %s: an agent app, like Claude Code.
							__( 'Learn more about the WordPress Studio plugin for %s' ),
							AGENT_APP_NAMES[ app.id ]
						) }
						onClick={ () => void connector.openExternalUrl( PLUGIN_GUIDES[ app.id ] ) }
					>
						{ __( 'Learn more…' ) }
					</Button>
					{ connect.error ? (
						<span role="alert" className={ styles.agentAppError }>
							{ connect.error.message }
						</span>
					) : null }
				</>
			}
		>
			{ ( control ) =>
				showAction ? (
					<Button
						{ ...control }
						variant="outline"
						disabled={ ! app.installed || pending }
						disabledAppearance={ pending ? 'outline' : 'default' }
						aria-busy={ pending || undefined }
						aria-invalid={ connect.error ? true : undefined }
						onClick={ () => connect.mutate( app.id ) }
					>
						{ getActionLabel() }
					</Button>
				) : null
			}
		</SettingsRow>
	);
}

export function AgentAppsSection() {
	const { data: apps } = useAgentApps();
	if ( ! apps ) {
		return null;
	}
	return (
		<SettingsGroup title={ __( 'AI apps' ) }>
			{ apps.map( ( app ) => (
				<AgentAppRow key={ app.id } app={ app } />
			) ) }
		</SettingsGroup>
	);
}
