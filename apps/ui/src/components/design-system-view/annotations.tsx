import { __ } from '@wordpress/i18n';
import { Popover, VisuallyHidden } from '@wordpress/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './style.module.css';
import type { Annotation, InspectorCommand, InspectorState } from '@/components/site-preview/types';
import type { MouseEvent } from 'react';

export interface DesignAnnotationProps {
	command?: InspectorCommand | null;
	onState?: ( state: InspectorState ) => void;
	onDone?: ( annotations: Annotation[] ) => void;
}

// Something on the page a note can point at: a DESIGN.md token when it has one.
interface Target {
	key: string;
	label: string;
	value?: string;
	token?: string;
}

interface Note extends Target {
	id: string;
	comment: string;
}

interface Draft {
	target: Target;
	comment: string;
	id?: string;
	anchor: Element;
}

const TARGET_ATTRIBUTE = 'data-annotation-target';

function toAnnotation( note: Note ): Annotation {
	return {
		id: note.id,
		comment: note.comment,
		nearbyText: note.value ? `${ note.label }: ${ note.value }` : note.label,
		designToken: note.token,
		path: 'DESIGN.md',
		timestamp: Date.now(),
	};
}

/**
 * Annotation mode for the design system page, driven by the preview toolbar like
 * the site-preview inspector: while picking, clicking a target opens a note, and
 * submitting hands the notes over as annotations naming the DESIGN.md token.
 */
export function useDesignAnnotations( {
	command,
	onState,
	onDone,
	ready,
}: DesignAnnotationProps & { ready: boolean } ) {
	const [ isPicking, setIsPicking ] = useState( false );
	const [ notes, setNotes ] = useState< Note[] >( [] );
	const [ draft, setDraft ] = useState< Draft | null >( null );
	const targets = useRef( new Map< string, Target >() );

	const reset = useCallback( () => {
		setIsPicking( false );
		setNotes( [] );
		setDraft( null );
	}, [] );

	const commitDraft = useCallback( (): Note[] => {
		const comment = draft?.comment.trim();
		if ( ! draft || ! comment ) {
			return notes;
		}
		const next = draft.id
			? notes.map( ( note ) => ( note.id === draft.id ? { ...note, comment } : note ) )
			: [ ...notes, { ...draft.target, id: crypto.randomUUID(), comment } ];
		setNotes( next );
		setDraft( null );
		return next;
	}, [ draft, notes ] );

	const submit = useCallback( () => {
		const submitted = commitDraft();
		if ( submitted.length ) {
			onDone?.( submitted.map( toAnnotation ) );
		}
		reset();
	}, [ commitDraft, onDone, reset ] );

	const lastCommandId = useRef( command?.id );
	useEffect( () => {
		if ( ! command || command.id === lastCommandId.current ) {
			return;
		}
		lastCommandId.current = command.id;
		if ( command.type === 'toggle-picking' ) {
			setIsPicking( ( picking ) => ! picking );
			setDraft( null );
		} else if ( command.type === 'cancel' ) {
			reset();
		} else {
			submit();
		}
	}, [ command, reset, submit ] );

	useEffect( () => {
		onState?.( {
			ready,
			isPicking,
			annotationCount: notes.length,
			hasUnsavedDraft: !! draft?.comment.trim(),
		} );
	}, [ draft, isPicking, notes.length, onState, ready ] );

	const target = ( key: string, label: string, value?: string, token?: string ) => {
		targets.current.set( key, { key, label, value, token } );
		return { [ TARGET_ATTRIBUTE ]: key };
	};

	const marker = ( key: string ) => {
		const index = notes.findIndex( ( note ) => note.key === key );
		return index === -1 ? null : (
			<span className={ styles.annotationMarker } aria-hidden="true">
				{ index + 1 }
			</span>
		);
	};

	const onClickCapture = ( event: MouseEvent< HTMLElement > ) => {
		// React also routes clicks inside the (portaled) note popup through here.
		if ( ! isPicking || ! event.currentTarget.contains( event.target as Node ) ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const element = ( event.target as Element ).closest( `[${ TARGET_ATTRIBUTE }]` );
		const picked = element && targets.current.get( element.getAttribute( TARGET_ATTRIBUTE ) ?? '' );
		if ( ! element || ! picked ) {
			return;
		}
		const existing = notes.find( ( note ) => note.key === picked.key );
		setDraft( {
			target: picked,
			comment: existing?.comment ?? '',
			id: existing?.id,
			anchor: element,
		} );
	};

	const popup = draft ? (
		<NotePopup
			draft={ draft }
			hasNotes={ notes.length > 0 }
			onChange={ ( comment ) => setDraft( { ...draft, comment } ) }
			onSave={ commitDraft }
			onSubmit={ submit }
			onClose={ () => setDraft( null ) }
			onDelete={ () => {
				setNotes( notes.filter( ( note ) => note.id !== draft.id ) );
				setDraft( null );
			} }
		/>
	) : null;

	return { isPicking, target, marker, onClickCapture, popup };
}

function NotePopup( {
	draft,
	hasNotes,
	onChange,
	onSave,
	onSubmit,
	onClose,
	onDelete,
}: {
	draft: Draft;
	hasNotes: boolean;
	onChange: ( comment: string ) => void;
	onSave: () => void;
	onSubmit: () => void;
	onClose: () => void;
	onDelete: () => void;
} ) {
	const empty = ! draft.comment.trim();

	// The preview listens for Escape in the capture phase to cancel annotating;
	// with a note open, Escape closes the note first.
	useEffect( () => {
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' ) {
				event.stopPropagation();
				onClose();
			}
		};
		window.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => window.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ onClose ] );

	return (
		<Popover.Root open onOpenChange={ ( open ) => ! open && onClose() }>
			<Popover.Popup
				variant="unstyled"
				className={ styles.notePopup }
				positioner={
					<Popover.Positioner
						anchor={ draft.anchor }
						side="bottom"
						align="start"
						sideOffset={ 8 }
					/>
				}
			>
				<VisuallyHidden render={ <Popover.Title /> }>{ __( 'Add a note' ) }</VisuallyHidden>
				<div className={ styles.noteTarget }>
					<span>{ draft.target.label }</span>
					{ draft.target.value ? <code>{ draft.target.value }</code> : null }
				</div>
				<textarea
					autoFocus
					aria-label={ __( 'Note' ) }
					placeholder={ __( 'What should change about this?' ) }
					value={ draft.comment }
					onChange={ ( event ) => onChange( event.target.value ) }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Enter' && ! event.shiftKey && ! event.nativeEvent.isComposing ) {
							event.preventDefault();
							if ( ! empty ) {
								onSave();
							}
						}
					} }
				/>
				<div className={ styles.noteActions }>
					{ draft.id ? (
						<button type="button" className={ styles.noteDelete } onClick={ onDelete }>
							{ __( 'Delete' ) }
						</button>
					) : null }
					<button type="button" className={ styles.noteCancel } onClick={ onClose }>
						{ __( 'Cancel' ) }
					</button>
					<button type="button" className={ styles.noteSave } disabled={ empty } onClick={ onSave }>
						{ draft.id ? __( 'Update' ) : __( 'Save' ) }
					</button>
					<button
						type="button"
						className={ styles.noteSubmit }
						disabled={ empty && ! hasNotes }
						onClick={ onSubmit }
					>
						{ __( 'Send to chat' ) }
					</button>
				</div>
			</Popover.Popup>
		</Popover.Root>
	);
}
