'use client'

const API_BASE = '/api'
const PORT_PARAM = 'XTransformPort=3031'

function apiUrl(path: string): string {
  return `${API_BASE}${path}?${PORT_PARAM}`
}

export interface UploadResult {
  file_id: string
  original_filename: string
  stored_filename: string
  file_path: string
  file_size: number
  extension: string
  sheets: string[]
  upload_time: string
}

export interface FileListResult {
  files: Array<{
    file_id: string
    stored_filename: string
    file_path: string
    file_size: number
    extension: string
    modified: string
    sheets?: string[]
  }>
  count: number
}

export interface SheetDataResult {
  sheet_name: string
  data: Array<Array<{
    row: number
    col: number
    value: unknown
    type: string
  }>>
  range: string
  total_rows: number
  returned_rows: number
  has_more: boolean
  columns: number
}

export interface MacroResult {
  success: boolean
  output: string[]
  errors: string[]
  variables?: Record<string, string>
}

export interface AnalysisResult {
  analysis: Record<string, Record<string, unknown>>
  operations: string[]
  numeric_columns: string[]
  total_rows: number
  total_columns: number
  message?: string
}

export function useExcelApi() {
  // File operations
  const uploadFile = async (file: File): Promise<UploadResult> => {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(apiUrl('/upload'), {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка загрузки файла' }))
      throw new Error(error.detail || 'Ошибка загрузки файла')
    }

    return response.json()
  }

  const fetchFiles = async (): Promise<FileListResult> => {
    const response = await fetch(apiUrl('/files'), {
      method: 'GET',
    })

    if (!response.ok) {
      throw new Error('Ошибка получения списка файлов')
    }

    return response.json()
  }

  const deleteFile = async (id: string): Promise<void> => {
    const response = await fetch(apiUrl(`/file/${id}`), {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error('Ошибка удаления файла')
    }
  }

  const downloadFile = async (id: string): Promise<void> => {
    const response = await fetch(apiUrl(`/download/${id}`), {
      method: 'GET',
    })

    if (!response.ok) {
      throw new Error('Ошибка скачивания файла')
    }

    const blob = await response.blob()
    const contentDisposition = response.headers.get('content-disposition')
    let filename = 'download.xlsx'
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (match && match[1]) {
        filename = match[1].replace(/['"]/g, '')
      }
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const getFile = async (id: string) => {
    const response = await fetch(apiUrl(`/file/${id}`), {
      method: 'GET',
    })

    if (!response.ok) {
      throw new Error('Ошибка получения информации о файле')
    }

    return response.json()
  }

  // Sheet operations
  const fetchSheetData = async (
    filePath: string,
    sheetName: string,
    range?: string
  ): Promise<SheetDataResult> => {
    const params = new URLSearchParams({
      file_path: filePath,
      sheet_name: sheetName,
    })
    if (range) {
      params.append('range', range)
    }

    const response = await fetch(`${apiUrl('/sheet-data')}&${params.toString()}`, {
      method: 'GET',
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка загрузки данных листа' }))
      throw new Error(error.detail || 'Ошибка загрузки данных листа')
    }

    return response.json()
  }

  const updateCells = async (
    filePath: string,
    sheetName: string,
    changes: Array<{ row: number; col: number; value: string }>
  ) => {
    const response = await fetch(apiUrl('/sheet-update'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        sheet_name: sheetName,
        changes,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка обновления ячеек' }))
      throw new Error(error.detail || 'Ошибка обновления ячеек')
    }

    return response.json()
  }

  const createSheet = async (filePath: string, sheetName: string) => {
    const response = await fetch(apiUrl('/sheet-create'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        sheet_name: sheetName,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка создания листа' }))
      throw new Error(error.detail || 'Ошибка создания листа')
    }

    return response.json()
  }

  const deleteSheet = async (filePath: string, sheetName: string) => {
    const response = await fetch(apiUrl('/sheet-delete'), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        sheet_name: sheetName,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка удаления листа' }))
      throw new Error(error.detail || 'Ошибка удаления листа')
    }

    return response.json()
  }

  const renameSheet = async (filePath: string, oldName: string, newName: string) => {
    const response = await fetch(apiUrl('/sheet-rename'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        old_name: oldName,
        new_name: newName,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка переименования листа' }))
      throw new Error(error.detail || 'Ошибка переименования листа')
    }

    return response.json()
  }

  // Data operations
  const sortData = async (
    filePath: string,
    sheetName: string,
    column: string,
    ascending: boolean,
    range?: string
  ) => {
    const response = await fetch(apiUrl('/sort'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        sheet_name: sheetName,
        column,
        ascending,
        range,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка сортировки' }))
      throw new Error(error.detail || 'Ошибка сортировки')
    }

    return response.json()
  }

  const filterData = async (
    filePath: string,
    sheetName: string,
    column: string,
    condition: string,
    value?: unknown,
    range?: string
  ) => {
    const response = await fetch(apiUrl('/filter'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        sheet_name: sheetName,
        column,
        condition,
        value,
        range,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка фильтрации' }))
      throw new Error(error.detail || 'Ошибка фильтрации')
    }

    return response.json()
  }

  const findReplace = async (
    filePath: string,
    sheetName: string,
    find: string,
    replace: string,
    range?: string
  ) => {
    const response = await fetch(apiUrl('/find-replace'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        sheet_name: sheetName,
        find,
        replace,
        range,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка поиска и замены' }))
      throw new Error(error.detail || 'Ошибка поиска и замены')
    }

    return response.json()
  }

  const mergeCells = async (
    filePath: string,
    sheetName: string,
    range: string,
    action: 'merge' | 'unmerge' = 'merge'
  ) => {
    const response = await fetch(apiUrl('/merge-cells'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        sheet_name: sheetName,
        range,
        action,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка объединения ячеек' }))
      throw new Error(error.detail || 'Ошибка объединения ячеек')
    }

    return response.json()
  }

  const formatCells = async (
    filePath: string,
    sheetName: string,
    range: string,
    formatType: string,
    formatValue?: unknown
  ) => {
    const response = await fetch(apiUrl('/format-cells'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        sheet_name: sheetName,
        range,
        format_type: formatType,
        format_value: formatValue,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка форматирования' }))
      throw new Error(error.detail || 'Ошибка форматирования')
    }

    return response.json()
  }

  // Macro operations
  const executeMacro = async (
    filePath: string,
    macroCode: string,
    language: 'vba' | 'python'
  ): Promise<MacroResult> => {
    const response = await fetch(apiUrl('/macro/execute'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        macro_code: macroCode,
        language,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        output: [],
        errors: [data.detail || 'Ошибка выполнения макроса'],
      }
    }

    return data
  }

  // Analysis
  const analyzeData = async (
    filePath: string,
    sheetName: string,
    range: string,
    operations: string[]
  ): Promise<AnalysisResult> => {
    const response = await fetch(apiUrl('/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        sheet_name: sheetName,
        range,
        operations,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Ошибка анализа данных' }))
      throw new Error(error.detail || 'Ошибка анализа данных')
    }

    return response.json()
  }

  // Health check
  const checkHealth = async (): Promise<boolean> => {
    try {
      const response = await fetch(apiUrl('/health'), {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  // Main Database operations - call Python backend directly through gateway
  const mainDbApiUrl = (path: string) => `/api${path}?XTransformPort=3031`

  const mainDbStatus = async () => {
    const response = await fetch(mainDbApiUrl('/main-db/status'), {
      method: 'GET',
    })
    if (!response.ok) throw new Error('Ошибка получения статуса основной БД')
    return response.json()
  }

  const mainDbLoad = async (filePath?: string) => {
    const response = await fetch(mainDbApiUrl('/main-db/load'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath }),
    })
    if (!response.ok) throw new Error('Ошибка загрузки основной БД')
    return response.json()
  }

  const mainDbData = async (params: {
    offset?: number
    limit?: number
    search?: string
    filters?: Record<string, string>
    sort_column?: string
    sort_ascending?: boolean
    key_columns_only?: boolean
  } = {}) => {
    const sp = new URLSearchParams()
    if (params.offset !== undefined) sp.set('offset', String(params.offset))
    if (params.limit !== undefined) sp.set('limit', String(params.limit))
    if (params.search) sp.set('search', params.search)
    if (params.sort_column) sp.set('sort_column', params.sort_column)
    if (params.sort_ascending !== undefined) sp.set('sort_ascending', String(params.sort_ascending))
    if (params.key_columns_only !== undefined) sp.set('key_columns_only', String(params.key_columns_only))
    if (params.filters && Object.keys(params.filters).length > 0) {
      sp.set('filters', JSON.stringify(params.filters))
    }

    const response = await fetch(mainDbApiUrl(`/main-db/data&${sp.toString()}`), {
      method: 'GET',
    })
    if (!response.ok) throw new Error('Ошибка загрузки данных основной БД')
    return response.json()
  }

  const mainDbColumns = async () => {
    const response = await fetch(mainDbApiUrl('/main-db/columns'), {
      method: 'GET',
    })
    if (!response.ok) throw new Error('Ошибка получения колонок основной БД')
    return response.json()
  }

  const mainDbStats = async () => {
    const response = await fetch(mainDbApiUrl('/main-db/stats'), {
      method: 'GET',
    })
    if (!response.ok) throw new Error('Ошибка получения статистики основной БД')
    return response.json()
  }

  const mainDbSearch = async (params: {
    query: string
    key_columns_only?: boolean
    exact_match?: boolean
    offset?: number
    limit?: number
  }) => {
    const response = await fetch(mainDbApiUrl('/main-db/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', ...params }),
    })
    if (!response.ok) throw new Error('Ошибка поиска в основной БД')
    return response.json()
  }

  const mainDbClear = async () => {
    const response = await fetch(mainDbApiUrl('/main-db/clear'), {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error('Ошибка очистки основной БД')
    return response.json()
  }

  // Report API methods
  const generateReport = async (params: {
    report_type: string
    year?: number | null
    month?: number | null
    citizenship?: string | null
    territory?: string | null
    organization?: string | null
    status?: string | null
    direction?: string | null
    justification?: string | null
    arrival_status?: string | null
    worker_type?: string | null
    department?: string | null
  }) => {
    const response = await fetch(mainDbApiUrl('/reports/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!response.ok) throw new Error('Ошибка генерации отчета')
    return response.json()
  }

  const getReportFilters = async () => {
    const response = await fetch(mainDbApiUrl('/reports/filters'), {
      method: 'GET',
    })
    if (!response.ok) throw new Error('Ошибка получения фильтров')
    return response.json()
  }

  const calendarStatus = async () => {
    const response = await fetch(mainDbApiUrl('/calendar/status'), { method: 'GET' })
    if (!response.ok) throw new Error('Ошибка получения статуса календаря')
    return response.json()
  }

  const calendarLoad = async () => {
    const response = await fetch(mainDbApiUrl('/calendar/load'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!response.ok) throw new Error('Ошибка загрузки календаря')
    return response.json()
  }

  return {
    uploadFile,
    fetchFiles,
    deleteFile,
    downloadFile,
    getFile,
    fetchSheetData,
    updateCells,
    createSheet,
    deleteSheet,
    renameSheet,
    sortData,
    filterData,
    findReplace,
    mergeCells,
    formatCells,
    executeMacro,
    analyzeData,
    checkHealth,
    mainDbStatus,
    mainDbLoad,
    mainDbData,
    mainDbColumns,
    mainDbStats,
    mainDbSearch,
    mainDbClear,
    generateReport,
    getReportFilters,
    calendarStatus,
    calendarLoad,
  }
}
