import { NextRequest, NextResponse } from 'next/server'
import { EXCEL_BACKEND_URL } from '@/lib/excel-backend'
import { db } from '@/lib/db'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params

    // Try fetching from the Python backend first
    const backendResponse = await fetch(`${EXCEL_BACKEND_URL}/api/file/${encodeURIComponent(id)}`)
    const backendData = backendResponse.ok ? await backendResponse.json() : null

    // Also look up in the database
    let dbFile = null
    try {
      dbFile = await db.excelFile.findUnique({ where: { id } })
    } catch (dbError) {
      console.error('Database lookup error:', dbError)
    }

    if (!backendData && !dbFile) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    return NextResponse.json({
      ...(backendData || {}),
      dbId: dbFile?.id || null,
      description: dbFile?.description || '',
      isActive: dbFile?.isActive || false,
      createdAt: dbFile?.createdAt?.toISOString() || null,
      updatedAt: dbFile?.updatedAt?.toISOString() || null,
    })
  } catch (error) {
    console.error('Get file error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params

    // Delete from the Python backend
    const backendResponse = await fetch(`${EXCEL_BACKEND_URL}/api/file/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })

    if (!backendResponse.ok) {
      const body = await backendResponse.json().catch(() => ({}))
      // Even if backend returns 404, we still try to clean up the DB
      if (backendResponse.status !== 404) {
        return NextResponse.json(
          { error: body.detail || `Backend error: ${backendResponse.statusText}` },
          { status: backendResponse.status }
        )
      }
    }

    const backendData = backendResponse.ok ? await backendResponse.json() : null

    // Delete from the database
    try {
      await db.excelFile.deleteMany({ where: { id } })
    } catch (dbError) {
      console.error('Database delete error:', dbError)
      // Non-fatal
    }

    return NextResponse.json({
      deleted: true,
      file_id: id,
      backend: backendData,
    })
  } catch (error) {
    console.error('Delete file error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
