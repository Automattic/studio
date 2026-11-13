import { __ } from '@wordpress/i18n';
import { useAgentApps, useConnectAgentApp } from '@/data/queries/use-agent-apps';
import { getAgentAppConnectionName, getAgentAppDescription } from '@/data/settings-sections';
import { AppIcon } from '@/features/sites';
import { McpIcon } from '@/lib/icons';
import { Badge, Button } from '@/lib/ui';
import { SettingsGroup, SettingsRow } from './rows';
import styles from './style.module.css';
import type { AgentApp } from '@/data/core';

function AgentAppRow( { app }: { app: AgentApp } ) {
	const connect = useConnectAgentApp();
	const connected = app.installed && app.connected;
	const isUpdate = !! app.updateStatus;
	const pending = connect.isPending || app.updateStatus === 'updating';
	const canRetry = !! connect.error || app.updateStatus === 'failed';
	const showAction = ! connected || isUpdate || pending || canRetry;
	const getActionLabel = () => {
		if ( ! app.installed ) {
			return __( 'Not installed' );
		}
		if ( connect.isPending && connect.variables.retry ) {
			return __( 'Retrying' );
		}
		if ( pending ) {
			return isUpdate ? __( 'Updating' ) : __( 'Installing' );
		}
		if ( canRetry ) {
			return __( 'Retry' );
		}
		return isUpdate ? __( 'Update' ) : __( 'Install' );
	};
	return (
		<SettingsRow
			title={ getAgentAppConnectionName( app.id ) }
			settingId={ `agent-app-${ app.id }` }
			badge={
				connected ? (
					<Badge size="xs" variant="accent">
						{ __( 'Installed' ) }
					</Badge>
				) : null
			}
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
			description={
				<>
					{ getAgentAppDescription( app.id ) }
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
						onClick={ () => connect.mutate( { id: app.id, retry: canRetry } ) }
					>
						{ getActionLabel() }
					</Button>
				) : null
			}
		</SettingsRow>
	);
}

export function AgentAppsSection() {
	const apps = useAgentApps();
	return (
		<SettingsGroup>
			{ apps.isPending ? <SettingsRow title={ __( 'Loading apps…' ) } /> : null }
			{ apps.isError ? (
				<SettingsRow title={ __( 'Couldn’t load apps.' ) }>
					<Button variant="outline" onClick={ () => void apps.refetch() }>
						{ __( 'Retry' ) }
					</Button>
				</SettingsRow>
			) : null }
			{ apps.data?.map( ( app ) => <AgentAppRow key={ app.id } app={ app } /> ) }
		</SettingsGroup>
	);
}
