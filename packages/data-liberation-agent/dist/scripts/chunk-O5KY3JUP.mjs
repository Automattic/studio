import { createRequire as __bundleCreateRequire } from 'node:module';
const require = __bundleCreateRequire(import.meta.url);
async function s(e,o,i){let r=new Array(e.length),n=0,m=async()=>{for(let t=n++;t<e.length;t=n++)r[t]=await i(e[t],t)},a=Math.max(1,Math.min(Math.floor(o)||1,e.length||1));return await Promise.all(Array.from({length:a},()=>m())),r}async function l(e,o,i){let r,n=new Promise((m,a)=>{r=setTimeout(()=>a(new Error(`${i} timed out after ${o}ms`)),o)});try{return await Promise.race([e,n])}finally{r&&clearTimeout(r)}}export{s as a,l as b};
