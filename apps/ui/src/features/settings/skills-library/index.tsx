import {
	AlertDialog,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
	Input,
} from '@studio/ds';
import { PlusIcon, SearchIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { useRef } from 'react';
import { SettingsGroup, SettingsRow, SettingsToggle } from '@/features/settings/settings-view/rows';
import styles from './style.module.css';
import type { ReactNode } from 'react';

interface LibrarySkill {
	id: string;
	displayName: string;
	description: string;
}

/** Whether a skill's name, command or description has the search text. */
export function matchesSkillSearch( skill: LibrarySkill, query: string ): boolean {
	return `${ skill.displayName } ${ skill.id } ${ skill.description }`
		.toLowerCase()
		.includes( query.trim().toLowerCase() );
}

/** One list of skills with search: the Skills screen of the App and Site tabs. */
export function SkillsLibrary( {
	settingId,
	query,
	onQueryChange,
	filters,
	scope,
	error,
	onAdd,
	children,
}: {
	settingId: string;
	// The search text; undefined when there is nothing to search yet.
	query?: string;
	onQueryChange: ( query: string ) => void;
	filters?: ReactNode;
	// What the list holds and what its switches change.
	scope: ReactNode;
	error?: string;
	// Opens the form for a new skill, where the host can save one.
	onAdd?: () => void;
	children: ReactNode;
} ) {
	return (
		<div className={ styles.library } data-settings-target={ settingId }>
			{ query !== undefined || onAdd ? (
				<div className={ styles.toolbar }>
					{ query !== undefined ? (
						<Input
							className={ styles.search }
							type="search"
							placeholder={ __( 'Search skills' ) }
							aria-label={ __( 'Search skills' ) }
							value={ query }
							onChange={ ( event ) => onQueryChange( event.target.value ) }
							endAdornment={ <SearchIcon aria-hidden="true" /> }
						/>
					) : (
						<span className={ styles.spacer } />
					) }
					{ onAdd ? (
						<Button variant="outline" size="sm" onClick={ onAdd }>
							<PlusIcon data-icon="inline-start" aria-hidden="true" />
							{ __( 'Add skill' ) }
						</Button>
					) : null }
				</div>
			) : null }
			{ filters }
			<p className={ styles.scopeLine }>{ scope }</p>
			{ error ? <p className={ styles.error }>{ error }</p> : null }
			{ children }
		</div>
	);
}

export { SkillEditor } from './skill-editor';

/** Chips that pick which skills the list shows, each with its count. */
export function SkillsFilter< TValue extends string >( {
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: Array< { value: TValue; label: string; count: number } >;
	value: TValue;
	onChange: ( value: TValue ) => void;
} ) {
	return (
		<div className={ styles.filters } role="group" aria-label={ label }>
			{ options.map( ( option ) => (
				<Button
					key={ option.value }
					variant="outline"
					size="sm"
					className={ styles.filter }
					aria-pressed={ option.value === value }
					onClick={ () => onChange( option.value ) }
				>
					{ option.label }
					<span className={ styles.count }>{ option.count }</span>
				</Button>
			) ) }
		</div>
	);
}

/** The card of skill rows. */
export function SkillsList( { children }: { children: ReactNode } ) {
	return <SettingsGroup>{ children }</SettingsGroup>;
}

/** A skill: its name, command and description, its actions and its switch. */
export function SkillRow( {
	skill,
	badge,
	enabled,
	disabled,
	onToggle,
	actions,
}: {
	skill: LibrarySkill;
	// Where the skill works, when the list mixes skills of a site and of all sites.
	badge?: ReactNode;
	enabled: boolean;
	disabled?: boolean;
	onToggle: ( enabled: boolean ) => void;
	actions?: ReactNode;
} ) {
	return (
		<SettingsRow
			title={ skill.displayName }
			badge={
				<>
					<code className={ styles.command }>/{ skill.id }</code>
					{ badge }
				</>
			}
			description={ <span className={ styles.description }>{ skill.description }</span> }
			error={
				skill.description ? undefined : __( 'Add a description so agents know when to use it.' )
			}
		>
			{ actions }
			<SettingsToggle
				label={ skill.displayName }
				checked={ enabled && !! skill.description }
				disabled={ disabled || ! skill.description }
				onChange={ onToggle }
			/>
		</SettingsRow>
	);
}

export function SkillsEmpty( { title, children }: { title: string; children: ReactNode } ) {
	return (
		<Empty>
			<EmptyHeader>
				<EmptyTitle>{ title }</EmptyTitle>
				<EmptyDescription>{ children }</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

/** Asks before a skill's folder is deleted: that can't be undone. */
export function DeleteSkillDialog( {
	open,
	question,
	pending,
	error,
	onConfirm,
	onClose,
	onClosed,
}: {
	open: boolean;
	// Names the skill and where it is deleted from.
	question: string;
	pending: boolean;
	error?: string;
	onConfirm: () => void;
	onClose: () => void;
	onClosed: () => void;
} ) {
	const cancelRef = useRef< HTMLButtonElement >( null );
	return (
		<AlertDialog
			open={ open }
			onOpenChange={ ( isOpen ) => ! isOpen && ! pending && onClose() }
			onOpenChangeComplete={ ( isOpen ) => ! isOpen && onClosed() }
		>
			<DialogContent
				layout="confirmation"
				closeButtonDisabled={ pending }
				initialFocus={ cancelRef }
			>
				<DialogHeader>
					<DialogTitle>{ __( 'Delete skill' ) }</DialogTitle>
					<DialogDescription>
						{ question }{ ' ' }
						{ __( 'This removes the skill’s folder and all its files. You can’t undo this.' ) }
					</DialogDescription>
				</DialogHeader>
				{ error ? <p className={ styles.dialogError }>{ error }</p> : null }
				<DialogFooter>
					<Button ref={ cancelRef } variant="outline" disabled={ pending } onClick={ onClose }>
						{ __( 'Cancel' ) }
					</Button>
					<Button variant="destructive" loading={ pending } onClick={ onConfirm }>
						{ __( 'Delete skill' ) }
					</Button>
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
