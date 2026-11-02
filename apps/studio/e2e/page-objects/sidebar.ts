import { type Page, expect } from '@playwright/test';

export default class Sidebar {
	constructor( private page: Page ) {}

	get addSiteButton() {
		return this.page.getByRole( 'button', { name: 'Add site', exact: true } );
	}

	get locator() {
		// A bare <aside>; the site preview is the labelled one.
		return this.page.locator( 'aside:not([aria-label])' );
	}

	getSiteButton( siteName: string ) {
		return this.locator.getByRole( 'button', { name: siteName, exact: true } ).first();
	}

	getSiteRow( siteName: string ) {
		// The performance comparison runs these page objects against trunk builds
		// too, whose rows are sections rather than list items.
		return this.locator.locator( 'li, section' ).filter( {
			has: this.page.getByRole( 'button', { name: siteName, exact: true } ),
		} );
	}

	getStatusButton( siteName: string ) {
		// By its state rather than its name, which is translated.
		// A flyout adds a second row; keep state reads on the original row.
		return this.getSiteRow( siteName ).locator( 'button[data-state]' ).first();
	}

	private get interactiveLocator() {
		return this.locator.and( this.page.locator( ':not([inert] *)' ) );
	}

	async ensureOpen() {
		const toggle = this.page.locator( '[data-sidebar-toggle]:not([inert] *)' );
		if ( ( await toggle.getAttribute( 'aria-expanded' ) ) === 'false' ) {
			await toggle.click();
		}
		await expect( this.interactiveLocator ).toBeInViewport();
	}

	async toggleSite( siteName: string ) {
		await this.ensureOpen();
		await this.getSiteRow( siteName )
			.and( this.page.locator( ':not([inert] *)' ) )
			.locator( 'button[data-state]' )
			.click();
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
			.and( this.page.locator( ':not([inert] *)' ) )
			.getByTestId( 'import-backup-file' )
			.setInputFiles( backupPath );
		const dialog = this.page.getByRole( 'alertdialog' );
		await expect( dialog ).toContainText( 'Importing a backup will replace' );
		await dialog.getByRole( 'button', { name: 'Import' } ).click();
	}
}
