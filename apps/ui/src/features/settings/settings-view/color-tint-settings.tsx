import {
	DEFAULT_ACCENT_COLOR,
	getColorTint,
	type ColorTint,
} from '@studio/common/lib/user-settings/preferences';
import { __ } from '@wordpress/i18n';
import { useEffect, useLayoutEffect, useState } from 'react';
import { applyColorTint, previewAccentColor } from '@/lib/theme';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	Slider,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/lib/ui';
import { SettingsRow } from './rows';
import styles from './style.module.css';

const getColorPresets = () => [
	{ label: __( 'Default' ), color: DEFAULT_ACCENT_COLOR },
	{ label: __( 'Green' ), color: '#069e08', tintIntensity: 20 },
	{ label: __( 'Purple' ), color: '#8c52d9' },
];

function ColorSwatch( {
	label,
	color,
	selected,
	onClick,
}: {
	label: string;
	color: string;
	selected: boolean;
	onClick: () => void;
} ) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						className={ styles.swatch }
						aria-label={ label }
						aria-pressed={ selected }
						style={ { backgroundColor: color } }
						onClick={ onClick }
					/>
				}
			/>
			<TooltipContent>{ label }</TooltipContent>
		</Tooltip>
	);
}

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

	// Each preset in the accent the active theme gives it.
	const [ previewColors, setPreviewColors ] = useState< Record< string, string > >( {} );
	useLayoutEffect( () => {
		const update = () =>
			setPreviewColors(
				Object.fromEntries(
					getColorPresets().map( ( preset ) => [
						preset.color,
						previewAccentColor( {
							...draft,
							accentColor: preset.color,
							tintIntensity: preset.tintIntensity ?? draft.tintIntensity,
						} ),
					] )
				)
			);
		update();
		const observer = new MutationObserver( update );
		observer.observe( document.documentElement, {
			attributes: true,
			attributeFilter: [ 'data-color-scheme' ],
		} );
		return () => observer.disconnect();
	}, [ draft ] );

	const preview = ( patch: Partial< ColorTint > ) => {
		const next = { ...draft, ...patch };
		setDraft( next );
		applyColorTint( next );
		return next;
	};
	const commit = ( patch: Partial< ColorTint > ) => onCommit( preview( patch ) );

	return (
		<>
			<SettingsRow title={ __( 'Color' ) } description={ __( 'Choose an accent color.' ) }>
				<div role="group" aria-label={ __( 'Color' ) } className={ styles.colorControl }>
					{ getColorPresets().map( ( preset ) => (
						<ColorSwatch
							key={ preset.color }
							label={ preset.label }
							color={ previewColors[ preset.color ] ?? preset.color }
							selected={ draft.accentColor === preset.color }
							onClick={ () => {
								setHex( preset.color );
								commit( {
									accentColor: preset.color,
									tintIntensity: preset.tintIntensity ?? draft.tintIntensity,
								} );
							} }
						/>
					) ) }
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
