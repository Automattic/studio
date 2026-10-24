import { __ } from '@wordpress/i18n';
import { isAppleOS } from '@wordpress/keycodes';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { SettingsGroup, SettingsRow } from './rows';
import styles from './style.module.css';

type ShortcutSection = {
	title?: string;
	shortcuts: { label: string; keys: string[] }[];
};

function getShortcutKeyAriaLabel( key: string ): string {
	switch ( key ) {
		case '⌘':
			return __( 'Command' );
		case 'Ctrl':
			return __( 'Control' );
		case '⌥':
			return __( 'Option' );
		case '⇧':
			return __( 'Shift' );
		case '↩':
			return __( 'Return' );
		case 'Esc':
			return __( 'Escape' );
		case ',':
			return __( 'Comma' );
		case '[':
			return __( 'Left bracket' );
		case ']':
			return __( 'Right bracket' );
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
	const altKey = isApple ? '⌥' : 'Alt';
	const shiftKey = isApple ? '⇧' : 'Shift';
	const navModifierKey = isApple ? '⌘' : 'Alt';
	return [
		{
			shortcuts: [
				{ label: __( 'Open command palette' ), keys: [ modifierKey, 'K' ] },
				{ label: __( 'Open settings' ), keys: [ modifierKey, ',' ] },
				{ label: __( 'Add site' ), keys: [ modifierKey, 'N' ] },
				{ label: __( 'Toggle sidebar' ), keys: [ modifierKey, 'B' ] },
				{ label: __( 'Close dialog or menu' ), keys: [ 'Esc' ] },
				{ label: __( 'Back in settings or preview' ), keys: [ modifierKey, '[' ] },
				{ label: __( 'Forward in settings or preview' ), keys: [ modifierKey, ']' ] },
			],
		},
		{
			title: __( 'Sites' ),
			shortcuts: [
				{ label: __( 'Start or stop active site' ), keys: [ altKey, modifierKey, 'S' ] },
				{ label: __( 'Rename site' ), keys: [ altKey, modifierKey, 'R' ] },
				{ label: __( 'Pin or unpin site' ), keys: [ altKey, modifierKey, 'P' ] },
			],
		},
		{
			title: __( 'Chats' ),
			shortcuts: [
				{ label: __( 'Rename chat' ), keys: [ altKey, modifierKey, 'R' ] },
				{ label: __( 'Pin or unpin chat' ), keys: [ altKey, modifierKey, 'P' ] },
				{ label: __( 'Archive chat' ), keys: [ shiftKey, modifierKey, 'A' ] },
				{ label: __( 'Rename the focused site or chat' ), keys: [ 'F2' ] },
				{ label: __( 'Answer with an option' ), keys: [ '1–9' ] },
			],
		},
		{
			title: __( 'Composer' ),
			shortcuts: [
				{ label: __( 'Send message' ), keys: [ '↩' ] },
				{ label: __( 'Insert newline' ), keys: [ shiftKey, '↩' ] },
				{ label: __( 'Stop response' ), keys: [ 'Esc' ] },
			],
		},
		{
			title: __( 'Site preview' ),
			shortcuts: [
				{ label: __( 'Toggle site preview' ), keys: [ shiftKey, modifierKey, 'B' ] },
				{ label: __( 'Reload preview' ), keys: [ modifierKey, 'R' ] },
				{ label: __( 'Go back in preview' ), keys: [ navModifierKey, '←' ] },
				{ label: __( 'Go forward in preview' ), keys: [ navModifierKey, '→' ] },
			],
		},
	];
}

export function KeyboardPanel() {
	return (
		<div className={ styles.preferencesPanel }>
			{ getShortcutSections( isAppleOS() ).map( ( section ) => (
				<SettingsGroup key={ section.title ?? '' } title={ section.title }>
					{ section.shortcuts.map( ( shortcut ) => (
						<SettingsRow key={ shortcut.label } title={ shortcut.label }>
							<KbdGroup aria-label={ shortcut.keys.map( getShortcutKeyAriaLabel ).join( ' + ' ) }>
								{ shortcut.keys.map( ( key ) => (
									<Kbd key={ key } variant="settings" aria-hidden="true">
										{ key }
									</Kbd>
								) ) }
							</KbdGroup>
						</SettingsRow>
					) ) }
				</SettingsGroup>
			) ) }
		</div>
	);
}
