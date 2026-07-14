import { createRequire as __bundleCreateRequire } from 'node:module';
const require = __bundleCreateRequire(import.meta.url);
function e(t){return`${t} contains a Custom HTML block. Use existing WordPress core blocks first; create a custom block when needed, and move CSS into style.css instead of wp:html.`}var o="lib-coverage-island",r=`<!-- wp:html {"metadata":{"name":"${o}"}} -->`,s=/<!--\s*wp:(?:core\/)?html(?=[\s/]|-->)[\s\S]*?(?:-->|$)/gi;function c(t){for(let n of t.matchAll(s))if(!n[0].includes(`"name":"${o}"`))return!0;return!1}export{e as a,r as b,c};
