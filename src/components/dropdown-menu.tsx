import { DropdownMenu as GBDropdownMenu, withFocusOutside } from '@wordpress/components';
import { moreVertical } from '@wordpress/icons';
import { Component, ComponentProps } from 'react';

type DropdownMenuProps = ComponentProps< typeof GBDropdownMenu > & {
	isDisabled: boolean;
};

interface DropdownMenuState {
	isDropdownOpen: boolean;
}

export const DropdownMenu = withFocusOutside(
	class extends Component< DropdownMenuProps, DropdownMenuState > {
		state = {
			isDropdownOpen: false,
		};

		closeDropdown = () => {
			this.setState( { isDropdownOpen: false } );
		};

		toggleDropdown = () => {
			if ( this.props.isDisabled ) {
				this.closeDropdown();
				return;
			}
			this.setState( ( prevState ) => ( { isDropdownOpen: ! prevState.isDropdownOpen } ) );
		};

		handleFocusOutside() {
			this.closeDropdown();
		}

		render() {
			const { children, className, icon = moreVertical, label, ...restProps } = this.props;
			return (
				<GBDropdownMenu
					className={ className }
					icon={ icon }
					size={ 24 }
					label={ label }
					open={ this.state.isDropdownOpen }
					onToggle={ this.toggleDropdown }
					{ ...restProps }
				>
					{ children }
				</GBDropdownMenu>
			);
		}
	}
);
