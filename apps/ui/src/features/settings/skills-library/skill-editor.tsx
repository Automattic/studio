import {
	getSkillId,
	SKILL_DESCRIPTION_MAX_LENGTH,
	SKILL_INSTRUCTIONS_MAX_LENGTH,
	SKILL_NAME_MAX_LENGTH,
} from '@studio/common/lib/skill-draft';
import {
	AlertDialog,
	Badge,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	FieldDescription,
	FieldLabel,
	Input,
	Textarea,
} from '@studio/ds';
import { ArrowLeftIcon, ChatIcon, FileTextIcon } from '@studio/ds/icons';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';
import { useSaveSkill, useSkill } from '@/data/queries/use-skill';
import { useSettingsDialog } from '@/features/settings/settings-dialog/context';
import {
	SettingsGroup,
	SettingsLoadState,
	SettingsRow,
} from '@/features/settings/settings-view/rows';
import styles from './style.module.css';
import type { SkillDetails, SkillDraft } from '@/data/core';
import type { ReactNode } from 'react';

const EMPTY_DRAFT: SkillDraft = { name: '', description: '', instructions: '' };

/**
 * A skill as agents read it, in a form: a new one, or the one with `skillId`. It takes the
 * place of the list it was opened from.
 */
export function SkillEditor( {
	siteId,
	scopeLabel,
	skillId,
	actions,
	onBack,
	onCreateInChat,
}: {
	// The site the skill is saved in; null for a skill for all sites.
	siteId: string | null;
	// Where the skill works: the site's name, or "All sites".
	scopeLabel: string;
	// The skill to change; a new skill without it.
	skillId?: string;
	// The menu of the skill's row, for a skill that exists.
	actions?: ReactNode;
	onBack: () => void;
	// Hands what the user typed to the chat, where the agent writes the skill.
	onCreateInChat?: ( draft: SkillDraft ) => void;
} ) {
	const { data: skill, isError, refetch } = useSkill( siteId, skillId );
	if ( skillId && ! skill ) {
		return (
			<div className={ styles.editor }>
				<EditorHeader scopeLabel={ scopeLabel } onBack={ onBack } />
				<SettingsLoadState loadFailed={ isError } onRetry={ () => void refetch() } />
			</div>
		);
	}
	return (
		<SkillForm
			siteId={ siteId }
			scopeLabel={ scopeLabel }
			skill={ skill }
			actions={ actions }
			onBack={ onBack }
			onCreateInChat={ onCreateInChat }
		/>
	);
}

function EditorHeader( {
	scopeLabel,
	actions,
	onBack,
}: {
	scopeLabel: string;
	actions?: ReactNode;
	onBack: () => void;
} ) {
	return (
		<div className={ styles.editorHeader }>
			<Button variant="ghost" size="sm" onClick={ onBack }>
				<ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
				{ __( 'Skills' ) }
			</Button>
			<span className={ styles.spacer } />
			<Badge size="xs" variant="secondary">
				{ scopeLabel }
			</Badge>
			{ actions }
		</div>
	);
}

function SkillForm( {
	siteId,
	scopeLabel,
	skill,
	actions,
	onBack,
	onCreateInChat,
}: {
	siteId: string | null;
	scopeLabel: string;
	skill?: SkillDetails;
	actions?: ReactNode;
	onBack: () => void;
	onCreateInChat?: ( draft: SkillDraft ) => void;
} ) {
	const [ initial ] = useState< SkillDraft >( () =>
		skill
			? {
					name: skill.displayName,
					description: skill.description,
					instructions: skill.instructions,
			  }
			: EMPTY_DRAFT
	);
	const [ draft, setDraft ] = useState( initial );
	const [ confirmingDiscard, setConfirmingDiscard ] = useState( false );
	const save = useSaveSkill( siteId );
	const keepRef = useRef< HTMLButtonElement >( null );
	const formId = useId();
	const id = getSkillId( draft.name );
	const dirty =
		draft.name !== initial.name ||
		draft.description !== initial.description ||
		draft.instructions !== initial.instructions;
	const tooLong = draft.instructions.trim().length > SKILL_INSTRUCTIONS_MAX_LENGTH;
	const complete =
		!! id &&
		id.length <= SKILL_NAME_MAX_LENGTH &&
		!! draft.description.trim() &&
		!! draft.instructions.trim() &&
		! tooLong;

	const { setDirty } = useSettingsDialog();
	useEffect( () => setDirty( dirty ), [ dirty, setDirty ] );
	useEffect( () => () => setDirty( false ), [ setDirty ] );

	const change = ( patch: Partial< SkillDraft > ) => {
		save.reset();
		setDraft( ( current ) => ( { ...current, ...patch } ) );
	};
	const leave = () => ( dirty ? setConfirmingDiscard( true ) : onBack() );

	return (
		<form
			className={ styles.editor }
			aria-label={ skill ? skill.displayName : __( 'New skill' ) }
			onSubmit={ ( event ) => {
				event.preventDefault();
				if ( complete && ! save.isPending ) {
					save.mutate( { id: skill?.id, draft }, { onSuccess: onBack } );
				}
			} }
		>
			<EditorHeader scopeLabel={ scopeLabel } actions={ actions } onBack={ leave } />
			<div className={ styles.form }>
				<Field>
					<FieldLabel htmlFor={ `${ formId }-name` }>{ __( 'Name' ) }</FieldLabel>
					<Input
						id={ `${ formId }-name` }
						value={ draft.name }
						placeholder={ __( 'Lookbook post' ) }
						autoFocus={ ! skill }
						aria-describedby={ id ? `${ formId }-command` : undefined }
						onChange={ ( event ) => change( { name: event.target.value } ) }
					/>
					{ id ? (
						<FieldDescription id={ `${ formId }-command` } width="full">
							{ __( 'Command:' ) } <code className={ styles.command }>/{ id }</code>
						</FieldDescription>
					) : null }
				</Field>
				<Field>
					<FieldLabel htmlFor={ `${ formId }-when` }>
						{ __( 'When should agents use it?' ) }
					</FieldLabel>
					<Textarea
						id={ `${ formId }-when` }
						rows={ 2 }
						maxLength={ SKILL_DESCRIPTION_MAX_LENGTH }
						value={ draft.description }
						placeholder={ __( 'Lay out a seasonal lookbook post with the gallery pattern.' ) }
						onChange={ ( event ) => change( { description: event.target.value } ) }
					/>
				</Field>
				<Field>
					<div className={ styles.instructionsHeader }>
						<FieldLabel htmlFor={ `${ formId }-instructions` }>{ __( 'Instructions' ) }</FieldLabel>
						<FieldDescription
							id={ `${ formId }-count` }
							className={ clsx( tooLong && styles.overLimit ) }
						>
							{ sprintf(
								/* translators: 1: the number of characters typed, 2: the most allowed. */
								__( '%1$s / %2$s' ),
								draft.instructions.trim().length.toLocaleString(),
								SKILL_INSTRUCTIONS_MAX_LENGTH.toLocaleString()
							) }
						</FieldDescription>
					</div>
					<Textarea
						id={ `${ formId }-instructions` }
						sizing="fixed"
						rows={ skill ? 11 : 7 }
						className={ styles.instructions }
						value={ draft.instructions }
						placeholder={ __( 'Write the steps the agent must follow.' ) }
						aria-describedby={ `${ formId }-count` }
						aria-invalid={ tooLong || undefined }
						onChange={ ( event ) => change( { instructions: event.target.value } ) }
					/>
				</Field>
			</div>
			{ save.error ? (
				<p role="alert" className={ styles.error }>
					{ save.error.message }
				</p>
			) : null }
			<div className={ styles.editorFooter }>
				{ onCreateInChat && ! skill ? (
					<Button variant="ghost" onClick={ () => onCreateInChat( draft ) }>
						<ChatIcon data-icon="inline-start" aria-hidden="true" />
						{ __( 'Create in chat instead' ) }
					</Button>
				) : null }
				<span className={ styles.spacer } />
				<Button variant="outline" disabled={ save.isPending } onClick={ leave }>
					{ __( 'Cancel' ) }
				</Button>
				<Button
					type="submit"
					variant="accent"
					disabled={ ! complete || ( !! skill && ! dirty ) }
					loading={ save.isPending }
				>
					{ skill ? __( 'Save changes' ) : __( 'Create skill' ) }
				</Button>
			</div>
			{ skill ? (
				<SettingsGroup title={ __( 'Files' ) }>
					{ skill.files.map( ( file ) => (
						<SettingsRow
							key={ file }
							icon={ <FileTextIcon className={ styles.fileIcon } /> }
							title={ file }
							description={
								file === 'SKILL.md'
									? __( 'The name, the description and the instructions.' )
									: __( 'Agents read this only when the instructions point to it.' )
							}
						/>
					) ) }
				</SettingsGroup>
			) : null }
			<AlertDialog open={ confirmingDiscard } onOpenChange={ setConfirmingDiscard }>
				<DialogContent layout="confirmation" showCloseButton={ false } initialFocus={ keepRef }>
					<DialogHeader>
						<DialogTitle>{ __( 'Discard changes?' ) }</DialogTitle>
						<DialogDescription>{ __( 'Your unsaved changes will be lost.' ) }</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							ref={ keepRef }
							variant="outline"
							onClick={ () => setConfirmingDiscard( false ) }
						>
							{ __( 'Cancel' ) }
						</Button>
						<Button variant="destructive" onClick={ onBack }>
							{ __( 'Discard changes' ) }
						</Button>
					</DialogFooter>
				</DialogContent>
			</AlertDialog>
		</form>
	);
}
