/**
 * page.evaluate に渡すシリアライズ関数本体（文字列）。
 * クローン上で form 状態を attribute へ反映し、ライブ DOM は変更しない。
 */
export function getSerializeRuntimeStateFunctionSource(): string {
  return `function serializeRuntimeState(root) {
  function collectNodes(el) {
    var list = [];
    if (el.matches && el.matches('input, textarea, select, details, dialog')) {
      list.push(el);
    }
    var nested = el.querySelectorAll('input, textarea, select, details, dialog');
    for (var i = 0; i < nested.length; i++) {
      list.push(nested[i]);
    }
    return list;
  }

  var clone = root.cloneNode(true);
  var liveNodes = collectNodes(root);
  var cloneNodes = collectNodes(clone);

  for (var i = 0; i < liveNodes.length; i++) {
    var live = liveNodes[i];
    var node = cloneNodes[i];
    if (!node) {
      continue;
    }
    var tag = live.tagName.toLowerCase();

    if (tag === 'input') {
      var type = (live.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (live.checked) {
          node.setAttribute('checked', '');
        } else {
          node.removeAttribute('checked');
        }
      } else {
        node.setAttribute('value', live.value);
      }
    } else if (tag === 'textarea') {
      node.textContent = live.value;
    } else if (tag === 'select') {
      var liveOptions = live.options;
      var cloneOptions = node.options;
      for (var oi = 0; oi < liveOptions.length; oi++) {
        if (!cloneOptions[oi]) {
          continue;
        }
        if (liveOptions[oi].selected) {
          cloneOptions[oi].setAttribute('selected', '');
        } else {
          cloneOptions[oi].removeAttribute('selected');
        }
      }
    } else if (tag === 'details') {
      if (live.open) {
        node.setAttribute('open', '');
      } else {
        node.removeAttribute('open');
      }
    } else if (tag === 'dialog') {
      if (live.open) {
        node.setAttribute('open', '');
      } else {
        node.removeAttribute('open');
      }
    }
  }

  return clone.outerHTML;
}`;
}
