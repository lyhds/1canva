import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {renderSection,context} from './test-support/theme-fixtures.js';

test('header responds to scroll direction, restores top state, and keeps open menus stable', () => {
  const {window,document}=parseHTML('<html><body><mobile-drawer><button data-drawer-open data-menu-index="0"></button><div data-drawer-overlay></div><div data-drawer-panel inert><details data-menu-group="0"></details></div></mobile-drawer></body></html>');
  window.scrollY=0;window.innerWidth=390;
  window.theme={lockScroll(on){document.documentElement.style.overflow=on?'hidden':'';},trapFocus(){}};
  vm.runInNewContext(fs.readFileSync('assets/header.js','utf8'),{window,document,HTMLElement:window.HTMLElement,customElements:window.customElements});
  const header=document.querySelector('mobile-drawer');
  const scroll=y=>{window.scrollY=y;window.dispatchEvent(new window.Event('scroll'));};
  scroll(100);assert.ok(header.hasAttribute('data-scroll-down'));assert.ok(header.hasAttribute('data-scrolled'));
  scroll(80);assert.equal(header.hasAttribute('data-scroll-down'),false);
  header.open(header.querySelector('button'));assert.equal(header.panel.inert,false);assert.equal(document.documentElement.style.overflow,'hidden');
  scroll(160);assert.equal(header.hasAttribute('data-scroll-down'),false);
  header.close();assert.equal(header.panel.inert,true);assert.equal(document.documentElement.style.overflow,'');
  scroll(0);assert.equal(header.hasAttribute('data-scrolled'),false);assert.equal(header.hasAttribute('data-scroll-down'),false);
  header.open();window.dispatchEvent(new window.Event('resize'));assert.equal(header.classList.contains('is-open'),false);
  header.remove();scroll(200);assert.equal(header.hasAttribute('data-scrolled'),false);
});

test('header preserves merchant links and limits optional announcement to the homepage',async()=>{
  for(const type of ['index','product']){
    const ctx={...context(),request:{page_type:type}};
    const html=await renderSection('header',ctx,{home_notice:'An existing store announcement',menu:{links:[{title:'Shop',url:'/collections/all-products',links:[{title:'Abstract',url:'/collections/abstract',links:[]}]}]}});
    const {document}=parseHTML(html);
    assert.equal(!!document.querySelector('[data-header-notice]'),type==='index');
    assert.ok(document.querySelector('[data-header-logo]'));
    assert.ok(document.querySelector('[data-mobile-menu-toggle]'));
    const panel=document.querySelector('[data-drawer-panel]');
    assert.ok(panel.hasAttribute('inert'));assert.equal(panel.getAttribute('role'),'dialog');
    assert.equal(document.querySelector('[data-mobile-menu-toggle]').getAttribute('aria-controls'),panel.id);
    assert.ok(panel.querySelector('a[href="/collections/abstract"]'));
    assert.ok(panel.querySelector('a[href="/collections/all-products"]'));
    assert.equal(panel.querySelector('[data-menu-feature]'),null);
  }
});

test('desktop menus expose only their branch and close on escape, outside click and resize',async()=>{
 const menu={links:[{title:'Shop',url:'/shop',links:[{title:'Subject',url:'/subject',links:[{title:'Abstract',url:'/abstract'}]}]},{title:'Collections',url:'/collections',links:[{title:'New',url:'/new',links:[]}]},{title:'Journal',url:'/journal',links:[]}]};
 const html=await renderSection('header',context(),{menu});const {window,document}=parseHTML('<html><body>'+html+'<button id="outside">Outside</button></body></html>');
 window.scrollY=0;window.innerWidth=1440;window.theme={lockScroll(){throw Error('desktop must not lock scrolling');},trapFocus(){throw Error('desktop must not trap focus');}};
 vm.runInNewContext(fs.readFileSync('assets/header.js','utf8'),{window,document,HTMLElement:window.HTMLElement,customElements:window.customElements});
 const header=document.querySelector('mobile-drawer'),menus=[...document.querySelectorAll('[data-desktop-menu]')];assert.equal(menus.length,2);
 const first=menus[0].querySelector('button'),second=menus[1].querySelector('button');
 first.click();assert.equal(first.getAttribute('aria-expanded'),'true');assert.equal(menus[0].querySelector('[data-desktop-menu-panel]').hidden,false);assert.equal(header.classList.contains('is-open'),false);
 assert.ok(menus[0].querySelector('a[href="/abstract"]'));assert.equal(menus[0].querySelector('a[href="/new"]'),null);
 second.click();assert.equal(first.getAttribute('aria-expanded'),'false');assert.equal(second.getAttribute('aria-expanded'),'true');
 let restored=false;second.focus=()=>{restored=true;};const escape=new window.Event('keydown',{bubbles:true});escape.key='Escape';second.dispatchEvent(escape);assert.equal(restored,true);assert.equal(header.hasAttribute('data-desktop-open'),false);
 first.click();document.querySelector('#outside').click();assert.equal(first.getAttribute('aria-expanded'),'false');
 first.click();window.dispatchEvent(new window.Event('resize'));assert.equal(first.getAttribute('aria-expanded'),'false');
 assert.ok(document.querySelector('.header-desktop-nav > a[href="/journal"]'));assert.equal(document.querySelector('.header-desktop-nav [data-drawer-open]'),null);
});

test('mouse hover opens desktop branches and cancels delayed closing when moving between menus',async()=>{
 const menu={links:['Shop','Collections'].map(title=>({title,url:'/',links:[{title:'Child',url:'/child'}]}))};
 const {window,document}=parseHTML('<html><body>'+await renderSection('header',context(),{menu})+'</body></html>');
 window.innerWidth=1440;window.scrollY=0;
 const timers=new Map();let id=0;window.setTimeout=fn=>{timers.set(++id,fn);return id;};window.clearTimeout=id=>timers.delete(id);
 vm.runInNewContext(fs.readFileSync('assets/header.js','utf8'),{window,document,HTMLElement:window.HTMLElement,customElements:window.customElements});
 const header=document.querySelector('mobile-drawer'),[first,second]=header.desktopMenus;
 const pointer=(menu,type,pointerType='mouse')=>{const event=new window.Event(type);event.pointerType=pointerType;menu.dispatchEvent(event);};
 pointer(first,'pointerenter','touch');assert.equal(header.activeDesktopMenu,undefined);
 pointer(first,'pointerenter');assert.equal(header.activeDesktopMenu,first);
 pointer(first,'pointerleave');assert.equal(header.activeDesktopMenu,first);assert.equal(timers.size,1);
 pointer(second,'pointerenter');assert.equal(header.activeDesktopMenu,second);assert.equal(timers.size,0);
 pointer(second,'pointerleave');for(const fn of [...timers.values()])fn();assert.equal(header.activeDesktopMenu,null);
 window.innerWidth=390;pointer(first,'pointerenter');assert.equal(header.activeDesktopMenu,null);
 window.innerWidth=1440;pointer(first,'pointerenter');pointer(first,'pointerleave');header.remove();assert.equal(timers.size,0);
});
