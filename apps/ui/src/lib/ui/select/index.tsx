import { Select as BaseSelect } from '@base-ui/react/select';
import { clsx } from 'clsx';
import { CheckIcon } from 'lucide-react';
import buttonStyles from '@/components/ui/button/style.module.css';
import surface from '@/components/ui/surface/style.module.css';
import { ChevronDownIcon } from '@/lib/icons/chevron-down-icon';
import styles from './style.module.css';
import type { ButtonSize, ButtonVariant } from '@/components/ui/button';
import type { ComponentProps, ReactNode } from 'react';

export const Select = BaseSelect.Root;

export function SelectValue( { className, ...props }: ComponentProps< typeof BaseSelect.Value > ) {
	return (
		<BaseSelect.Value
			data-slot="select-value"
			className={ clsx( styles.value, className ) }
			{ ...props }
		/>
	);
}

export function SelectTrigger( {
	className,
	size = 'default',
	variant = 'outline',
	fullWidth = false,
	children,
	...props
}: ComponentProps< typeof BaseSelect.Trigger > & {
	size?: ButtonSize;
	variant?: ButtonVariant;
	fullWidth?: boolean;
} ) {
	return (
		<BaseSelect.Trigger
			data-slot="select-trigger"
			data-size={ size }
			data-variant={ variant }
			data-full-width={ fullWidth || undefined }
			className={ clsx( buttonStyles.button, styles.trigger, className ) }
			{ ...props }
		>
			{ children }
			{ size !== 'icon-sm' && (
				<BaseSelect.Icon data-icon="inline-end" data-dropdown-indicator className={ styles.icon }>
					<ChevronDownIcon />
				</BaseSelect.Icon>
			) }
		</BaseSelect.Trigger>
	);
}

export function SelectContent( {
	className,
	children,
	side = 'bottom',
	sideOffset = 4,
	align = 'center',
	alignOffset = 0,
	alignItemWithTrigger = true,
	...props
}: ComponentProps< typeof BaseSelect.Popup > &
	Pick<
		ComponentProps< typeof BaseSelect.Positioner >,
		'align' | 'alignOffset' | 'side' | 'sideOffset' | 'alignItemWithTrigger'
	> ) {
	return (
		<BaseSelect.Portal>
			<BaseSelect.Positioner
				side={ side }
				sideOffset={ sideOffset }
				align={ align }
				alignOffset={ alignOffset }
				alignItemWithTrigger={ alignItemWithTrigger }
				className={ styles.positioner }
			>
				<BaseSelect.Popup
					data-slot="select-content"
					className={ clsx(
						surface.floating,
						surface.popup,
						surface.padded,
						styles.content,
						! alignItemWithTrigger && surface.motion,
						className
					) }
					{ ...props }
				>
					<BaseSelect.ScrollUpArrow className={ clsx( styles.arrow, styles.arrowUp ) }>
						<ChevronDownIcon />
					</BaseSelect.ScrollUpArrow>
					<BaseSelect.List>{ children }</BaseSelect.List>
					<BaseSelect.ScrollDownArrow className={ styles.arrow }>
						<ChevronDownIcon />
					</BaseSelect.ScrollDownArrow>
				</BaseSelect.Popup>
			</BaseSelect.Positioner>
		</BaseSelect.Portal>
	);
}

export function SelectGroup( props: ComponentProps< typeof BaseSelect.Group > ) {
	return <BaseSelect.Group data-slot="select-group" { ...props } />;
}

export function SelectLabel( {
	className,
	...props
}: ComponentProps< typeof BaseSelect.GroupLabel > ) {
	return (
		<BaseSelect.GroupLabel
			data-slot="select-label"
			className={ clsx( surface.groupLabel, className ) }
			{ ...props }
		/>
	);
}

export function SelectItem( {
	className,
	children,
	description,
	...props
}: ComponentProps< typeof BaseSelect.Item > & { description?: ReactNode } ) {
	return (
		<BaseSelect.Item
			data-slot="select-item"
			data-described={ description ? true : undefined }
			className={ clsx( surface.item, styles.item, className ) }
			{ ...props }
		>
			<div className={ styles.itemBody }>
				<BaseSelect.ItemText className={ styles.itemText }>{ children }</BaseSelect.ItemText>
				{ description && <span className={ styles.itemDescription }>{ description }</span> }
			</div>
			<BaseSelect.ItemIndicator className={ styles.indicator }>
				<CheckIcon />
			</BaseSelect.ItemIndicator>
		</BaseSelect.Item>
	);
}
