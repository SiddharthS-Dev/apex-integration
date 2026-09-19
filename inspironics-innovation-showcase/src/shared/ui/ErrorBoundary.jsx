import { Component } from 'react'
import { reportError } from '#shared/lib/reporter.js'

/**
 * Catches render-time errors so one broken subtree does not take the page with
 * it.
 *
 * There are two of these in the tree: one around the whole router, and one
 * around the 3D explorer — which is by far the most likely thing to fail,
 * because it depends on a working WebGL context and a GPU that will admit to
 * having memory. Losing the city should still leave you a gallery.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    reportError(error, {
      source: 'ErrorBoundary',
      label: this.props.label || 'app',
      componentStack: info?.componentStack,
    })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback({ error, retry: () => this.setState({ error: null }) })
        : this.props.fallback
    }

    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-8 py-16 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-xl text-muted">
          ⚠
        </div>
        <p className="text-lg font-semibold text-chalk">
          {this.props.label ? `The ${this.props.label} could not be rendered.` : 'Something went wrong.'}
        </p>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button onClick={() => this.setState({ error: null })} className="btn-ghost mt-1">
          Try again
        </button>
      </div>
    )
  }
}
