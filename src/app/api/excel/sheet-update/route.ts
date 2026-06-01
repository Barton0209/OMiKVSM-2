import { NextRequest, NextResponse } from 'next/server'
import { EXCEL_BACKEND_URL } from '@/lib/excel-backend'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { file_path, sheet_name, changes } = body as {
      file_path?: string
      sheet_name?: string
      changes?: Array<{ row: number; col: number; value: unknown }>
    }

    if (!file_path || !sheet_name || !changes) {
      return NextResponse.json(
        { error: 'Missing required fields: file_path, sheet_name, changes' },
        { status: 400 }
      )
    }

    const response = await fetch(`${EXCEL_BACKEND_URL}/api/sheet-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path, sheet_name, changes }),
    })

    if (!response.ok) {
      let errorMessage = response.statusText
      try {
        const errBody = await response.json()
        if (errBody.detail) {
          errorMessage = typeof errBody.detail === 'string' ? errBody.detail : JSON.stringify(errBody.detail)
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
    console.error('Sheet update error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
