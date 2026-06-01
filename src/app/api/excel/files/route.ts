import { NextResponse } from 'next/server'
import { EXCEL_BACKEND_URL } from '@/lib/excel-backend'
import { db } from '@/lib/db'

export async function GET() {
  try {
    // Fetch files from the Python backend
    const backendResponse = await fetch(`${EXCEL_BACKEND_URL}/api/files`)
    if (!backendResponse.ok) {
      throw new Error(`Backend error: ${backendResponse.statusText}`)
    }
    const backendData = await backendResponse.json()

    // Fetch files from the database
    let dbFiles: Awaited<ReturnType<typeof db.excelFile.findMany>> = []
    try {
      dbFiles = await db.excelFile.findMany({
        orderBy: { createdAt: 'desc' },
      })
    } catch (dbError) {
      console.error('Failed to fetch files from database:', dbError)
    }

    // Build a map of DB records by path for quick lookup
    const dbFileMap = new Map(dbFiles.map((f) => [f.path, f]))

    // Combine: use backend data as the primary source, enrich with DB metadata
    const combinedFiles = (backendData.files || []).map(
      (backendFile: Record<string, unknown>) => {
        const dbRecord = dbFileMap.get(backendFile.file_path as string)
        return {
          ...backendFile,
          dbId: dbRecord?.id || null,
          description: dbRecord?.description || '',
          isActive: dbRecord?.isActive || false,
          createdAt: dbRecord?.createdAt?.toISOString() || null,
          updatedAt: dbRecord?.updatedAt?.toISOString() || null,
        }
      }
    )

    // Include DB-only files that aren't on the backend (e.g., deleted from disk)
    const backendPaths = new Set(
      (backendData.files || []).map((f: Record<string, unknown>) => f.file_path)
    )
    const dbOnlyFiles = dbFiles
      .filter((f) => !backendPaths.has(f.path))
      .map((f) => ({
        file_id: f.id,
        stored_filename: f.name,
        file_path: f.path,
        file_size: f.size,
        extension: f.name.includes('.') ? '.' + f.name.split('.').pop() : '',
        sheets: [],
        dbId: f.id,
        description: f.description,
        isActive: f.isActive,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
        deletedFromDisk: true,
      }))

    return NextResponse.json({
      files: [...combinedFiles, ...dbOnlyFiles],
      count: combinedFiles.length + dbOnlyFiles.length,
    })
  } catch (error) {
    console.error('List files error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
