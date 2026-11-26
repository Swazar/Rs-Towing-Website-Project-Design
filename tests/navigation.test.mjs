import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { adaptServiceList } from '../public/assets/service-list.js';
import { LiquidNavigation } from '../public/assets/admin-navigation.js';

test('glass navigation retargets interrupted motion and snaps on reduced motion or resize', () => {
  const dom = new JSDOM('<nav><button aria-current="page">Overview</button><button>Enquiries</button><button>Website</button></nav>');
  const menu = dom.window.document.querySelector('nav');
  const buttons = [...menu.querySelectorAll('button')];
  let reduced = false, onMotionChange;
  dom.window.matchMedia = () => ({ get matches() { return reduced; }, addEventListener(type, callback) { onMotionChange = callback; }, removeEventListener() {} });
  menu.getBoundingClientRect = () => ({ left: 10, top: 20, width: 220, height: 180 });
  let horizontal = false;
  buttons.forEach((button, index) => { button.getBoundingClientRect = () => ({
    left: 10 + (horizontal ? index * 70 : 0) - menu.scrollLeft, top: 20 + (horizontal ? 0 : index * 63), width: horizontal ? 66 : 220, height: 56,
  }); });
  const navigation = new LiquidNavigation(menu), animations = [];
  navigation.glass.getBoundingClientRect = () => ({ left: 10, top: 50, width: 220, height: 60 });
  navigation.glass.animate = frames => {
    const animation = { frames, cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(animation); return animation;
  };
  navigation.select(buttons[0]);
  assert.equal(animations.length, 0, 'initial layout appears without an entrance animation');
  assert.equal(navigation.glass.getAttribute('aria-hidden'), 'true');
  navigation.select(buttons[1]);
  navigation.select(buttons[2]);
  assert.ok(animations.every(animation => animation.frames.every(frame => Object.keys(frame).every(key => key === 'transform'))), 'motion must stay transform-only to avoid layout and corner repainting');
  assert.equal(animations[0].cancelled, true, 'rapid selection cancels the previous flight');
  assert.match(animations[1].frames[0].transform, /30px/, 'the next flight starts from the current rendered position');
  animations[0].onfinish();
  assert.equal(menu.classList.contains('is-flowing'), true, 'a stale completion cannot interrupt the new flight');
  reduced = true; onMotionChange();
  assert.equal(animations[1].cancelled, true);
  assert.equal(menu.classList.contains('is-flowing'), false);
  assert.equal(navigation.glass.style.transform, 'translate3d(0px, 126px, 0px)');
  horizontal = true;
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(navigation.glass.style.transform, 'translate3d(140px, 0px, 0px)', 'a mobile layout change realigns the highlight');
  assert.equal(navigation.glass.style.width, '66px');
  menu.scrollLeft = 70;
  navigation.select(buttons[2], false);
  assert.equal(navigation.glass.style.transform, 'translate3d(140px, 0px, 0px)', 'scrolling the mobile row preserves the highlight in content coordinates');
  assert.equal(buttons[0].getAttribute('aria-current'), 'page', 'decoration never changes the accessible navigation state');
  navigation.destroy();
  assert.equal(menu.querySelector('.nav-liquid-glass'), null);
  dom.window.close();
});

test('resizing a published service preserves the heading, quote shortcut and keyboard focus', () => {
  const dom = new JSDOM('<section><article class="service-row"><h3>Vehicle hauling</h3><p>Local moves</p><a href="#contact">Get a quote</a></article></section>');
  const page = dom.window.document;
  let resize;
  const query = { matches: true, addEventListener(_type, listener) { resize = listener; } };
  dom.window.matchMedia = () => query;
  const list = page.querySelector('section');
  const heading = list.querySelector('h3');
  const quote = list.querySelector('a');
  adaptServiceList(list);
  const details = list.querySelector('details');
  assert.equal(details.open, false);
  assert.equal(details.querySelector('summary h3'), heading);
  heading.textContent = 'Updated service';
  details.open = true;
  quote.focus();
  query.matches = false;
  resize();
  assert.equal(list.querySelector('details'), null);
  assert.equal(list.querySelector('h3').textContent, 'Updated service');
  assert.equal(page.activeElement, quote);
  query.matches = true;
  resize();
  assert.equal(list.querySelector('details').open, true);
  assert.equal(page.activeElement, quote);
  dom.window.close();
});
