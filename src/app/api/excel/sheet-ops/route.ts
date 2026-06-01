import { NextRequest, NextResponse } from 'next/server'
import { EXCEL_BACKEND_URL } from '@/lib/excel-backend'

type SheetAction = 'create' | 'delete' | 'rename'

interface SheetOpsBody {
  action: SheetAction
  file_path: string
  sheet_name: string
  old_name?: string
  new_name?: string
}

const VALID_ACTIONS: Set<string> = new Set(['create', 'delete', 'rename'])

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SheetOpsBody
    const { action, file_path, sheet_name, old_name, new_name } = body

    if (!action || !VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${[...VALID_ACTIONS].join(', ')}` },
        { status: 400 }
      )
    }

    if (!file_path) {
      return NextResponse.json(
        { error: 'Missing required field: file_path' },
        { status: 400 }
      )
    }

    let backendUrl: string
    let backendBody: Record<string, unknown>

    switch (action) {
      case 'create':
        if (!sheet_name) {
          return NextResponse.json(
            { error: 'Missing required field: sheet_name for create action' },
            { status: 400 }
          )
        }
        backendUrl = `${EXCEL_BACKEND_URL}/api/sheet-create`
        backendBody = { file_path, sheet_name }
        break

      case 'delete':
        if (!sheet_name) {
          return NextResponse.json(
            { error: 'Missing required field: sheet_name for delete action' },
            { status: 400 }
          )
        }
        backendUrl = `${EXCEL_BACKEND_URL}/api/sheet-delete`
        backendBody = { file_path, sheet_name }
        break

      case 'rename':
        if (!old_name && !sheet_name) {
          return NextResponse.json(
            { error: 'Missing required field: old_name (or sheet_name) for rename action' },
            { status: 400 }
          )
        }
        if (!new_name) {
          return NextResponse.json(
            { error: 'Missing required field: new_name for rename action' },
            { status: 400 }
          )
        }
        backendUrl = `${EXCEL_BACKEND_URL}/api/sheet-rename`
        backendBody = { file_path, old_name: old_name || sheet_name, new_name }
        break
    }

    // For sheet-delete, the Python backend uses DELETE method
    const method = action === 'delete' ? 'DELETE' : 'POST'

    const response = await fetch(backendUrl, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendBody),
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
    console.error('Sheet ops error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
