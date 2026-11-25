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
	IconButton,
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	Tabs,
	TabsList,
	TabsScopeIndicator,
	TabsTrigger,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@studio/ds';
import { LinkIcon, PlusIcon, SearchIcon, XIcon } from '@studio/ds/icons';
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

/**
 * The Skills screen of the App and Site tabs, laid out like the other settings: a card that
 * says what the list holds, then the list under its search field.
 */
export function SkillsLibrary( {
	settingId,
	title,
	description,
	link,
	query,
	onQueryChange,
	filters,
	note,
	error,
	onAdd,
	children,
}: {
	settingId: string;
	title: string;
	// What the list holds and what its switches change.
	description: string;
	// Leads to the other tab's skills.
	link?: ReactNode;
	query: string;
	onQueryChange: ( query: string ) => void;
	filters?: ReactNode;
	// Says what the picked filter shows, when the card above does not.
	note?: string;
	error?: string;
	// Opens the form for a new skill, where the host can save one.
	onAdd?: () => void;
	children: ReactNode;
} ) {
	return (
		<div className={ styles.library } data-settings-target={ settingId }>
			<SettingsGroup>
				<SettingsRow title={ title } description={ description } additionalContent={ link }>
					{ onAdd ? (
						<Button variant="outline" size="sm" onClick={ onAdd }>
							<PlusIcon data-icon="inline-start" aria-hidden="true" />
							{ __( 'Add skill' ) }
						</Button>
					) : null }
				</SettingsRow>
			</SettingsGroup>
			<div className={ styles.list }>
				<div className={ styles.toolbar }>
					<InputGroup className={ styles.search }>
						<InputGroupInput
							placeholder={ __( 'Search skills' ) }
							aria-label={ __( 'Search skills' ) }
							value={ query }
							onChange={ ( event ) => onQueryChange( event.target.value ) }
							onKeyDown={ ( event ) => {
								if ( event.key === 'Escape' && query ) {
									event.stopPropagation();
									onQueryChange( '' );
								}
							} }
						/>
						<InputGroupAddon>
							<SearchIcon />
						</InputGroupAddon>
						{ query ? (
							<InputGroupAddon align="inline-end">
								<IconButton
									size="icon-xs"
									icon={ <XIcon /> }
									label={ __( 'Clear search' ) }
									onClick={ () => onQueryChange( '' ) }
								/>
							</InputGroupAddon>
						) : null }
					</InputGroup>
					{ filters }
				</div>
				{ note ? <p className={ styles.note }>{ note }</p> : null }
				{ error ? <p className={ styles.error }>{ error }</p> : null }
				{ children }
			</div>
		</div>
	);
}

export { SkillEditor } from './skill-editor';

/** The app's segmented switch, to pick which skills the list shows; each side has its count. */
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
		<Tabs value={ value } onValueChange={ ( next: TValue ) => onChange( next ) }>
			<TabsList variant="scope" aria-label={ label }>
				{ options.map( ( option ) => (
					<TabsTrigger key={ option.value } value={ option.value }>
						{ option.label }
						<span className={ styles.count }>{ option.count }</span>
					</TabsTrigger>
				) ) }
				<TabsScopeIndicator />
			</TabsList>
		</Tabs>
	);
}

/** The card of skill rows. */
export function SkillsList( { children }: { children: ReactNode } ) {
	return <SettingsGroup>{ children }</SettingsGroup>;
}

/** Marks a skill Studio links to in `~/.agents/skills`, where the other agents use it too. */
export function LinkedSkillMark() {
	const label = __( 'Linked from ~/.agents/skills' );
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span role="img" aria-label={ label } className={ styles.linked }>
						<LinkIcon aria-hidden="true" />
					</span>
				}
			/>
			<TooltipContent>{ label }</TooltipContent>
		</Tooltip>
	);
}

/** A skill: its name, command and description, its actions and its switch. */
export function SkillRow( {
	skill,
	badge,
	enabled,
	onToggle,
	actions,
}: {
	skill: LibrarySkill;
	// What sets the skill apart from the others in the list, such as the mark of a linked one.
	badge?: ReactNode;
	enabled: boolean;
	onToggle: ( enabled: boolean ) => void;
	actions?: ReactNode;
} ) {
	return (
		<SettingsRow
			title={ skill.displayName }
			// The command drops under a name it does not fit beside.
			wrapBadge
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
				disabled={ ! skill.description }
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
