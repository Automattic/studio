import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@studio/ds';
import styles from './style.module.css';
import type { SelectRowProps } from '@studio/providers';

// A choice in the publish panel's rows, which a provider's `NewSiteRows` renders.
export function SelectRow( { icon, label, value, options, disabled, onChange }: SelectRowProps ) {
	const selected = options.find( ( option ) => option.value === value );
	return (
		<Select< string >
			items={ options }
			value={ value }
			disabled={ disabled }
			onValueChange={ ( next ) => next !== null && onChange( next ) }
		>
			<SelectTrigger
				variant="ghost"
				fullWidth
				className={ styles.accessTrigger }
				aria-label={ label }
				aria-description={ selected?.label }
			>
				<span className={ styles.destinationRowIcon }>{ icon }</span>
				<SelectValue>
					<span className={ styles.previewHostname }>{ selected?.label }</span>
				</SelectValue>
			</SelectTrigger>
			<SelectContent alignItemWithTrigger={ false }>
				{ options.map( ( option ) => (
					<SelectItem
						key={ option.value }
						value={ option.value }
						label={ option.label }
						icon={ icon }
					>
						{ option.label }
					</SelectItem>
				) ) }
			</SelectContent>
		</Select>
	);
}
