import { createRequire as __bundleCreateRequire } from 'node:module';
const require = __bundleCreateRequire(import.meta.url);
import{chromium as i}from"playwright";var[,,w,o,r]=process.argv,c=Number(r||1008),e=await i.launch(),t=await e.newPage({viewport:{width:c,height:900}});await t.goto(w,{waitUntil:"networkidle",timeout:6e4}).catch(()=>{});for(let a=0;a<6e3;a+=700)await t.mouse.wheel(0,700),await t.waitForTimeout(120);await t.keyboard.press("Home").catch(()=>{});await t.waitForTimeout(2e3);await t.screenshot({path:o,fullPage:!0,timeout:6e4});await e.close();console.log("wrote",o);
