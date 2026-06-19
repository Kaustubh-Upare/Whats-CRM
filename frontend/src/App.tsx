import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, getToken } from '@/lib/api'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Upload from '@/pages/Upload'
import Batches from '@/pages/Batches'
import BatchDetail from '@/pages/BatchDetail'
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

function Protected({ children }: { children: JSX.Element }) {
  const loc = useLocation()
  const hasToken = !!getToken()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data,
    enabled: hasToken,
    retry: false,
  })
  if (!hasToken) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  if (me.isLoading) return <div className="p-10 text-slate-500">Loading…</div>
  if (me.isError) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="upload" element={<Upload />} />
        <Route path="batches" element={<Batches />} />
        <Route path="batches/:id" element={<BatchDetail />} />
        <Route path="retailers" element={<Retailers />} />
        <Route path="retailers/:id" element={<RetailerProfile />} />
        <Route path="messages" element={<Messages />} />
        <Route path="messages/:id" element={<MessageDetail />} />
        <Route path="chats" element={<Chats />} />
        <Route path="webhook-logs" element={<WebhookLogs />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="templates" element={<Templates />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
