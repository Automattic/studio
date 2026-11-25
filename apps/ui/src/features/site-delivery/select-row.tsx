import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@studio/ds';
import { ExternalLinkIcon } from '@studio/ds/icons';
import styles from './style.module.css';
import type { SelectRowProps } from '@studio/providers';
import type { ComponentProps, ReactNode } from 'react';

const managementValue = 'manage';

export type PickerOption< Value extends string > = {
	value: Value;
	label: string;
	description?: string;
	disabled?: boolean;
};

// A choice among the publish panel's rows, such as who can view the site.
export function PickerRow< Value extends string >( {
	label,
	icon,
	value,
	valueLabel,
	options,
	disabled,
	checking = false,
	open,
	onOpenChange,
	onValueChange,
	managementAction,
	children,
}: {
	label: string;
	icon: ( value?: Value ) => ReactNode;
	value: string | undefined;
	// What the row shows instead of the selected option's label.
	valueLabel?: string;
	options: PickerOption< Value >[];
	disabled?: boolean;
	checking?: boolean;
	open?: boolean;
	onOpenChange?: ComponentProps< typeof Select >[ 'onOpenChange' ];
	onValueChange: ( value: Value ) => void;
	managementAction?: { label: string; onClick: () => void; disabled: boolean };
	children?: ReactNode;
} ) {
	const selected = options.find( ( option ) => option.value === value );
	const shown = valueLabel ?? selected?.label;
	return (
		<Select< Value | typeof managementValue >
			items={
				managementAction
					? [ ...options, { value: managementValue, label: managementAction.label } ]
					: options
			}
			value={ selected?.value ?? null }
			open={ open }
			disabled={ disabled }
			onOpenChange={ onOpenChange }
			onValueChange={ ( next ) => {
				if ( next === managementValue ) managementAction?.onClick();
				else if ( next !== null ) onValueChange( next );
			} }
		>
			<SelectTrigger
				variant="ghost"
				fullWidth
				className={ styles.accessTrigger }
				aria-label={ label }
				aria-description={ shown }
			>
				<span className={ styles.destinationRowIcon }>
					{ icon( checking ? undefined : selected?.value ) }
				</span>
				<SelectValue className={ checking ? 'studio-shimmer' : undefined }>
					<span className={ styles.previewHostname }>{ shown }</span>
				</SelectValue>
			</SelectTrigger>
			<SelectContent alignItemWithTrigger={ false }>
				{ options.map( ( option ) => (
					<SelectItem
						key={ option.value }
						value={ option.value }
						label={ option.label }
						icon={ icon( option.value ) }
						disabled={ option.disabled }
						aria-label={ option.label }
						aria-description={ option.description }
						description={ option.description }
					>
						{ option.label }
					</SelectItem>
				) ) }
				{ children }
				{ managementAction && (
					<SelectGroup className={ styles.selectActions }>
						<SelectItem
							value={ managementValue }
							label={ managementAction.label }
							disabled={ managementAction.disabled }
						>
							{ managementAction.label }
							<ExternalLinkIcon />
						</SelectItem>
					</SelectGroup>
				) }
			</SelectContent>
		</Select>
	);
}

// The row a provider's `NewSiteRows` renders.
export function SelectRow( { icon, label, value, options, disabled, onChange }: SelectRowProps ) {
	return (
		<PickerRow
			label={ label }
			icon={ () => icon }
			value={ value }
			options={ options }
			disabled={ disabled }
			onValueChange={ onChange }
		/>
	);
}
