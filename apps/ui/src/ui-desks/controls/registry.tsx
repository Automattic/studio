import { ColorControl } from './color';
import type { ControlRendererProps } from './types';

export function ControlRenderer( props: ControlRendererProps ) {
	switch ( props.control.type ) {
		case 'color':
			return <ColorControl { ...props } control={ props.control } />;
	}
}
