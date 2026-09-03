import vm from "node:vm";

function dataProperty(value) {
  return String(value).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}

function dataAttribute(value) {
  return String(value).replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function prepareEvent(event, target) {
  const prepared = event && typeof event === "object" ? event : { type: String(event || "") };
  if (!prepared.type) throw new TypeError("Fake DOM events require a type.");
  if (!prepared.target) prepared.target = target;
  prepared.currentTarget = target;
  prepared.defaultPrevented = Boolean(prepared.defaultPrevented);
  prepared.propagationStopped = false;
  prepared.immediatePropagationStopped = false;
  prepared.preventDefault ??= function preventDefault() {
    this.defaultPrevented = true;
  };
  prepared.stopPropagation ??= function stopPropagation() {
    this.propagationStopped = true;
  };
  prepared.stopImmediatePropagation ??= function stopImmediatePropagation() {
    this.propagationStopped = true;
    this.immediatePropagationStopped = true;
  };
  return prepared;
}

function splitSelectorList(selector) {
  const values = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "[" || character === "(") depth += 1;
    if (character === "]" || character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      values.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  values.push(selector.slice(start).trim());
  return values.filter(Boolean);
}

function selectorParts(selector) {
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index <= selector.length; index += 1) {
    const character = selector[index];
    if (character === "[" || character === "(") depth += 1;
    if (character === "]" || character === ")") depth -= 1;
    if ((character === undefined || /\s/u.test(character)) && depth === 0) {
      const part = selector.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  return parts;
}

export class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  assign(value) {
    this.values = new Set(String(value || "").split(/\s+/u).filter(Boolean));
  }

  add(...values) {
    values.forEach((value) => this.values.add(String(value)));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(String(value)));
  }

  contains(value) {
    return this.values.has(String(value));
  }

  toggle(value, force) {
    const enabled = force === undefined ? !this.contains(value) : Boolean(force);
    if (enabled) this.add(value);
    else this.remove(value);
    return enabled;
  }

  toString() {
    return [...this.values].join(" ");
  }
}

export class FakeElement {
  constructor(tagName = "div", registry = null) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.registry = registry;
    this.ownerDocument = registry?.document ?? null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {
      setProperty(name, value) { this[name] = String(value); },
      removeProperty(name) { delete this[name]; }
    };
    this.classList = new FakeClassList();
    this.childNodes = [];
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.open = false;
    this.value = "";
    this.returnValue = "";
    this.complete = false;
    this.naturalWidth = 0;
    this.tabIndex = 0;
    this.listeners = new Map();
    this.flatQueryScope = false;
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set className(value) {
    this.classList.assign(value);
  }

  get className() {
    return this.classList.toString();
  }

  set href(value) {
    this.setAttribute("href", value);
  }

  get href() {
    return this.getAttribute("href") || "";
  }

  set src(value) {
    this.setAttribute("src", value);
  }

  get src() {
    return this.getAttribute("src") || "";
  }

  set rel(value) {
    this.setAttribute("rel", value);
  }

  get rel() {
    return this.getAttribute("rel") || "";
  }

  set textContent(value) {
    const text = String(value ?? "");
    this.childNodes = text ? [{ nodeType: 3, nodeValue: text, parentElement: this }] : [];
    this.children = [];
  }

  get textContent() {
    return this.childNodes
      .map((node) => node.nodeType === 3 ? node.nodeValue : node.textContent)
      .join("");
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current === this.ownerDocument?.documentElement) return true;
      current = current.parentElement;
    }
    return false;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    const prepared = prepareEvent(event, this);
    for (const listener of this.listeners.get(prepared.type) || []) {
      prepared.currentTarget = this;
      listener.call(this, prepared);
      if (prepared.immediatePropagationStopped) break;
    }
    if (prepared.bubbles && !prepared.propagationStopped) {
      if (this.parentElement) this.parentElement.dispatchEvent(prepared);
      else this.ownerDocument?.dispatchEvent(prepared);
    }
    return !prepared.defaultPrevented;
  }

  append(...nodes) {
    for (const value of nodes) {
      const node = typeof value === "string"
        ? { nodeType: 3, nodeValue: value, parentElement: null }
        : value;
      if (!node) continue;
      node.parentElement?.removeChild?.(node);
      node.parentElement = this;
      if (node.nodeType === 1 && !node.ownerDocument) node.ownerDocument = this.ownerDocument;
      this.childNodes.push(node);
      if (node.nodeType === 1) this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  prepend(...nodes) {
    const prepared = nodes.map((value) => typeof value === "string"
      ? { nodeType: 3, nodeValue: value, parentElement: null }
      : value).filter(Boolean);
    for (const node of prepared) {
      node.parentElement?.removeChild?.(node);
      node.parentElement = this;
      if (node.nodeType === 1 && !node.ownerDocument) node.ownerDocument = this.ownerDocument;
    }
    this.childNodes.unshift(...prepared);
    this.children = this.childNodes.filter((node) => node.nodeType === 1);
  }

  removeChild(node) {
    this.childNodes = this.childNodes.filter((candidate) => candidate !== node);
    this.children = this.children.filter((candidate) => candidate !== node);
    if (node?.parentElement === this) node.parentElement = null;
    return node;
  }

  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentElement = null;
    this.childNodes = [];
    this.children = [];
    this.append(...nodes);
  }

  before(...nodes) {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.childNodes.indexOf(this);
    const prepared = nodes.filter(Boolean);
    for (const node of prepared) {
      node.parentElement?.removeChild?.(node);
      node.parentElement = parent;
      if (node.nodeType === 1 && !node.ownerDocument) node.ownerDocument = this.ownerDocument;
    }
    parent.childNodes.splice(index, 0, ...prepared);
    parent.children = parent.childNodes.filter((node) => node.nodeType === 1);
  }

  replaceWith(...nodes) {
    this.before(...nodes);
    this.remove();
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  contains(candidate) {
    if (candidate === this) return true;
    return this.children.some((child) => child.contains(candidate));
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  click() {
    this.dispatchEvent({ type: "click", bubbles: true });
  }

  reset() {}
  scrollTo() {}

  showModal() {
    this.open = true;
  }

  close(value = "") {
    this.open = false;
    this.returnValue = value;
    this.dispatchEvent({ type: "close" });
  }

  querySelector(selector) {
    return this.flatQueryScope
      ? this.registry?.querySelector(selector) || null
      : this.registry?.querySelector(selector, this) || null;
  }

  querySelectorAll(selector) {
    return this.flatQueryScope
      ? this.registry?.querySelectorAll(selector) || []
      : this.registry?.querySelectorAll(selector, this) || [];
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (this.registry?.matches(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  matches(selector) {
    return this.registry?.matches(this, selector) || false;
  }

  setAttribute(name, value) {
    const normalized = String(name);
    const text = String(value);
    this.attributes.set(normalized, text);
    if (normalized === "class") this.classList.assign(text);
    if (normalized === "id") this.registry?.register(this);
    if (normalized.startsWith("data-")) this.dataset[dataProperty(normalized.slice(5))] = text;
    if (normalized === "hidden") this.hidden = true;
    if (normalized === "disabled") this.disabled = true;
  }

  getAttribute(name) {
    const normalized = String(name);
    if (normalized === "class") return this.className || null;
    if (normalized.startsWith("data-")) {
      const property = dataProperty(normalized.slice(5));
      if (Object.prototype.hasOwnProperty.call(this.dataset, property)) return String(this.dataset[property]);
    }
    if (normalized === "hidden" && this.hidden) return "";
    if (normalized === "disabled" && this.disabled) return "";
    return this.attributes.get(normalized) ?? null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  removeAttribute(name) {
    const normalized = String(name);
    this.attributes.delete(normalized);
    if (normalized.startsWith("data-")) delete this.dataset[dataProperty(normalized.slice(5))];
    if (normalized === "hidden") this.hidden = false;
    if (normalized === "disabled") this.disabled = false;
  }

  toggleAttribute(name, force) {
    const enabled = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (enabled) this.setAttribute(name, "");
    else this.removeAttribute(name);
    return enabled;
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
  }

  animate() {
    return { finished: Promise.resolve() };
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName, this.registry);
    for (const [name, value] of this.attributes) clone.setAttribute(name, value);
    for (const [name, value] of Object.entries(this.dataset)) {
      clone.setAttribute(`data-${dataAttribute(name)}`, value);
    }
    if (deep) clone.append(...this.children.map((child) => child.cloneNode(true)));
    else clone.textContent = this.textContent;
    return clone;
  }
}

function matchesCompound(element, compound, registry) {
  let remaining = compound;
  const excluded = [...remaining.matchAll(/:not\(([^)]+)\)/gu)].map((match) => match[1]);
  remaining = remaining.replace(/:not\([^)]+\)/gu, "");
  if (excluded.some((selector) => registry.matches(element, selector))) return false;

  for (const match of remaining.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/gu)) {
    if (!element.hasAttribute(match[1])) return false;
    if (match[2] !== undefined && element.getAttribute(match[1]) !== match[2]) return false;
  }
  remaining = remaining.replace(/\[[^\]]+\]/gu, "");

  const id = /#([\w-]+)/u.exec(remaining)?.[1];
  if (id && element.id !== id) return false;
  remaining = remaining.replace(/#[\w-]+/gu, "");

  const classes = [...remaining.matchAll(/\.([\w-]+)/gu)].map((match) => match[1]);
  if (classes.some((className) => !element.classList.contains(className))) return false;
  remaining = remaining.replace(/\.[\w-]+/gu, "");

  const tagName = remaining.trim();
  return !tagName || tagName === "*" || element.tagName === tagName.toUpperCase();
}

export class FakeRegistry {
  constructor() {
    this.elements = [];
    this.byId = new Map();
    this.document = null;
  }

  create(tagName = "div") {
    const element = new FakeElement(tagName, this);
    element.ownerDocument = this.document;
    this.elements.push(element);
    return element;
  }

  register(element) {
    if (element.id) this.byId.set(element.id, element);
    return element;
  }

  seed(html) {
    const elementPattern = /<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/giu;
    for (const match of html.matchAll(elementPattern)) {
      const element = this.create(match[1]);
      // This lightweight parser intentionally records authority markup as a
      // flat fixture. Seeded nodes therefore retain the legacy global-query
      // behavior, while programmatically built DOM trees use real scoping.
      element.flatQueryScope = true;
      for (const attribute of match[2].matchAll(/([:\w-]+)(?:="([^"]*)")?/gu)) {
        if (attribute[1] === match[1]) continue;
        element.setAttribute(attribute[1], attribute[2] ?? "");
      }
      element.hidden = /(?:^|\s)hidden(?:\s|$)/u.test(match[2]);
      element.disabled = /(?:^|\s)disabled(?:\s|$)/u.test(match[2]);
      element.checked = /(?:^|\s)checked(?:\s|$)/u.test(match[2]);
      this.register(element);
    }
  }

  element(id) {
    if (!this.byId.has(id)) {
      const element = this.create();
      element.id = id;
    }
    return this.byId.get(id);
  }

  matches(element, rawSelector) {
    return splitSelectorList(String(rawSelector || "")).some((selector) => {
      const parts = selectorParts(selector);
      if (!parts.length || !matchesCompound(element, parts.at(-1), this)) return false;
      let ancestor = element.parentElement;
      for (let index = parts.length - 2; index >= 0; index -= 1) {
        while (ancestor && !matchesCompound(ancestor, parts[index], this)) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }

  querySelectorAll(rawSelector, root = null) {
    return this.elements.filter((element) => {
      if (root) {
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== root) ancestor = ancestor.parentElement;
        if (ancestor !== root) return false;
      }
      return this.matches(element, rawSelector);
    });
  }

  querySelector(selector, root = null) {
    return this.querySelectorAll(selector, root)[0] || null;
  }
}

export function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [String(key), String(value)]));
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    clear() {
      values.clear();
    },
    snapshot() {
      return Object.fromEntries(values);
    }
  };
}

export function createBrowserHarness({
  course,
  localStorageValues = {},
  sessionStorageValues = {},
  runtime: runtimeOverrides = {},
  window: windowOverrides = {},
  location: locationOverrides = {}
} = {}) {
  const registry = new FakeRegistry();
  const documentListeners = new Map();
  const document = {
    activeElement: null,
    readyState: "complete",
    visibilityState: "visible",
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      documentListeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      const prepared = prepareEvent(event, document);
      for (const listener of documentListeners.get(prepared.type) || []) {
        prepared.currentTarget = document;
        listener.call(document, prepared);
        if (prepared.immediatePropagationStopped) break;
      }
      return !prepared.defaultPrevented;
    },
    querySelector: (selector) => registry.querySelector(selector),
    querySelectorAll: (selector) => registry.querySelectorAll(selector),
    getElementById: (id) => registry.byId.get(String(id)) || null,
    createElement: (tagName) => registry.create(tagName),
    createElementNS: (_namespace, tagName) => registry.create(tagName)
  };
  registry.document = document;
  document.documentElement = registry.create("html");
  document.documentElement.ownerDocument = document;
  document.head = registry.create("head");
  document.body = registry.create("body");
  document.documentElement.append(document.head, document.body);

  const localStorage = createMemoryStorage(localStorageValues);
  const sessionStorage = createMemoryStorage(sessionStorageValues);
  const windowListeners = new Map();
  const runtime = {
    env: "browser",
    registerServiceWorker: async () => true,
    ...runtimeOverrides
  };
  const location = {
    origin: "https://caatuu.test",
    href: "https://caatuu.test/course/index.html",
    pathname: "/course/index.html",
    search: "",
    hash: "",
    hostname: "caatuu.test",
    ...locationOverrides
  };
  const history = { state: null, replaceState() {} };
  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
      this.bubbles = options.bubbles === true;
    }
  }
  class FakeResizeObserver {
    observe() {}
    disconnect() {}
  }
  const window = {
    CaatuuCourse: course,
    CaatuuRuntime: runtime,
    CaatuuShellPolicy: {},
    CaatuuLearning: null,
    CustomEvent: FakeCustomEvent,
    ResizeObserver: FakeResizeObserver,
    document,
    history,
    innerHeight: 800,
    innerWidth: 1200,
    localStorage,
    location,
    navigator: { standalone: false, onLine: true },
    sessionStorage,
    visualViewport: null,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      windowListeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      const prepared = prepareEvent(event, window);
      for (const listener of windowListeners.get(prepared.type) || []) {
        prepared.currentTarget = window;
        listener.call(window, prepared);
        if (prepared.immediatePropagationStopped) break;
      }
      return !prepared.defaultPrevented;
    },
    requestAnimationFrame(callback) {
      callback(0);
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    },
    getComputedStyle() {
      return { getPropertyValue() { return ""; } };
    },
    confirm() {
      return false;
    },
    ...windowOverrides
  };
  window.window = window;
  window.document = document;
  document.defaultView = window;

  const context = vm.createContext({
    AbortController,
    Blob,
    CustomEvent: FakeCustomEvent,
    Date,
    Error,
    Map,
    Math,
    Promise,
    ResizeObserver: FakeResizeObserver,
    Response,
    Set,
    TextDecoder,
    URL,
    Uint8Array,
    WeakMap,
    WeakSet,
    clearTimeout,
    console,
    document,
    fetch: async () => new Response("not found", { status: 404 }),
    history,
    localStorage,
    location,
    navigator: window.navigator,
    sessionStorage,
    setTimeout,
    window
  });
  return { context, document, localStorage, registry, runtime, sessionStorage, window };
}
