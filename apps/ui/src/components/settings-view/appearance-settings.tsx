import { Slider } from '@base-ui/react/slider';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useEffect, useState } from 'react';
import {
	USER_PREFERENCES_QUERY_KEY,
	useSaveUserPreferences,
	useUserPreferences,
} from '@/data/queries/use-user-preferences';
import { SettingsGroup, SettingsRow, SettingsSelect } from './rows';
import styles from './style.module.css';
import type { ColorScheme, UserPreferences } from '@/data/core';

// The rebuild's presets; Green also tints the surfaces.
const getColorPresets = () => [
	{ label: __( 'Default' ), color: '#3858e9', tintIntensity: 0 },
	{ label: __( 'Green' ), color: '#069e08', tintIntensity: 20 },
	{ label: __( 'Purple' ), color: '#8c52d9', tintIntensity: 0 },
];
const DEFAULT_ACCENT = '#3858e9';
const HEX = /^#?[0-9a-f]{6}$/i;

type Appearance = Pick< UserPreferences, 'colorScheme' | 'accentColor' | 'tintIntensity' >;

export function AppearanceSettings() {
	const queryClient = useQueryClient();
	const { data } = useUserPreferences();
	const save = useSaveUserPreferences();
	const accent = data?.accentColor ?? DEFAULT_ACCENT;
	const intensity = data?.tintIntensity ?? 0;
	const [ hex, setHex ] = useState( accent );
	useEffect( () => setHex( accent ), [ accent ] );

	if ( ! data ) {
		return null;
	}
	// Shows a change right away; `save` persists it.
	const preview = ( patch: Partial< Appearance > ) =>
		queryClient.setQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY, ( current ) =>
			current ? { ...current, ...patch } : current
		);
	const apply = ( patch: Partial< Appearance > ) => {
		preview( patch );
		save.mutate( patch );
	};
	const isDefault = ! data.accentColor && ! intensity;

	return (
		<div className={ styles.preferencesPanel }>
			<SettingsGroup>
				<SettingsRow title={ __( 'Theme' ) } description={ __( 'Choose light, dark, or system.' ) }>
					<SettingsSelect< ColorScheme >
						label={ __( 'Theme' ) }
						value={ data.colorScheme }
						options={ [
							{ value: 'system', label: __( 'System' ) },
							{ value: 'light', label: __( 'Light' ) },
							{ value: 'dark', label: __( 'Dark' ) },
						] }
						onChange={ ( colorScheme ) => save.mutate( { colorScheme } ) }
					/>
				</SettingsRow>
				<SettingsRow title={ __( 'Color' ) } description={ __( 'Choose an accent color.' ) }>
					<div className={ styles.swatches } role="group" aria-label={ __( 'Color' ) }>
						{ getColorPresets().map( ( preset ) => (
							<button
								key={ preset.color }
								type="button"
								className={ styles.swatch }
								style={ { backgroundColor: preset.color } }
								aria-label={ preset.label }
								aria-pressed={ accent === preset.color }
								onClick={ () =>
									apply( {
										accentColor: preset.color === DEFAULT_ACCENT ? null : preset.color,
										tintIntensity: preset.tintIntensity,
									} )
								}
							/>
						) ) }
						<span className={ styles.hexField }>
							<input
								aria-label={ __( 'Hex color' ) }
								value={ hex }
								spellCheck={ false }
								autoComplete="off"
								onChange={ ( event ) => {
									const value = event.target.value;
									setHex( value );
									if ( HEX.test( value ) ) {
										const color = ( value.startsWith( '#' ) ? value : `#${ value }` ).toLowerCase();
										apply( { accentColor: color === DEFAULT_ACCENT ? null : color } );
									}
								} }
								onBlur={ () => setHex( accent ) }
							/>
							<span className={ styles.hexSample } style={ { backgroundColor: accent } } />
						</span>
					</div>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Intensity' ) }
					description={ __( 'Adjust the strength of the color tint.' ) }
				>
					<Slider.Root
						className={ styles.slider }
						value={ intensity }
						min={ 0 }
						max={ 100 }
						onValueChange={ ( value ) => preview( { tintIntensity: value as number } ) }
						onValueCommitted={ ( value ) => save.mutate( { tintIntensity: value as number } ) }
					>
						<Slider.Control className={ styles.sliderControl }>
							<Slider.Track className={ styles.sliderTrack }>
								<Slider.Indicator className={ styles.sliderIndicator } />
								<Slider.Thumb className={ styles.sliderThumb } aria-label={ __( 'Intensity' ) } />
							</Slider.Track>
						</Slider.Control>
					</Slider.Root>
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup title={ __( 'Reset' ) }>
				<SettingsRow
					title={ __( 'Reset appearance' ) }
					description={ __( 'Restore the default color and intensity.' ) }
				>
					<Button
						variant="outline"
						tone="neutral"
						size="compact"
						disabled={ isDefault }
						onClick={ () => apply( { accentColor: null, tintIntensity: 0 } ) }
					>
						{ __( 'Reset' ) }
					</Button>
				</SettingsRow>
			</SettingsGroup>
		</div>
	);
}
