import { __, sprintf } from '@wordpress/i18n';
import { XIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { updateResponsivePreview, type ResponsivePreviewSettings } from '@/data/responsive-preview';
import { ChevronDownIcon, RefreshIcon } from '@/lib/icons';
import { Button, IconButton, Input, Menu } from '@/lib/ui';
import { devicePresets, parseDimension } from './settings';
import styles from './style.module.css';

function DimensionInput( {
	label,
	value,
	onCommit,
}: {
	label: string;
	value: number;
	onCommit: ( value: number ) => void;
} ) {
	const cancelled = useRef( false );
	const [ draft, setDraft ] = useState( String( value ) );
	const [ focused, setFocused ] = useState( false );
	return (
		<Input
			className={ styles.dimension }
			aria-label={ label }
			inputMode="numeric"
			value={ focused ? draft : String( value ) }
			onFocus={ ( event ) => {
				setDraft( String( value ) );
				setFocused( true );
				event.currentTarget.select();
			} }
			onChange={ ( event ) => setDraft( event.target.value ) }
			onBlur={ () => {
				const next = cancelled.current ? null : parseDimension( draft );
				cancelled.current = false;
				if ( next !== null ) onCommit( next );
				setFocused( false );
			} }
			onKeyDown={ ( event ) => {
				if ( event.key === 'Enter' ) event.currentTarget.blur();
				if ( event.key === 'Escape' ) {
					cancelled.current = true;
					setDraft( String( value ) );
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.blur();
				}
			} }
		/>
	);
}

export function ResponsiveToolbar( {
	siteId,
	settings,
	fitScale,
}: {
	siteId: string;
	settings: ResponsivePreviewSettings;
	fitScale: number;
} ) {
	const update = ( patch: Partial< ResponsivePreviewSettings > ) =>
		updateResponsivePreview( siteId, patch );
	const isLandscape = settings.width > settings.height;
	const isSquare = settings.width === settings.height;
	return (
		<div className={ styles.toolbar } role="toolbar" aria-label={ __( 'Responsive preview' ) }>
			<Menu.Root>
				<Menu.Trigger
					render={ <Button variant="ghost" size="header" className={ styles.device } /> }
				>
					<span>{ settings.preset === 'responsive' ? __( 'Responsive' ) : settings.preset }</span>
					<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
				</Menu.Trigger>
				<Menu.Popup side="bottom">
					<Menu.RadioGroup
						value={ settings.preset }
						onValueChange={ ( value ) => {
							const preset = devicePresets.find( ( item ) => item.name === value );
							update(
								preset
									? { preset: preset.name, width: preset.width, height: preset.height }
									: { preset: 'responsive' }
							);
						} }
					>
						<Menu.RadioItem value="responsive">{ __( 'Responsive' ) }</Menu.RadioItem>
						{ devicePresets.map( ( preset ) => (
							<Menu.RadioItem key={ preset.name } value={ preset.name }>
								<span className={ styles.presetLabel }>
									{ preset.name }{ ' ' }
									<span className={ styles.presetDimensions }>
										· { preset.width } × { preset.height }
									</span>
								</span>
							</Menu.RadioItem>
						) ) }
					</Menu.RadioGroup>
				</Menu.Popup>
			</Menu.Root>
			<span className={ styles.divider } aria-hidden="true" />
			<div className={ styles.dimensions }>
				<DimensionInput
					label={ __( 'Width' ) }
					value={ settings.width }
					onCommit={ ( width ) => update( { width, preset: 'responsive' } ) }
				/>
				<span aria-hidden="true">×</span>
				<DimensionInput
					label={ __( 'Height' ) }
					value={ settings.height }
					onCommit={ ( height ) => update( { height, preset: 'responsive' } ) }
				/>
			</div>
			<IconButton
				className={ styles.rotate }
				variant="ghost"
				size="icon-sm"
				label={
					isSquare
						? __( 'Rotate viewport' )
						: isLandscape
						? __( 'Rotate to portrait' )
						: __( 'Rotate to landscape' )
				}
				icon={ <RefreshIcon /> }
				onClick={ () =>
					update( { width: settings.height, height: settings.width, preset: 'responsive' } )
				}
			/>
			<span className={ styles.divider } aria-hidden="true" />
			<Menu.Root>
				<Menu.Trigger render={ <Button variant="ghost" size="header" /> }>
					{ settings.zoom === 'fit' ? __( 'Fit' ) : `${ settings.zoom * 100 }%` }
					<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
				</Menu.Trigger>
				<Menu.Popup side="bottom" align="start">
					<Menu.RadioGroup
						value={ String( settings.zoom ) }
						onValueChange={ ( value ) =>
							update( { zoom: value === 'fit' ? 'fit' : Number( value ) } )
						}
					>
						<Menu.RadioItem value="fit">
							<span>
								{ __( 'Fit' ) }{ ' ' }
								<span className={ styles.optionDetail }>
									{ sprintf( __( '· %d%%' ), Math.round( fitScale * 100 ) ) }
								</span>
							</span>
						</Menu.RadioItem>
						<Menu.Separator />
						{ [ 0.5, 0.75, 1, 1.25, 1.5 ].map( ( zoom ) => (
							<Menu.RadioItem key={ zoom } value={ String( zoom ) }>
								{ zoom * 100 }%
							</Menu.RadioItem>
						) ) }
					</Menu.RadioGroup>
				</Menu.Popup>
			</Menu.Root>
			<IconButton
				variant="ghost"
				size="icon-sm"
				label={ __( 'Exit responsive mode' ) }
				className={ styles.close }
				icon={ <XIcon /> }
				onClick={ () => update( { enabled: false } ) }
			/>
		</div>
	);
}
