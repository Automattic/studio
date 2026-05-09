import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { comment, download, globe, plus } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { useDesk } from '@/ui-desks/desk/provider';
import { getCreatableWidgetDefinitions } from '@/ui-desks/widgets/registry';
import { DeskHeaderIconButton } from './header-button';
import styles from './style.module.css';
import type { DeskChatsSearch } from '../chats/search';

export function DeskCreateMenu() {
	const navigate = useNavigate();
	const desk = useDesk();
	const creatableWidgetDefinitions = getCreatableWidgetDefinitions();

	const createChat = () => {
		void navigate( {
			to: '.',
			search: ( previous: DeskChatsSearch ) => ( {
				...previous,
				chats: true,
				newChat: Date.now(),
			} ),
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
				render={ <DeskHeaderIconButton icon={ plus } label={ __( 'Create new' ) } /> }
			/>
			<Menu.Popup side="bottom" align="start" className={ styles.popup }>
				{ creatableWidgetDefinitions.map( ( definition ) => (
					<Menu.Item
						key={ definition.type }
						disabled={ ! desk.canAddWidgets }
						onClick={ () => desk.addWidget( definition.type ) }
					>
						{ definition.icon && <Icon icon={ definition.icon } /> }
						<span>{ definition.labels.add() }</span>
					</Menu.Item>
				) ) }
				{ creatableWidgetDefinitions.length > 0 && <Menu.Separator /> }
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
