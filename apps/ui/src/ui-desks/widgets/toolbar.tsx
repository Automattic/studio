import { __ } from '@wordpress/i18n';
import { trash } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { useEffect, useState } from 'react';
import { ControlRenderer } from '@/ui-desks/controls/registry';
import controlStyles from '@/ui-desks/controls/style.module.css';
import { useDesk } from '@/ui-desks/desk/provider';
import styles from './toolbar.module.css';
import type { getSelectedWidgetToolbarItem } from '@/ui-desks/widgets/toolbar-selection';

type SelectedWidgetToolbarItem = NonNullable< ReturnType< typeof getSelectedWidgetToolbarItem > >;

export function DeskWidgetToolbar() {
	const { selectedWidgetToolbarItem, updateSelectedWidgetProps, removeSelectedWidget } = useDesk();
	const visible = Boolean( selectedWidgetToolbarItem );
	const [ lastSelection, setLastSelection ] = useState< SelectedWidgetToolbarItem | null >( null );
	const [ openControlId, setOpenControlId ] = useState< string | null >( null );

	useEffect( () => {
		if ( selectedWidgetToolbarItem ) {
			setLastSelection( selectedWidgetToolbarItem );
		}
	}, [ selectedWidgetToolbarItem ] );

	const renderSelection = visible ? selectedWidgetToolbarItem : lastSelection;
	if ( ! renderSelection ) {
		return null;
	}

	const { definition, widget } = renderSelection;
	const controls = definition.controls;
	if ( ! controls?.length || ! definition.isWidgetProps( widget.widgetProps ) ) {
		return null;
	}

	return (
		<div
			className={ styles.toolbar }
			data-visible={ visible ? 'true' : 'false' }
			role="toolbar"
			aria-label={ __( 'Widget controls' ) }
			aria-hidden={ ! visible }
			onPointerDown={ ( event ) => event.stopPropagation() }
		>
			{ controls.map( ( control ) => (
				<ControlRenderer
					key={ control.id }
					control={ control }
					isOpen={ openControlId === control.id }
					props={ widget.widgetProps }
					setIsOpen={ ( isOpen ) => setOpenControlId( isOpen ? control.id : null ) }
					updateProps={ updateSelectedWidgetProps }
				/>
			) ) }
			<div className={ styles.toolbarDivider } />
			<IconButton
				icon={ trash }
				label={ __( 'Remove widget' ) }
				size="compact"
				tone="neutral"
				variant="minimal"
				className={ controlStyles.button }
				onClick={ removeSelectedWidget }
			/>
		</div>
	);
}
