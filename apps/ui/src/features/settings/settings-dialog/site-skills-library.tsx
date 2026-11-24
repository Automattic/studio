import { Badge, Menu } from '@studio/ds';
import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useSiteAgentFiles, useUpdateSiteAgentFiles } from '@/data/queries/use-site-agent-files';
import { LearnMoreLink } from '@/features/onboarding';
import { SettingsLoadState, SettingsSectionLink } from '@/features/settings/settings-view/rows';
import {
	DeleteSkillDialog,
	matchesSkillSearch,
	SkillEditor,
	SkillRow,
	SkillsEmpty,
	SkillsFilter,
	SkillsLibrary,
	SkillsList,
} from '@/features/settings/skills-library';
import { getFileManager, useOpenInDestinations } from '@/features/sites';
import { SkillActions } from '../skill-actions';
import type { SiteAgentFile, SiteDetails, SkillDraft } from '@/data/core';
import type { SiteAgentFileOpenTarget } from '@studio/common/lib/site-agent-file-paths';

const OPEN_TARGETS: string[] = [ 'editor', 'files', 'terminal' ];

type Filter = 'all' | 'site' | 'global';

/**
 * What agents can use on a site: the skills in its folder, then the ones for all
 * sites. A switch changes this site only.
 */
export function SiteSkillsLibrary( {
	site,
	onManageAll,
	onCreateInChat,
}: {
	site: SiteDetails;
	onManageAll: () => void;
	// Opens a chat where the agent writes the skill from what the user typed.
	onCreateInChat?: ( draft: SkillDraft ) => void;
} ) {
	const connector = useConnector();
	const { localMachine, globalSkills, skillEditing } = connector.capabilities;
	const { data: files, isError, refetch } = useSiteAgentFiles( site.id, 'skills' );
	const update = useUpdateSiteAgentFiles( site.id, 'skills' );
	const destinations = useOpenInDestinations( site ).filter( ( destination ) =>
		OPEN_TARGETS.includes( destination.id )
	);
	const fileManager = getFileManager();
	const [ query, setQuery ] = useState( '' );
	const [ filter, setFilter ] = useState< Filter >( 'all' );
	const [ deleting, setDeleting ] = useState< SiteAgentFile | null >( null );
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	// The form that takes the list's place: a new skill, or the one with this id.
	const [ editing, setEditing ] = useState< { id?: string } | null >( null );
	if ( ! files ) {
		return <SettingsLoadState loadFailed={ isError } onRetry={ () => void refetch() } />;
	}
	// An older server also lists the skills Studio ships that the site doesn't have.
	const skills = files.filter( ( file ) => file.installed );
	const own = skills.filter( ( skill ) => ! skill.globalSource );
	const global = skills.filter( ( skill ) => skill.globalSource );
	const mixed = own.length > 0 && global.length > 0;
	const scoped = ! mixed || filter === 'all' ? skills : filter === 'site' ? own : global;
	const shown = scoped.filter( ( skill ) => matchesSkillSearch( skill, query ) );
	const report = ( error: Error ) => {
		toast.error( error.message );
	};

	const actionsFor = ( skill: SiteAgentFile, canEdit: boolean ) => (
		<SkillActions
			id={ skill.id }
			name={ skill.displayName }
			disabled={ update.isPending }
			removeLabel={ __( 'Delete' ) }
			onEdit={ canEdit && skillEditing ? () => setEditing( { id: skill.id } ) : undefined }
			onRemove={ () => {
				update.reset();
				setDeleting( skill );
				setDeleteOpen( true );
			} }
		>
			{ destinations.map( ( destination ) => (
				<Menu.Item
					key={ destination.id }
					onClick={ () =>
						void connector
							.openSiteAgentFile(
								site.id,
								'skills',
								skill.id,
								destination.id as SiteAgentFileOpenTarget
							)
							.catch( report )
					}
				>
					{ destination.logo }
					{ destination.label }
				</Menu.Item>
			) ) }
		</SkillActions>
	);
	const edited = own.find( ( skill ) => skill.id === editing?.id );
	const deleteDialog = (
		<DeleteSkillDialog
			open={ deleteOpen }
			question={ sprintf(
				/* translators: 1: the skill's name, 2: the site's name. */
				__( 'Delete “%1$s” from %2$s?' ),
				deleting?.displayName ?? '',
				site.name
			) }
			pending={ update.isPending }
			error={ update.error?.message }
			onConfirm={ () =>
				deleting &&
				update.mutate(
					{ remove: deleting.id },
					{
						onSuccess: () => {
							setDeleteOpen( false );
							setEditing( null );
						},
					}
				)
			}
			onClose={ () => setDeleteOpen( false ) }
			onClosed={ () => {
				setDeleting( null );
				update.reset();
			} }
		/>
	);

	if ( editing ) {
		return (
			<>
				<SkillEditor
					key={ editing.id ?? '' }
					siteId={ site.id }
					scopeLabel={ site.name }
					skillId={ editing.id }
					actions={ edited ? actionsFor( edited, false ) : undefined }
					onBack={ () => setEditing( null ) }
					onCreateInChat={ onCreateInChat }
				/>
				{ deleteDialog }
			</>
		);
	}

	return (
		<SkillsLibrary
			settingId="site-wordpress-skills"
			query={ skills.length ? query : undefined }
			onQueryChange={ setQuery }
			filters={
				mixed ? (
					<SkillsFilter
						label={ __( 'Filter skills' ) }
						value={ filter }
						onChange={ setFilter }
						options={ [
							{ value: 'all', label: __( 'All' ), count: skills.length },
							{ value: 'site', label: __( 'This site' ), count: own.length },
							{ value: 'global', label: __( 'All sites' ), count: global.length },
						] }
					/>
				) : null
			}
			scope={
				<>
					{ sprintf(
						/* translators: %s: the site's name. */
						__( 'What agents can use on %s. Switches here change this site only.' ),
						site.name
					) }
					{ globalSkills ? (
						<>
							{ ' ' }
							<SettingsSectionLink onClick={ onManageAll }>
								{ __( 'Skills for all sites' ) }
							</SettingsSectionLink>
						</>
					) : null }
				</>
			}
			error={ update.error && ! deleteOpen ? update.error.message : undefined }
			onAdd={ skillEditing ? () => setEditing( {} ) : undefined }
		>
			{ shown.length ? (
				<SkillsList>
					{ shown.map( ( skill ) => {
						const { globalSource } = skill;
						return (
							<SkillRow
								key={ skill.id }
								skill={ skill }
								badge={
									global.length ? (
										<Badge size="xs" variant={ globalSource ? 'secondary' : 'accent' }>
											{ globalSource ? __( 'All sites' ) : __( 'This site' ) }
										</Badge>
									) : null
								}
								enabled={ skill.enabled }
								disabled={ update.isPending }
								onToggle={ ( enabled ) => update.mutate( { ids: [ skill.id ], enabled } ) }
								actions={
									globalSource ? (
										// A skill for all sites is changed and deleted in the App tab.
										<SkillActions name={ skill.displayName } disabled={ update.isPending }>
											{ localMachine ? (
												<Menu.Item
													onClick={ () =>
														void connector.openGlobalSkill( globalSource, skill.id ).catch( report )
													}
												>
													{ fileManager.logo }
													{ fileManager.label }
												</Menu.Item>
											) : null }
										</SkillActions>
									) : (
										actionsFor( skill, true )
									)
								}
							/>
						);
					} ) }
				</SkillsList>
			) : skills.length ? (
				<SkillsEmpty title={ __( 'No skills found' ) }>{ __( 'Try another search.' ) }</SkillsEmpty>
			) : (
				<SkillsEmpty title={ __( 'No skills on this site yet' ) }>
					{ __(
						'A skill is a folder with a SKILL.md file in .agents/skills, in the site’s folder. Agents load it when a request matches its description.'
					) }{ ' ' }
					<LearnMoreLink docsLinksKey="docsSkills" />
				</SkillsEmpty>
			) }
			{ deleteDialog }
		</SkillsLibrary>
	);
}
