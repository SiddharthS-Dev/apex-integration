/**
 * The shape a feature uses to describe one of its routes.
 *
 * It lives in shared/ rather than app/ so that a feature can annotate its own
 * route table without depending on the composition root — which the
 * architecture guard rightly refused when this typedef started out in app/.
 *
 * @typedef {object} RouteSpec
 * @property {string} path
 * @property {import('react').ComponentType} Component
 * @property {boolean} [protected] wrap the element in ProtectedRoute
 * @property {string} [title] document title for the route, without the site suffix
 */

export {}
