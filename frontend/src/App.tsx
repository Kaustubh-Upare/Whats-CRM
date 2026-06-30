import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Landing from '@/pages/Landing'
import HowItWorks from '@/pages/HowItWorks'
import Pricing from '@/pages/Pricing'
import Dashboard from '@/pages/Dashboard'
import WorkspaceRoot from '@/pages/WorkspaceRoot'
import Upload from '@/pages/Upload'
import Batches from '@/pages/Batches'
import BatchDetail from '@/pages/BatchDetail'
import BatchAIFollowup from '@/pages/BatchAIFollowup'
import Retailers from '@/pages/Retailers'
import RetailerProfile from '@/pages/RetailerProfile'
import Messages from '@/pages/Messages'
import MessageDetail from '@/pages/MessageDetail'
import Chats from '@/pages/Chats'
import WebhookLogs from '@/pages/WebhookLogs'
import AuditLog from '@/pages/AuditLog'
import Templates from '@/pages/Templates'
import Reports from '@/pages/Reports'
import Settings from '@/pages/Settings'
import Credentials from '@/pages/Credentials'
import SetupGuide from '@/pages/SetupGuide'
import AIDashboard from '@/pages/AIDashboard'
import AISetupGuidePage from '@/pages/AISetupGuidePage'
import AIUsers from '@/pages/AIUsers'
import Agent from '@/pages/Agent'
import Knowledge from '@/pages/Knowledge'
import Conversations from '@/pages/Conversations'
import Followups from '@/pages/Followups'
import AIFollowupCRMDashboard from '@/pages/AIFollowupCRMDashboard'
import AIHumanReview from '@/pages/AIHumanReview'
import FollowupDetail from '@/pages/FollowupDetail'
import BatchAIAgentSetup from '@/pages/BatchAIAgentSetup'
import CRMLeads from '@/pages/CRMLeads'
import CRMLeadDetail from '@/pages/CRMLeadDetail'
import CRMPipelines from '@/pages/CRMPipelines'
import CRMSequences from '@/pages/CRMSequences'
import { useAuth } from '@/lib/useAuth'

/**
 * Wrap admin pages behind the auth gate. Unauthenticated users get
 * bounced to /login (with the original path preserved so we can send
 * them back after they sign in). The gate probes /auth/me once and
 * caches the result via useAuth, so this works for both password login
 * (token in localStorage) AND Google OAuth (token in httpOnly cookie).
 */
function Protected({ children }: { children: JSX.Element }) {
  const loc = useLocation()
  const { status } = useAuth()
  if (status === 'loading') {
    return <div className="p-10 text-slate-500">Loading…</div>
  }
  if (status === 'guest') return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  return children
}

/**
 * Logged-in users who hit the public root get sent to the admin dashboard.
 * Logged-out users see the marketing landing page.
 */
function RootIndex() {
  const { status } = useAuth()
  if (status === 'loading') {
    return <div className="p-10 text-slate-500">Loading…</div>
  }
  if (status === 'authed') return <Navigate to="/admin" replace />
  return <Landing />
}

function ParamRedirect({ to }: { to: string }) {
  const params = useParams()
  const resolved = Object.entries(params).reduce((path, [key, value]) => (
    path.replace(`:${key}`, encodeURIComponent(value ?? ''))
  ), to)
  return <Navigate to={resolved} replace />
}

export default function App() {
  return (
    <Routes>
      {/* Public marketing pages */}
      <Route path="/" element={<RootIndex />} />
      <Route path="/how-it-works" element={<HowItWorks />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/login" element={<Login />} />

      {/* Protected admin console (everything under /admin/*).
          Split into two workspaces:
            /admin/messages/bulk/*  → Bulk Messages workspace
            /admin/ai/*             → AI Workflows workspace
          /admin/settings is global (accessible from either workspace). */}
      <Route path="/admin" element={<Protected><Layout /></Protected>}>
        <Route index element={<WorkspaceRoot />} />

        {/* Bulk Messages workspace — uploads, batches, retailers, messaging */}
        <Route path="messages/bulk" element={<Dashboard />} />
        <Route path="messages/bulk/upload" element={<Upload />} />
        <Route path="messages/bulk/batches" element={<Batches />} />
        <Route path="messages/bulk/batches/:id" element={<BatchDetail />} />
        <Route path="messages/bulk/batches/:id/ai-followup" element={<BatchAIFollowup />} />
        <Route path="messages/bulk/retailers" element={<Retailers />} />
        <Route path="messages/bulk/retailers/:id" element={<RetailerProfile />} />
        <Route path="messages/bulk/messages" element={<Messages />} />
        <Route path="messages/bulk/messages/:id" element={<MessageDetail />} />
        <Route path="messages/bulk/chats" element={<Chats />} />
        <Route path="messages/bulk/webhook-logs" element={<WebhookLogs />} />
        <Route path="messages/bulk/audit-log" element={<AuditLog />} />
        <Route path="messages/bulk/templates" element={<Templates />} />
        <Route path="messages/bulk/reports" element={<Reports />} />
        <Route path="messages/bulk/credentials" element={<Credentials />} />
        <Route path="messages/bulk/credentials/setup-guide" element={<SetupGuide />} />

        {/* AI Workflows workspace — agent, knowledge, follow-ups, CRM, human review */}
        <Route path="ai" element={<AIDashboard />} />
        <Route path="ai/setup-guide" element={<AISetupGuidePage />} />
        <Route path="ai/users" element={<AIUsers />} />
        <Route path="ai/agent" element={<Agent />} />
        <Route path="ai/knowledge" element={<Knowledge />} />
        <Route path="ai/conversations" element={<Conversations />} />
        <Route path="ai/followups" element={<Followups />} />
        <Route path="ai/human-review" element={<AIHumanReview />} />
        <Route path="ai/ai-followup-crm" element={<AIFollowupCRMDashboard />} />
        <Route path="ai/ai-followup-crm/:batchId" element={<AIFollowupCRMDashboard />} />
        <Route path="ai/followups/:id/agent" element={<BatchAIAgentSetup />} />
        <Route path="ai/followups/batches/:id/agent" element={<BatchAIAgentSetup />} />
        <Route path="ai/followups/batches/:id" element={<BatchAIFollowup />} />
        <Route path="ai/followups/recipients/:recipientId" element={<FollowupDetail />} />
        <Route path="ai/followups/:id" element={<BatchAIFollowup />} />
        <Route path="ai/crm" element={<Navigate to="/admin/ai/ai-followup-crm" replace />} />
        <Route path="ai/crm/leads" element={<CRMLeads />} />
        <Route path="ai/crm/leads/:id" element={<CRMLeadDetail />} />
        <Route path="ai/crm/pipelines" element={<CRMPipelines />} />
        <Route path="ai/crm/sequences" element={<CRMSequences />} />

        {/* Global — accessible from any workspace */}
        <Route path="settings" element={<Settings />} />

        {/* ----- Legacy redirects (pre-workspace URLs) -----
            Every old `/admin/<x>` path that moved under one of the two
            workspaces gets a 301-style redirect to the new home. Bookmark
            and email links keep working without us re-rendering the old
            route. */}
        <Route path="upload" element={<Navigate to="/admin/messages/bulk/upload" replace />} />
        <Route path="batches" element={<Navigate to="/admin/messages/bulk/batches" replace />} />
        <Route path="batches/:id" element={<ParamRedirect to="/admin/messages/bulk/batches/:id" />} />
        <Route path="batches/:id/ai-followup" element={<ParamRedirect to="/admin/messages/bulk/batches/:id/ai-followup" />} />
        <Route path="retailers" element={<Navigate to="/admin/messages/bulk/retailers" replace />} />
        <Route path="retailers/:id" element={<ParamRedirect to="/admin/messages/bulk/retailers/:id" />} />
        <Route path="messages" element={<Navigate to="/admin/messages/bulk/messages" replace />} />
        <Route path="messages/:id" element={<ParamRedirect to="/admin/messages/bulk/messages/:id" />} />
        <Route path="chats" element={<Navigate to="/admin/messages/bulk/chats" replace />} />
        <Route path="webhook-logs" element={<Navigate to="/admin/messages/bulk/webhook-logs" replace />} />
        <Route path="audit-log" element={<Navigate to="/admin/messages/bulk/audit-log" replace />} />
        <Route path="templates" element={<Navigate to="/admin/messages/bulk/templates" replace />} />
        <Route path="reports" element={<Navigate to="/admin/messages/bulk/reports" replace />} />
        <Route path="credentials" element={<Navigate to="/admin/messages/bulk/credentials" replace />} />
        <Route path="credentials/setup-guide" element={<Navigate to="/admin/messages/bulk/credentials/setup-guide" replace />} />
        <Route path="ai-followup-crm" element={<Navigate to="/admin/ai/ai-followup-crm" replace />} />
        <Route path="ai-followup-crm/:batchId" element={<ParamRedirect to="/admin/ai/ai-followup-crm/:batchId" />} />
        <Route path="crm" element={<Navigate to="/admin/ai/ai-followup-crm" replace />} />
        <Route path="crm/leads" element={<Navigate to="/admin/ai/crm/leads" replace />} />
        <Route path="crm/leads/:id" element={<ParamRedirect to="/admin/ai/crm/leads/:id" />} />
        <Route path="crm/pipelines" element={<Navigate to="/admin/ai/crm/pipelines" replace />} />
        <Route path="crm/sequences" element={<Navigate to="/admin/ai/crm/sequences" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
