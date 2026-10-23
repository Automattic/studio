import { __, sprintf } from '@wordpress/i18n';
import { EllipsisIcon } from 'lucide-react';
import { LearnMoreLink } from '@/components/learn-more';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import {
	SettingsGroup,
	SettingsLoadState,
	SettingsRow,
	SettingsSectionLink,
	SettingsToggle,
} from '@/components/settings-view/rows';
import { IconButton } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useSiteAgentFiles, useUpdateSiteAgentFiles } from '@/data/queries/use-site-agent-files';
import { ExternalLinkIcon } from '@/lib/icons/external-link-icon';
import { TrashIcon } from '@/lib/icons/trash-icon';
import styles from './style.module.css';
import type { SiteAgentFileKind, SiteDetails } from '@/data/core';
import type { SiteAgentFileOpenTarget } from '@studio/common/lib/site-agent-file-paths';

const OPEN_TARGETS: string[] = [ 'editor', 'files', 'terminal' ];

/** A site's skills or instruction files, each switched on or off for this site only. */
export function SiteAgentFiles( {
	site,
	kind,
	onManageAll,
}: {
	site: SiteDetails;
	kind: SiteAgentFileKind;
	onManageAll: () => void;
} ) {
	const connector = useConnector();
	const { data: files, isError, refetch } = useSiteAgentFiles( site.id, kind );
	const update = useUpdateSiteAgentFiles( site.id, kind );
	const destinations = useOpenInDestinations( site ).filter( ( destination ) =>
		OPEN_TARGETS.includes( destination.id )
	);
	const skills = kind === 'skills';
	if ( ! files ) {
		return <SettingsLoadState loadFailed={ isError } onRetry={ () => void refetch() } />;
	}
	const open = ( id: string, target: SiteAgentFileOpenTarget ) =>
		connector.openSiteAgentFile( site.id, kind, id, target ).catch( ( error: Error ) => {
			toast.error( error.message );
		} );
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
										'Turn on WordPress skills for this site. Manage individual skills below. Turning skills off keeps their files and edits.'
								  )
								: __(
										'Turn on agent instructions for this site. Manage individual files below. Turning instructions off keeps their files and edits.'
								  ) }
							<SettingsSectionLink onClick={ onManageAll }>
								{ skills
									? __( 'Manage skills for all sites' )
									: __( 'Manage instructions for all sites' ) }
							</SettingsSectionLink>
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
				title={
					skills
						? __( 'Skills installed on this site' )
						: __( 'Instructions installed on this site' )
				}
				description={
					<>
						{ skills
							? __(
									'Skills give AI agents guidance for WordPress development. Changes here apply only to this site.'
							  )
							: __(
									'Instruction files guide AI agents working with this site. Changes here apply only to this site.'
							  ) }{ ' ' }
						<LearnMoreLink docsLinksKey={ skills ? 'docsSkills' : 'docsCli' } />
					</>
				}
			>
				{ files.map( ( file ) => (
					<SettingsRow key={ file.id } title={ file.displayName } description={ file.description }>
						{ file.installed ? (
							<Menu.Root>
								<Menu.Trigger
									render={
										<IconButton
											size="icon-sm"
											icon={ <EllipsisIcon /> }
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
									<Menu.SubmenuRoot>
										<Menu.SubmenuTrigger>
											<ExternalLinkIcon />
											{ __( 'Open in' ) }
										</Menu.SubmenuTrigger>
										<Menu.SubmenuPopup>
											{ destinations.map( ( destination ) => (
												<Menu.Item
													key={ destination.id }
													onClick={ () =>
														void open( file.id, destination.id as SiteAgentFileOpenTarget )
													}
												>
													{ destination.logo }
													{ destination.label }
												</Menu.Item>
											) ) }
										</Menu.SubmenuPopup>
									</Menu.SubmenuRoot>
									<Menu.Separator />
									<Menu.Item destructive onClick={ () => update.mutate( { remove: file.id } ) }>
										<TrashIcon />
										{ __( 'Uninstall' ) }
									</Menu.Item>
								</Menu.Popup>
							</Menu.Root>
						) : null }
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
