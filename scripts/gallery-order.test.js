import vm from 'node:vm';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {parseHTML} from 'linkedom';import {engine} from './test-support/theme-fixtures.js';
test('PDP leads with large scene, then master, with matching lightbox payload and legacy fallback',async()=>{
 const source=fs.readFileSync('sections/main-product.liquid','utf8');
 const setup=source.slice(source.indexOf('  assign master ='),source.indexOf('-%}',source.indexOf('  assign master =')));
 const gallery=source.match(/<product-gallery[\s\S]*?<\/product-gallery>/)[0];
 const payload=source.match(/<script type="application\/json" data-lightbox-images>[\s\S]*?<\/script>/)[0];
 const master={id:1,alt:'master',media_type:'image',src:'/master.png',width:100,height:100};const detail={...master,id:2,alt:'detail',src:'/detail.png'};const large={...master,id:3,alt:'scene-room-large-v1',src:'/large.png',width:300,height:400,aspect_ratio:.75};
  for(const largeAlt of ['scene-room-large-v1','scene-room-large-v2','composed-unframed-scene-3-v1','composed-framed-scene-3-v1'])for(const hasDesktop of [true,false])for(const hasLarge of [true,false]){large.alt=largeAlt;const liquid=engine();liquid.registerFilter('placeholder_svg_tag',()=> '');const html=await liquid.parseAndRender(`{% liquid ${setup} %}${gallery}${payload}`,{product:{metafields:{custom:{scene_layouts:{value:{[largeAlt]:{profile:'composed-frames-v1',left:.3,top:.15,right:.7,bottom:.65}}}}},title:'Test',media:[...(hasLarge?[detail,large,master]:[detail,master]),...(hasDesktop?[{...large,id:4,alt:'scene-room-desktop-v1',src:'/desktop.png'}]:[])],featured_media:detail},section:{settings:{gallery_ratio:1}},frame_val:'Oak Float Frame'});const {document}=parseHTML(html);const slides=[...document.querySelectorAll('[data-gallery-slide]')];if(hasLarge&&largeAlt==='composed-unframed-scene-3-v1'){assert.ok(slides[0].querySelector('[data-composed-frame]'));assert.equal(slides[0].querySelectorAll('img').length,1);}if(hasLarge&&largeAlt==='composed-framed-scene-3-v1'){assert.ok(slides[0].querySelector('[data-artwork-scene]'),'baked scenes ship ready and render their own image');assert.equal(slides[0].querySelectorAll('img').length,1);}assert.equal(slides.length,hasLarge?3:2);assert.equal(!!slides[0].querySelector('[data-artwork-scene]'),hasLarge);assert.equal(slides[hasLarge?1:0].querySelector('.frame-art-image').getAttribute('src'),'/master.png');assert.deepEqual(JSON.parse(document.querySelector('[data-lightbox-images]').textContent).map(x=>x.src),hasLarge?['/large.png','/master.png','/detail.png']:['/master.png','/detail.png']);assert.equal(document.querySelectorAll('[data-gallery-thumb]:not([data-gallery-dot])').length,slides.length);}
});

test('the back button closes the viewer instead of leaving it over the page',()=>{
 const {window,document}=parseHTML(`<div class="shopify-section"><image-lightbox class="hidden"><div data-lightbox-stage><img data-lightbox-current></div><script data-lightbox-images>[{"src":"a"},{"src":"b"}]</script></image-lightbox></div>`);
 window.theme={lockScroll(){},trapFocus(){}};
 const calls=[];
 window.history={state:null,pushState(){calls.push('push');},back(){calls.push('back');}};
 vm.runInNewContext(fs.readFileSync('assets/lightbox.js','utf8'),{window,document,HTMLElement:window.HTMLElement,customElements:window.customElements});
 const l=document.querySelector('image-lightbox');
 l.open(0);assert.equal(l.classList.contains('hidden'),false);assert.deepEqual(calls,['push'],'opening owns one history entry');
 l.open(1);assert.deepEqual(calls,['push'],'a second open must not stack another entry');
 window.dispatchEvent(new window.Event('popstate'));
 assert.equal(l.classList.contains('hidden'),true,'a back press must close the viewer');
 assert.deepEqual(calls,['push'],'the back press already consumed the entry');
 l.open(0);l.close();
 assert.deepEqual(calls,['push','push','back'],'closing from the page consumes its own entry');
 l.close();assert.deepEqual(calls,['push','push','back'],'closing twice must not go back twice');
 // A viewer without the History API still opens and closes.
 const plain=parseHTML(`<div class="shopify-section"><image-lightbox class="hidden"><div data-lightbox-stage><img data-lightbox-current></div><script data-lightbox-images>[{"src":"a"}]</script></image-lightbox></div>`);
 plain.window.theme={lockScroll(){},trapFocus(){}};
 vm.runInNewContext(fs.readFileSync('assets/lightbox.js','utf8'),{window:plain.window,document:plain.document,HTMLElement:plain.window.HTMLElement,customElements:plain.window.customElements});
 const bare=plain.document.querySelector('image-lightbox');
 bare.open(0);bare.close();assert.equal(bare.classList.contains('hidden'),true);
});

test('responsive gallery keeps logical indices across desktop/mobile and lightbox wrapping',()=>{
 const {window,document}=parseHTML(`<div class="shopify-section"><product-gallery data-desktop-skip-lead><div data-gallery-track>${[0,1,2,3].map(()=>'<button data-gallery-slide></button>').join('')}</div><span data-gallery-count></span></product-gallery><image-lightbox class="hidden"><div data-lightbox-stage><img data-lightbox-current></div><script data-lightbox-images>[{"src":"scene"},{"src":"master"},{"src":"detail"},{"src":"room"}]</script></image-lightbox></div>`);
 let change;const mq={matches:true,addEventListener(t,fn){change=fn;},removeEventListener(){}};
 window.matchMedia=()=>mq;window.theme={lockScroll(){},trapFocus(){}};
 const track=document.querySelector('[data-gallery-track]');Object.defineProperty(track,'clientWidth',{value:500});let left;track.scrollTo=o=>{left=o.left;};
 for(const name of ['product-gallery','lightbox'])vm.runInNewContext(fs.readFileSync('assets/'+name+'.js','utf8'),{window,document,HTMLElement:window.HTMLElement,customElements:window.customElements});
 const g=document.querySelector('product-gallery'),l=document.querySelector('image-lightbox');
 assert.deepEqual([...g.visibleIndices],[1,2,3]);assert.equal(g.active,1);g.move(1);assert.equal(left,500);
 l.open(1);l.jumpTo(0);assert.equal(l.active,3);l.jumpTo(4);assert.equal(l.active,1);l.jumpTo(3);assert.equal(l.active,3);
 mq.matches=false;change();assert.equal(left,500);assert.deepEqual([...g.visibleIndices],[0,1,2,3]);l.jumpTo(0);assert.equal(l.active,0);
 g.active=0;mq.matches=true;change();assert.equal(g.active,1);assert.equal(left,0);assert.equal(document.querySelector('[data-gallery-count]').textContent,'1 / 3');
});

test('gallery arrows wrap visible slides in both directions and hide only for one image',()=>{
 const {window,document}=parseHTML(`<product-gallery data-desktop-skip-lead><div data-gallery-track><div data-gallery-slide></div><div data-gallery-slide></div><div data-gallery-slide></div></div><button data-gallery-prev></button><button data-gallery-next></button><span data-gallery-count></span></product-gallery>`);
 const mq={matches:true,addEventListener(){},removeEventListener(){}};window.matchMedia=()=>mq;
 const track=document.querySelector('[data-gallery-track]');Object.defineProperty(track,'clientWidth',{value:500});let left;track.scrollTo=o=>{left=o.left;};
 vm.runInNewContext(fs.readFileSync('assets/product-gallery.js','utf8'),{window,document,HTMLElement:window.HTMLElement,customElements:window.customElements});
 const gallery=document.querySelector('product-gallery');
 for(const desktop of [true,false]){
  mq.matches=desktop;gallery.active=2;gallery.updateControls();
  assert.equal(gallery.next.style.display,'');gallery.next.click();assert.equal(left,0,'last advances to first visible slide');
  gallery.active=desktop?1:0;gallery.updateControls();
  assert.equal(gallery.prev.style.display,'');gallery.prev.click();assert.equal(left,desktop?500:1000,'first returns to last visible slide');
 }
 mq.matches=false;track.innerHTML='<div data-gallery-slide></div>';gallery.active=0;gallery.updateControls();
 assert.equal(gallery.prev.style.display,'none');assert.equal(gallery.next.style.display,'none');
});
