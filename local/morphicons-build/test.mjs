import assert from 'node:assert/strict';
import {createMorph} from 'morphicons/dom';
let now=0,next=0;
const frames=new Map();
const preference={matches:false,addEventListener(){},removeEventListener(){}};
globalThis.matchMedia=()=>preference;
globalThis.window={matchMedia:globalThis.matchMedia};
globalThis.performance={now:()=>now};
globalThis.requestAnimationFrame=callback=>{frames.set(++next,callback);return next;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
function tick(count){for(let i=0;i<count;i++){now+=1000/60;const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(now));}}
function target(){const attrs={};return {attrs,setAttribute:(key,value)=>{attrs[key]=value;},removeAttribute:key=>delete attrs[key]};}
const menu='M4 6h16M4 12h16M4 18h16',close='M6 6l12 12M18 6L6 18';
const path=target(),driver=createMorph(path,menu,{reducedMotion:'user'});
driver.set(close);const expected=path.attrs.d;driver.set(menu);
driver.morphTo(close,{stiffness:600,damping:48});
assert(frames.size>0,'A state change should schedule animation frames.');
tick(4);assert(!/NaN|Infinity/.test(path.attrs.d));
tick(150);assert.equal(path.attrs.d,expected,'Animation must settle at the requested shape.');
driver.morphTo(menu);tick(3);driver.morphTo(close);tick(150);
assert.equal(path.attrs.d,expected,'Fast repeated clicks must settle at the latest state.');
driver.destroy();tick(2);assert.equal(frames.size,0,'Destroyed drivers must not keep rendering.');
preference.matches=true;
const reducedPath=target(),reduced=createMorph(reducedPath,menu,{reducedMotion:'user'});
reduced.morphTo(close,{stiffness:600,damping:48});
assert.equal(reducedPath.attrs.d,expected,'Reduced motion should switch immediately.');
assert.equal(frames.size,0,'Reduced motion should not schedule animation frames.');
reduced.destroy();
console.log('PASS: Morphicons animates, settles, handles rapid changes, cleans up and respects reduced motion.');
