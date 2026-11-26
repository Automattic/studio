import { Menu } from '@studio/ds';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useSiteAgentFiles, useUpdateSiteAgentFiles } from '@/data/queries/use-site-agent-files';
import { LearnMoreLink } from '@/features/onboarding';
import {
	SettingsGroup,
	SettingsLoadState,
	SettingsRow,
	SettingsSectionLink,
	SettingsToggle,
} from '@/features/settings/settings-view/rows';
import { useOpenInDestinations } from '@/features/sites';
import { SkillActions } from '../skill-actions';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { SiteAgentFileOpenTarget } from '@studio/common/lib/site-agent-file-paths';

const OPEN_TARGETS: string[] = [ 'editor', 'files', 'terminal' ];

/** A site's instruction files, each switched on or off for this site only. */
export function SiteAgentFiles( {
	site,
	onManageAll,
}: {
	site: SiteDetails;
	onManageAll: () => void;
} ) {
	const connector = useConnector();
	const { data: files, isError, refetch } = useSiteAgentFiles( site.id, 'instructions' );
	const update = useUpdateSiteAgentFiles( site.id, 'instructions' );
	const destinations = useOpenInDestinations( site ).filter( ( destination ) =>
		OPEN_TARGETS.includes( destination.id )
	);
	if ( ! files ) {
		return <SettingsLoadState loadFailed={ isError } onRetry={ () => void refetch() } />;
	}
	const open = ( id: string, target: SiteAgentFileOpenTarget ) =>
		connector.openSiteAgentFile( site.id, 'instructions', id, target ).catch( ( error: Error ) => {
			toast.error( error.message );
		} );
	const title = __( 'Agent instructions' );

	return (
		<div className={ styles.sections }>
			{ update.error ? <p className={ styles.error }>{ update.error.message }</p> : null }
			<SettingsGroup>
				<SettingsRow
					settingId="site-agent-instructions"
					title={ title }
					description={ __(
						'Turn on agent instructions for this site. Manage individual files below. Turning instructions off keeps their files and edits.'
					) }
					additionalContent={
						<SettingsSectionLink onClick={ onManageAll }>
							{ __( 'Manage instructions for all sites' ) }
						</SettingsSectionLink>
					}
				>
					<SettingsToggle
						label={ title }
						checked={ files.some( ( file ) => file.enabled ) }
						disabled={ update.isPending }
						onChange={ ( enabled ) =>
							update.mutate( {
								ids: files
									.filter( ( file ) => file.enabled !== enabled )
									.map( ( file ) => file.id ),
								enabled,
							} )
						}
					/>
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup
				title={ __( 'Instructions installed on this site' ) }
				description={
					<>
						{ __(
							'Instruction files guide AI agents working with this site. Changes here apply only to this site.'
						) }{ ' ' }
						<LearnMoreLink docsLinksKey="docsCli" />
					</>
				}
			>
				{ files.map( ( file ) => (
					<SettingsRow key={ file.id } title={ file.displayName } description={ file.description }>
						<SkillActions
							name={ file.displayName }
							disabled={ update.isPending }
							onRemove={ file.installed ? () => update.mutate( { remove: file.id } ) : undefined }
						>
							{ file.installed
								? destinations.map( ( destination ) => (
										<Menu.Item
											key={ destination.id }
											onClick={ () =>
												void open( file.id, destination.id as SiteAgentFileOpenTarget )
											}
										>
											{ destination.logo }
											{ destination.label }
										</Menu.Item>
								  ) )
								: null }
						</SkillActions>
						<SettingsToggle
							label={ file.displayName }
							checked={ file.enabled }
							disabled={ update.isPending }
							onChange={ ( enabled ) => update.mutate( { ids: [ file.id ], enabled } ) }
						/>
					</SettingsRow>
				) ) }
			</SettingsGroup>
		</div>
	);
}
