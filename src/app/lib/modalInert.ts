/**
 * Radix modals (dialogs, menus, selects) hide the rest of the page with aria-hidden + data-aria-hidden but leave
 * its links and buttons focusable, which screen readers and axe report as "aria-hidden element contains focusable
 * content". Mirror every Radix-hidden element with `inert` so it is genuinely unreachable while the modal is open,
 * and release it when Radix does. Only elements Radix marked are touched.
 */
export function installModalInert(root: HTMLElement = document.body): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const sync = (el: Element) => {
    const hidden = el.getAttribute('data-aria-hidden') === 'true';
    if (hidden && !el.hasAttribute('inert')) {
      el.setAttribute('inert', '');
      el.setAttribute('data-modal-inert', '');
    } else if (!hidden && el.hasAttribute('data-modal-inert')) {
      el.removeAttribute('inert');
      el.removeAttribute('data-modal-inert');
    }
  };
  root.querySelectorAll('[data-aria-hidden],[data-modal-inert]').forEach(sync);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target instanceof Element) sync(record.target);
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-aria-hidden'], subtree: true });
  return () => {
    observer.disconnect();
    root.querySelectorAll('[data-modal-inert]').forEach((el) => {
      el.removeAttribute('inert');
      el.removeAttribute('data-modal-inert');
    });
  };
}
