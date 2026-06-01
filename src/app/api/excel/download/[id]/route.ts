import { NextRequest, NextResponse } from 'next/server'
import { EXCEL_BACKEND_URL } from '@/lib/excel-backend'
import { db } from '@/lib/db'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params

    // First, try to find the file in the database to get its path
    let filePath: string | null = null
    try {
      const dbFile = await db.excelFile.findUnique({ where: { id } })
      if (dbFile) {
        filePath = dbFile.path
      }
    } catch (dbError) {
      console.error('Database lookup error:', dbError)
    }

    // If we found a path in the DB, we can use the file_id from the backend
    // The Python backend's find_file_by_id will resolve the path
    // We use the id from the URL to fetch from the backend
    const backendId = filePath
      ? filePath.split('/').pop()?.split('.')[0] || id
      : id

    const response = await fetch(
      `${EXCEL_BACKEND_URL}/api/download/${encodeURIComponent(backendId)}`
    )

    if (!response.ok) {
      let errorMessage = response.statusText
      try {
        const body = await response.json()
        if (body.detail) {
          errorMessage = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
        }
      } catch {
        // ignore
      }
      return NextResponse.json(
        { error: `Backend error (${response.status}): ${errorMessage}` },
        { status: response.status }
      )
    }

    // Stream the file from the backend
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const contentDisposition = response.headers.get('content-disposition')
    const contentLength = response.headers.get('content-length')

    const headers = new Headers()
    headers.set('Content-Type', contentType)
    if (contentDisposition) {
      headers.set('Content-Disposition', contentDisposition)
    }
    if (contentLength) {
      headers.set('Content-Length', contentLength)
    }

    // If no content-disposition from backend, construct one
    if (!contentDisposition && filePath) {
      const filename = filePath.split('/').pop() || 'download.xlsx'
      headers.set('Content-Disposition', `attachment; filename="${filename}"`)
    }

    const body = response.body
    if (!body) {
      return NextResponse.json({ error: 'No response body from backend' }, { status: 500 })
    }

    return new NextResponse(body, { headers })
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
