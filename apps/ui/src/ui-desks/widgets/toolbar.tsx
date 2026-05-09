import { __ } from '@wordpress/i18n';
import { trash } from '@wordpress/icons';
import { useEffect, useState } from 'react';
import { Divider, IconControlButton, Surface } from '@/ui-desks/components';
import { ControlRenderer } from '@/ui-desks/controls/registry';
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
		<Surface
			variant="glass"
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
			<Divider />
			<IconControlButton
				icon={ trash }
				label={ __( 'Remove widget' ) }
				variant="toolbar"
				onClick={ removeSelectedWidget }
			/>
		</Surface>
	);
}
