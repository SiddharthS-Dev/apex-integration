/**
 * Reference-counted body scroll lock.
 *
 * Two overlays can be open at the same time — the plate viewer and the
 * add-plate modal — and each used to save and restore
 * `document.body.style.overflow` on its own, so whichever unmounted second
 * restored the *locked* value it had captured on the way in, leaving the page
 * unscrollable for good. Counting holders fixes that whatever order things
 * mount and unmount in.
 *
 * The count lives on the `<body>` element rather than in a module variable.
 * That is not incidental: module state outlives the document it describes, so
 * a second bundle, a hot reload, or a fresh jsdom in a test would each start
 * from a stale count and either fail to lock or fail to release. Keeping it on
 * the element means the state and the thing it describes are thrown away
 * together.
 */
const COUNT = 'data-scroll-locks'
const ORIGINAL = 'data-scroll-overflow'

/**
 * Lock body scrolling and return an idempotent release function, so it can be
 * handed straight back from a React effect cleanup.
 */
export function lockScroll() {
  const body = document.body
  const held = Number(body.getAttribute(COUNT)) || 0

  if (held === 0) {
    body.setAttribute(ORIGINAL, body.style.overflow)
    body.style.overflow = 'hidden'
  }
  body.setAttribute(COUNT, String(held + 1))

  let released = false
  return () => {
    if (released) return
    released = true

    const current = Number(body.getAttribute(COUNT)) || 0
    const next = Math.max(0, current - 1)
    if (next === 0) {
      body.style.overflow = body.getAttribute(ORIGINAL) || ''
      body.removeAttribute(COUNT)
      body.removeAttribute(ORIGINAL)
    } else {
      body.setAttribute(COUNT, String(next))
    }
  }
}
