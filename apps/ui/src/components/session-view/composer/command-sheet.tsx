import { useEffect, useId } from 'react';
import * as Popover from '@/components/ui/popover';
import styles from './style.module.css';
import type { ComponentProps, ComponentType, KeyboardEvent, Ref } from 'react';

export interface ComposerCommand {
	value: string;
	label: string;
	description?: string;
	icon: ComponentType< { className?: string } >;
	disabled?: boolean;
}

export interface ComposerCommandGroup {
	label: string;
	heading?: string;
	items: ComposerCommand[];
}

function enabledItems( groups: ComposerCommandGroup[] ) {
	return groups.flatMap( ( group ) => group.items ).filter( ( item ) => ! item.disabled );
}

/** The highlighted item: the one asked for while it can be picked, else the first. */
export function getActiveCommand( groups: ComposerCommandGroup[], value?: string ) {
	const items = enabledItems( groups );
	return items.find( ( item ) => item.value === value ) ?? items[ 0 ];
}

/**
 * Arrow keys move the highlight round the list and Enter picks it; true when
 * handled. Typing in a textarea keeps Home and End and also picks with Tab.
 */
export function handleCommandKey(
	event: KeyboardEvent,
	groups: ComposerCommandGroup[],
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
 * Commands listed on a sheet above the composer, as wide as it. The list
 * always highlights one item; it takes focus, or a textarea drives it.
 */
export function CommandSheet( {
	label,
	groups,
	highlighted,
	onHighlight,
	onSelect,
	listRef,
	listId,
	anchor,
	initialFocus,
	finalFocus,
}: {
	label: string;
	groups: ComposerCommandGroup[];
	highlighted?: string;
	onHighlight: ( value: string ) => void;
	onSelect: ( value: string ) => void;
	listRef?: Ref< HTMLDivElement >;
	listId?: string;
	anchor: ComponentProps< typeof Popover.Popup >[ 'anchor' ];
	initialFocus?: ComponentProps< typeof Popover.Popup >[ 'initialFocus' ];
	finalFocus?: ComponentProps< typeof Popover.Popup >[ 'finalFocus' ];
} ) {
	const fallbackId = useId();
	const id = listId ?? fallbackId;
	const active = getActiveCommand( groups, highlighted );
	const optionId = ( value: string ) => `${ id }-${ value }`;

	useEffect( () => {
		if ( active ) {
			document
				.getElementById( `${ id }-${ active.value }` )
				?.scrollIntoView?.( { block: 'nearest' } );
		}
	}, [ active, id ] );

	return (
		<Popover.Popup
			variant="commands"
			side="top"
			anchor={ anchor }
			initialFocus={ initialFocus }
			finalFocus={ finalFocus }
			aria-label={ label }
			className={ styles.commandSheet }
		>
			<div
				ref={ listRef }
				id={ id }
				role="listbox"
				tabIndex={ 0 }
				aria-label={ label }
				aria-activedescendant={ active ? optionId( active.value ) : undefined }
				className={ styles.commandList }
				onKeyDown={ ( event ) =>
					handleCommandKey( event, groups, active?.value, onHighlight, onSelect )
				}
			>
				{ groups
					.filter( ( group ) => group.items.length )
					.map( ( group ) => (
						<div key={ group.label } role="group" aria-label={ group.label }>
							{ group.heading ? (
								<div className={ styles.commandHeading } aria-hidden="true">
									{ group.heading }
								</div>
							) : null }
							{ group.items.map(
								( { value, label: itemLabel, description, icon: Icon, disabled } ) => (
									<div
										key={ value }
										id={ optionId( value ) }
										role="option"
										aria-selected={ value === active?.value }
										aria-disabled={ disabled || undefined }
										data-highlighted={ value === active?.value ? '' : undefined }
										data-disabled={ disabled ? '' : undefined }
										className={ styles.commandItem }
										onPointerMove={ () => ! disabled && onHighlight( value ) }
										onMouseDown={ ( event ) => event.preventDefault() }
										onClick={ () => ! disabled && onSelect( value ) }
									>
										<Icon className={ styles.commandIcon } />
										{ description ? (
											<span className={ styles.commandText }>
												<span className={ styles.commandLabel }>{ itemLabel }</span>
												<span className={ styles.commandDescription }>{ description }</span>
											</span>
										) : (
											itemLabel
										) }
									</div>
								)
							) }
						</div>
					) ) }
			</div>
		</Popover.Popup>
	);
}
