import { createRequire as __bundleCreateRequire } from 'node:module';
const require = __bundleCreateRequire(import.meta.url);
var t="window.__name = window.__name || function (f) { return f; };";async function a(e,n={width:1440,height:900}){let i=await e.newPage({viewport:n});return await i.addInitScript(t),i}async function r(e){await e.addInitScript(t)}export{a,r as b};
