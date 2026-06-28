import { Navigate, useLocation, useParams } from 'react-router-dom'

/**
 * Tiny redirect component used to retire the legacy /ai/followups/:id/agent
 * route. The "per-batch agent" UI lives on /ai/followups/:id now
 * (BatchAIFollowup.tsx has an inline picker card).
 *
 * Two route shapes are supported to be safe:
 *   /ai/followups/:id/agent          → /ai/followups/:id
 *   /ai/followups/batches/:id/agent  → /ai/followups/batches/:id
 */
export default function RedirectToBatchFollowup() {
  const { id } = useParams()
  const loc = useLocation()
  // Recover the prefix from the original path so both `/ai/followups/:id/agent`
  // and `/ai/followups/batches/:id/agent` keep their parent shape.
  const parent = loc.pathname.replace(/\/agent\/?$/, '')
  if (!id) {
    return <Navigate to="/admin/ai/followups" replace />
  }
  // The redirect above assumes the original path was already under
  // /admin/ai/* (it is, per the legacy routes we retired). If a caller
  // somehow hits us without that prefix, normalise it before redirecting.
  const normalised = parent.startsWith('/ai/') ? `/admin${parent}` : `/admin/ai/followups/${id}`
  return <Navigate to={normalised} replace />
}