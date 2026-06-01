import { NextRequest, NextResponse } from 'next/server'
import { EXCEL_BACKEND_URL } from '@/lib/excel-backend'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const file_path = searchParams.get('file_path')
    const sheet_name = searchParams.get('sheet_name')
    const range = searchParams.get('range')
    const max_rows = searchParams.get('max_rows')

    if (!file_path || !sheet_name) {
      return NextResponse.json(
        { error: 'Missing required query parameters: file_path and sheet_name' },
        { status: 400 }
      )
    }

    // Build the backend URL with query parameters
    const params = new URLSearchParams({
      file_path,
      sheet_name,
    })
    if (range) params.set('range', range)
    if (max_rows) params.set('max_rows', max_rows)

    const response = await fetch(`${EXCEL_BACKEND_URL}/api/sheet-data?${params.toString()}`)

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

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Sheet data error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
