import { clsx } from 'clsx';
import { useId } from 'react';
import * as Popover from '@/lib/ui/popover';
import styles from './style.module.css';
import type { ComponentProps, ComponentType, KeyboardEvent, ReactNode, Ref } from 'react';

export interface Command {
	value: string;
	label: string;
	description?: string;
	icon: ComponentType< { className?: string } >;
	disabled?: boolean;
}

export interface CommandGroup {
	label: string;
	heading?: string;
	items: Command[];
}

function enabledItems( groups: CommandGroup[] ) {
	return groups.flatMap( ( group ) => group.items ).filter( ( item ) => ! item.disabled );
}

/** The highlighted item: the one asked for while it can be picked, else the first. */
export function getActiveCommand( groups: CommandGroup[], value?: string ) {
	const items = enabledItems( groups );
	return items.find( ( item ) => item.value === value ) ?? items[ 0 ];
}

/**
 * Arrow keys move the highlight round the list and Enter picks it; true when
 * handled. Typing in a textarea keeps Home and End and also picks with Tab.
 */
export function handleCommandKey(
	event: KeyboardEvent,
	groups: CommandGroup[],
	value: string | undefined,
	onHighlight: ( value: string ) => void,
	onSelect: ( value: string ) => void
) {
	const typing = event.target instanceof HTMLTextAreaElement;
	const items = enabledItems( groups );
	const active = getActiveCommand( groups, value );
	if ( ! active ) {
		return false;
	}
	const index = items.indexOf( active );
	const target = {
		ArrowDown: items[ ( index + 1 ) % items.length ],
		ArrowUp: items[ ( index - 1 + items.length ) % items.length ],
		...( typing ? {} : { Home: items[ 0 ], End: items[ items.length - 1 ] } ),
	}[ event.key ];
	if ( target ) {
		event.preventDefault();
		onHighlight( target.value );
		const listId = event.currentTarget.getAttribute( 'aria-controls' ) ?? event.currentTarget.id;
		document
			.getElementById( `${ listId }-${ target.value }` )
			?.scrollIntoView?.( { block: 'nearest' } );
		return true;
	}
	if ( event.key === 'Enter' || ( typing && event.key === 'Tab' ) ) {
		event.preventDefault();
		onSelect( active.value );
		return true;
	}
	return false;
}

/**
 * A list of commands that always highlights one of them. It takes focus, or a
 * text field drives it through `handleCommandKey`; only the keyboard scrolls
 * it. `sm` rows (32px, inline descriptions) suit sheets, and
 * `default` rows (36px, descriptions at the end) suit the palette.
 */
export function CommandList( {
	label,
	groups,
	highlighted,
	onHighlight,
	onSelect,
	listRef,
	id: listId,
	size = 'sm',
	empty,
	className,
}: {
	label: string;
	groups: CommandGroup[];
	highlighted?: string;
	onHighlight: ( value: string ) => void;
	onSelect: ( value: string ) => void;
	listRef?: Ref< HTMLDivElement >;
	id?: string;
	size?: 'sm' | 'default';
	empty?: ReactNode;
	className?: string;
} ) {
	const fallbackId = useId();
	const id = listId ?? fallbackId;
	const active = getActiveCommand( groups, highlighted );
	const optionId = ( value: string ) => `${ id }-${ value }`;
	const shown = groups.filter( ( group ) => group.items.length );

	return (
		<div
			ref={ listRef }
			id={ id }
			role="listbox"
			tabIndex={ 0 }
			aria-label={ label }
			aria-activedescendant={ active ? optionId( active.value ) : undefined }
			data-size={ size }
			className={ clsx( styles.list, className ) }
			onKeyDown={ ( event ) =>
				handleCommandKey( event, groups, active?.value, onHighlight, onSelect )
			}
		>
			{ shown.length === 0 && empty ? <div className={ styles.empty }>{ empty }</div> : null }
			{ shown.map( ( group ) => (
				<div key={ group.label } role="group" aria-label={ group.label }>
					{ group.heading ? (
						<div className={ styles.heading } aria-hidden="true">
							{ group.heading }
						</div>
					) : null }
					{ group.items.map( ( { value, label: itemLabel, description, icon: Icon, disabled } ) => (
						<div
							key={ value }
							id={ optionId( value ) }
							role="option"
							aria-selected={ value === active?.value }
							aria-disabled={ disabled || undefined }
							data-highlighted={ value === active?.value ? '' : undefined }
							data-disabled={ disabled ? '' : undefined }
							className={ styles.item }
							onPointerMove={ () => ! disabled && onHighlight( value ) }
							onMouseDown={ ( event ) => event.preventDefault() }
							onClick={ () => ! disabled && onSelect( value ) }
						>
							<Icon className={ styles.icon } />
							{ description ? (
								<span className={ styles.text }>
									<span className={ styles.label }>{ itemLabel }</span>
									<span className={ styles.description }>{ description }</span>
								</span>
							) : (
								<span className={ styles.label }>{ itemLabel }</span>
							) }
						</div>
					) ) }
				</div>
			) ) }
		</div>
	);
}

/** A `CommandList` on a sheet above its anchor, as wide as it. */
export function CommandSheet( {
	anchor,
	initialFocus,
	finalFocus,
	...list
}: ComponentProps< typeof CommandList > & {
	anchor: ComponentProps< typeof Popover.Popup >[ 'anchor' ];
	initialFocus?: ComponentProps< typeof Popover.Popup >[ 'initialFocus' ];
	finalFocus?: ComponentProps< typeof Popover.Popup >[ 'finalFocus' ];
} ) {
	return (
		<Popover.Popup
			variant="commands"
			side="top"
			anchor={ anchor }
			initialFocus={ initialFocus }
			finalFocus={ finalFocus }
			aria-label={ list.label }
			className={ styles.sheet }
		>
			<CommandList { ...list } />
		</Popover.Popup>
	);
}
