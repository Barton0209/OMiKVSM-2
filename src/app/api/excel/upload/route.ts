import { NextRequest, NextResponse } from 'next/server'
import { EXCEL_BACKEND_URL } from '@/lib/excel-backend'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Forward the file to the Python backend
    const backendForm = new FormData()
    backendForm.append('file', file)

    const response = await fetch(`${EXCEL_BACKEND_URL}/api/upload`, {
      method: 'POST',
      body: backendForm,
    })

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

    // Save file metadata to the Prisma database
    try {
      await db.excelFile.create({
        data: {
          name: data.stored_filename || file.name,
          originalName: file.name,
          path: data.file_path || '',
          size: data.file_size || 0,
          sheetCount: data.sheets?.length || 0,
          isActive: false,
          description: '',
        },
      })
    } catch (dbError) {
      console.error('Failed to save file metadata to database:', dbError)
      // Non-fatal: we still return the backend response even if DB save fails
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
