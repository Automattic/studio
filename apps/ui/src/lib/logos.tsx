import type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
import type { ReactElement } from 'react';

/* Brand marks for the apps a site can be opened in, rendered with
   `currentColor` so they follow the theme-aware foreground tokens in light and
   dark mode. Third-party path data comes from Simple Icons (CC0) except VS
   Code, which comes from Devicon (MIT) because Simple Icons no longer ships
   it. Finder, Terminal, and the generic folder are drawn in-house in the same
   stroke style as `./icons`. Each root svg declares its own `fill` so the
   stroke-drawn marks are not affected by a consumer's fill mapping for
   @wordpress/icons. */

const vscodeLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -16 160 160" fill="currentColor">
		<path
			fillRule="evenodd"
			d="M90.767 127.126a7.968 7.968 0 0 0 6.35-.244l26.353-12.681a8 8 0 0 0 4.53-7.209V21.009a8 8 0 0 0-4.53-7.21L97.117 1.12a7.97 7.97 0 0 0-9.093 1.548l-50.45 46.026L15.6 32.013a5.328 5.328 0 0 0-6.807.302l-7.048 6.411a5.335 5.335 0 0 0-.006 7.888L20.796 64 1.74 81.387a5.336 5.336 0 0 0 .006 7.887l7.048 6.411a5.327 5.327 0 0 0 6.807.303l21.974-16.68 50.45 46.025a7.96 7.96 0 0 0 2.743 1.793Zm5.252-92.183L57.74 64l38.28 29.058V34.943Z"
		/>
	</svg>
);

const cursorLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="currentColor">
		<path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
	</svg>
);

const phpstormLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="currentColor">
		<path d="M7.833 6.611v-.055c0-1-.667-1.5-1.778-1.5H4.389v3.056h1.722c1.111-.001 1.722-.668 1.722-1.501zM0 0v24h24V0H0zm2.167 3.111h4.056c2.389 0 3.833 1.389 3.833 3.445v.055c0 2.333-1.778 3.5-4.056 3.5H4.333v3H2.167v-10zM11.278 21h-9v-1.5h9V21zM18.5 10.222c0 2-1.5 3.111-3.667 3.111-1.5-.056-3-.611-4.222-1.667l1.278-1.556c.89.722 1.833 1.222 3 1.222.889 0 1.444-.333 1.444-.944v-.056c0-.555-.333-.833-2-1.277C12.333 8.555 11 8 11 6v-.056c0-1.833 1.444-3 3.5-3 1.444 0 2.723.444 3.723 1.278l-1.167 1.667c-.889-.611-1.777-1-2.611-1-.833 0-1.278.389-1.278.889v.056c0 .667.445.889 2.167 1.333 2 .556 3.167 1.278 3.167 3v.055z" />
	</svg>
);

const webstormLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="currentColor">
		<path d="M0 0v24h24V0H0zm17.889 2.889c1.444 0 2.667.444 3.667 1.278l-1.111 1.667c-.889-.611-1.722-1-2.556-1s-1.278.389-1.278.889v.056c0 .667.444.889 2.111 1.333 2 .556 3.111 1.278 3.111 3v.056c0 2-1.5 3.111-3.611 3.111-1.5-.056-3-.611-4.167-1.667l1.278-1.556c.889.722 1.833 1.222 2.944 1.222.889 0 1.389-.333 1.389-.944v-.056c0-.556-.333-.833-2-1.278-2-.5-3.222-1.056-3.222-3.056v-.056c0-1.833 1.444-3 3.444-3zm-16.111.222h2.278l1.5 5.778 1.722-5.778h1.667l1.667 5.778 1.5-5.778h2.333l-2.833 9.944H9.723L8.112 7.277l-1.667 5.778H4.612L1.779 3.111zm.5 16.389h9V21h-9v-1.5z" />
	</svg>
);

const windsurfLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="currentColor">
		<path d="M23.55 5.067c-1.2038-.002-2.1806.973-2.1806 2.1765v4.8676c0 .972-.8035 1.7594-1.7597 1.7594-.568 0-1.1352-.286-1.4718-.7659l-4.9713-7.1003c-.4125-.5896-1.0837-.941-1.8103-.941-1.1334 0-2.1533.9635-2.1533 2.153v4.8957c0 .972-.7969 1.7594-1.7596 1.7594-.57 0-1.1363-.286-1.4728-.7658L.4076 5.1598C.2822 4.9798 0 5.0688 0 5.2882v4.2452c0 .2147.0656.4228.1884.599l5.4748 7.8183c.3234.462.8006.8052 1.3509.9298 1.3771.313 2.6446-.747 2.6446-2.0977v-4.893c0-.972.7875-1.7593 1.7596-1.7593h.003a1.798 1.798 0 0 1 1.4718.7658l4.9723 7.0994c.4135.5905 1.05.941 1.8093.941 1.1587 0 2.1515-.9645 2.1515-2.153v-4.8948c0-.972.7875-1.7594 1.7596-1.7594h.194a.22.22 0 0 0 .2204-.2202v-4.622a.22.22 0 0 0-.2203-.2203Z" />
	</svg>
);

const sublimeLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="currentColor">
		<path d="M20.953.004a.397.397 0 0 0-.18.017L3.225 5.585c-.175.055-.323.214-.402.398a.42.42 0 0 0-.06.22v5.726a.42.42 0 0 0 .06.22c.079.183.227.341.402.397l7.454 2.364-7.454 2.363c-.255.08-.463.374-.463.655v5.688c0 .282.208.444.463.363l17.55-5.565c.237-.075.426-.336.452-.6.003-.022.013-.04.013-.065V12.06c0-.281-.208-.575-.463-.656L13.4 9.065l7.375-2.339c.255-.08.462-.375.462-.656V.384c0-.211-.117-.355-.283-.38z" />
	</svg>
);

const zedLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="currentColor">
		<path d="M2.25 1.5a.75.75 0 0 0-.75.75v16.5H0V2.25A2.25 2.25 0 0 1 2.25 0h20.095c1.002 0 1.504 1.212.795 1.92L10.764 14.298h3.486V12.75h1.5v1.922a1.125 1.125 0 0 1-1.125 1.125H9.264l-2.578 2.578h11.689V9h1.5v9.375a1.5 1.5 0 0 1-1.5 1.5H5.185L2.562 22.5H21.75a.75.75 0 0 0 .75-.75V5.25H24v16.5A2.25 2.25 0 0 1 21.75 24H1.655C.653 24 .151 22.788.86 22.08L13.19 9.75H9.75v1.5h-1.5V9.375A1.125 1.125 0 0 1 9.375 8.25h5.314l2.625-2.625H5.625V15h-1.5V5.625a1.5 1.5 0 0 1 1.5-1.5h13.19L21.438 1.5z" />
	</svg>
);

const itermLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="currentColor">
		<path d="M24 5.359v13.282A5.36 5.36 0 0 1 18.641 24H5.359A5.36 5.36 0 0 1 0 18.641V5.359A5.36 5.36 0 0 1 5.359 0h13.282A5.36 5.36 0 0 1 24 5.359m-.932-.233A4.196 4.196 0 0 0 18.874.932H5.126A4.196 4.196 0 0 0 .932 5.126v13.748a4.196 4.196 0 0 0 4.194 4.194h13.748a4.196 4.196 0 0 0 4.194-4.194zm-.816.233v13.282a3.613 3.613 0 0 1-3.611 3.611H5.359a3.613 3.613 0 0 1-3.611-3.611V5.359a3.613 3.613 0 0 1 3.611-3.611h13.282a3.613 3.613 0 0 1 3.611 3.611M8.854 4.194v6.495h.962V4.194zM5.483 9.493v1.085h.597V9.48q.283-.037.508-.133.373-.165.575-.448.208-.284.208-.649a.9.9 0 0 0-.171-.568 1.4 1.4 0 0 0-.426-.388 3 3 0 0 0-.544-.261 32 32 0 0 0-.545-.209 1.8 1.8 0 0 1-.426-.216q-.164-.12-.164-.284 0-.223.179-.351.18-.126.485-.127.344 0 .575.105.239.105.5.298l.433-.5a2.3 2.3 0 0 0-.605-.433 1.6 1.6 0 0 0-.582-.159v-.968h-.597v.978a2 2 0 0 0-.477.127 1.2 1.2 0 0 0-.545.411q-.194.268-.194.634 0 .335.164.56.164.224.418.38a4 4 0 0 0 .552.262q.291.104.545.209.261.104.425.238a.39.39 0 0 1 .165.321q0 .225-.187.359-.18.134-.537.134-.381 0-.717-.134a4.4 4.4 0 0 1-.649-.351l-.388.589q.209.173.477.306.276.135.575.217.191.046.373.064" />
	</svg>
);

const warpLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="currentColor">
		<path d="M12.035 2.723h9.253A2.712 2.712 0 0 1 24 5.435v10.529a2.712 2.712 0 0 1-2.712 2.713H8.047Zm-1.681 2.6L6.766 19.677h5.598l-.399 1.6H2.712A2.712 2.712 0 0 1 0 18.565V8.036a2.712 2.712 0 0 1 2.712-2.712Z" />
	</svg>
);

const ghosttyLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="currentColor">
		<path d="M12 0C6.7 0 2.4 4.3 2.4 9.6v11.146c0 1.772 1.45 3.267 3.222 3.254a3.18 3.18 0 0 0 1.955-.686 1.96 1.96 0 0 1 2.444 0 3.18 3.18 0 0 0 1.976.686c.75 0 1.436-.257 1.98-.686.715-.563 1.71-.587 2.419-.018.59.476 1.355.743 2.182.699 1.705-.094 3.022-1.537 3.022-3.244V9.601C21.6 4.3 17.302 0 12 0M6.069 6.562a1 1 0 0 1 .46.131l3.578 2.065v.002a.974.974 0 0 1 0 1.687L6.53 12.512a.975.975 0 0 1-.976-1.687L7.67 9.602 5.553 8.38a.975.975 0 0 1 .515-1.818m7.438 2.063h4.7a.975.975 0 1 1 0 1.95h-4.7a.975.975 0 0 1 0-1.95" />
	</svg>
);

export const finderLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
		<rect x="3" y="3" width="18" height="18" rx="4.5" stroke="currentColor" strokeWidth="1.5" />
		<path
			d="M13.75 3.1c-1.7 3.3-1.8 6.9-.35 9.2-2 2.1-2.5 5.7-2.1 8.6"
			stroke="currentColor"
			strokeWidth="1.5"
		/>
		<path d="M7.75 8.75v2.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		<path d="M16.25 8.75v2.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		<path
			d="M6.75 15c2.7 2.6 7.8 2.6 10.5 0"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
		/>
	</svg>
);

export const folderLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
		<path
			d="M3.75 6.75c0-.55.45-1 1-1h4.53l1.9 1.9h8.07c.55 0 1 .45 1 1v8.6c0 .55-.45 1-1 1H4.75c-.55 0-1-.45-1-1V6.75Z"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinejoin="round"
		/>
	</svg>
);

export const appleTerminalLogo = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
		<rect x="3" y="3.75" width="18" height="16.5" rx="3" stroke="currentColor" strokeWidth="1.5" />
		<path
			d="M7 9l3.25 2.75L7 14.5"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path d="M12.75 15.25h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
	</svg>
);

/* Antigravity has no reliable vector mark yet; it falls back to the generic
   code glyph in the menu. */
export const editorLogos: Partial< Record< SupportedEditor, ReactElement > > = {
	vscode: vscodeLogo,
	cursor: cursorLogo,
	phpstorm: phpstormLogo,
	webstorm: webstormLogo,
	windsurf: windsurfLogo,
	sublime: sublimeLogo,
	zed: zedLogo,
};

export const terminalLogos: Record< SupportedTerminal, ReactElement > = {
	terminal: appleTerminalLogo,
	iterm: itermLogo,
	warp: warpLogo,
	ghostty: ghosttyLogo,
};
