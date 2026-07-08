import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import OrderList from './pages/OrderList'
import ManualReview from './pages/ManualReview'
import InvoiceManager from './pages/InvoiceManager'
import Settings from './pages/Settings'

type Page = 'dashboard' | 'orders' | 'invoice' | 'review' | 'settings'

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: '대시보드', icon: '📊' },
  { id: 'orders', label: '주문 관리', icon: '📦' },
  { id: 'invoice', label: '송장 처리', icon: '🚚' },
  { id: 'review', label: '수동검토', icon: '🔍' },
  { id: 'settings', label: '설정', icon: '⚙️' },
]

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [reviewBadge, setReviewBadge] = useState(0)

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* 사이드바 */}
      <aside style={{
        width: 200,
        background: '#0a1628',
        borderRight: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* 로고 */}
        <div style={{ padding: '20px 16px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ color: '#3b82f6', fontWeight: 700, fontSize: 16 }}>Spring</div>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14, marginTop: 2 }}>Toever Ops</div>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>v1.0.0</div>
        </div>

        {/* 네비게이션 */}
        <nav style={{ flex: 1, padding: '8px 0' }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '10px 16px',
                borderRadius: 0,
                background: currentPage === item.id ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: currentPage === item.id ? '#3b82f6' : '#94a3b8',
                fontWeight: currentPage === item.id ? 600 : 400,
                borderLeft: currentPage === item.id ? '3px solid #3b82f6' : '3px solid transparent',
                justifyContent: 'flex-start',
                fontSize: 13,
              }}
            >
              <span>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.id === 'review' && reviewBadge > 0 && (
                <span style={{
                  background: '#ef4444',
                  color: 'white',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 9999,
                  padding: '1px 6px',
                  minWidth: 18,
                  textAlign: 'center',
                }}>
                  {reviewBadge > 99 ? '99+' : reviewBadge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* 메인 콘텐츠 */}
      <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {currentPage === 'dashboard' && (
          <Dashboard
            onNavigate={setCurrentPage}
            onReviewBadgeUpdate={setReviewBadge}
          />
        )}
        {currentPage === 'orders' && <OrderList />}
        {currentPage === 'invoice' && <InvoiceManager />}
        {currentPage === 'review' && (
          <ManualReview />
        )}
        {currentPage === 'settings' && <Settings />}
      </main>
    </div>
  )
}
