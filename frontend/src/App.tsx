import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Landing from '@/pages/Landing'
import HowItWorks from '@/pages/HowItWorks'
import Dashboard from '@/pages/Dashboard'
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

export default function App() {
  return (
    <Routes>
      {/* Public marketing pages */}
      <Route path="/" element={<RootIndex />} />
      <Route path="/how-it-works" element={<HowItWorks />} />
      <Route path="/login" element={<Login />} />

      {/* Protected admin console (everything under /admin/*) */}
      <Route path="/admin" element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="upload" element={<Upload />} />
        <Route path="batches" element={<Batches />} />
        <Route path="batches/:id" element={<BatchDetail />} />
        <Route path="batches/:id/ai-followup" element={<BatchAIFollowup />} />
        <Route path="retailers" element={<Retailers />} />
        <Route path="retailers/:id" element={<RetailerProfile />} />
        <Route path="messages" element={<Messages />} />
        <Route path="messages/:id" element={<MessageDetail />} />
        <Route path="chats" element={<Chats />} />
        <Route path="webhook-logs" element={<WebhookLogs />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="templates" element={<Templates />} />
        <Route path="reports" element={<Reports />} />
        <Route path="credentials" element={<Credentials />} />
        <Route path="credentials/setup-guide" element={<SetupGuide />} />
        <Route path="ai" element={<AIDashboard />} />
        <Route path="ai/agent" element={<Agent />} />
        <Route path="ai/knowledge" element={<Knowledge />} />
        <Route path="ai/conversations" element={<Conversations />} />
        <Route path="ai/followups" element={<Followups />} />
        <Route path="ai/human-review" element={<AIHumanReview />} />
        <Route path="ai-followup-crm" element={<AIFollowupCRMDashboard />} />
        <Route path="ai-followup-crm/:batchId" element={<AIFollowupCRMDashboard />} />
        <Route path="ai/followups/:id/agent" element={<BatchAIAgentSetup />} />
        <Route path="ai/followups/batches/:id/agent" element={<BatchAIAgentSetup />} />
        <Route path="ai/followups/batches/:id" element={<BatchAIFollowup />} />
        <Route path="ai/followups/recipients/:recipientId" element={<FollowupDetail />} />
        <Route path="ai/followups/:id" element={<BatchAIFollowup />} />
        <Route path="crm" element={<Navigate to="/admin/ai-followup-crm" replace />} />
        <Route path="crm/leads" element={<CRMLeads />} />
        <Route path="crm/leads/:id" element={<CRMLeadDetail />} />
        <Route path="crm/pipelines" element={<CRMPipelines />} />
        <Route path="crm/sequences" element={<CRMSequences />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
