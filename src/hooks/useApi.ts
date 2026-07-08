declare global {
  interface Window {
    toeverApi: {
      settings: {
        getAll: () => Promise<{ success: boolean; data?: unknown; error?: string }>
        save: (s: unknown) => Promise<{ success: boolean; error?: string }>
      }
      dashboard: {
        getStats: (today: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
      }
      orders: {
        search: (params: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
        getDetail: (id: number) => Promise<{ success: boolean; data?: unknown; error?: string }>
        collect: (params: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
      }
      ezadmin: {
        generateUploadFile: (date: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
      }
      invoice: {
        importEzadmin: (params: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
        selectFile: () => Promise<{ success: boolean; data?: string; error?: string }>
        uploadToever: () => Promise<{ success: boolean; data?: unknown; error?: string }>
      }
      batch: {
        getActive: () => Promise<{ success: boolean; data?: unknown; error?: string }>
        cancel: (id: number, reason: string) => Promise<{ success: boolean; error?: string }>
      }
      review: {
        getOpen: () => Promise<{ success: boolean; data?: unknown; error?: string }>
        getAll: (limit: number, offset: number) => Promise<{ success: boolean; data?: unknown; error?: string }>
        updateStatus: (id: number, status: string, memo?: string, resolvedBy?: string) => Promise<{ success: boolean; error?: string }>
      }
      backup: {
        status:     ()                         => Promise<{ success: boolean; data?: unknown; error?: string }>
        run:        (type?: 'AUTO' | 'MANUAL') => Promise<{ success: boolean; data?: unknown; error?: string }>
        getHistory: (limit?: number)           => Promise<{ success: boolean; data?: unknown; error?: string }>
        onProgress: (cb: (p: unknown) => void) => () => void
      }
      fs: {
        openFolder: (path: string) => Promise<{ success: boolean; error?: string }>
        storageStatus: () => Promise<{ success: boolean; data?: boolean; error?: string }>
      }
      onAutomationEvent: (cb: (event: string, data: unknown) => void) => () => void
    }
  }
}

export const api = (() => {
  if (typeof window !== 'undefined' && window.toeverApi) {
    return window.toeverApi
  }
  // 개발 환경 mock
  return null
})()

export function useApi() {
  return api
}
