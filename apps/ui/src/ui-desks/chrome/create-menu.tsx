import { __ } from '@wordpress/i18n';
import { comment, download, globe, plus } from '@wordpress/icons';
import { Icon, IconButton } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { useDesksNavigate } from '../router/navigation';
import styles from './style.module.css';

export function DeskCreateMenu() {
	const navigate = useDesksNavigate();

	const createChat = () => {
		void navigate( {
			to: '/',
			search: { chats: true, newChat: Date.now() },
		} );
	};

	const openCreateSite = () => {
		void navigate( { to: '/onboarding' } );
	};

	const openImportSite = () => {
		void navigate( { to: '/onboarding/import', search: { step: 'select' } } );
	};

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						className={ styles.trigger }
						icon={ plus }
						label={ __( 'Create new' ) }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="start" className={ styles.popup }>
				<Menu.Item onClick={ createChat }>
					<Icon icon={ comment } />
					<span>{ __( 'New chat' ) }</span>
				</Menu.Item>
				<Menu.Item onClick={ openCreateSite }>
					<Icon icon={ globe } />
					<span>{ __( 'New site' ) }</span>
				</Menu.Item>
				<Menu.Item onClick={ openImportSite }>
					<Icon icon={ download } />
					<span>{ __( 'Import from…' ) }</span>
				</Menu.Item>
			</Menu.Popup>
		</Menu.Root>
	);
}
