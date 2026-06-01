'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useExcelStore, cellRef, getSelectedRangeBounds, type FileInfo } from '@/store/excel-store'
import { useMainDbStore } from '@/store/main-db-store'
import { useExcelApi } from '@/hooks/use-excel-api'
import SpreadsheetGrid from '@/components/excel/SpreadsheetGrid'
import Toolbar from '@/components/excel/Toolbar'
import FormulaBar from '@/components/excel/FormulaBar'
import SheetTabs from '@/components/excel/SheetTabs'
import CellContextMenu from '@/components/excel/CellContextMenu'
import Sidebar from '@/components/excel/Sidebar'
import MacroEditor from '@/components/excel/MacroEditor'
import FindReplaceDialog from '@/components/excel/FindReplaceDialog'
import MainDatabasePanel from '@/components/excel/MainDatabasePanel'
import { Button } from '@/components/ui/button'
import {
  Upload, FilePlus, FileSpreadsheet, Loader2, Wifi, WifiOff, Table2,
  Code2, BarChart3, Zap, Database, FileDown, ArrowLeft, Users
} from 'lucide-react'

function StatusBar() {
  const selectedCell = useExcelStore((s) => s.selectedCell)
  const sheets = useExcelStore((s) => s.sheets)
  const activeSheetIndex = useExcelStore((s) => s.activeSheetIndex)
  const selectedRange = useExcelStore((s) => s.selectedRange)
  const backendAvailable = useExcelStore((s) => s.backendAvailable)
  const activeFile = useExcelStore((s) => s.activeFile)
  const appMode = useExcelStore((s) => s.sidebarTab as string)

  const stats = useMemo(() => {
    const state = useExcelStore.getState()
    const bounds = getSelectedRangeBounds(state)
    if (!bounds) return { sum: null, avg: null, count: 0 }

    const sheet = sheets[activeSheetIndex]
    let sum = 0
    let count = 0
    let numericCount = 0

    for (let r = bounds.startRow; r <= bounds.endRow; r++) {
      for (let c = bounds.startCol; c <= bounds.endCol; c++) {
        const key = `${r},${c}`
        const cell = sheet.data[key]
        if (cell && cell.value !== null && cell.value !== '') {
          count++
          const num = Number(cell.value)
          if (!isNaN(num)) {
            sum += num
            numericCount++
          }
        }
      }
    }

    const avg = numericCount > 0 ? sum / numericCount : null
    return { sum, avg, count, numericCount }
  }, [selectedCell, selectedRange, sheets, activeSheetIndex])

  const formatNumber = (n: number | null) => {
    if (n === null) return '—'
    if (Number.isInteger(n)) return n.toLocaleString('ru-RU')
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  }

  return (
    <div className="flex items-center justify-between h-5 bg-gray-50 border-t border-gray-200 px-3 flex-shrink-0">
      <div className="text-[10px] text-gray-500 flex items-center gap-3">
        <span>
          {selectedCell ? `Ячейка: ${cellRef(selectedCell.row, selectedCell.col)}` : 'Готово'}
        </span>
        {activeFile && (
          <span className="text-gray-400">| {activeFile.name}</span>
        )}
      </div>
      <div className="text-[10px] text-gray-500 flex items-center gap-3">
        {stats.count > 1 && (
          <>
            <span>Сумма: {formatNumber(stats.sum)}</span>
            <span>Среднее: {formatNumber(stats.avg)}</span>
            <span>Количество: {stats.count}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-gray-500">
        {backendAvailable ? (
          <span className="flex items-center gap-1 text-green-600">
            <Wifi className="h-3 w-3" />
            Python
          </span>
        ) : (
          <span className="flex items-center gap-1 text-orange-500">
            <WifiOff className="h-3 w-3" />
            Оффлайн
          </span>
        )}
      </div>
    </div>
  )
}

function WelcomeScreen() {
  const api = useExcelApi()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const files = useExcelStore((s) => s.files)
  const setFiles = useExcelStore((s) => s.setFiles)
  const isUploading = useExcelStore((s) => s.isUploading)
  const [isDragOver, setIsDragOver] = useState(false)
  const [mainDbLoading, setMainDbLoading] = useState(false)

  const processFile = useCallback(
    async (file: File) => {
      useExcelStore.getState().setIsUploading(true)
      useExcelStore.getState().setUploadProgress(0)

      try {
        const result = await api.uploadFile(file)
        const newFile: FileInfo = {
          id: result.file_id,
          name: result.original_filename,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          size: result.file_size,
          filePath: result.file_path,
          sheets: result.sheets,
          extension: result.extension,
        }

        const currentFiles = useExcelStore.getState().files
        setFiles([newFile, ...currentFiles])

        if (result.sheets.length > 0) {
          useExcelStore.getState().setIsLoading(true)
          try {
            const sheetResult = await api.fetchSheetData(result.file_path, result.sheets[0])
            const store = useExcelStore.getState()
            const newSheets = result.sheets.map((name, i) => {
              if (i === 0) return { ...store.sheets[0], name }
              return {
                name,
                data: {},
                mergedCells: [],
                columnWidths: {},
                rowHeights: {},
                defaultColumnWidth: 100,
                defaultRowHeight: 24,
              }
            })

            useExcelStore.setState({
              activeFile: newFile,
              currentFilePath: result.file_path,
              sheets: newSheets,
              activeSheetIndex: 0,
              selectedCell: { row: 0, col: 0 },
              selectedRange: null,
            })
            store.loadApiSheetData(sheetResult.data)
          } catch (err) {
            useExcelStore.getState().setError(err instanceof Error ? err.message : 'Ошибка загрузки данных')
          } finally {
            useExcelStore.getState().setIsLoading(false)
          }
        }
      } catch (err) {
        useExcelStore.getState().setError(err instanceof Error ? err.message : 'Ошибка загрузки файла')
      } finally {
        useExcelStore.getState().setIsUploading(false)
        useExcelStore.getState().setUploadProgress(0)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [api, setFiles]
  )

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleNewClick = useCallback(() => {
    const store = useExcelStore.getState()
    useExcelStore.setState({
      activeFile: { id: 'new', name: 'Новая книга', createdAt: Date.now(), updatedAt: Date.now(), size: 0 },
      currentFilePath: null,
      sheets: [{
        name: 'Лист1',
        data: {},
        mergedCells: [],
        columnWidths: {},
        rowHeights: {},
        defaultColumnWidth: 100,
        defaultRowHeight: 24,
      }],
      activeSheetIndex: 0,
      selectedCell: { row: 0, col: 0 },
      selectedRange: null,
    })
  }, [])

  const handleOpenMainDb = useCallback(() => {
    setMainDbLoading(true)
    // Just switch to main DB mode - the MainDatabasePanel handles loading
    useExcelStore.getState().setActiveFile({
      id: 'main-db',
      name: 'Основная БД — Сотрудники',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      size: 19539715,
    })
  }, [])

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) await processFile(file)
    },
    [processFile]
  )

  const handleRecentFileClick = useCallback(
    async (file: FileInfo) => {
      if (!file.filePath || !file.sheets || file.sheets.length === 0) return

      useExcelStore.getState().setIsLoading(true)
      try {
        const sheetResult = await api.fetchSheetData(file.filePath, file.sheets[0])
        const store = useExcelStore.getState()
        const newSheets = file.sheets.map((name, i) => {
          if (i === 0) return { ...store.sheets[0], name }
          return {
            name,
            data: {},
            mergedCells: [],
            columnWidths: {},
            rowHeights: {},
            defaultColumnWidth: 100,
            defaultRowHeight: 24,
          }
        })

        useExcelStore.setState({
          activeFile: file,
          currentFilePath: file.filePath,
          sheets: newSheets,
          activeSheetIndex: 0,
          selectedCell: { row: 0, col: 0 },
          selectedRange: null,
        })
        store.loadApiSheetData(sheetResult.data)
      } catch (err) {
        useExcelStore.getState().setError(err instanceof Error ? err.message : 'Ошибка загрузки файла')
      } finally {
        useExcelStore.getState().setIsLoading(false)
      }
    },
    [api]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      const file = e.dataTransfer.files[0]
      if (file) await processFile(file)
    },
    [processFile]
  )

  return (
    <div
      className={`flex-1 flex items-center justify-center transition-colors duration-200 ${isDragOver ? 'bg-green-50' : 'bg-gradient-to-br from-gray-50 via-white to-gray-100'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".xlsx,.xls,.csv,.xlsb,.xlsm,.tsv"
        onChange={handleFileSelect}
      />

      {isDragOver && (
        <div className="fixed inset-0 z-50 bg-green-500/10 border-4 border-dashed border-green-500 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl px-12 py-8 shadow-2xl text-center">
            <Upload className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <p className="text-xl font-semibold text-green-700">Перетащите файл сюда</p>
            <p className="text-sm text-green-600 mt-1">.xlsx, .xls, .csv, .xlsb</p>
          </div>
        </div>
      )}

      <div className="text-center max-w-lg mx-auto px-6">
        {/* Logo */}
        <div className="mb-8">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-green-600 to-green-800 shadow-2xl shadow-green-600/30">
            <Table2 className="h-12 w-12 text-white" />
          </div>
        </div>

        <h1 className="text-3xl font-bold text-gray-800 mb-2">Таблица</h1>
        <p className="text-gray-500 mb-2">Мощный Excel-подобный редактор электронных таблиц</p>
        <p className="text-xs text-gray-400 mb-8">Поддержка .xlsx, .xls, .csv, .xlsb • Python-бэкенд • VBA макросы • Анализ данных</p>

        {/* Main Database Card - prominently displayed */}
        <div className="mb-6 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl shadow-lg shadow-amber-200/30 cursor-pointer hover:shadow-xl hover:border-amber-400 transition-all"
          onClick={handleOpenMainDb}
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div className="text-left flex-1">
              <h3 className="text-sm font-bold text-amber-900">Основная База Данных</h3>
              <p className="text-[11px] text-amber-700">БД сотрудников компании • 112 270 записей</p>
              <p className="text-[10px] text-amber-500 mt-0.5">Загружается 1 раз • Ключевые столбцы A:G, I, K:N</p>
            </div>
            <div className="text-amber-600">
              {mainDbLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Database className="h-5 w-5" />}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <Button
            size="lg"
            className="bg-green-700 hover:bg-green-800 text-white shadow-lg shadow-green-700/20 h-12 px-6"
            onClick={handleUploadClick}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <Upload className="h-5 w-5 mr-2" />
            )}
            Загрузить файл
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-12 px-6"
            onClick={handleNewClick}
          >
            <FilePlus className="h-5 w-5 mr-2" />
            Создать новый
          </Button>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <Code2 className="h-6 w-6 text-green-600 mx-auto mb-2" />
            <div className="text-xs font-medium text-gray-700">VBA & Python</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Макросы и скрипты</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <BarChart3 className="h-6 w-6 text-green-600 mx-auto mb-2" />
            <div className="text-xs font-medium text-gray-700">Анализ данных</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Pandas, Polars, NumPy</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <Zap className="h-6 w-6 text-green-600 mx-auto mb-2" />
            <div className="text-xs font-medium text-gray-700">Быстрая обработка</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Большие файлы</div>
          </div>
        </div>

        {/* Drag hint */}
        <div className="flex items-center justify-center gap-2 text-xs text-gray-400 mb-6">
          <FileDown className="h-4 w-4" />
          <span>Или перетащите файл в это окно</span>
        </div>

        {/* Recent files */}
        {files.length > 0 && (
          <div className="mt-2">
            <h3 className="text-sm font-medium text-gray-600 mb-3">Последние файлы</h3>
            <div className="space-y-2">
              {files.slice(0, 5).map((file) => (
                <button
                  key={file.id}
                  className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl bg-white border border-gray-100 hover:border-green-300 hover:bg-green-50 transition-all text-left shadow-sm hover:shadow"
                  onClick={() => handleRecentFileClick(file)}
                >
                  <FileSpreadsheet className="h-5 w-5 text-green-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-700 truncate">{file.name}</div>
                    <div className="text-xs text-gray-400">
                      {new Date(file.updatedAt).toLocaleDateString('ru-RU')}
                      {file.size && (
                        <span className="ml-2">
                          {file.size > 1024 * 1024
                            ? `${(file.size / (1024 * 1024)).toFixed(1)} МБ`
                            : `${(file.size / 1024).toFixed(1)} КБ`}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Supported libraries */}
        <div className="mt-8 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-gray-400 flex-wrap">
            <Database className="h-3 w-3" />
            <span>openpyxl • pandas • polars • numpy • xlrd • xlsxwriter • xlwt • pyexcel</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ErrorNotification() {
  const error = useExcelStore((s) => s.error)
  const setError = useExcelStore((s) => s.setError)

  if (!error) return null

  return (
    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg shadow-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
      <span>{error}</span>
      <button
        className="p-1 rounded hover:bg-red-100"
        onClick={() => setError(null)}
      >
        ×
      </button>
    </div>
  )
}

function LoadingOverlay() {
  const isLoading = useExcelStore((s) => s.isLoading)

  if (!isLoading) return null

  return (
    <div className="fixed inset-0 z-40 bg-black/10 flex items-center justify-center pointer-events-auto">
      <div className="bg-white rounded-xl px-8 py-5 shadow-2xl flex items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-green-600" />
        <span className="text-sm text-gray-700 font-medium">Загрузка данных...</span>
      </div>
    </div>
  )
}

export default function Home() {
  const api = useExcelApi()
  const activeFile = useExcelStore((s) => s.activeFile)
  const setFiles = useExcelStore((s) => s.setFiles)
  const setBackendAvailable = useExcelStore((s) => s.setBackendAvailable)
  const setActiveFile = useExcelStore((s) => s.setActiveFile)

  const isMainDbMode = activeFile?.id === 'main-db'

  // Check backend availability and load files on mount
  useEffect(() => {
    const init = async () => {
      try {
        const available = await api.checkHealth()
        setBackendAvailable(available)

        if (available) {
          const result = await api.fetchFiles()
          const mappedFiles: FileInfo[] = result.files.map((f) => ({
            id: f.file_id,
            name: f.stored_filename,
            createdAt: new Date(f.modified).getTime(),
            updatedAt: new Date(f.modified).getTime(),
            size: f.file_size,
            filePath: f.file_path,
            sheets: f.sheets,
            extension: f.extension,
          }))
          setFiles(mappedFiles)
        }
      } catch {
        setBackendAvailable(false)
      }
    }
    init()
  }, [api, setFiles, setBackendAvailable])

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-white">
      {/* Title bar */}
      <div className={`flex items-center h-8 text-white px-3 flex-shrink-0 shadow-sm ${
        isMainDbMode
          ? 'bg-gradient-to-r from-amber-600 to-orange-600'
          : 'bg-gradient-to-r from-green-700 to-green-800'
      }`}>
        <div className="flex items-center gap-2">
          {isMainDbMode ? (
            <Database className="h-4 w-4" />
          ) : (
            <Table2 className="h-4 w-4" />
          )}
          <span className="text-xs font-medium">
            {isMainDbMode
              ? 'Основная БД — Сотрудники компании'
              : `Таблица${activeFile ? ` — ${activeFile.name}` : ''}`
            }
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isMainDbMode && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] text-amber-100 hover:text-white hover:bg-amber-700 px-2"
              onClick={() => setActiveFile(null)}
            >
              <ArrowLeft className="h-3 w-3 mr-1" />
              Меню
            </Button>
          )}
          <span className="text-[10px] text-white/60">v1.0</span>
        </div>
      </div>

      {isMainDbMode ? (
        <>
          {/* Main Database Panel */}
          <MainDatabasePanel />
          <StatusBar />
        </>
      ) : activeFile ? (
        <>
          {/* Toolbar */}
          <Toolbar />

          {/* Formula bar */}
          <FormulaBar />

          {/* Main content area */}
          <div className="flex flex-1 min-h-0">
            {/* Sidebar */}
            <Sidebar />

            {/* Grid */}
            <SpreadsheetGrid />
          </div>

          {/* Sheet tabs */}
          <SheetTabs />

          {/* Status bar */}
          <StatusBar />
        </>
      ) : (
        <>
          {/* Minimal toolbar for welcome screen */}
          <div className="flex items-center h-10 border-b border-gray-200 bg-gray-50 px-3 flex-shrink-0">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => useExcelStore.getState().setSidebarOpen(true)}
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                Файлы
              </Button>
            </div>
          </div>

          {/* Welcome Screen */}
          <WelcomeScreen />

          {/* Status bar */}
          <StatusBar />
        </>
      )}

      {/* Overlays */}
      <CellContextMenu />
      <MacroEditor />
      <FindReplaceDialog />
      <ErrorNotification />
      <LoadingOverlay />
    </div>
  )
}
