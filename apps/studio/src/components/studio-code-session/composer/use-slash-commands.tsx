import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import motionStyles from '../floating-surface-motion/style.module.css';
import menuStyles from '../menu/style.module.css';
import { getSlashCommandMatches } from './slash-autocomplete';
import styles from './style.module.css';
import type { Dispatch, KeyboardEvent, ReactNode, RefObject, SetStateAction } from 'react';

// Matches the trailing `/token` (at the start of input or right after
// whitespace) that drives the inline autocomplete. Shared by the insert,
// close-on-Escape, and toggle paths so they stay in sync.
const TRAILING_SLASH_TOKEN = /(^|\s)\/[\w-]*$/;

type FloatingPresenceStatus = 'starting' | 'open' | 'ending';

/**
 * Drives the enter/exit transitions from `floating-surface-motion` for a plain
 * element. Base UI's `Menu.Popup` toggles `data-starting-style` /
 * `data-ending-style` itself, but our inline listbox is a plain `<ul>` (kept
 * plain so the textarea retains focus), so we reproduce that handshake: mount
 * with the starting styles applied, drop them on the next paint to animate in,
 * and keep the element mounted while the ending styles play out before
 * unmounting. Returns whether to render the element and its transition phase.
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
	/**
	 * Handle a textarea keydown. Returns `true` when the autocomplete consumed
	 * the event (the caller should then stop processing it), `false` otherwise.
	 */
	handleKeyDown: ( event: KeyboardEvent< HTMLTextAreaElement > ) => boolean;
	/** Toolbar "/" button handler: opens the popup, or closes it if already open. */
	toggle: () => void;
	/** The listbox popup, anchored above the textarea (or `null` when hidden). */
	popup: ReactNode;
}

/**
 * Inline slash-command autocomplete for the composer textarea. Everything is
 * driven by the textarea value (via `getSlashCommandMatches`) so the textarea
 * keeps focus the whole time — a `Menu.Root` would steal it. Encapsulates the
 * open/highlight state, keyboard navigation, ARIA wiring, enter/exit animation,
 * and the rendered listbox, keeping the Composer component lean.
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

	// Whenever the filtered list changes, reset the highlight to the top.
	const matchKey = slashMatches.map( ( command ) => command.name ).join( ',' );
	useEffect( () => {
		setHighlightedIndex( 0 );
	}, [ matchKey ] );

	// Mount/unmount transition so the listbox animates in and out (see
	// `useFloatingPresence`). While exiting, `slashMatches` has already emptied,
	// so retain the last visible set — updated during render, the supported
	// pattern for deriving state — to animate out with its content intact.
	const presence = useFloatingPresence( slashOpen );
	const [ popupMatches, setPopupMatches ] = useState( slashMatches );
	if ( slashOpen && popupMatches !== slashMatches ) {
		setPopupMatches( slashMatches );
	}

	// Accessibility: wire the textarea (combobox) to the listbox and its active
	// option so screen readers announce the open state and the highlighted item.
	const listboxId = useId();
	const optionId = useCallback( ( name: string ) => `${ listboxId }-${ name }`, [ listboxId ] );
	const activeOptionId =
		slashOpen && slashMatches[ highlightedIndex ]
			? optionId( slashMatches[ highlightedIndex ].name )
			: undefined;

	// Replace the trailing `/token` (at start or after whitespace) with the
	// chosen command, preserving any earlier text and the leading whitespace.
	const insertSlashCommand = useCallback(
		( name: string ) => {
			setValue( ( prev ) => prev.replace( TRAILING_SLASH_TOKEN, `$1/${ name } ` ) );
			textareaRef.current?.focus();
		},
		[ setValue, textareaRef ]
	);

	// Toolbar "/" button. Toggles the inline autocomplete: when closed it appends
	// a "/" (preceded by a space when the input doesn't already end in
	// whitespace) to open it, keeping whatever the user already typed; when
	// already open, a second click strips the trailing "/token" to close it.
	// Either way the textarea is refocused with the caret at the end.
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
				// Close the popup by dropping the unfinished `/token`, leaving any
				// earlier text intact. stopPropagation keeps this Escape from also
				// reaching the Escape-to-interrupt handler.
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
