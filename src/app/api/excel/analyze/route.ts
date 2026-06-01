import { NextRequest, NextResponse } from 'next/server'
import { EXCEL_BACKEND_URL } from '@/lib/excel-backend'

interface AnalyzeBody {
  file_path: string
  sheet_name: string
  range?: string
  operations?: string[]
}

const DEFAULT_OPERATIONS = ['sum', 'avg', 'count', 'min', 'max', 'std', 'median']

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AnalyzeBody
    const { file_path, sheet_name, range, operations } = body

    if (!file_path || !sheet_name) {
      return NextResponse.json(
        { error: 'Missing required fields: file_path, sheet_name' },
        { status: 400 }
      )
    }

    const response = await fetch(`${EXCEL_BACKEND_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path,
        sheet_name,
        range: range || null,
        operations: operations || DEFAULT_OPERATIONS,
      }),
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
    console.error('Analyze error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
