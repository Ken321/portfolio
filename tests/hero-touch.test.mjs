import test from 'node:test';
import assert from 'node:assert/strict';
import {bindHeroTouch,isEffectDrag} from '../src/hero-touch.js';
class Surface {
 listeners=new Map();
 addEventListener(n,fn){this.listeners.set(n,fn);}
 removeEventListener(n){this.listeners.delete(n);}
 emit(type,values={}){this.listeners.get(type)?.({type,pointerType:'touch',pointerId:1,clientX:10,clientY:10,...values});}
}
const wait=()=>new Promise(r=>setTimeout(r,25));
const cell={};const target={closest:()=>cell};
test('holding activates the touched digit and releasing restores idle',async()=>{
 const root=new Surface(),p={active:false};const dispose=bindHeroTouch(root,p,5);
 root.emit('pointerdown',{target});assert.equal(p.active,false);await wait();assert.equal(p.active,true);assert.equal(p.cell,cell);
 root.emit('pointerup');assert.equal(p.active,false);assert.equal(p.cell,null);dispose();
});
test('scroll, cancel and multiple fingers cannot leave a digit stuck active',async()=>{
 for(const event of [{type:'pointermove',clientY:40},{type:'pointercancel'},{type:'pointerdown',pointerId:2,target}]){
 const root=new Surface(),p={active:false};const dispose=bindHeroTouch(root,p,5);
 root.emit('pointerdown',{target});root.emit(event.type,event);await wait();assert.equal(p.active,false);dispose();
 }
});
test('mouse remains hover-driven; selection menus are blocked only in the hero',async()=>{
 const root=new Surface(),p={active:false};const dispose=bindHeroTouch(root,p,5);
 root.emit('pointerdown',{target,pointerType:'mouse'});await wait();assert.equal(p.active,false);
 let blocked=0;root.emit('contextmenu',{target,preventDefault:()=>blocked++});root.emit('contextmenu',{target:{closest:()=>null},preventDefault:()=>blocked++});assert.equal(blocked,1);dispose();
});
test('ken touch moves keep rendering; real scroll and ordinary page touches still pause',()=>{
 assert.equal(isEffectDrag({type:'touchmove',target}),true);
 assert.equal(isEffectDrag({type:'scroll',target}),false);
 assert.equal(isEffectDrag({type:'touchmove',target:{closest:()=>null}}),false);
});
