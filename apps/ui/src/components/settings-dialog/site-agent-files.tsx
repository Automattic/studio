import { __, sprintf } from '@wordpress/i18n';
import { moreHorizontal, trash, Icon } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { SettingsGroup, SettingsRow, SettingsToggle } from '@/components/settings-view/rows';
import { useSiteAgentFiles, useUpdateSiteAgentFiles } from '@/data/queries/use-site-agent-files';
import styles from './style.module.css';
import type { SiteAgentFileKind } from '@/data/core';

/** A site's skills or instruction files, each switched on or off for this site only. */
export function SiteAgentFiles( {
	siteId,
	kind,
	onManageAll,
}: {
	siteId: string;
	kind: SiteAgentFileKind;
	onManageAll: () => void;
} ) {
	const { data: files, error } = useSiteAgentFiles( siteId, kind );
	const update = useUpdateSiteAgentFiles( siteId, kind );
	const skills = kind === 'skills';
	if ( ! files ) {
		return error ? <p className={ styles.empty }>{ error.message }</p> : null;
	}
	const title = skills ? __( 'WordPress skills' ) : __( 'Agent instructions' );

	return (
		<div className={ styles.sections }>
			{ update.error ? <p className={ styles.error }>{ update.error.message }</p> : null }
			<SettingsGroup>
				<SettingsRow
					title={ title }
					description={
						<>
							{ skills
								? __(
										'Turn on WordPress skills for this site. Turning them off keeps their files and edits.'
								  )
								: __(
										'Turn on agent instructions for this site. Turning them off keeps their files and edits.'
								  ) }
							<Button
								className={ styles.manageAll }
								variant="minimal"
								tone="brand"
								size="small"
								onClick={ onManageAll }
							>
								{ skills
									? __( 'Manage skills for all sites' )
									: __( 'Manage instructions for all sites' ) }
							</Button>
						</>
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
				title={ skills ? __( 'Skills on this site' ) : __( 'Instructions on this site' ) }
				description={
					skills
						? __(
								'Guidance for AI agents doing WordPress development. Changes apply only to this site.'
						  )
						: __(
								'Files that guide AI agents working on this site. Changes apply only to this site.'
						  )
				}
			>
				{ files.map( ( file ) => (
					<SettingsRow key={ file.id } title={ file.displayName } description={ file.description }>
						<SettingsToggle
							label={ file.displayName }
							checked={ file.enabled }
							disabled={ update.isPending }
							onChange={ ( enabled ) => update.mutate( { ids: [ file.id ], enabled } ) }
						/>
						{ file.installed ? (
							<Menu.Root>
								<Menu.Trigger
									render={
										<IconButton
											variant="minimal"
											tone="neutral"
											size="small"
											icon={ moreHorizontal }
											label={ sprintf(
												/* translators: %s: a skill or instruction file name. */
												__( 'Actions for %s' ),
												file.displayName
											) }
											disabled={ update.isPending }
										/>
									}
								/>
								<Menu.Popup side="bottom" align="end">
									<Menu.Item destructive onClick={ () => update.mutate( { remove: file.id } ) }>
										<Icon icon={ trash } />
										{ __( 'Uninstall' ) }
									</Menu.Item>
								</Menu.Popup>
							</Menu.Root>
						) : null }
					</SettingsRow>
				) ) }
			</SettingsGroup>
		</div>
	);
}
