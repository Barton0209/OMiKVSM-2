import { NextRequest, NextResponse } from 'next/server'
import { EXCEL_BACKEND_URL } from '@/lib/excel-backend'
import { db } from '@/lib/db'

interface MacroExecuteBody {
  file_path: string
  macro_code: string
  language: 'vba' | 'python'
  name?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MacroExecuteBody
    const { file_path, macro_code, language, name } = body

    if (!file_path || !macro_code || !language) {
      return NextResponse.json(
        { error: 'Missing required fields: file_path, macro_code, language' },
        { status: 400 }
      )
    }

    const response = await fetch(`${EXCEL_BACKEND_URL}/api/macro/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path, macro_code, language }),
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || `Backend error (${response.status})` },
        { status: response.status }
      )
    }

    // Log the macro execution to the database
    try {
      const dbFile = await db.excelFile.findFirst({
        where: { path: file_path },
      })

      const macroName = name || `Macro_${Date.now()}`

      // Save or update the macro in the DB
      const savedMacro = await db.macro.create({
        data: {
          name: macroName,
          code: macro_code,
          language,
          fileId: dbFile?.id || null,
          isGlobal: !dbFile,
        },
      })

      // Log the run
      await db.macroRun.create({
        data: {
          macroId: savedMacro.id,
          status: data.success ? 'success' : 'error',
          output: data.output ? JSON.stringify(data.output) : null,
          duration: data.duration || null,
        },
      })
    } catch (dbError) {
      console.error('Failed to log macro execution to database:', dbError)
      // Non-fatal
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Macro execute error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const file_path = searchParams.get('file_path')

    if (!file_path) {
      // If no file_path provided, list all macros from the database
      try {
        const macros = await db.macro.findMany({
          orderBy: { createdAt: 'desc' },
          include: { runs: { take: 5, orderBy: { createdAt: 'desc' } } },
        })
        return NextResponse.json({ macros, count: macros.length, source: 'database' })
      } catch (dbError) {
        console.error('Failed to list macros from database:', dbError)
        return NextResponse.json({ macros: [], count: 0, source: 'database' })
      }
    }

    // Fetch macros from the Python backend for a specific file
    const params = new URLSearchParams({ file_path })
    const response = await fetch(`${EXCEL_BACKEND_URL}/api/macro/list?${params.toString()}`)

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

    const backendData = await response.json()

    // Also include macros from the database for this file
    try {
      const dbFile = await db.excelFile.findFirst({
        where: { path: file_path },
      })
      if (dbFile) {
        const dbMacros = await db.macro.findMany({
          where: { fileId: dbFile.id },
          include: { runs: { take: 5, orderBy: { createdAt: 'desc' } } },
        })
        return NextResponse.json({
          ...backendData,
          dbMacros,
        })
      }
    } catch (dbError) {
      console.error('Failed to fetch DB macros:', dbError)
    }

    return NextResponse.json(backendData)
  } catch (error) {
    console.error('Macro list error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
