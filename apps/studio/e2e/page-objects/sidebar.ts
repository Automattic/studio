import { type Page, expect } from '@playwright/test';

export default class Sidebar {
	constructor( private page: Page ) {}

	get addSiteButton() {
		return this.page.getByRole( 'button', { name: 'Add site' } );
	}

	get locator() {
		// A bare <aside>; the site preview is the labelled one.
		return this.page.locator( 'aside:not([aria-label])' );
	}

	getSiteButton( siteName: string ) {
		return this.locator.getByRole( 'button', { name: siteName, exact: true } );
	}

	getSiteRow( siteName: string ) {
		return this.locator.locator( 'section' ).filter( {
			has: this.page.getByRole( 'button', { name: siteName, exact: true } ),
		} );
	}

	getStatusButton( siteName: string ) {
		// By its state rather than its name, which is translated.
		return this.getSiteRow( siteName ).locator( 'button[data-state]' );
	}

	async expectRunning( siteName: string, timeout = 120_000 ) {
		await expect( this.getStatusButton( siteName ) ).toHaveAttribute( 'data-state', 'running', {
			timeout,
		} );
	}

	async openSite( siteName: string ) {
		await this.getSiteButton( siteName ).click();
	}

	async openContextMenuItem( siteName: string, item: string ) {
		await this.getSiteButton( siteName ).click( { button: 'right' } );
		await this.page.getByRole( 'menuitem', { name: item } ).click();
	}
}
