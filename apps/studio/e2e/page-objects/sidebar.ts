import { type Page, expect } from '@playwright/test';

const INTERACTIVE_SELECTOR = ':not([inert] *, [aria-hidden="true"] *)';

export default class Sidebar {
	constructor( private page: Page ) {}

	get addSiteButton() {
		return this.page.getByRole( 'button', { name: 'Add site', exact: true } );
	}

	get toggle() {
		return this.page.locator( `[data-sidebar-toggle]${ INTERACTIVE_SELECTOR }` );
	}

	get locator() {
		// A bare <aside>; the site preview is the labelled one.
		return this.page.locator( 'aside:not([aria-label])' );
	}

	getSiteButton( siteName: string ) {
		return this.locator.getByRole( 'button', { name: siteName, exact: true } ).first();
	}

	getSiteRow( siteName: string, { includeHidden = false } = {} ) {
		// The performance comparison runs these page objects against trunk builds
		// too, whose rows are sections rather than list items.
		return this.locator.locator( 'li, section' ).filter( {
			has: this.page.getByRole( 'button', { name: siteName, exact: true, includeHidden } ),
		} );
	}

	getStatusButton( siteName: string ) {
		// By its state rather than its name, which is translated.
		// The original row stays mounted while the sidebar is collapsed.
		return this.getSiteRow( siteName, { includeHidden: true } )
			.locator( 'button[data-state]' )
			.first();
	}

	private get interactiveLocator() {
		return this.locator.and( this.page.locator( INTERACTIVE_SELECTOR ) );
	}

	async ensureOpen() {
		if ( ( await this.toggle.getAttribute( 'aria-expanded' ) ) === 'false' ) {
			await this.toggle.click();
		}
		await expect( this.interactiveLocator ).toBeInViewport();
	}

	async toggleSite( siteName: string ) {
		await this.ensureOpen();
		const control = this.getSiteRow( siteName )
			.and( this.page.locator( INTERACTIVE_SELECTOR ) )
			.locator( 'button[data-state]' );
		const opensMenu = ( await control.getAttribute( 'aria-haspopup' ) ) === 'menu';
		await control.click();
		if ( opensMenu ) {
			const stop = this.page.getByRole( 'menuitem', { name: 'Stop', exact: true } );
			const hasSubmenu = ( await stop.getAttribute( 'aria-haspopup' ) ) === 'menu';
			await stop.click();
			if ( hasSubmenu )
				await this.page.getByRole( 'menuitem', { name: 'Stop site', exact: true } ).click();
		}
	}

	async expectRunning( siteName: string, timeout = 120_000 ) {
		await expect( this.getStatusButton( siteName ) ).toHaveAttribute( 'data-state', 'running', {
			timeout,
		} );
	}

	async openSite( siteName: string ) {
		await this.ensureOpen();
		await this.interactiveLocator.getByRole( 'button', { name: siteName, exact: true } ).click();
		const close = this.page.getByRole( 'button', { name: 'Close sidebar', exact: true } );
		if ( await close.isVisible() ) {
			await close.click();
			await expect( this.page.getByRole( 'dialog', { name: 'Sidebar' } ) ).toBeHidden();
		}
	}

	// Earlier items open submenus: `openContextMenuItem( site, 'Export', 'Export site' )`.
	async openContextMenuItem( siteName: string, ...items: string[] ) {
		await this.ensureOpen();
		await this.interactiveLocator
			.getByRole( 'button', { name: siteName, exact: true } )
			.click( { button: 'right' } );
		for ( const item of items ) {
			await this.page.getByRole( 'menuitem', { name: item, exact: true } ).click();
		}
	}

	// Imports a backup into a site, confirming the overwrite. The site menu's
	// "Import" opens this input's native file picker.
	async importBackup( siteName: string, backupPath: string ) {
		await this.ensureOpen();
		await this.getSiteRow( siteName )
			.and( this.page.locator( INTERACTIVE_SELECTOR ) )
			.getByTestId( 'import-backup-file' )
			.setInputFiles( backupPath );
		const dialog = this.page.getByRole( 'alertdialog' );
		await expect( dialog ).toContainText( 'Importing a backup will replace' );
		await dialog.getByRole( 'button', { name: 'Import' } ).click();
	}
}
