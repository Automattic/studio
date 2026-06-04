import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { chevronDownSmall, commentAuthorAvatar } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { Gravatar } from '@/components/gravatar';
import { SiteIcon } from '@/components/site-icon';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useSites } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { Button, Menu } from '@/ui-desks/components';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

const WPCOM_PROFILE_URL = 'https://wordpress.com/me';

interface DeskMenuProps {
	siteId?: string;
	disabled?: boolean;
	showSiteName?: boolean;
}

function getSiteIconSeed( site: SiteDetails ) {
	return `${ site.id }:${ site.name }:${ site.path }`;
}

export function DeskMenu( { siteId, disabled = false, showSiteName = true }: DeskMenuProps ) {
	const navigate = useNavigate();
	const connector = useConnector();
	const { data: user } = useAuthUser();
	const { data: preferences } = useUserPreferences();
	const { data: sites, isLoading: sitesLoading } = useSites();
	const login = useLogin();
	const logout = useLogout();
	const effectiveScheme = usePrefersColorScheme();
	const savedScheme = preferences?.colorScheme;
	const themeIsDark =
		savedScheme === 'dark' || ( savedScheme !== 'light' && effectiveScheme === 'dark' );
	const activeSite = sites?.find( ( candidate ) => candidate.id === siteId );
	const activeSiteName = activeSite?.name ?? __( 'Site' );
	const activeSiteIconSeed = activeSite ? getSiteIconSeed( activeSite ) : siteId;
	const switcherSites = activeSite
		? [ activeSite, ...( sites ?? [] ).filter( ( candidate ) => candidate.id !== activeSite.id ) ]
		: sites ?? [];

	const openLink = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const openUserDashboard = () => {
		void navigate( { to: '/' } );
	};

	const switchToOldUi = () => {
		void connector.setStudioUiMode( 'default' );
	};

	const openSite = ( nextSiteId: string ) => {
		if ( nextSiteId === siteId ) {
			return;
		}
		void navigate( { to: '/sites/$siteId', params: { siteId: nextSiteId } } );
	};

	const trigger = siteId ? (
		<Button
			className={ styles.siteTrigger }
			disabled={ disabled }
			label={ sprintf(
				/* translators: %s: current site name. */
				__( 'Desk menu. Current site is %s.' ),
				activeSiteName
			) }
			tooltipLabel={ false }
		>
			<SiteIcon
				className={ styles.siteIcon }
				seed={ activeSiteIconSeed }
				imageSrc={ activeSite?.siteIcon }
			/>
			{ showSiteName && (
				<span className={ styles.siteName } title={ activeSiteName }>
					{ activeSiteName }
				</span>
			) }
			<Icon icon={ chevronDownSmall } size={ 20 } className={ styles.siteCaret } />
		</Button>
	) : (
		<Button disabled={ disabled } label={ __( 'Desk menu' ) } tooltipLabel={ user?.displayName }>
			{ user ? (
				<Gravatar className={ styles.avatar } email={ user.email } isDark={ themeIsDark } />
			) : (
				<Icon
					icon={ commentAuthorAvatar }
					size={ 24 }
					className={ styles.loginAvatar }
					aria-hidden="true"
				/>
			) }
		</Button>
	);

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger render={ trigger } />
			<Menu.Popup side="bottom" align="start" className={ styles.popup }>
				{ user ? (
					<Menu.Item
						className={ styles.email }
						title={ user.email }
						onClick={ () => openLink( WPCOM_PROFILE_URL ) }
					>
						{ user.email }
					</Menu.Item>
				) : (
					<Menu.Item onClick={ () => login.mutate() }>
						{ login.isPending ? __( 'Logging in…' ) : __( 'Log in with WordPress.com' ) }
					</Menu.Item>
				) }
				<Menu.Item onClick={ openUserDashboard }>{ __( 'User desk' ) }</Menu.Item>
				<Menu.Separator />
				{ sitesLoading ? (
					<Menu.Item disabled>{ __( 'Loading…' ) }</Menu.Item>
				) : switcherSites.length > 0 ? (
					switcherSites.map( ( site ) => (
						<Menu.Item
							key={ site.id }
							aria-current={ site.id === siteId ? 'page' : undefined }
							onClick={ () => openSite( site.id ) }
						>
							<span title={ site.name }>{ site.name }</span>
						</Menu.Item>
					) )
				) : (
					<Menu.Item disabled>{ __( 'No sites yet' ) }</Menu.Item>
				) }
				<Menu.Separator />
				<Menu.Item onClick={ switchToOldUi }>{ __( 'Switch to old Studio UI' ) }</Menu.Item>
				{ user ? (
					<Menu.Item onClick={ () => logout.mutate() }>{ __( 'Log out' ) }</Menu.Item>
				) : null }
			</Menu.Popup>
		</Menu.Root>
	);
}
