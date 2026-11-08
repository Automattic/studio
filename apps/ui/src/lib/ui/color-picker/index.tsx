import { __ } from '@wordpress/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { ColorArea, ColorThumb, parseColor } from 'react-aria-components/ColorArea';
import { ColorSlider, SliderTrack } from 'react-aria-components/ColorSlider';
import { IconButton } from '@/lib/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/lib/ui/input-group';
import * as Popover from '@/lib/ui/popover';
import styles from './style.module.css';
import type { Color } from 'react-aria-components/ColorArea';

interface ColorPickerProps {
	value: string;
	onValueChange: ( value: string ) => void;
	onValueCommitted: ( value: string ) => void;
	'aria-label'?: string;
	className?: string;
	disabled?: boolean;
}

const toHex = ( color: Color ) => color.toString( 'hex' ).toLowerCase();

/** An opaque hex field with a saturation/brightness and hue picker. */
export function ColorPicker( {
	value,
	onValueChange,
	onValueCommitted,
	'aria-label': label = __( 'Hex color' ),
	className,
	disabled = false,
}: ColorPickerProps ) {
	const [ color, setColor ] = useState( () => parseColor( value ).toFormat( 'hsb' ) );
	const [ hex, setHex ] = useState( value );
	const [ open, setOpen ] = useState( false );
	const triggerId = useId();
	const inputRef = useRef< HTMLInputElement >( null );
	const anchorRef = useRef< HTMLDivElement >( null );
	const colorRef = useRef( color );
	const restoreFocus = useRef( false );

	useEffect( () => {
		if ( disabled ) setOpen( false );
		// Keep the chosen hue when a gray or black preview is echoed back as hex.
		if ( value.toLowerCase() !== toHex( colorRef.current ) ) {
			const next = parseColor( value ).toFormat( 'hsb' );
			colorRef.current = next;
			setColor( next );
			setHex( value );
		}
	}, [ value, disabled ] );

	const preview = ( next: Color, updateInput = true ) => {
		const nextHex = toHex( next );
		colorRef.current = next;
		setColor( next );
		if ( updateInput ) setHex( nextHex );
		onValueChange( nextHex );
	};
	const commit = ( next: Color ) => onValueCommitted( toHex( next ) );
	const changeHex = ( text: string ) => {
		setHex( text );
		const normalized = text.startsWith( '#' ) ? text : '#' + text;
		if ( /^#[0-9a-f]{6}$/i.test( normalized ) ) {
			const next = parseColor( normalized ).toFormat( 'hsb' );
			preview( next, false );
			commit( next );
		}
	};

	return (
		<Popover.Root
			triggerId={ triggerId }
			open={ open && ! disabled }
			modal={ false }
			onOpenChange={ ( nextOpen, details ) => {
				if (
					details.reason === 'trigger-press' &&
					details.trigger === inputRef.current &&
					! nextOpen
				) {
					details.cancel();
					return;
				}
				restoreFocus.current = details.reason === 'escape-key';
				if ( ! nextOpen ) {
					setHex( toHex( colorRef.current ) );
				}
				setOpen( nextOpen );
			} }
		>
			<InputGroup ref={ anchorRef } className={ className }>
				<Popover.Trigger
					id={ triggerId }
					nativeButton={ false }
					role="textbox"
					disabled={ disabled }
					render={
						<InputGroupInput
							ref={ inputRef }
							aria-label={ label }
							placeholder="#hex"
							value={ hex }
							disabled={ disabled }
							autoComplete="off"
							spellCheck={ false }
							onPointerDown={ () => {
								restoreFocus.current = false;
								setOpen( true );
							} }
							onFocus={ () => {
								if ( restoreFocus.current ) {
									restoreFocus.current = false;
									return;
								}
								setOpen( true );
							} }
							onChange={ ( event ) => changeHex( event.target.value ) }
							onBlur={ () => {
								restoreFocus.current = false;
								setHex( toHex( colorRef.current ) );
							} }
						/>
					}
				/>
				<InputGroupAddon align="inline-end">
					<Popover.Trigger
						disabled={ disabled }
						render={
							<IconButton
								label={ __( 'Choose color' ) }
								size="icon-xs"
								tooltip={ false }
								icon={
									<span
										aria-hidden="true"
										className={ styles.swatch }
										style={ { backgroundColor: toHex( color ) } }
									/>
								}
							/>
						}
					/>
				</InputGroupAddon>
			</InputGroup>
			<Popover.Popup
				anchor={ anchorRef }
				align="end"
				initialFocus={ false }
				finalFocus={ () => ( restoreFocus.current ? inputRef.current : false ) }
				aria-label={ __( 'Color picker' ) }
				className={ styles.picker }
			>
				<ColorArea
					aria-label={ __( 'Saturation and brightness' ) }
					colorSpace="hsb"
					xChannel="saturation"
					yChannel="brightness"
					value={ color }
					onChange={ preview }
					onChangeEnd={ commit }
					className={ styles.area }
				>
					<ColorThumb className={ styles.thumb } />
				</ColorArea>
				<ColorSlider
					aria-label={ __( 'Hue' ) }
					colorSpace="hsb"
					channel="hue"
					value={ color }
					onChange={ preview }
					onChangeEnd={ commit }
				>
					<SliderTrack className={ styles.hueTrack }>
						<ColorThumb className={ styles.thumb } />
					</SliderTrack>
				</ColorSlider>
			</Popover.Popup>
		</Popover.Root>
	);
}
