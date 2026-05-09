import { ColorControl } from './color';
import type { ControlRendererProps } from './types';

export function ControlRenderer( props: ControlRendererProps ) {
	switch ( props.control.type ) {
		case 'color':
			return <ColorControl { ...props } control={ props.control } />;
		case 'custom': {
			const Component = props.control.Component;
			return (
				<Component
					isOpen={ props.isOpen }
					props={ props.props }
					setIsOpen={ props.setIsOpen }
					updateProps={ props.updateProps }
				/>
			);
		}
	}
}
