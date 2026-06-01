import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = 'http://localhost:3031'

async function backendFetch(path: string, init?: RequestInit) {
  const url = `${BACKEND_URL}${path}`
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

// GET /api/excel/main-db - Proxy to Python backend main-db endpoints
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'status'

  switch (action) {
    case 'status':
      return backendFetch('/api/main-db/status')
    case 'data': {
      const offset = searchParams.get('offset') || '0'
      const limit = searchParams.get('limit') || '100'
      const search = searchParams.get('search') || ''
      const sortColumn = searchParams.get('sort_column') || ''
      const sortAscending = searchParams.get('sort_ascending') || 'true'
      const keyColumnsOnly = searchParams.get('key_columns_only') || 'false'
      const filtersStr = searchParams.get('filters') || ''

      let queryParams = `offset=${offset}&limit=${limit}`
      if (search) queryParams += `&search=${encodeURIComponent(search)}`
      if (sortColumn) queryParams += `&sort_column=${encodeURIComponent(sortColumn)}`
      queryParams += `&sort_ascending=${sortAscending}`
      queryParams += `&key_columns_only=${keyColumnsOnly}`
      if (filtersStr) queryParams += `&filters=${encodeURIComponent(filtersStr)}`

      return backendFetch(`/api/main-db/data?${queryParams}`)
    }
    case 'columns':
      return backendFetch('/api/main-db/columns')
    case 'stats':
      return backendFetch('/api/main-db/stats')
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}

// POST /api/excel/main-db - Load or search main database
export async function POST(request: NextRequest) {
  const body = await request.json()
  const action = body.action || 'load'

  switch (action) {
    case 'load':
      return backendFetch('/api/main-db/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: body.file_path }),
      })
    case 'search':
      return backendFetch('/api/main-db/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: body.query,
          columns: body.columns,
          key_columns_only: body.key_columns_only || false,
          exact_match: body.exact_match || false,
          case_sensitive: body.case_sensitive || false,
          offset: body.offset || 0,
          limit: body.limit || 100,
        }),
      })
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}

// DELETE /api/excel/main-db - Clear main database cache
export async function DELETE() {
  return backendFetch('/api/main-db/clear', { method: 'DELETE' })
}
