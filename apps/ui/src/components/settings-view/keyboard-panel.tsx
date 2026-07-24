import { __ } from '@wordpress/i18n';
import { isAppleOS } from '@wordpress/keycodes';
import styles from './style.module.css';

type ShortcutSection = {
	title: string;
	shortcuts: { label: string; keys: string[] }[];
};

function getShortcutKeyAriaLabel( key: string ): string {
	switch ( key ) {
		case '⌘':
			return __( 'Command' );
		case 'Ctrl':
			return __( 'Control' );
		case '↩':
			return __( 'Return' );
		case 'Esc':
			return __( 'Escape' );
		case ',':
			return __( 'Comma' );
		case '←':
			return __( 'Left arrow' );
		case '→':
			return __( 'Right arrow' );
		default:
			return key;
	}
}

function getShortcutSections( isApple: boolean ): ShortcutSection[] {
	const modifierKey = isApple ? '⌘' : 'Ctrl';
	const navModifierKey = isApple ? '⌘' : 'Alt';
	return [
		{
			title: __( 'Global' ),
			shortcuts: [ { label: __( 'Open settings' ), keys: [ modifierKey, ',' ] } ],
		},
		{
			title: __( 'Composer' ),
			shortcuts: [
				{ label: __( 'New chat' ), keys: [ modifierKey, 'N' ] },
				{ label: __( 'Send message' ), keys: [ '↩' ] },
				{ label: __( 'Insert newline' ), keys: [ 'Shift', '↩' ] },
				{ label: __( 'Stop response' ), keys: [ 'Esc' ] },
			],
		},
		{
			title: __( 'Site preview' ),
			shortcuts: [
				{ label: __( 'Toggle site preview' ), keys: [ modifierKey, 'Shift', 'B' ] },
				{ label: __( 'Reload preview' ), keys: [ modifierKey, 'R' ] },
				{ label: __( 'Go back in preview' ), keys: [ navModifierKey, '←' ] },
				{ label: __( 'Go forward in preview' ), keys: [ navModifierKey, '→' ] },
			],
		},
	];
}

function ShortcutKeys( { keys }: { keys: string[] } ) {
	return (
		<span
			className={ styles.shortcutKeys }
			aria-label={ keys.map( getShortcutKeyAriaLabel ).join( ' + ' ) }
		>
			{ keys.map( ( key, index ) => (
				<kbd key={ `${ key }-${ index }` } className={ styles.shortcutKey } aria-hidden="true">
					{ key }
				</kbd>
			) ) }
		</span>
	);
}

export function KeyboardPanel() {
	return (
		<section className={ styles.card }>
			<div className={ styles.cardHeader }>
				<div className={ styles.cardHeaderText }>
					<h2 className={ styles.cardTitle }>{ __( 'Keyboard' ) }</h2>
				</div>
			</div>
			{ getShortcutSections( isAppleOS() ).map( ( section ) => (
				<div key={ section.title } className={ styles.shortcutGroup }>
					<h3 className={ styles.shortcutGroupTitle }>{ section.title }</h3>
					<ul className={ styles.list }>
						{ section.shortcuts.map( ( shortcut ) => (
							<li key={ shortcut.label } className={ styles.field }>
								<div className={ styles.fieldText }>
									<span className={ styles.fieldLabel }>{ shortcut.label }</span>
								</div>
								<ShortcutKeys keys={ shortcut.keys } />
							</li>
						) ) }
					</ul>
				</div>
			) ) }
		</section>
	);
}
