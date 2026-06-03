import { Button, Menu } from '@/ui-desks/components';
import type { AnySelectControlConfig, ControlRendererProps } from '../types';

type SelectControlProps = ControlRendererProps & {
	control: AnySelectControlConfig;
};

export function SelectControl( {
	control,
	isOpen,
	setIsOpen,
	updateProps,
	props,
}: SelectControlProps ) {
	const currentValue =
		typeof props[ control.property ] === 'string'
			? ( props[ control.property ] as string )
			: control.defaultValue;

	return (
		<Menu.Root modal={ false } open={ isOpen } orientation="horizontal" onOpenChange={ setIsOpen }>
			<Menu.Trigger
				render={
					<Button
						icon={ control.icon }
						label={ control.label() }
						variant="quiet"
						size="medium"
						aria-pressed={ isOpen }
					/>
				}
			/>
			<Menu.Popup side="top" align="center" sideOffset={ 18 }>
				<Menu.RadioGroup
					value={ currentValue }
					onValueChange={ ( value ) => {
						updateProps( { [ control.property ]: value } );
						setIsOpen( false );
					} }
				>
					{ control.options.map( ( option ) => (
						<Menu.RadioItem key={ option.value } value={ option.value }>
							{ option.label() }
						</Menu.RadioItem>
					) ) }
				</Menu.RadioGroup>
			</Menu.Popup>
		</Menu.Root>
	);
}
