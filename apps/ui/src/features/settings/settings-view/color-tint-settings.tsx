import { getColorTint, type ColorTint } from '@studio/common/lib/user-settings/preferences';
import { __ } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { applyColorTint } from '@/lib/theme';
import { InputGroup, InputGroupAddon, InputGroupInput, Slider } from '@/lib/ui';
import { SettingsRow } from './rows';
import styles from './style.module.css';

// The accent color, tint intensity and contrast rows. Sliders preview while
// dragging and save on release.
export function ColorTintSettings( {
	tint,
	onCommit,
}: {
	tint: Partial< ColorTint >;
	onCommit: ( tint: ColorTint ) => void;
} ) {
	const { accentColor, tintIntensity, contrast } = getColorTint( tint );
	const [ draft, setDraft ] = useState( { accentColor, tintIntensity, contrast } );
	const [ hex, setHex ] = useState( accentColor );
	useEffect( () => {
		setDraft( { accentColor, tintIntensity, contrast } );
		setHex( accentColor );
	}, [ accentColor, tintIntensity, contrast ] );

	const preview = ( patch: Partial< ColorTint > ) => {
		const next = { ...draft, ...patch };
		setDraft( next );
		applyColorTint( next );
		return next;
	};
	const commit = ( patch: Partial< ColorTint > ) => onCommit( preview( patch ) );

	return (
		<>
			<SettingsRow
				title={ __( 'Accent' ) }
				description={ __( 'Studio adapts your chosen color to work with your theme.' ) }
			>
				<div role="group" aria-label={ __( 'Accent' ) } className={ styles.colorControl }>
					<InputGroup className={ styles.hexInput }>
						<InputGroupInput
							aria-label={ __( 'Hex color' ) }
							placeholder="#hex"
							value={ hex }
							autoComplete="off"
							spellCheck={ false }
							onChange={ ( event ) => {
								const value = event.target.value;
								setHex( value );
								const normalized = value.startsWith( '#' ) ? value : '#' + value;
								if ( /^#[0-9a-f]{6}$/i.test( normalized ) ) {
									commit( { accentColor: normalized.toLowerCase() } );
								}
							} }
							onBlur={ () => setHex( draft.accentColor ) }
						/>
						<InputGroupAddon align="inline-end">
							<span
								aria-hidden="true"
								className={ styles.hexPreview }
								style={ { backgroundColor: draft.accentColor } }
							/>
						</InputGroupAddon>
					</InputGroup>
				</div>
			</SettingsRow>
			<SettingsRow
				title={ __( 'Intensity' ) }
				description={ __( 'Adjust the strength of the color tint.' ) }
			>
				<div className={ styles.sliderControl }>
					<Slider
						aria-label={ __( 'Intensity' ) }
						value={ draft.tintIntensity }
						onValueChange={ ( value ) => preview( { tintIntensity: value as number } ) }
						onValueCommitted={ ( value ) => commit( { tintIntensity: value as number } ) }
					/>
				</div>
			</SettingsRow>
			<SettingsRow
				title={ __( 'Contrast' ) }
				description={ __( 'Increase separation between surfaces.' ) }
			>
				<div className={ styles.sliderControl }>
					<Slider
						aria-label={ __( 'Contrast' ) }
						value={ draft.contrast }
						onValueChange={ ( value ) => preview( { contrast: value as number } ) }
						onValueCommitted={ ( value ) => commit( { contrast: value as number } ) }
					/>
				</div>
			</SettingsRow>
		</>
	);
}
