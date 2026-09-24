import { useEffect } from 'react'

const SUFFIX = 'Inspironics Innovation Showcase'

/**
 * Set the document title for a route.
 *
 * Every route used to render the same title, so browser tabs, history entries
 * and shared links were indistinguishable. Restores the previous title on
 * unmount so a lazy route that fails to mount does not leave a stale one.
 *
 * @param {string} [title] omit for the bare site name
 */
export function useDocumentTitle(title) {
  useEffect(() => {
    const previous = document.title
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX
    return () => {
      document.title = previous
    }
  }, [title])
}
