import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { clsx } from 'clsx';
import { CheckIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { ChevronDownIcon } from '../../icons';
import buttonStyles from '../button/style.module.css';
import selectStyles from '../select/style.module.css';
import surface from '../surface/style.module.css';
import styles from './style.module.css';
import type { ComponentProps, ReactNode } from 'react';

// A button that opens a searchable checklist, for picking several items from a long list. The
// search stays after a pick, so several matches can be checked in turn, and clears on close.
export function Combobox< Value, Multiple extends boolean | undefined = false >( {
	onOpenChange,
	...props
}: BaseCombobox.Root.Props< Value, Multiple > ) {
	const [ query, setQuery ] = useState( '' );
	return (
		<BaseCombobox.Root
			inputValue={ query }
			onInputValueChange={ ( value, { isItemPress } ) => {
				if ( ! isItemPress ) {
					setQuery( value );
				}
			} }
			onOpenChange={ ( open, details ) => {
				if ( ! open ) {
					setQuery( '' );
				}
				onOpenChange?.( open, details );
			} }
			{ ...props }
		/>
	);
}

export const ComboboxCollection = BaseCombobox.Collection;

export function ComboboxTrigger( {
	className,
	children,
	...props
}: ComponentProps< typeof BaseCombobox.Trigger > ) {
	return (
		<BaseCombobox.Trigger
			data-slot="combobox-trigger"
			data-size="default"
			data-variant="outline"
			className={ clsx( buttonStyles.button, selectStyles.trigger, className ) }
			{ ...props }
		>
			{ children }
			<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
		</BaseCombobox.Trigger>
	);
}

// The popup, at `anchor` (the trigger): a search field over the list, `empty` when the search
// matches nothing, and an optional `footer`.
export function ComboboxContent( {
	className,
	children,
	searchLabel,
	empty,
	footer,
	anchor,
	...props
}: ComponentProps< typeof BaseCombobox.Popup > &
	Pick< ComponentProps< typeof BaseCombobox.Positioner >, 'anchor' > & {
		searchLabel: string;
		empty?: ReactNode;
		footer?: ReactNode;
	} ) {
	return (
		<BaseCombobox.Portal>
			<BaseCombobox.Positioner
				anchor={ anchor }
				sideOffset={ 4 }
				align="end"
				className={ selectStyles.positioner }
			>
				<BaseCombobox.Popup
					data-slot="combobox-content"
					className={ clsx( surface.floating, surface.popup, styles.content, className ) }
					{ ...props }
				>
					<div className={ styles.search }>
						<SearchIcon aria-hidden />
						<BaseCombobox.Input
							className={ styles.searchInput }
							placeholder={ searchLabel }
							aria-label={ searchLabel }
						/>
					</div>
					<div className={ styles.scroll }>
						{ empty ? (
							<BaseCombobox.Empty className={ styles.empty }>{ empty }</BaseCombobox.Empty>
						) : null }
						{ children }
					</div>
					{ footer ? <div className={ styles.footer }>{ footer }</div> : null }
				</BaseCombobox.Popup>
			</BaseCombobox.Positioner>
		</BaseCombobox.Portal>
	);
}

export function ComboboxList( props: ComponentProps< typeof BaseCombobox.List > ) {
	return <BaseCombobox.List data-slot="combobox-list" { ...props } />;
}

export function ComboboxGroup( props: ComponentProps< typeof BaseCombobox.Group > ) {
	return <BaseCombobox.Group data-slot="combobox-group" { ...props } />;
}

export function ComboboxGroupLabel( {
	className,
	...props
}: ComponentProps< typeof BaseCombobox.GroupLabel > ) {
	return (
		<BaseCombobox.GroupLabel
			data-slot="combobox-group-label"
			className={ clsx( surface.groupLabel, className ) }
			{ ...props }
		/>
	);
}

// A checklist row: a checkbox, the label and an optional description under it.
export function ComboboxItem( {
	className,
	children,
	description,
	...props
}: ComponentProps< typeof BaseCombobox.Item > & { description?: ReactNode } ) {
	return (
		<BaseCombobox.Item
			data-slot="combobox-item"
			className={ clsx( surface.item, styles.item, className ) }
			{ ...props }
		>
			<span className={ styles.checkbox }>
				<BaseCombobox.ItemIndicator className={ styles.indicator }>
					<CheckIcon />
				</BaseCombobox.ItemIndicator>
			</span>
			<span className={ selectStyles.itemBody }>
				<span className={ styles.itemLabel }>{ children }</span>
				{ description && <span className={ selectStyles.itemDescription }>{ description }</span> }
			</span>
		</BaseCombobox.Item>
	);
}
