import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { clsx } from 'clsx';
import { CheckIcon } from 'lucide-react';
import { XIcon } from '@/lib/icons';
import inputStyles from '@/lib/ui/input/style.module.css';
import selectStyles from '@/lib/ui/select/style.module.css';
import surface from '@/lib/ui/surface/style.module.css';
import styles from './style.module.css';
import type { ComponentProps, ReactNode } from 'react';

// A searchable choice of one or more items. With `multiple`, the chosen ones show as chips next to
// the search field, all inside `ComboboxChips`.
export const Combobox = BaseCombobox.Root;
export const ComboboxValue = BaseCombobox.Value;
export const ComboboxCollection = BaseCombobox.Collection;

export function ComboboxChips( {
	className,
	...props
}: ComponentProps< typeof BaseCombobox.Chips > ) {
	return (
		<BaseCombobox.Chips
			data-slot="combobox-chips"
			className={ clsx( inputStyles.input, styles.chips, className ) }
			{ ...props }
		/>
	);
}

export function ComboboxChip( {
	className,
	children,
	removeLabel,
	...props
}: ComponentProps< typeof BaseCombobox.Chip > & { removeLabel: string } ) {
	return (
		<BaseCombobox.Chip
			data-slot="combobox-chip"
			className={ clsx( styles.chip, className ) }
			{ ...props }
		>
			<span className={ styles.chipLabel }>{ children }</span>
			<BaseCombobox.ChipRemove className={ styles.chipRemove } aria-label={ removeLabel }>
				<XIcon />
			</BaseCombobox.ChipRemove>
		</BaseCombobox.Chip>
	);
}

export function ComboboxInput( {
	className,
	...props
}: ComponentProps< typeof BaseCombobox.Input > ) {
	return (
		<BaseCombobox.Input
			data-slot="combobox-input"
			className={ clsx( styles.input, className ) }
			{ ...props }
		/>
	);
}

// The popup: the items `ComboboxList` renders, or `empty` when the search matches none.
export function ComboboxContent( {
	className,
	children,
	empty,
	anchor,
	sideOffset = 4,
	...props
}: ComponentProps< typeof BaseCombobox.Popup > &
	Pick< ComponentProps< typeof BaseCombobox.Positioner >, 'anchor' | 'sideOffset' > & {
		empty?: ReactNode;
	} ) {
	return (
		<BaseCombobox.Portal>
			<BaseCombobox.Positioner
				anchor={ anchor }
				sideOffset={ sideOffset }
				align="start"
				className={ selectStyles.positioner }
			>
				<BaseCombobox.Popup
					data-slot="combobox-content"
					className={ clsx(
						surface.floating,
						surface.popup,
						surface.padded,
						styles.content,
						className
					) }
					{ ...props }
				>
					{ empty ? (
						<BaseCombobox.Empty className={ styles.empty }>{ empty }</BaseCombobox.Empty>
					) : null }
					{ children }
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

export function ComboboxItem( {
	className,
	children,
	description,
	...props
}: ComponentProps< typeof BaseCombobox.Item > & { description?: ReactNode } ) {
	return (
		<BaseCombobox.Item
			data-slot="combobox-item"
			data-described={ description ? true : undefined }
			className={ clsx( surface.item, selectStyles.item, className ) }
			{ ...props }
		>
			<div className={ selectStyles.itemBody }>
				<span className={ selectStyles.itemText }>{ children }</span>
				{ description && <span className={ selectStyles.itemDescription }>{ description }</span> }
			</div>
			<BaseCombobox.ItemIndicator className={ selectStyles.indicator }>
				<CheckIcon />
			</BaseCombobox.ItemIndicator>
		</BaseCombobox.Item>
	);
}
