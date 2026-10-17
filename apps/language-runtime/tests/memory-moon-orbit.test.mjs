import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chooseMoonShip, moonOrbitPose, createMoonOrbit } from "../static/review/memory-moon-orbit.mjs";

const catalog = {
  "/assets/ships/ship%20(1).png": { category: "ship", description: "First craft", orientation: { heading_degrees: 155 } },
  "/assets/ships/ship%20(2).png": { category: "ship", description: "Second craft", orientation: { heading_degrees: 180 } },
};
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, message || `${actual} should equal ${expected}`);
const wrap = angle => (angle % 360 + 360) % 360;

test("ship selection preserves authoritative encoded paths and headings", async () => {
  const metadata = JSON.parse(await readFile(new URL("../../launcher/static/assets/ships/meta.json", import.meta.url)));
  const entries = Object.entries(metadata);
  assert.ok(entries.length > 0);
  for (let index = 0; index < entries.length; index++) {
    const [href, source] = entries[index];
    const selected = chooseMoonShip(metadata, { random: () => (index + 0.1) / entries.length });
    assert.equal(selected.href, href);
    assert.equal(selected.headingDegrees, source.orientation.heading_degrees);
  }
  assert.equal(chooseMoonShip(catalog, { random: () => 1 }).href, Object.keys(catalog)[1]);
  assert.equal(chooseMoonShip(catalog, { random: () => -1 }).href, Object.keys(catalog)[0]);
});

test("missing headings and invalid assets are excluded without guessing orientation", () => {
  const invalid = {
    "/assets/ships/no-heading.png": { category: "ship" },
    "/assets/ships/bad-heading.png": { category: "ship", orientation: { heading_degrees: 360 } },
    "/assets/ships/%2e%2e%2fother.png": { category: "ship", orientation: { heading_degrees: 0 } },
    "https://example.com/ship.png": { category: "ship", orientation: { heading_degrees: 0 } },
  };
  assert.equal(chooseMoonShip(invalid), null);
  assert.equal(chooseMoonShip(null), null);
  assert.equal(chooseMoonShip({ ...invalid, ...catalog }, { random: () => 0 }).headingDegrees, 155);
});

test("orbit travels around the tilted Moon and hides its entire rear half", () => {
  const tilt = -15 * Math.PI / 180;
  const front = moonOrbitPose(0, 155);
  near(front.x, 100 - 32 * Math.sin(tilt));
  near(front.y, 100 + 32 * Math.cos(tilt));
  near(front.scale, 1);
  assert.equal(front.visible, true);
  assert.equal(moonOrbitPose(0.2, 155).visible, true);
  assert.equal(moonOrbitPose(0.3, 155).visible, false);
  assert.equal(moonOrbitPose(0.5, 155).visible, false);
  assert.equal(moonOrbitPose(0.7, 155).visible, false);
  assert.equal(moonOrbitPose(0.8, 155).visible, true);
  assert.deepEqual(moonOrbitPose(1, 155), front);
});

test("rotation and optional mirror align each catalog heading with the flight tangent", () => {
  for (const heading of [0, 90, 145, 155, 180, 270]) {
    for (let index = 0; index < 40; index++) {
      const pose = moonOrbitPose(index / 40, heading);
      const artworkHeading = pose.mirror ? wrap(180 - heading) : heading;
      near(wrap(artworkHeading + pose.rotation), pose.heading);
      const alternative = wrap(pose.heading - (pose.mirror ? heading : wrap(180 - heading)) + 180) - 180;
      assert.ok(Math.abs(pose.rotation) <= Math.abs(alternative) + 1e-8, "choose the more upright equivalent pose");
    }
  }
  near(moonOrbitPose(0, 155).rotation, 10);
});

class Surface extends EventTarget {
  attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
}

function mount({ reduce = false, random = () => 0 } = {}) {
  const document = new Surface(), window = new Surface(), image = new Surface(), element = new Surface(), motion = new Surface();
  document.defaultView = window;
  document.hidden = false;
  motion.matches = reduce;
  const frames = new Map();
  let sequence = 0;
  const controller = createMoonOrbit({ element, image, document, reducedMotion: motion, random,
    requestFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
  });
  return { controller, document, window, image, element, motion, frames,
    load() { image.dispatchEvent(new Event("load")); },
    tick(time) {
      assert.equal(frames.size, 1);
      const [id, callback] = [...frames][0];
      frames.delete(id);
      callback(time);
    },
    visibility(hidden) { document.hidden = hidden; document.dispatchEvent(new Event("visibilitychange")); },
    reduce(value) { motion.matches = value; motion.dispatchEvent(new Event("change")); },
  };
}

test("loaded spacecraft stays opaque, circles once per twelve seconds, and hides behind the Moon", t => {
  const app = mount();
  t.after(() => app.controller.destroy());
  app.controller.select(catalog);
  assert.equal(app.frames.size, 0, "wait for artwork to load");
  assert.equal(app.element.getAttribute("visibility"), "hidden");
  assert.equal(app.image.getAttribute("href"), Object.keys(catalog)[0]);
  app.load();
  assert.equal(app.element.getAttribute("opacity"), "1");
  assert.equal(app.element.getAttribute("visibility"), "visible");
  app.tick(0);
  const initial = app.element.getAttribute("transform");
  app.tick(6000);
  assert.equal(app.element.getAttribute("visibility"), "hidden");
  app.tick(12000);
  assert.equal(app.element.getAttribute("visibility"), "visible");
  assert.notEqual(app.element.getAttribute("transform"), initial, "the next pass emerges on a different orbit plane");
});

const transformFor = pose => `translate(${pose.x} ${pose.y}) rotate(${pose.rotation}) scale(${pose.mirror ? -pose.scale : pose.scale} ${pose.scale})`;

test("new moons sample independent starting positions, planes and directions", t => {
  const values = [0, 0.12, 0.25, 0.9, 0, 0.82, 0.65, 0.1];
  const app = mount({ random: () => values.shift() });
  t.after(() => app.controller.destroy());
  app.controller.select(catalog);
  app.load();
  assert.equal(app.element.getAttribute("transform"), transformFor(moonOrbitPose(0.12, 155, { tiltDegrees: 90, direction: -1 })));
  app.controller.select(catalog);
  assert.equal(app.element.getAttribute("transform"), transformFor(moonOrbitPose(0.82, 155, { tiltDegrees: 234, direction: 1 })));
  assert.equal(values.length, 0);
});

test("reverse flight follows the tangent and keeps the rear half hidden for every orbit plane", () => {
  for (const tiltDegrees of [0, 45, 90, 210, 320]) {
    for (const direction of [-1, 1]) {
      for (const progress of [0.1, 0.4, 0.6, 0.9]) {
        const pose = moonOrbitPose(progress, 155, { tiltDegrees, direction });
        const next = moonOrbitPose(progress + 1e-7, 155, { tiltDegrees, direction });
        const derivative = wrap(Math.atan2(next.y - pose.y, next.x - pose.x) * 180 / Math.PI);
        assert.ok(Math.abs(wrap(pose.heading - derivative + 180) - 180) < 0.001);
        assert.equal(pose.visible, progress < 0.25 || progress > 0.75);
      }
    }
  }
});

test("each rear pass changes the emergence point without changing the craft or direction", t => {
  const values = [0, 0, 0, 0.9, 0.25];
  const app = mount({ random: () => values.shift() });
  t.after(() => app.controller.destroy());
  app.controller.select(catalog);
  app.load();
  app.tick(0);
  app.tick(6000);
  assert.equal(app.element.getAttribute("visibility"), "hidden");
  const geometry = { tiltDegrees: 112.5, direction: -1 };
  assert.equal(app.element.getAttribute("transform"), transformFor(moonOrbitPose(0.5, 155, geometry)));
  app.tick(10000);
  assert.equal(app.element.getAttribute("visibility"), "visible");
  assert.equal(app.element.getAttribute("transform"), transformFor(moonOrbitPose(0.5 + 4000 / 12000, 155, geometry)));
  assert.equal(app.image.getAttribute("href"), Object.keys(catalog)[0]);
  assert.equal(values.length, 0);
});

test("a frame skipping the entire rear arc defers the new plane until the ship is hidden", t => {
  const values = [0, 0, 0, 0, 0.5];
  const app = mount({ random: () => values.shift() });
  t.after(() => app.controller.destroy());
  app.controller.select(catalog);
  app.load();
  app.tick(0);
  app.tick(12000);
  assert.equal(app.element.getAttribute("transform"), transformFor(moonOrbitPose(0, 155, { tiltDegrees: 0, direction: 1 })));
  assert.equal(values.length, 1, "no visible course change after a long frame");
  app.tick(16000);
  assert.equal(app.element.getAttribute("visibility"), "hidden");
  assert.equal(app.element.getAttribute("transform"), transformFor(moonOrbitPose(4000 / 12000, 155, { tiltDegrees: 180, direction: 1 })));
  assert.equal(values.length, 0);
});

test("hidden page and explicit pause preserve orbit position without a clock jump", t => {
  const app = mount();
  t.after(() => app.controller.destroy());
  app.controller.select(catalog);
  app.load();
  app.tick(0);
  app.tick(1000);
  const position = app.element.getAttribute("transform"), stale = [...app.frames.values()][0];
  app.visibility(true);
  assert.equal(app.frames.size, 0);
  stale(100000);
  assert.equal(app.element.getAttribute("transform"), position);
  app.visibility(false);
  app.visibility(false);
  assert.equal(app.frames.size, 1);
  app.tick(100000);
  assert.equal(app.element.getAttribute("transform"), position);
  app.controller.pause();
  app.visibility(true);
  app.visibility(false);
  assert.equal(app.frames.size, 0, "visibility cannot override explicit pause");
  app.controller.resume();
  assert.equal(app.frames.size, 1);
});

test("pagehide pauses through visibility changes and pageshow resumes a single loop", t => {
  const app = mount();
  t.after(() => app.controller.destroy());
  app.controller.select(catalog);
  app.load();
  app.window.dispatchEvent(new Event("pagehide"));
  app.visibility(false);
  app.controller.resume();
  assert.equal(app.frames.size, 0);
  app.window.dispatchEvent(new Event("pageshow"));
  app.window.dispatchEvent(new Event("pageshow"));
  assert.equal(app.frames.size, 1);
});

test("reduced motion uses a static visible craft even when enabled during the rear arc", t => {
  const app = mount({ reduce: true });
  t.after(() => app.controller.destroy());
  app.controller.select(catalog);
  app.load();
  assert.equal(app.frames.size, 0);
  assert.equal(app.element.getAttribute("visibility"), "visible");
  app.visibility(true);
  app.visibility(false);
  assert.equal(app.frames.size, 0);
  app.reduce(false);
  app.tick(0);
  app.tick(6000);
  assert.equal(app.element.getAttribute("visibility"), "hidden");
  const stale = [...app.frames.values()][0];
  app.reduce(true);
  stale(12000);
  assert.equal(app.frames.size, 0);
  assert.equal(app.element.getAttribute("visibility"), "visible");
});

test("image errors hide artwork and a new selection can recover", t => {
  const app = mount();
  t.after(() => app.controller.destroy());
  app.controller.select(catalog);
  app.load();
  app.image.dispatchEvent(new Event("error"));
  assert.equal(app.frames.size, 0);
  assert.equal(app.element.getAttribute("visibility"), "hidden");
  app.controller.select(catalog);
  app.load();
  assert.equal(app.frames.size, 1);
  app.controller.select({});
  app.load();
  assert.equal(app.frames.size, 0);
  assert.equal(app.element.getAttribute("visibility"), "hidden");
});

test("selecting the same cached craft starts a new orbit without waiting for another load", t => {
  const app = mount();
  t.after(() => app.controller.destroy());
  app.controller.select(catalog);
  app.load();
  app.tick(0);
  const initial = app.element.getAttribute("transform");
  app.tick(6000);
  assert.equal(app.element.getAttribute("visibility"), "hidden");
  app.controller.select(catalog);
  assert.equal(app.frames.size, 1);
  assert.equal(app.element.getAttribute("visibility"), "visible");
  assert.equal(app.element.getAttribute("transform"), initial);
});

test("destroy prevents stale frames and all lifecycle events from restarting motion", () => {
  const app = mount();
  app.controller.select(catalog);
  app.load();
  const stale = [...app.frames.values()][0];
  app.controller.destroy();
  app.controller.destroy();
  stale(12000);
  app.window.dispatchEvent(new Event("pageshow"));
  app.visibility(false);
  app.reduce(false);
  app.load();
  app.controller.resume();
  assert.equal(app.controller.select(catalog), null);
  assert.equal(app.frames.size, 0);
  assert.equal(app.element.getAttribute("visibility"), "hidden");
});
