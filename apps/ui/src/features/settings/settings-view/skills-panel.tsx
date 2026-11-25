import { Menu } from '@studio/ds';
import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useGlobalSkills, useUpdateGlobalSkills } from '@/data/queries/use-global-skills';
import { LearnMoreLink } from '@/features/onboarding';
import {
	DeleteSkillDialog,
	LinkedSkillMark,
	matchesSkillSearch,
	SkillEditor,
	SkillRow,
	SkillsEmpty,
	SkillsFilter,
	SkillsLibrary,
	SkillsList,
} from '@/features/settings/skills-library';
import { getFileManager } from '@/features/sites';
import { SkillActions } from '../skill-actions';
import { SettingsLoadState, SettingsSectionLink } from './rows';
import type { GlobalSkill, GlobalSkillSource, SkillDraft } from '@/data/core';

/**
 * The user's skills for all sites: the ones in Studio's folder, and the ones the other
 * agents on this computer keep, which Studio links into its folder once switched on.
 */
export function SkillsPanel( {
	onManageSite,
	onCreateInChat,
}: {
	onManageSite?: () => void;
	// Opens a chat where the agent writes the skill from what the user typed.
	onCreateInChat?: ( draft: SkillDraft ) => void;
} ) {
	const connector = useConnector();
	const { localMachine, skillEditing } = connector.capabilities;
	const { data: skills, isLoading, isError, refetch } = useGlobalSkills();
	const update = useUpdateGlobalSkills();
	const fileManager = getFileManager();
	const [ query, setQuery ] = useState( '' );
	const [ source, setSource ] = useState< GlobalSkillSource >( 'studio' );
	const [ deleting, setDeleting ] = useState< GlobalSkill | null >( null );
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	// The form that takes the list's place: a new skill, or the one with this id.
	const [ editing, setEditing ] = useState< { id?: string } | null >( null );
	if ( ! skills ) {
		return (
			<SettingsLoadState loadFailed={ ! isLoading && isError } onRetry={ () => void refetch() } />
		);
	}
	const fromStudio = skills.filter( ( skill ) => skill.source === 'studio' );
	// Another computer's `~/.agents/skills` is not the user's.
	const fromAgents = localMachine ? skills.filter( ( skill ) => skill.source === 'agents' ) : [];
	const listed = source === 'agents' && localMachine ? fromAgents : fromStudio;
	const shown = listed.filter( ( skill ) => matchesSkillSearch( skill, query ) );

	const actionsFor = ( skill: GlobalSkill, canEdit: boolean ) => (
		<SkillActions
			name={ skill.displayName }
			removeLabel={ __( 'Delete' ) }
			onEdit={
				canEdit && skillEditing && skill.source === 'studio'
					? () => setEditing( { id: skill.id } )
					: undefined
			}
			onRemove={
				skill.source === 'studio'
					? () => {
							update.reset();
							setDeleting( skill );
							setDeleteOpen( true );
					  }
					: undefined
			}
		>
			{ localMachine ? (
				<Menu.Item
					onClick={ () =>
						void connector.openGlobalSkill( skill.source, skill.id ).catch( ( error: Error ) => {
							toast.error( error.message );
						} )
					}
				>
					{ fileManager.logo }
					{ fileManager.label }
				</Menu.Item>
			) : null }
		</SkillActions>
	);
	const edited = fromStudio.find( ( skill ) => skill.id === editing?.id );
	const deleteDialog = (
		<DeleteSkillDialog
			open={ deleteOpen }
			question={ sprintf(
				deleting?.linked
					? /* translators: %s: the skill's name. */
					  __(
							'Delete “%s” from all sites, and from ~/.agents/skills, where your other agents use it?'
					  )
					: /* translators: %s: the skill's name. */
					  __( 'Delete “%s” from all sites?' ),
				deleting?.displayName ?? ''
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
					siteId={ null }
					scopeLabel={ __( 'All sites' ) }
					skillId={ editing.id }
					actions={ edited ? actionsFor( edited, false ) : undefined }
					onBack={ () => {
						setEditing( null );
						setSource( 'studio' );
					} }
					onCreateInChat={ onCreateInChat }
				/>
				{ deleteDialog }
			</>
		);
	}

	return (
		<SkillsLibrary
			settingId="global-skills"
			query={ query }
			onQueryChange={ setQuery }
			filters={
				localMachine ? (
					<SkillsFilter
						label={ __( 'Where skills are kept' ) }
						value={ source }
						onChange={ setSource }
						options={ [
							{ value: 'studio', label: __( 'Studio' ), count: fromStudio.length },
							{ value: 'agents', label: __( 'Global' ), count: fromAgents.length },
						] }
					/>
				) : null
			}
			title={ __( 'Skills for all sites' ) }
			description={ __(
				'Skills that work on every site. Agents load one when a request matches its description, or when you type its command.'
			) }
			link={
				onManageSite ? (
					<SettingsSectionLink onClick={ onManageSite }>
						{ __( 'Skills for this site' ) }
					</SettingsSectionLink>
				) : null
			}
			note={
				listed === fromAgents
					? __(
							'Skills in ~/.agents/skills, the folder your other agents use. Switch one on to add it to Studio.'
					  )
					: undefined
			}
			error={ update.error && ! deleteOpen ? update.error.message : undefined }
			onAdd={ skillEditing ? () => setEditing( {} ) : undefined }
		>
			{ shown.length ? (
				<SkillsList>
					{ shown.map( ( skill ) => (
						<SkillRow
							key={ `${ skill.source }/${ skill.id }` }
							skill={ skill }
							badge={ skill.linked ? <LinkedSkillMark /> : null }
							enabled={ skill.enabled }
							onToggle={ ( enabled ) =>
								update.mutate( { source: skill.source, id: skill.id, enabled } )
							}
							actions={ actionsFor( skill, true ) }
						/>
					) ) }
				</SkillsList>
			) : listed.length ? (
				<SkillsEmpty title={ __( 'No skills found' ) }>{ __( 'Try another search.' ) }</SkillsEmpty>
			) : listed === fromAgents ? (
				<SkillsEmpty title={ __( 'No skills found on this computer' ) }>
					{ __( 'Skills your other agents save in ~/.agents/skills show here.' ) }
				</SkillsEmpty>
			) : (
				<SkillsEmpty title={ __( 'No skills for all sites yet' ) }>
					{ __(
						'A skill is a folder with a SKILL.md file in ~/.studio/skills. Agents load it when a request matches its description.'
					) }{ ' ' }
					<LearnMoreLink docsLinksKey="docsSkills" />
				</SkillsEmpty>
			) }
			{ deleteDialog }
		</SkillsLibrary>
	);
}
