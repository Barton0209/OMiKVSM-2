'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMainDbStore, type MainDbColumn, type MainDbStatus } from '@/store/main-db-store'
import { useExcelApi } from '@/hooks/use-excel-api'
import { Button } from '@/components/ui/button'
import {
  Search,
  Database,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronFirst,
  ChevronLast,
  RefreshCw,
  Filter,
  Key,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Users,
  Building2,
  Briefcase,
  MapPin,
  Calendar,
  FileSpreadsheet,
  ToggleLeft,
  ToggleRight,
  BarChart3,
} from 'lucide-react'
import ReportsPanel from '@/components/excel/ReportsPanel'

const PAGE_SIZE = 200

// Column short labels for filter chips
function getColumnShortLabel(colName: string): string {
  const map: Record<string, string> = {
    'Табельный номер (с префиксами)': 'Таб. номер',
    'ФИО': 'ФИО',
    'Удостоверение.Серия': 'Серия',
    'Удостоверение.Номер': 'Номер',
    'Организация': 'Организация',
    'Подразделение': 'Подразделение',
    'Должность': 'Должность',
    'Разряд (категория)': 'Разряд',
    'Состояние': 'Состояние',
    'График работы': 'График',
    'Дата приема': 'Дата приема',
    'Дата увольнения': 'Дата увольн.',
    'Страна гражданства': 'Страна',
    'Территория': 'Территория',
    'Дата рождения': 'Дата рожд.',
    'Сотрудник.Дата выхода на работу (Сотрудники)': 'Дата выхода',
    'Место рождения': 'Место рожд.',
    'Удостоверение.Кем выдан': 'Кем выдан',
    'Удостоверение.Дата выдачи': 'Дата выдачи',
    'Физическое лицо.Адрес по прописке': 'Адрес',
    'Физическое лицо.Домашний телефон': 'Тел. дом.',
    'Физическое лицо.Личный мобильный телефон': 'Тел. моб.',
    'Физическое лицо.Рабочий телефон': 'Тел. раб.',
    'Итого': 'Итого',
  }
  return map[colName] || colName.substring(0, 15)
}

function getColumnIcon(colName: string) {
  if (colName.includes('ФИО') || colName.includes('Табельный')) return Users
  if (colName.includes('Организация') || colName.includes('Подразделение')) return Building2
  if (colName.includes('Должность') || colName.includes('Разряд')) return Briefcase
  if (colName.includes('Дата') || colName.includes('График')) return Calendar
  if (colName.includes('Территория') || colName.includes('Страна') || colName.includes('Адрес') || colName.includes('Место')) return MapPin
  return null
}

export default function MainDatabasePanel() {
  const api = useExcelApi()
  const status = useMainDbStore((s) => s.status)
  const columns = useMainDbStore((s) => s.columns)
  const data = useMainDbStore((s) => s.data)
  const totalRows = useMainDbStore((s) => s.totalRows)
  const totalUnfilteredRows = useMainDbStore((s) => s.totalUnfilteredRows)
  const offset = useMainDbStore((s) => s.offset)
  const hasMore = useMainDbStore((s) => s.hasMore)
  const displayedColumns = useMainDbStore((s) => s.displayedColumns)
  const searchQuery = useMainDbStore((s) => s.searchQuery)
  const filters = useMainDbStore((s) => s.filters)
  const sortColumn = useMainDbStore((s) => s.sortColumn)
  const sortAscending = useMainDbStore((s) => s.sortAscending)
  const keyColumnsOnly = useMainDbStore((s) => s.keyColumnsOnly)
  const isLoadingData = useMainDbStore((s) => s.isLoadingData)
  const isLoaded = useMainDbStore((s) => s.isLoaded)
  const isLoadingDb = useMainDbStore((s) => s.isLoadingDb)

  const [localSearch, setLocalSearch] = useState(searchQuery)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [activeView, setActiveView] = useState<'data' | 'reports'>('data')
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Load main database on mount
  useEffect(() => {
    const initMainDb = async () => {
      try {
        useMainDbStore.getState().setIsLoadingDb(true)
        // First check status
        const statusResult = await api.mainDbStatus()

        if (!statusResult.loaded) {
          // Need to explicitly load
          const loadResult = await api.mainDbLoad()
          useMainDbStore.getState().setStatus(loadResult as MainDbStatus)

          if (!loadResult.loaded) {
            useMainDbStore.getState().setIsLoadingDb(false)
            return
          }
        } else {
          useMainDbStore.getState().setStatus(statusResult as MainDbStatus)
        }

        // Fetch columns and data in parallel
        const [columnsResult, dataResult] = await Promise.all([
          api.mainDbColumns(),
          api.mainDbData({ offset: 0, limit: PAGE_SIZE }),
        ])
        useMainDbStore.getState().setColumns(columnsResult.columns || [])
        useMainDbStore.getState().setData(
          dataResult.data || [],
          dataResult.total_rows || 0,
          dataResult.total_unfiltered_rows || 0,
          0,
          dataResult.has_more || false,
          dataResult.columns || []
        )
      } catch (err) {
        console.error('Failed to load main DB:', err)
      } finally {
        useMainDbStore.getState().setIsLoadingDb(false)
      }
    }
    initMainDb()
  }, [api])

  const fetchData = useCallback(async (newOffset?: number) => {
    const store = useMainDbStore.getState()
    const actualOffset = newOffset !== undefined ? newOffset : store.offset
    store.setIsLoadingData(true)
    try {
      const result = await api.mainDbData({
        offset: actualOffset,
        limit: PAGE_SIZE,
        search: store.searchQuery || undefined,
        filters: Object.keys(store.filters).length > 0 ? store.filters : undefined,
        sort_column: store.sortColumn || undefined,
        sort_ascending: store.sortAscending,
        key_columns_only: store.keyColumnsOnly,
      })
      store.setData(
        result.data || [],
        result.total_rows || 0,
        result.total_unfiltered_rows || 0,
        actualOffset,
        result.has_more || false,
        result.columns || []
      )
    } catch (err) {
      console.error('Failed to fetch data:', err)
    } finally {
      store.setIsLoadingData(false)
    }
  }, [api])

  const handleSearch = useCallback((value: string) => {
    setLocalSearch(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      useMainDbStore.getState().setSearchQuery(value)
      fetchData(0)
    }, 500)
  }, [fetchData])

  const handleSort = useCallback((colName: string) => {
    const store = useMainDbStore.getState()
    if (store.sortColumn === colName) {
      store.setSortAscending(!store.sortAscending)
    } else {
      store.setSortColumn(colName)
      store.setSortAscending(true)
    }
    fetchData(0)
  }, [fetchData])

  const handlePageChange = useCallback((newOffset: number) => {
    useMainDbStore.getState().setOffset(newOffset)
    fetchData(newOffset)
    gridRef.current?.scrollTo(0, 0)
  }, [fetchData])

  const handleToggleKeyColumns = useCallback(() => {
    const newVal = !keyColumnsOnly
    useMainDbStore.getState().setKeyColumnsOnly(newVal)
    fetchData(0)
  }, [keyColumnsOnly, fetchData])

  const handleRefresh = useCallback(() => {
    fetchData()
  }, [fetchData])

  const handleClearFilters = useCallback(() => {
    useMainDbStore.getState().clearFilters()
    setLocalSearch('')
    fetchData(0)
  }, [fetchData])

  const keyColumnSet = useMemo(() => new Set(columns.filter(c => c.is_key).map(c => c.name)), [columns])
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.ceil(totalRows / PAGE_SIZE)

  // Loading state
  if (isLoadingDb) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-amber-600 mx-auto mb-4" />
          <p className="text-lg font-semibold text-amber-800">Загрузка Основной Базы Данных...</p>
          <p className="text-sm text-amber-600 mt-1">112 000+ записей сотрудников</p>
        </div>
      </div>
    )
  }

  if (!isLoaded || !status?.loaded) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Database className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-600">Основная БД не загружена</p>
          <Button onClick={() => window.location.reload()} className="mt-4">Обновить</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      {/* Header bar */}
      <div className="bg-gradient-to-r from-amber-600 to-orange-600 text-white px-4 py-2 flex items-center gap-3 flex-shrink-0 shadow-sm">
        <Database className="h-5 w-5" />
        <div className="flex-1">
          <h2 className="text-sm font-bold">Основная База Данных — Сотрудники</h2>
          <p className="text-[10px] text-amber-100">
            {totalUnfilteredRows.toLocaleString('ru-RU')} сотрудников • {status.col_count} столбцов • 12 ключевых столбцов (A:G, I, K:N)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-white hover:bg-amber-700"
            onClick={() => setActiveView(activeView === 'data' ? 'reports' : 'data')}
          >
            <BarChart3 className="h-3.5 w-3.5 mr-1" />
            {activeView === 'data' ? 'Отчеты' : 'Данные'}
          </Button>
          {activeView === 'data' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-white hover:bg-amber-700"
                onClick={handleToggleKeyColumns}
              >
                {keyColumnsOnly ? <ToggleRight className="h-4 w-4 mr-1" /> : <ToggleLeft className="h-4 w-4 mr-1" />}
                {keyColumnsOnly ? 'Все столбцы' : 'Ключевые'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-white hover:bg-amber-700"
                onClick={handleRefresh}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Reports View */}
      {activeView === 'reports' && <ReportsPanel />}

      {/* Data View */}
      {activeView === 'data' && (<>

      {/* Search & Filter bar */}
      <div className="border-b border-gray-200 px-4 py-2 flex items-center gap-3 flex-shrink-0 bg-gray-50">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Поиск по всем столбцам..."
            className="w-full h-8 pl-8 pr-8 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
            value={localSearch}
            onChange={(e) => handleSearch(e.target.value)}
          />
          {localSearch && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              onClick={() => handleSearch('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Active filters */}
        {Object.keys(filters).length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {Object.entries(filters).map(([col, val]) => (
              <span
                key={col}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[11px]"
              >
                <span className="font-medium">{getColumnShortLabel(col)}:</span> {val}
                <button onClick={() => { useMainDbStore.getState().removeFilter(col); fetchData(0) }}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              className="text-[11px] text-gray-500 hover:text-gray-700 underline"
              onClick={handleClearFilters}
            >
              Сбросить
            </button>
          </div>
        )}

        {searchQuery && (
          <span className="text-[11px] text-gray-500">
            Найдено: {totalRows.toLocaleString('ru-RU')} из {totalUnfilteredRows.toLocaleString('ru-RU')}
          </span>
        )}
      </div>

      {/* Data Grid */}
      <div className="flex-1 min-h-0 overflow-auto" ref={gridRef}>
        {isLoadingData && (
          <div className="sticky top-0 z-10 bg-amber-50 border-b border-amber-200 px-3 py-1 text-xs text-amber-700 flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Загрузка...
          </div>
        )}
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-gray-100">
            <tr>
              <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-gray-500 border-b border-r border-gray-200 w-10 bg-gray-100">
                №
              </th>
              {displayedColumns.map((colName, idx) => {
                const isKey = keyColumnSet.has(colName)
                return (
                  <th
                    key={idx}
                    className={`px-2 py-1.5 text-left text-[11px] font-semibold border-b border-r border-gray-200 cursor-pointer select-none whitespace-nowrap ${
                      isKey
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                    onClick={() => handleSort(colName)}
                  >
                    <div className="flex items-center gap-1">
                      {isKey && <Key className="h-3 w-3 text-amber-500 flex-shrink-0" />}
                      <span className="truncate max-w-[150px]">{getColumnShortLabel(colName)}</span>
                      {sortColumn === colName && (
                        sortAscending
                          ? <ArrowUp className="h-3 w-3 text-amber-600 flex-shrink-0" />
                          : <ArrowDown className="h-3 w-3 text-amber-600 flex-shrink-0" />
                      )}
                      {sortColumn !== colName && (
                        <ArrowUpDown className="h-3 w-3 text-gray-300 flex-shrink-0" />
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIdx) => {
              const isSelected = selectedRow === rowIdx
              return (
                <tr
                  key={rowIdx}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-amber-100'
                      : rowIdx % 2 === 0
                        ? 'bg-white hover:bg-amber-50'
                        : 'bg-gray-50 hover:bg-amber-50'
                  }`}
                  onClick={() => setSelectedRow(isSelected ? null : rowIdx)}
                >
                  <td className="px-2 py-1 text-[11px] text-gray-400 border-b border-r border-gray-100 text-right">
                    {offset + rowIdx + 1}
                  </td>
                  {row.map((cell, cellIdx) => {
                    const isKey = keyColumnSet.has(cell.column)
                    const cellValue = cell.value !== null && cell.value !== undefined
                      ? String(cell.value)
                      : ''
                    return (
                      <td
                        key={cellIdx}
                        className={`px-2 py-1 text-[12px] border-b border-r border-gray-100 truncate max-w-[250px] ${
                          isKey
                            ? 'font-medium text-gray-900'
                            : 'text-gray-600'
                        }`}
                        title={cellValue}
                      >
                        {cellValue}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {data.length === 0 && (
              <tr>
                <td colSpan={displayedColumns.length + 1} className="text-center py-12 text-gray-400">
                  <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">Данные не найдены</p>
                  {searchQuery && (
                    <p className="text-xs mt-1">Попробуйте изменить запрос поиска</p>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="text-[11px] text-gray-500">
          Стр. {currentPage} из {totalPages} • Записи {offset + 1}–{Math.min(offset + PAGE_SIZE, totalRows)} из {totalRows.toLocaleString('ru-RU')}
          {totalRows !== totalUnfilteredRows && (
            <span className="text-amber-600"> (фильтр: {totalRows.toLocaleString('ru-RU')} из {totalUnfilteredRows.toLocaleString('ru-RU')})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={offset === 0}
            onClick={() => handlePageChange(0)}
          >
            <ChevronFirst className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={offset === 0}
            onClick={() => handlePageChange(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-[11px] text-gray-600 mx-2">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={!hasMore}
            onClick={() => handlePageChange(offset + PAGE_SIZE)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={!hasMore}
            onClick={() => handlePageChange((totalPages - 1) * PAGE_SIZE)}
          >
            <ChevronLast className="h-4 w-4" />
          </Button>
        </div>
      </div>
      </>)}
    </div>
  )
}
