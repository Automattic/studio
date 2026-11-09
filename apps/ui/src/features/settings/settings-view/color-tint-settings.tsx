import { getColorTint, type ColorTint } from '@studio/common/lib/user-settings/preferences';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import { applyColorTint } from '@/lib/theme';
import { ColorPicker, Slider } from '@/lib/ui';
import { SettingsRow } from './rows';
import styles from './style.module.css';

// The accent color, tint intensity and contrast rows. Sliders preview while
// dragging and save on release.
export function ColorTintSettings( {
	tint,
	onCommit,
}: {
	tint: Partial< ColorTint >;
	onCommit: ( tint: ColorTint ) => void | Promise< unknown >;
} ) {
	const { accentColor, tintIntensity, contrast } = getColorTint( tint );
	const [ draft, setDraft ] = useState( { accentColor, tintIntensity, contrast } );
	const savedTint = useRef( { accentColor, tintIntensity, contrast } );
	const commitVersion = useRef( 0 );
	useEffect( () => {
		savedTint.current = { accentColor, tintIntensity, contrast };
		setDraft( savedTint.current );
	}, [ accentColor, tintIntensity, contrast ] );

	const preview = ( patch: Partial< ColorTint > ) => {
		const next = { ...draft, ...patch };
		setDraft( next );
		applyColorTint( next );
		return next;
	};
	const commit = ( patch: Partial< ColorTint > ) => {
		const version = ++commitVersion.current;
		void Promise.resolve( onCommit( preview( patch ) ) ).catch( () => {
			if ( version !== commitVersion.current ) return;
			setDraft( savedTint.current );
			applyColorTint( savedTint.current );
		} );
	};

	return (
		<>
			<SettingsRow
				title={ __( 'Accent' ) }
				description={ __( 'Studio adapts your chosen color to work with your theme.' ) }
			>
				<div role="group" aria-label={ __( 'Accent' ) } className={ styles.colorControl }>
					<ColorPicker
						value={ draft.accentColor }
						onValueChange={ ( value ) => preview( { accentColor: value } ) }
						onValueCommitted={ ( value ) => commit( { accentColor: value } ) }
					/>
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
