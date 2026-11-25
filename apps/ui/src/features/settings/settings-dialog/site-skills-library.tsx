import { Menu } from '@studio/ds';
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
	SkillsLibrary,
	SkillsList,
} from '@/features/settings/skills-library';
import { useOpenInDestinations } from '@/features/sites';
import { SkillActions } from '../skill-actions';
import type { SiteAgentFile, SiteDetails, SkillDraft } from '@/data/core';
import type { SiteAgentFileOpenTarget } from '@studio/common/lib/site-agent-file-paths';

const OPEN_TARGETS: string[] = [ 'editor', 'files', 'terminal' ];

/**
 * A site's own skills: the ones in its folder. The skills for all sites are in the App tab,
 * so they are not repeated here.
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
	const { globalSkills, skillEditing } = connector.capabilities;
	const { data: files, isError, refetch } = useSiteAgentFiles( site.id, 'skills' );
	const update = useUpdateSiteAgentFiles( site.id, 'skills' );
	const destinations = useOpenInDestinations( site ).filter( ( destination ) =>
		OPEN_TARGETS.includes( destination.id )
	);
	const [ query, setQuery ] = useState( '' );
	const [ deleting, setDeleting ] = useState< SiteAgentFile | null >( null );
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	// The form that takes the list's place: a new skill, or the one with this id.
	const [ editing, setEditing ] = useState< { id?: string } | null >( null );
	if ( ! files ) {
		return <SettingsLoadState loadFailed={ isError } onRetry={ () => void refetch() } />;
	}
	// The list also holds the skills for all sites, for the chat's `/` menu. An older server
	// lists the skills Studio ships that the site doesn't have, too.
	const skills = files.filter( ( file ) => file.installed && ! file.globalSource );
	const shown = skills.filter( ( skill ) => matchesSkillSearch( skill, query ) );
	const report = ( error: Error ) => {
		toast.error( error.message );
	};

	const actionsFor = ( skill: SiteAgentFile, canEdit: boolean ) => (
		<SkillActions
			id={ skill.id }
			name={ skill.displayName }
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
	const edited = skills.find( ( skill ) => skill.id === editing?.id );
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
			query={ query }
			onQueryChange={ setQuery }
			title={ __( 'Skills on this site' ) }
			description={ sprintf(
				/* translators: %s: the site's name. */
				__( 'Skills saved in the folder of %s. They work on this site only.' ),
				site.name
			) }
			link={
				globalSkills ? (
					<SettingsSectionLink onClick={ onManageAll }>
						{ __( 'Skills for all sites' ) }
					</SettingsSectionLink>
				) : null
			}
			error={ update.error && ! deleteOpen ? update.error.message : undefined }
			onAdd={ skillEditing ? () => setEditing( {} ) : undefined }
		>
			{ shown.length ? (
				<SkillsList>
					{ shown.map( ( skill ) => (
						<SkillRow
							key={ skill.id }
							skill={ skill }
							enabled={ skill.enabled }
							onToggle={ ( enabled ) => update.mutate( { ids: [ skill.id ], enabled } ) }
							actions={ actionsFor( skill, true ) }
						/>
					) ) }
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
