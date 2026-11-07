/* dc-lite.js — claude.ai の Design キャンバス（.dc.html）を、普通のWebページ（GitHub Pages など）で動かすための小さな実行部品。
   Cover.dc.html が使う書き方だけに対応：
     <x-dc> の中のマークアップ、<helmet>（head に移す）、{{名前}} の差し込み（文字・属性）、
     onClick / onChange="{{関数}}"、<sc-if value="{{x}}">、<sc-for list="{{xs}}" as="x">、
     <script type="text/x-dc" data-dc-script> の class Component extends DCLogic（renderVals / setState / componentDidMount）。
   tools/publish_web.py が build/web/ に写して使う。 */
(function () {
  'use strict';
  var st = document.createElement('style');
  st.textContent = 'x-dc{display:none!important}';
  document.head.appendChild(st);

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, p);
    if (this.__render) this.__schedule();
  };
  window.DCLogic = DCLogic;

  var RE = /\{\{\s*([\w$.]+)\s*\}\}/g;
  var ONE = /^\{\{\s*([\w$.]+)\s*\}\}$/;
  function get(scope, path) {
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function str(v) { return v == null ? '' : String(v); }
  function interp(text, scope) { return text.replace(RE, function (_, p) { return str(get(scope, p)); }); }
  var EVT = { onclick: 'click', onchange: 'input', oninput: 'input', onsubmit: 'submit', onkeydown: 'keydown' };

  function build(nodes, scope, out) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) { out.appendChild(document.createTextNode(interp(n.data, scope))); continue; }
      if (n.nodeType !== 1) continue;
      var tag = n.localName;
      if (tag === 'helmet' || tag === 'script') continue;
      if (tag === 'sc-if') {
        var m = ONE.exec(n.getAttribute('value') || '');
        if (m && get(scope, m[1])) build(n.childNodes, scope, out);
        continue;
      }
      if (tag === 'sc-for') {
        var lm = ONE.exec(n.getAttribute('list') || ''), as = n.getAttribute('as') || 'item';
        var list = lm ? get(scope, lm[1]) : null;
        (list || []).forEach(function (item, idx) {
          var s = Object.create(scope); s[as] = item; s.$index = idx;
          build(n.childNodes, s, out);
        });
        continue;
      }
      var el = n.cloneNode(false);
      var attrs = Array.prototype.slice.call(n.attributes);
      el.__h = {};
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name, val = attrs[a].value, low = name.toLowerCase();
        if (low.indexOf('hint-placeholder') === 0) { el.removeAttribute(name); continue; }
        if (EVT[low]) {
          el.removeAttribute(name);
          var fm = ONE.exec(val);
          if (fm) { var fn = get(scope, fm[1]); if (typeof fn === 'function') el.__h[EVT[low]] = fn; }
          continue;
        }
        if (val.indexOf('{{') >= 0) el.setAttribute(name, interp(val, scope));
      }
      build(n.childNodes, scope, el);
      out.appendChild(el);
    }
    return out;
  }

  function dispatch(e) { var h = e.currentTarget.__h; if (h && h[e.type]) h[e.type].call(null, e); }
  function wire(el) {
    var h = el.__h || {};
    el.__wired = el.__wired || {};
    Object.keys(h).forEach(function (t) { if (!el.__wired[t]) { el.addEventListener(t, dispatch); el.__wired[t] = 1; } });
  }
  function wireAll(root) {
    if (root.nodeType !== 1) return;
    wire(root);
    for (var c = root.firstChild; c; c = c.nextSibling) wireAll(c);
  }
  function same(a, b) { return a.nodeType === b.nodeType && (a.nodeType !== 1 || a.namespaceURI === b.namespaceURI && a.localName === b.localName); }

  function morph(oldP, newP) {
    var o = oldP.firstChild, n = newP.firstChild;
    while (n) {
      var next = n.nextSibling;
      if (!o) { oldP.appendChild(n); wireAll(n); n = next; continue; }
      var oNext = o.nextSibling;
      if (!same(o, n)) { oldP.replaceChild(n, o); wireAll(n); }
      else if (o.nodeType === 3) { if (o.data !== n.data) o.data = n.data; }
      else if (o.nodeType === 1) {
        var na = n.attributes, oa = Array.prototype.slice.call(o.attributes), i;
        for (i = 0; i < oa.length; i++) if (!n.hasAttribute(oa[i].name)) o.removeAttribute(oa[i].name);
        for (i = 0; i < na.length; i++) if (o.getAttribute(na[i].name) !== na[i].value) o.setAttribute(na[i].name, na[i].value);
        if (o.localName === 'input' || o.localName === 'textarea') {
          var v = n.getAttribute('value') || '';
          if (o.value !== v) o.value = v;
        }
        o.__h = n.__h; wire(o);
        morph(o, n);
      }
      o = oNext; n = next;
    }
    while (o) { var x = o.nextSibling; oldP.removeChild(o); o = x; }
  }

  function start() {
    var host = document.querySelector('x-dc');
    if (!host) return;
    var helmet = host.querySelector('helmet');
    if (helmet) while (helmet.firstChild) document.head.appendChild(helmet.firstChild);
    var sc = document.querySelector('script[data-dc-script]');
    var props = {};
    try {
      var dp = JSON.parse(sc.getAttribute('data-props') || '{}');
      Object.keys(dp).forEach(function (k) { if (k.charAt(0) !== '$' && dp[k] && 'default' in dp[k]) props[k] = dp[k]['default']; });
    } catch (e) {}
    var Comp = new Function('DCLogic', sc.textContent + '\n;return Component;')(DCLogic);
    var c = new Comp(props);
    c.props = c.props && Object.keys(c.props).length ? c.props : props;
    c.state = c.state || {};
    var root = document.createElement('div');
    root.id = 'dc-root';
    host.parentNode.insertBefore(root, host);
    var tpl = host.childNodes, queued = false;
    c.__render = function () {
      queued = false;
      var frag = build(tpl, c.renderVals(), document.createElement('div'));
      morph(root, frag);
    };
    c.__schedule = function () { if (!queued) { queued = true; Promise.resolve().then(c.__render); } };
    c.__render();
    if (c.componentDidMount) c.componentDidMount();
    window.addEventListener('pagehide', function () { if (c.componentWillUnmount) c.componentWillUnmount(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
