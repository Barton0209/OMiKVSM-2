"""
Excel Processing Service - FastAPI Application
Provides REST API for Excel file processing with multiple libraries.
"""

import os
import sys
from typing import Optional, List

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import excel_handler
import data_ops
import macro_engine
import main_db
import calendar_db
import reports

app = FastAPI(title="Excel Processing Service", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure upload directory exists
excel_handler.ensure_upload_dir()


# =============================================================================
# Request/Response Models
# =============================================================================

class SheetUpdateRequest(BaseModel):
    file_path: str
    sheet_name: str
    changes: List[dict]

class SheetCreateRequest(BaseModel):
    file_path: str
    sheet_name: str

class SheetDeleteRequest(BaseModel):
    file_path: str
    sheet_name: str

class SheetRenameRequest(BaseModel):
    file_path: str
    old_name: str
    new_name: str

class SortRequest(BaseModel):
    file_path: str
    sheet_name: str
    column: str
    ascending: bool = True
    range: Optional[str] = None

class FilterRequest(BaseModel):
    file_path: str
    sheet_name: str
    column: str
    condition: str
    value: object = None
    range: Optional[str] = None

class FindReplaceRequest(BaseModel):
    file_path: str
    sheet_name: str
    find: str
    replace: str
    range: Optional[str] = None

class PivotRequest(BaseModel):
    file_path: str
    sheet_name: str
    rows: List[str]
    columns: Optional[List[str]] = None
    values: Optional[List[str]] = None
    agg_func: str = "sum"

class MergeCellsRequest(BaseModel):
    file_path: str
    sheet_name: str
    range: str
    action: str = "merge"

class FormatCellsRequest(BaseModel):
    file_path: str
    sheet_name: str
    range: str
    format_type: str
    format_value: object = None

class InsertRowsColsRequest(BaseModel):
    file_path: str
    sheet_name: str
    position: int
    count: int = 1
    direction: str = "rows"

class DeleteRowsColsRequest(BaseModel):
    file_path: str
    sheet_name: str
    position: int
    count: int = 1
    direction: str = "rows"

class ConvertRequest(BaseModel):
    input_path: str
    output_format: str

class MacroExecuteRequest(BaseModel):
    file_path: str
    macro_code: str
    language: str = "vba"

class AnalyzeRequest(BaseModel):
    file_path: str
    sheet_name: str
    range: Optional[str] = None
    operations: List[str] = ["sum", "avg", "count", "min", "max", "std", "median"]

class MainDbLoadRequest(BaseModel):
    file_path: Optional[str] = None
    sheet_name: Optional[str] = None

class MainDbSearchRequest(BaseModel):
    query: str
    key_columns_only: bool = False
    exact_match: bool = False
    offset: int = 0
    limit: int = 100

class ReportRequest(BaseModel):
    report_type: str  # employment_by_period, dismissal_by_period, current_composition, calendar_summary
    year: Optional[int] = None
    month: Optional[int] = None
    citizenship: Optional[str] = None
    territory: Optional[str] = None
    organization: Optional[str] = None
    status: Optional[str] = None
    direction: Optional[str] = None  # Прилет / Вылет (for calendar reports)
    justification: Optional[str] = None
    arrival_status: Optional[str] = None
    worker_type: Optional[str] = None
    department: Optional[str] = None

class CalendarLoadRequest(BaseModel):
    file_path: Optional[str] = None


# =============================================================================
# Health Check
# =============================================================================

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "excel-service", "version": "1.0.0"}


# =============================================================================
# File Operations
# =============================================================================

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload an Excel file, save to upload directory, return file info with sheets list."""
    if not excel_handler.is_excel_file(file.filename):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format. Supported: .xlsx, .xls, .xlsb, .xlsm, .csv, .tsv"
        )

    try:
        content = await file.read()
        result = excel_handler.save_uploaded_file(content, file.filename)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files")
async def list_files():
    """List all uploaded files."""
    try:
        files = excel_handler.list_uploaded_files()
        return {"files": files, "count": len(files)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/file/{file_id}")
async def get_file(file_id: str):
    """Get file metadata by file ID."""
    file_path = excel_handler.find_file_by_id(file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"File not found: {file_id}")

    try:
        info = excel_handler.get_file_info(file_path)
        info["file_id"] = file_id
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/file/{file_id}")
async def delete_file(file_id: str):
    """Delete a file by file ID."""
    file_path = excel_handler.find_file_by_id(file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"File not found: {file_id}")

    try:
        deleted = excel_handler.delete_file(file_path)
        return {"deleted": deleted, "file_id": file_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/download/{file_id}")
async def download_file(file_id: str):
    """Download a file by file ID."""
    file_path = excel_handler.find_file_by_id(file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"File not found: {file_id}")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File no longer exists on disk")

    filename = os.path.basename(file_path)
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream",
    )


# =============================================================================
# Sheet Operations
# =============================================================================

@app.get("/api/sheet-data")
async def get_sheet_data(
    file_path: str = Query(..., description="Path to the Excel file"),
    sheet_name: str = Query(..., description="Name of the sheet"),
    range: Optional[str] = Query(None, description="Cell range like A1:Z100"),
    max_rows: int = Query(10000, description="Maximum rows to return"),
):
    """Get sheet data with optional range and pagination."""
    # Handle relative paths - if just a file_id, resolve it
    if not os.path.isabs(file_path):
        resolved = excel_handler.find_file_by_id(file_path)
        if resolved:
            file_path = resolved
        else:
            file_path = os.path.join(excel_handler.UPLOAD_DIR, file_path)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    try:
        result = excel_handler.read_sheet_data(file_path, sheet_name, range, max_rows)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sheet-update")
async def update_sheet(request: SheetUpdateRequest):
    """Update cell values in a sheet."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = excel_handler.update_cells(request.file_path, request.sheet_name, request.changes)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sheet-create")
async def create_sheet(request: SheetCreateRequest):
    """Create a new sheet."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = excel_handler.create_sheet(request.file_path, request.sheet_name)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/sheet-delete")
async def delete_sheet(request: SheetDeleteRequest):
    """Delete a sheet."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = excel_handler.delete_sheet(request.file_path, request.sheet_name)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sheet-rename")
async def rename_sheet(request: SheetRenameRequest):
    """Rename a sheet."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = excel_handler.rename_sheet(request.file_path, request.old_name, request.new_name)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Data Operations
# =============================================================================

@app.post("/api/sort")
async def sort_data(request: SortRequest):
    """Sort data in a sheet."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = data_ops.sort_data(
            request.file_path, request.sheet_name,
            request.column, request.ascending, request.range
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/filter")
async def filter_data(request: FilterRequest):
    """Filter data based on conditions."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = data_ops.filter_data(
            request.file_path, request.sheet_name,
            request.column, request.condition, request.value, request.range
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/find-replace")
async def find_replace(request: FindReplaceRequest):
    """Find and replace values in a sheet."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = data_ops.find_replace(
            request.file_path, request.sheet_name,
            request.find, request.replace, request.range
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pivot")
async def create_pivot(request: PivotRequest):
    """Create a pivot table."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = data_ops.create_pivot(
            request.file_path, request.sheet_name,
            request.rows, request.columns, request.values, request.agg_func
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/merge-cells")
async def merge_cells(request: MergeCellsRequest):
    """Merge or unmerge cells."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = data_ops.merge_unmerge_cells(
            request.file_path, request.sheet_name,
            request.range, request.action
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/format-cells")
async def format_cells(request: FormatCellsRequest):
    """Format cells in a sheet."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = data_ops.format_cells(
            request.file_path, request.sheet_name,
            request.range, request.format_type, request.format_value
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/insert-rows-cols")
async def insert_rows_cols(request: InsertRowsColsRequest):
    """Insert rows or columns."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = data_ops.insert_rows_cols(
            request.file_path, request.sheet_name,
            request.position, request.count, request.direction
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/delete-rows-cols")
async def delete_rows_cols(request: DeleteRowsColsRequest):
    """Delete rows or columns."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = data_ops.delete_rows_cols(
            request.file_path, request.sheet_name,
            request.position, request.count, request.direction
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/convert")
async def convert_file(request: ConvertRequest):
    """Convert between Excel formats."""
    if not os.path.exists(request.input_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.input_path}")

    try:
        result = excel_handler.convert_file(request.input_path, request.output_format)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ImportError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Macro Operations
# =============================================================================

@app.post("/api/macro/execute")
async def execute_macro(request: MacroExecuteRequest):
    """Execute VBA or Python macro code."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = macro_engine.execute_macro(
            request.file_path, request.macro_code, request.language
        )
        if not result["success"]:
            return JSONResponse(status_code=400, content=result)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/macro/list")
async def list_macros(file_path: str = Query(..., description="Path to the Excel file")):
    """List macros in a file."""
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    try:
        result = macro_engine.list_macros(file_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Analysis
# =============================================================================

@app.post("/api/analyze")
async def analyze_data(request: AnalyzeRequest):
    """Perform statistical analysis on data."""
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")

    try:
        result = data_ops.analyze_data(
            request.file_path, request.sheet_name,
            request.range, request.operations
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sheet-info")
async def get_sheet_info(
    file_path: str = Query(..., description="Path to the Excel file"),
    sheet_name: str = Query(..., description="Name of the sheet"),
):
    """Get sheet dimensions and info."""
    # Handle relative paths
    if not os.path.isabs(file_path):
        resolved = excel_handler.find_file_by_id(file_path)
        if resolved:
            file_path = resolved
        else:
            file_path = os.path.join(excel_handler.UPLOAD_DIR, file_path)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    try:
        result = excel_handler.get_sheet_info(file_path, sheet_name)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Main Database Operations
# =============================================================================

@app.get("/api/main-db/status")
async def main_db_status():
    """Check if main database is loaded, return metadata. Auto-loads if file exists."""
    try:
        result = main_db.get_status()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/main-db/load")
async def main_db_load(request: MainDbLoadRequest):
    """Load an Excel file as the main database. If SQLite DB already exists, just reload meta."""
    try:
        # If already loaded in memory, just return status
        if main_db.is_loaded():
            return main_db.get_status()

        # If database file exists on disk, just reload meta from disk
        if os.path.exists(main_db.DB_PATH) and os.path.exists(main_db.META_PATH):
            main_db._load_meta_from_disk()
            if main_db.is_loaded():
                return main_db.get_status()

        # Otherwise, load from Excel file (this is the expensive operation)
        result = main_db.load_main_db(file_path=request.file_path, sheet_name=request.sheet_name)
        if not result.get("loaded", False):
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to load"))
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/main-db/data")
async def main_db_data(
    offset: int = Query(0, description="Row offset for pagination"),
    limit: int = Query(100, description="Maximum rows to return"),
    search: Optional[str] = Query(None, description="Global search across all columns"),
    filters: Optional[str] = Query(None, description="JSON dict of column_name:filter_value"),
    sort_column: Optional[str] = Query(None, description="Column name or index to sort by"),
    sort_ascending: bool = Query(True, description="Sort ascending"),
    key_columns_only: bool = Query(False, description="Only return key columns"),
):
    """Get paginated data from the main database with optional filters."""
    import json

    parsed_filters = None
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid filters JSON format")

    try:
        result = main_db.get_data(
            offset=offset,
            limit=limit,
            search=search,
            filters=parsed_filters,
            sort_column=sort_column,
            sort_ascending=sort_ascending,
            key_columns_only=key_columns_only,
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/main-db/columns")
async def main_db_columns():
    """Get column info with key column markers."""
    try:
        result = main_db.get_columns()
        if "error" in result and result.get("columns") == []:
            raise HTTPException(status_code=400, detail=result.get("error", "Main database not loaded"))
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/main-db/stats")
async def main_db_stats():
    """Get statistics about the main database."""
    try:
        result = main_db.get_stats()
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/main-db/search")
async def main_db_search(request: MainDbSearchRequest):
    """Advanced search across all or key columns."""
    try:
        result = main_db.search_advanced(
            query=request.query,
            key_columns_only=request.key_columns_only,
            exact_match=request.exact_match,
            offset=request.offset,
            limit=request.limit,
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/main-db/clear")
async def main_db_clear():
    """Clear the main database cache."""
    try:
        result = main_db.clear_cache()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Calendar Database Operations
# =============================================================================

@app.get("/api/calendar/status")
async def calendar_status():
    """Check if calendar database is loaded."""
    try:
        result = calendar_db.get_status()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/calendar/load")
async def calendar_load(request: CalendarLoadRequest):
    """Load the calendar .xlsb file into SQLite database."""
    try:
        if calendar_db.is_loaded():
            return calendar_db.get_status()

        result = calendar_db.load_calendar_db(file_path=request.file_path)
        if not result.get("loaded", False):
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to load calendar file"))
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/calendar/data")
async def calendar_data(
    direction: Optional[str] = Query(None, description="Прилет or Вылет"),
    year: Optional[int] = Query(None, description="Year filter"),
    month: Optional[int] = Query(None, description="Month filter (1-12)"),
    citizenship: Optional[str] = Query(None, description="Citizenship filter"),
    justification: Optional[str] = Query(None, description="Justification filter"),
    arrival_status: Optional[str] = Query(None, description="Arrival status filter"),
    worker_type: Optional[str] = Query(None, description="Worker type filter"),
    department: Optional[str] = Query(None, description="Department filter"),
    search: Optional[str] = Query(None, description="Search across fields"),
    offset: int = Query(0, description="Row offset"),
    limit: int = Query(200, description="Max rows"),
):
    """Get calendar data with filters."""
    try:
        result = calendar_db.get_calendar_data(
            direction=direction,
            year=year,
            month=month,
            citizenship=citizenship,
            justification=justification,
            arrival_status=arrival_status,
            worker_type=worker_type,
            department=department,
            search=search,
            offset=offset,
            limit=limit,
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/calendar/stats")
async def calendar_stats(
    direction: Optional[str] = Query(None, description="Прилет or Вылет"),
    year: Optional[int] = Query(None, description="Year filter"),
    month: Optional[int] = Query(None, description="Month filter"),
):
    """Get calendar statistics."""
    try:
        result = calendar_db.get_calendar_stats(
            direction=direction,
            year=year,
            month=month,
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/calendar/unique-values")
async def calendar_unique_values(
    column: str = Query(..., description="Column name to get unique values for"),
):
    """Get unique values for a calendar column."""
    try:
        result = calendar_db.get_unique_values(column)
        return {"column": column, "values": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/calendar/clear")
async def calendar_clear():
    """Clear the calendar database cache."""
    try:
        result = calendar_db.clear_cache()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Reporting Operations
# =============================================================================

@app.post("/api/reports/generate")
async def generate_report(request: ReportRequest):
    """Generate a statistical report based on filters."""
    try:
        if request.report_type == "employment_by_period":
            result = reports.report_employment_by_period(
                year=request.year,
                month=request.month,
                citizenship=request.citizenship,
                territory=request.territory,
                organization=request.organization,
                status=request.status,
            )
        elif request.report_type == "dismissal_by_period":
            result = reports.report_dismissal_by_period(
                year=request.year,
                month=request.month,
                citizenship=request.citizenship,
                territory=request.territory,
                organization=request.organization,
            )
        elif request.report_type == "current_composition":
            result = reports.report_current_composition(
                status=request.status,
                citizenship=request.citizenship,
                territory=request.territory,
                organization=request.organization,
            )
        elif request.report_type == "calendar_summary":
            result = reports.report_calendar_summary(
                direction=request.direction,
                year=request.year,
                month=request.month,
                citizenship=request.citizenship,
                justification=request.justification,
                arrival_status=request.arrival_status,
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unknown report type: {request.report_type}")

        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/reports/filters")
async def get_report_filters():
    """Get available filter options for report generation."""
    try:
        result = reports.get_available_report_filters()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Startup
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "3031"))
    print(f"Starting Excel Processing Service on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
