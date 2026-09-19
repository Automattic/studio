import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { validateOutputDir, planArtifacts, claimSlug } from './output-layout.js';

describe( 'validateOutputDir', () => {
	it( 'accepts a descendant of cwd', () => {
		const p = join( process.cwd(), 'output', 'example.com' );
		expect( () => validateOutputDir( p ) ).not.toThrow();
	} );

	it( 'accepts an absolute path outside cwd (no longer cwd-pinned)', () => {
		expect( () => validateOutputDir( join( tmpdir(), 'dla-out' ) ) ).not.toThrow();
	} );

	it( "rejects '..' traversal", () => {
		// path.join resolves '..', so use a raw relative path — normalize keeps the leading '..'
		expect( () => validateOutputDir( '../escape' ) ).toThrow( /traversal/ );
	} );
} );

describe( 'claimSlug', () => {
	it( 'returns the bare slug when not seen', () => {
		const seen = new Map< string, number >();
		expect( claimSlug( 'about', seen ) ).toBe( 'about' );
	} );

	it( 'appends -2, -3 on collision', () => {
		const seen = new Map< string, number >();
		claimSlug( 'about', seen );
		expect( claimSlug( 'about', seen ) ).toBe( 'about-2' );
		expect( claimSlug( 'about', seen ) ).toBe( 'about-3' );
	} );
} );

describe( 'planArtifacts', () => {
	it( 'identifies which artifacts need capture vs skip', () => {
		const dir = mkdtempSync( join( tmpdir(), 'artifacts-' ) );
		try {
			mkdirSync( join( dir, 'screenshots', 'desktop' ), { recursive: true } );
			mkdirSync( join( dir, 'screenshots', 'mobile' ), { recursive: true } );
			mkdirSync( join( dir, 'html' ), { recursive: true } );
			writeFileSync( join( dir, 'screenshots', 'desktop', 'about.png' ), 'fake' );
			writeFileSync( join( dir, 'html', 'about.html' ), 'fake' );

			const plan = planArtifacts( { slug: 'about', outputDir: dir, force: false, captureImages: true } );
			expect( plan.desktop.needsLoad ).toBe( true );
			expect( plan.desktop.captureFullpage ).toBe( false );
			expect( plan.desktop.captureScrolled ).toBe( true );
			expect( plan.desktop.captureHtml ).toBe( false );
			expect( plan.mobile.needsLoad ).toBe( true );
			expect( plan.mobile.captureFullpage ).toBe( true );
			expect( plan.mobile.captureScrolled ).toBe( true );
		} finally {
			rmSync( dir, { recursive: true, force: true } );
		}
	} );

	it( 'captures the mobile DOM html on the mobile pass only, gated on the file existing', () => {
		const dir = mkdtempSync( join( tmpdir(), 'artifacts-' ) );
		try {
			const plan = planArtifacts( { slug: 'about', outputDir: dir, force: false } );
			expect( plan.mobile.captureMobileHtml ).toBe( true ); // missing → capture
			expect( plan.desktop.captureMobileHtml ).toBe( false ); // never on desktop
			expect( plan.mobile.paths.htmlMobile.endsWith( '/html-mobile/about.html' ) ).toBe( true );

			mkdirSync( join( dir, 'html-mobile' ), { recursive: true } );
			writeFileSync( join( dir, 'html-mobile', 'about.html' ), 'fake' );
			expect(
				planArtifacts( { slug: 'about', outputDir: dir, force: false } ).mobile.captureMobileHtml
			).toBe( false );
			expect(
				planArtifacts( { slug: 'about', outputDir: dir, force: true } ).mobile.captureMobileHtml
			).toBe( true );
		} finally {
			rmSync( dir, { recursive: true, force: true } );
		}
	} );

	it( 'captures section specs on desktop only, gated on the sections file existing', () => {
		const dir = mkdtempSync( join( tmpdir(), 'artifacts-' ) );
		try {
			const plan = planArtifacts( { slug: 'about', outputDir: dir, force: false } );
			expect( plan.desktop.captureSections ).toBe( true ); // missing → capture
			expect( plan.mobile.captureSections ).toBe( false ); // never on mobile
			expect( plan.mobile.captureMobileSections ).toBe( true );
			expect( plan.desktop.paths.sections.endsWith( '/sections/about.json' ) ).toBe( true );
			expect( plan.mobile.paths.sectionsMobile.endsWith( '/sections-mobile/about.json' ) ).toBe(
				true
			);

			mkdirSync( join( dir, 'sections' ), { recursive: true } );
			writeFileSync( join( dir, 'sections', 'about.json' ), 'fake' );
			const plan2 = planArtifacts( { slug: 'about', outputDir: dir, force: false } );
			expect( plan2.desktop.captureSections ).toBe( false ); // present → skip
			mkdirSync( join( dir, 'sections-mobile' ), { recursive: true } );
			writeFileSync( join( dir, 'sections-mobile', 'about.json' ), 'fake' );
			expect(
				planArtifacts( { slug: 'about', outputDir: dir, force: false } ).mobile
					.captureMobileSections
			).toBe( false );
			// force re-captures regardless
			expect(
				planArtifacts( { slug: 'about', outputDir: dir, force: true } ).desktop.captureSections
			).toBe( true );
		} finally {
			rmSync( dir, { recursive: true, force: true } );
		}
	} );

	it( 'skips entire viewport when all artifacts exist', () => {
		const dir = mkdtempSync( join( tmpdir(), 'artifacts-' ) );
		try {
			mkdirSync( join( dir, 'screenshots', 'desktop' ), { recursive: true } );
			mkdirSync( join( dir, 'screenshots', 'mobile' ), { recursive: true } );
			mkdirSync( join( dir, 'html' ), { recursive: true } );
			mkdirSync( join( dir, 'html-mobile' ), { recursive: true } );
			mkdirSync( join( dir, 'sections' ), { recursive: true } );
			mkdirSync( join( dir, 'sections-mobile' ), { recursive: true } );
			mkdirSync( join( dir, 'layout-geometry' ), { recursive: true } );
			writeFileSync( join( dir, 'screenshots', 'desktop', 'about.png' ), 'fake' );
			writeFileSync( join( dir, 'screenshots', 'desktop', 'about.scrolled.png' ), 'fake' );
			writeFileSync( join( dir, 'screenshots', 'mobile', 'about.png' ), 'fake' );
			writeFileSync( join( dir, 'screenshots', 'mobile', 'about.scrolled.png' ), 'fake' );
			writeFileSync( join( dir, 'html', 'about.html' ), 'fake' );
			writeFileSync( join( dir, 'html-mobile', 'about.html' ), 'fake' );
			writeFileSync( join( dir, 'sections', 'about.json' ), 'fake' );
			writeFileSync( join( dir, 'sections-mobile', 'about.json' ), 'fake' );
			writeFileSync( join( dir, 'layout-geometry', 'about.desktop.json' ), 'fake' );
			writeFileSync( join( dir, 'layout-geometry', 'about.mobile.json' ), 'fake' );

			const plan = planArtifacts( { slug: 'about', outputDir: dir, force: false } );
			expect( plan.desktop.needsLoad ).toBe( false );
			expect( plan.mobile.needsLoad ).toBe( false );
		} finally {
			rmSync( dir, { recursive: true, force: true } );
		}
	} );

	it( 'force flag ignores existing files', () => {
		const dir = mkdtempSync( join( tmpdir(), 'artifacts-' ) );
		try {
			mkdirSync( join( dir, 'screenshots', 'desktop' ), { recursive: true } );
			writeFileSync( join( dir, 'screenshots', 'desktop', 'about.png' ), 'fake' );
			const plan = planArtifacts( { slug: 'about', outputDir: dir, force: true, captureImages: true } );
			expect( plan.desktop.captureFullpage ).toBe( true );
		} finally {
			rmSync( dir, { recursive: true, force: true } );
		}
	} );

	it( 'does not require PNG files when image capture is disabled', () => {
		const dir = mkdtempSync( join( tmpdir(), 'artifacts-' ) );
		try {
			mkdirSync( join( dir, 'html' ), { recursive: true } );
			mkdirSync( join( dir, 'html-mobile' ), { recursive: true } );
			mkdirSync( join( dir, 'sections' ), { recursive: true } );
			mkdirSync( join( dir, 'sections-mobile' ), { recursive: true } );
			mkdirSync( join( dir, 'layout-geometry' ), { recursive: true } );
			writeFileSync( join( dir, 'html', 'about.html' ), 'fake' );
			writeFileSync( join( dir, 'html-mobile', 'about.html' ), 'fake' );
			writeFileSync( join( dir, 'sections', 'about.json' ), 'fake' );
			writeFileSync( join( dir, 'sections-mobile', 'about.json' ), 'fake' );
			writeFileSync( join( dir, 'layout-geometry', 'about.desktop.json' ), 'fake' );
			writeFileSync( join( dir, 'layout-geometry', 'about.mobile.json' ), 'fake' );

			const plan = planArtifacts( {
				slug: 'about',
				outputDir: dir,
				force: false,
				captureImages: false,
			} );
			expect( plan.desktop.captureFullpage ).toBe( false );
			expect( plan.mobile.captureScrolled ).toBe( false );
			expect( plan.desktop.needsLoad ).toBe( false );
			expect( plan.mobile.needsLoad ).toBe( false );
		} finally {
			rmSync( dir, { recursive: true, force: true } );
		}
	} );

	it( 'omits PNGs by default while still planning HTML, sections, and geometry', () => {
		const dir = mkdtempSync( join( tmpdir(), 'artifacts-' ) );
		try {
			const plan = planArtifacts( { slug: 'about', outputDir: dir, force: false } );
			expect( plan.desktop.captureFullpage ).toBe( false );
			expect( plan.desktop.captureScrolled ).toBe( false );
			expect( plan.mobile.captureFullpage ).toBe( false );
			expect( plan.mobile.captureScrolled ).toBe( false );
			expect( plan.desktop.captureHtml ).toBe( true );
			expect( plan.mobile.captureMobileHtml ).toBe( true );
			expect( plan.desktop.captureSections ).toBe( true );
			expect( plan.mobile.captureMobileSections ).toBe( true );
			expect( plan.desktop.captureGeometry ).toBe( true );
			expect( plan.mobile.captureGeometry ).toBe( true );
		} finally {
			rmSync( dir, { recursive: true, force: true } );
		}
	} );
} );
