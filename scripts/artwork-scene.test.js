import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {engine} from './test-support/theme-fixtures.js';

test('a cached artwork waits for the room before revealing the scene, including failed backgrounds', async () => {
  for (const event of ['load', 'error']) {
    const {window, document} = parseHTML('<div data-artwork-scene><img data-room><frame-preview><img data-art></frame-preview></div>');
    const room = document.querySelector('[data-room]');
    const art = document.querySelector('[data-art]');
    Object.defineProperty(room, 'complete', {value: false});
    Object.defineProperty(art, 'complete', {value: true});
    art.decode = async () => {};
    room.decode = async () => { if (event === 'error') throw Error('Unavailable'); };
    vm.runInNewContext(fs.readFileSync('assets/frame-preview.js','utf8'), {window, document, HTMLElement:window.HTMLElement, customElements:window.customElements});
    const scene = document.querySelector('[data-artwork-scene]');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(scene.hasAttribute('data-scene-ready'), false);
    room.dispatchEvent(new window.Event(event));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(scene.hasAttribute('data-scene-ready'), true);
  }
});

test('large room media opts into a larger mount while ordinary rooms retain their placement', async () => {
  const liquid=engine();
  const master={src:'/master.png',width:1024,height:1536};
  for(const [alt,placement] of [['scene-room-desktop-v3','left:20%;top:16%;width:60%;height:50%;'],['scene-room-large-v2','left:18%;top:18%;width:64%;height:44%;'],['scene-room-desktop-v2','left:20%;top:8%;width:60%;height:78%;'],['scene-room-desktop-v1','left:28%;top:20%;width:44%;height:50%;'],['scene-room-v1','left:23%;top:14%;width:54%;height:44%;'],['scene-room-large-v1','left:10%;top:0%;width:80%;height:78%;']]) {
    const html=await liquid.renderFile('artwork-scene',{room:{src:'/room.png',width:1254,height:1254,alt},master,frame:'Oak Float Frame'});
    const {document}=parseHTML(html);
    assert.ok(document.querySelector('frame-preview').getAttribute('style').includes(placement));
    assert.equal(document.querySelector('[data-frame-box]').dataset.frame,'oak');
    assert.equal(document.querySelector('.frame-art-image').getAttribute('src'),'/master.png');
    assert.equal(Number(document.querySelector('.frame-art-image').getAttribute('width'))/Number(document.querySelector('.frame-art-image').getAttribute('height')),2/3);
  }
});

test('lightbox clones the selected framed scene and restores plain detail images', () => {
  const {window, document} = parseHTML(`<div class="shopify-section"><button data-gallery-slide><div data-artwork-scene><div data-frame-box data-frame="silver"></div></div></button><button data-gallery-slide><img></button><image-lightbox class="hidden"><div data-lightbox-stage><img data-lightbox-current></div><script data-lightbox-images>[{"src":"room","width":100,"height":100},{"src":"detail","width":100,"height":100}]</script></image-lightbox></div>`);
  window.theme = {lockScroll(){},trapFocus(){},sameSection(){return true;}};
  vm.runInNewContext(fs.readFileSync('assets/lightbox.js','utf8'), {window,document,HTMLElement:window.HTMLElement,customElements:window.customElements});
  const lightbox=document.querySelector('image-lightbox');
  lightbox.open(0);
  assert.equal(lightbox.img.querySelector('[data-frame-box]').dataset.frame,'silver');
  assert.equal(lightbox.originalImg.style.display,'none');
  lightbox.jumpTo(1);
  assert.equal(lightbox.img,lightbox.originalImg);
  assert.equal(lightbox.img.src,'detail');
  assert.equal(lightbox.stage.querySelector('[data-artwork-scene]'),null);
});

test('variant changes retain the active room scene but return plain details to the master', () => {
  const {window, document} = parseHTML('<product-gallery><div data-gallery-track><div data-gallery-slide></div><div data-gallery-slide><div data-artwork-scene></div></div></div></product-gallery>');
  window.theme = {sameSection: () => true};
  vm.runInNewContext(fs.readFileSync('assets/product-gallery.js','utf8'), {window,document,HTMLElement:window.HTMLElement,customElements:window.customElements});
  const gallery = document.querySelector('product-gallery');
  const calls = [];
  gallery.goTo = index => calls.push(index);
  gallery.active = 1;
  window.dispatchEvent(new window.CustomEvent('variant:change', {detail:{frame:'Black Float Frame'}}));
  assert.deepEqual(calls, []);
  gallery.active = 0;
  window.dispatchEvent(new window.CustomEvent('variant:change', {detail:{frame:'Oak Float Frame'}}));
  assert.deepEqual(calls, [0]);
  gallery.active = 1;
  window.dispatchEvent(new window.CustomEvent('variant:change', {detail:{frame:'Black Float Frame',selectedOption:'Frame'}}));
  assert.deepEqual(calls, [0,0]);
  window.dispatchEvent(new window.CustomEvent('variant:change', {detail:{frame:'Black Float Frame',selectedOption:'FRAME'}}));
  assert.deepEqual(calls, [0,0,0], 'reselecting the same frame also reveals master');
  window.theme.sameSection = () => false;
  window.dispatchEvent(new window.CustomEvent('variant:change', {detail:{source:{},selectedOption:'Frame'}}));
  assert.deepEqual(calls, [0,0,0], 'other product sections remain unchanged');

});

test('baked-frame scenes ship ready and never wait on a missing frame-preview', async () => {
  const liquid=engine();
  for (const alt of ['composed-framed-scene-desktop-v1','composed-framed-scene-1-v1']) {
    const html=await liquid.renderFile('artwork-scene',{room:{src:'/room.png',width:2016,height:864,alt,aspect_ratio:2016/864},master:{src:'/master.png',width:1024,height:1536},frame:'Oak Float Frame'});
    const {document}=parseHTML(html);
    const scene=document.querySelector('[data-artwork-scene]');
    assert.equal(scene.getAttribute('data-scene-layout'),alt);
    assert.ok(scene.hasAttribute('data-scene-ready'),'baked scenes must not sit under the opacity:0 reveal veil');
    assert.equal(document.querySelector('frame-preview'),null);
    assert.equal((html.match(/<img /g)||[]).length,1);
  }
});

test('composite scenes still wait for the reveal marker set by frame-preview', () => {
  const scene=fs.readFileSync('snippets/artwork-scene.liquid','utf8');
  const baked=scene.indexOf("contains 'composed-framed-'");
  const ready=scene.indexOf('data-scene-ready',baked);
  const unframed=scene.indexOf("contains 'composed-unframed-'");
  assert.ok(baked>-1&&ready>-1&&ready<unframed,'only the baked branch ships data-scene-ready');
});

test('room compositions use the source master and the common frame renderer', () => {
  const scene=fs.readFileSync('snippets/artwork-scene.liquid','utf8');
  assert.ok(scene.includes("render 'frame-preview', master: master"));
  assert.ok(scene.includes('frame: frame'));
  const product=fs.readFileSync('sections/main-product.liquid','utf8');
  assert.equal((product.match(/m.alt == 'scene-room-v1'/g)||[]).length,3);
});
