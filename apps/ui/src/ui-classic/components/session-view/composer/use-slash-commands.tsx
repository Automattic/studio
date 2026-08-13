import { getSlashCommandMatches } from '@studio/common/ai/slash-commands';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import menuStyles from '@/components/menu/style.module.css';
import styles from './style.module.css';
import type { Dispatch, KeyboardEvent, ReactNode, RefObject, SetStateAction } from 'react';

// The trailing `/token` that drives the autocomplete. Shared by the insert,
// close-on-Escape, and toggle paths so they stay in sync.
const TRAILING_SLASH_TOKEN = /(^|\s)\/[\w-]*$/;

type FloatingPresenceStatus = 'starting' | 'open' | 'ending';

/**
 * Reproduces Base UI's `data-starting-style` / `data-ending-style` handshake
 * for a plain element (the listbox stays a plain `<ul>` so the textarea keeps
 * focus): mount with starting styles, drop them next paint, keep mounted while
 * the exit transition plays.
 */
function useFloatingPresence( open: boolean ): {
	mounted: boolean;
	status: FloatingPresenceStatus;
} {
	// Matches the longest transition in floating-surface-motion (transform 180ms).
	const EXIT_MS = 200;
	const [ mounted, setMounted ] = useState( open );
	const [ status, setStatus ] = useState< FloatingPresenceStatus >( open ? 'open' : 'ending' );

	useEffect( () => {
		if ( open ) {
			setMounted( true );
			setStatus( 'starting' );
			// Two frames so the browser paints the starting styles before we drop
			// them — otherwise there's no "from" state and the transition is skipped.
			let inner = 0;
			const outer = requestAnimationFrame( () => {
				inner = requestAnimationFrame( () => setStatus( 'open' ) );
			} );
			return () => {
				cancelAnimationFrame( outer );
				cancelAnimationFrame( inner );
			};
		}
		setStatus( 'ending' );
		const timer = setTimeout( () => setMounted( false ), EXIT_MS );
		return () => clearTimeout( timer );
	}, [ open ] );

	return { mounted, status };
}

interface UseSlashCommandsParams {
	/** The committed textarea value (not the preview). */
	value: string;
	setValue: Dispatch< SetStateAction< string > >;
	textareaRef: RefObject< HTMLTextAreaElement | null >;
	/** When a preview prompt is showing, the autocomplete stays closed. */
	previewPrompt: string | null | undefined;
}

interface SlashCommands {
	/** ARIA combobox wiring to spread onto the textarea. */
	comboboxProps: {
		role: 'combobox';
		'aria-autocomplete': 'list';
		'aria-haspopup': 'listbox';
		'aria-expanded': boolean;
		'aria-controls': string | undefined;
		'aria-activedescendant': string | undefined;
	};
	/** Returns `true` when the autocomplete consumed the keydown. */
	handleKeyDown: ( event: KeyboardEvent< HTMLTextAreaElement > ) => boolean;
	/** Toolbar "/" button handler: opens the popup, or closes it if already open. */
	toggle: () => void;
	/** The listbox popup, anchored above the textarea (or `null` when hidden). */
	popup: ReactNode;
}

/**
 * Inline slash-command autocomplete for the composer textarea. Driven entirely
 * by the textarea value so the textarea keeps focus — a `Menu.Root` would
 * steal it.
 */
export function useSlashCommands( {
	value,
	setValue,
	textareaRef,
	previewPrompt,
}: UseSlashCommandsParams ): SlashCommands {
	const { open: slashOpen, matches: slashMatches } = useMemo(
		() => getSlashCommandMatches( value, previewPrompt ),
		[ value, previewPrompt ]
	);
	const [ highlightedIndex, setHighlightedIndex ] = useState( 0 );

	// Reset the highlight when the filtered list changes.
	const matchKey = slashMatches.map( ( command ) => command.name ).join( ',' );
	useEffect( () => {
		setHighlightedIndex( 0 );
	}, [ matchKey ] );

	// While exiting, `slashMatches` has already emptied, so retain the last
	// visible set (updated during render) to animate out with content intact.
	const presence = useFloatingPresence( slashOpen );
	const [ popupMatches, setPopupMatches ] = useState( slashMatches );
	if ( slashOpen && popupMatches !== slashMatches ) {
		setPopupMatches( slashMatches );
	}

	// Wire the textarea (combobox) to the listbox and its active option so
	// screen readers announce the open state and the highlighted item.
	const listboxId = useId();
	const optionId = useCallback( ( name: string ) => `${ listboxId }-${ name }`, [ listboxId ] );
	const activeOptionId =
		slashOpen && slashMatches[ highlightedIndex ]
			? optionId( slashMatches[ highlightedIndex ].name )
			: undefined;

	const insertSlashCommand = useCallback(
		( name: string ) => {
			setValue( ( prev ) => prev.replace( TRAILING_SLASH_TOKEN, `$1/${ name } ` ) );
			textareaRef.current?.focus();
		},
		[ setValue, textareaRef ]
	);

	// Toolbar toggle: appends a "/" to open (keeping any typed text), strips
	// the trailing token to close, and refocuses with the caret at the end.
	const toggle = useCallback( () => {
		setValue( ( prev ) => {
			if ( slashOpen ) {
				return prev.replace( TRAILING_SLASH_TOKEN, '' );
			}
			if ( prev.length === 0 ) {
				return '/';
			}
			return /\s$/.test( prev ) ? `${ prev }/` : `${ prev } /`;
		} );
		const node = textareaRef.current;
		queueMicrotask( () => {
			if ( ! node ) {
				return;
			}
			node.focus();
			const end = node.value.length;
			node.setSelectionRange( end, end );
		} );
	}, [ slashOpen, setValue, textareaRef ] );

	const handleKeyDown = useCallback(
		( event: KeyboardEvent< HTMLTextAreaElement > ): boolean => {
			if ( ! slashOpen ) {
				return false;
			}
			if ( event.key === 'ArrowDown' ) {
				event.preventDefault();
				setHighlightedIndex( ( index ) => ( index + 1 ) % slashMatches.length );
				return true;
			}
			if ( event.key === 'ArrowUp' ) {
				event.preventDefault();
				setHighlightedIndex(
					( index ) => ( index - 1 + slashMatches.length ) % slashMatches.length
				);
				return true;
			}
			if ( event.key === 'Enter' || event.key === 'Tab' ) {
				event.preventDefault();
				const command = slashMatches[ highlightedIndex ];
				if ( command ) {
					insertSlashCommand( command.name );
				}
				return true;
			}
			if ( event.key === 'Escape' ) {
				// stopPropagation keeps this Escape from also reaching the
				// Escape-to-interrupt handler.
				event.preventDefault();
				event.stopPropagation();
				setValue( ( prev ) => prev.replace( TRAILING_SLASH_TOKEN, '' ) );
				return true;
			}
			return false;
		},
		[ slashOpen, slashMatches, highlightedIndex, insertSlashCommand, setValue ]
	);

	const popup = presence.mounted ? (
		<ul
			id={ listboxId }
			className={ `${ menuStyles.popup } ${ styles.autocompletePopup } ${ motionStyles.motion }` }
			data-side="top"
			data-align="start"
			data-starting-style={ presence.status === 'starting' ? '' : undefined }
			data-ending-style={ presence.status === 'ending' ? '' : undefined }
			role="listbox"
			aria-label={ __( 'Slash commands' ) }
		>
			{ popupMatches.map( ( command, index ) => (
				<li
					key={ command.name }
					id={ optionId( command.name ) }
					role="option"
					aria-selected={ index === highlightedIndex }
					className={ menuStyles.item }
					data-highlighted={ index === highlightedIndex ? '' : undefined }
					onMouseDown={ ( event ) => {
						// Prevent the textarea from losing focus on click.
						event.preventDefault();
						insertSlashCommand( command.name );
					} }
					onMouseEnter={ () => setHighlightedIndex( index ) }
				>
					<span className={ styles.commandItem }>
						<span className={ styles.commandName }>/{ command.name }</span>
						<span className={ styles.commandDescription }>{ command.description }</span>
					</span>
				</li>
			) ) }
		</ul>
	) : null;

	return {
		comboboxProps: {
			role: 'combobox',
			'aria-autocomplete': 'list',
			'aria-haspopup': 'listbox',
			'aria-expanded': slashOpen,
			'aria-controls': slashOpen ? listboxId : undefined,
			'aria-activedescendant': activeOptionId,
		},
		handleKeyDown,
		toggle,
		popup,
	};
}
