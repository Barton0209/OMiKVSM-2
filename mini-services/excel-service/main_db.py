"""
Main Database Caching System - Uses SQLite for reliable, memory-efficient storage.
Loads Excel data into SQLite, then uses SQL for all queries.

Key columns (0-based indices): 0, 1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13
"""

import os
import json
import sqlite3
from typing import Optional, List, Dict, Any
from datetime import datetime

import pandas as pd
import numpy as np

UPLOAD_DIR = "/home/z/my-project/upload/"
DB_PATH = os.path.join(UPLOAD_DIR, "main_db.sqlite")
META_PATH = os.path.join(UPLOAD_DIR, "main_db_meta.json")

KEY_COLUMN_INDICES = [0, 1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13]

_cache: Dict[str, Any] = {
    "loaded": False,
    "file_path": None,
    "sheet_name": None,
    "columns": [],
    "key_columns": [],
    "col_mapping": {},
    "loaded_at": None,
    "row_count": 0,
    "col_count": 0,
}


def _nan_to_none(value):
    if value is None:
        return None
    if isinstance(value, float) and np.isnan(value):
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _convert_value_for_json(value):
    if value is None:
        return None
    if isinstance(value, (pd.Timestamp, datetime)):
        return str(value)
    if isinstance(value, float) and np.isnan(value):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        if np.isnan(value):
            return None
        return float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def _get_cell_type(value) -> str:
    if value is None:
        return "null"
    elif isinstance(value, bool):
        return "boolean"
    elif isinstance(value, (int, float)):
        return "number"
    elif isinstance(value, str):
        return "string"
    else:
        return "string"


def _detect_main_db_file() -> Optional[str]:
    if not os.path.isdir(UPLOAD_DIR):
        return None
    xlsx_files = []
    for filename in os.listdir(UPLOAD_DIR):
        if filename.lower().endswith(('.xlsx', '.xlsm')):
            file_path = os.path.join(UPLOAD_DIR, filename)
            if os.path.isfile(file_path):
                xlsx_files.append((file_path, os.path.getsize(file_path), filename))
    if not xlsx_files:
        return None
    for file_path, _, filename in xlsx_files:
        name_lower = filename.lower()
        if '1с' in name_lower or '1c' in name_lower:
            return file_path
    xlsx_files.sort(key=lambda x: x[1], reverse=True)
    return xlsx_files[0][0]


def _match_key_columns(columns: List[str]) -> List[str]:
    matched = []
    for idx in KEY_COLUMN_INDICES:
        if idx < len(columns):
            col_name = columns[idx]
            if col_name not in matched:
                matched.append(col_name)
    return matched


def _sanitize_col_name(name: str) -> str:
    """Sanitize column name for use as SQLite column name."""
    # Replace dots and special chars with underscore
    return name.replace('.', '_').replace(' ', '_').replace('(', '').replace(')', '').replace('-', '_')


def _get_db_connection() -> sqlite3.Connection:
    """Get a connection to the main database with custom Unicode LOWER function."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Register custom LOWER function that handles Unicode/Cyrillic
    conn.create_function("LOWER", 1, lambda x: x.lower() if x else None)
    return conn


def load_main_db(file_path: Optional[str] = None, sheet_name: Optional[str] = None) -> Dict[str, Any]:
    """Load an Excel file into SQLite database."""
    global _cache

    if file_path is None:
        file_path = _detect_main_db_file()
        if file_path is None:
            return {"loaded": False, "error": "No Excel file found in upload directory"}

    if not os.path.exists(file_path):
        return {"loaded": False, "error": f"File not found: {file_path}"}

    try:
        # Read Excel into DataFrame (temporary, will be freed)
        df = pd.read_excel(file_path, sheet_name=sheet_name or 0, engine='openpyxl')

        if sheet_name is None:
            xl = pd.ExcelFile(file_path, engine='openpyxl')
            actual_sheet = xl.sheet_names[0]
            xl.close()
        else:
            actual_sheet = sheet_name

        columns = list(df.columns)
        key_columns = _match_key_columns(columns)
        col_count = len(columns)

        # Sanitize column names for SQLite
        col_mapping = {}  # original -> sanitized
        for col in columns:
            sanitized = _sanitize_col_name(col)
            # Ensure uniqueness
            base = sanitized
            counter = 1
            while sanitized in col_mapping.values():
                sanitized = f"{base}_{counter}"
                counter += 1
            col_mapping[col] = sanitized

        # Remove existing database
        if os.path.exists(DB_PATH):
            os.remove(DB_PATH)

        # Create SQLite database using pandas to_sql (much faster)
        conn = sqlite3.connect(DB_PATH)

        # Sanitize column names for SQLite
        col_mapping = {}
        sanitized_names = []
        for col in columns:
            sanitized = _sanitize_col_name(col)
            base = sanitized
            counter = 1
            while sanitized in sanitized_names:
                sanitized = f"{base}_{counter}"
                counter += 1
            col_mapping[col] = sanitized
            sanitized_names.append(sanitized)

        # Rename DataFrame columns to sanitized names
        df_renamed = df.rename(columns=col_mapping)

        # Write to SQLite using pandas to_sql (very fast)
        df_renamed.to_sql('employees', conn, if_exists='replace', index=False, chunksize=10000)

        # Free the DataFrame memory
        del df
        del df_renamed

        row_count = conn.execute('SELECT COUNT(*) FROM employees').fetchone()[0]

        # Create indexes on key columns for fast search
        for kc in key_columns:
            if kc in col_mapping:
                idx_name = f"idx_{col_mapping[kc]}"
                conn.execute(f'CREATE INDEX IF NOT EXISTS "{idx_name}" ON employees ("{col_mapping[kc]}")')
        conn.commit()
        conn.close()

        # Save metadata
        meta = {
            "file_path": file_path,
            "sheet_name": actual_sheet,
            "columns": columns,
            "key_columns": key_columns,
            "col_mapping": col_mapping,
            "loaded_at": datetime.now().isoformat(),
            "row_count": row_count,
            "col_count": col_count,
        }
        with open(META_PATH, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        # Update cache
        _cache = {
            "loaded": True,
            "file_path": file_path,
            "sheet_name": actual_sheet,
            "columns": columns,
            "key_columns": key_columns,
            "col_mapping": col_mapping,
            "loaded_at": meta["loaded_at"],
            "row_count": row_count,
            "col_count": col_count,
        }

        return {
            "loaded": True,
            "file_path": file_path,
            "sheet_name": actual_sheet,
            "columns": columns,
            "key_columns": key_columns,
            "row_count": row_count,
            "col_count": col_count,
            "loaded_at": meta["loaded_at"],
        }

    except Exception as e:
        return {"loaded": False, "error": f"Failed to load file: {str(e)}"}


def _load_meta_from_disk():
    """Load metadata from disk if cache is empty but database exists."""
    global _cache
    if _cache["loaded"]:
        return True
    if os.path.exists(META_PATH) and os.path.exists(DB_PATH):
        try:
            with open(META_PATH, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            _cache = {
                "loaded": True,
                "file_path": meta["file_path"],
                "sheet_name": meta["sheet_name"],
                "columns": meta["columns"],
                "key_columns": meta["key_columns"],
                "col_mapping": meta["col_mapping"],
                "loaded_at": meta["loaded_at"],
                "row_count": meta["row_count"],
                "col_count": meta["col_count"],
            }
            return True
        except Exception:
            return False
    return False


def is_loaded() -> bool:
    if _cache["loaded"]:
        return True
    return _load_meta_from_disk()


def get_status() -> Dict[str, Any]:
    if not is_loaded():
        return {"loaded": False}
    return {
        "loaded": True,
        "file_path": _cache["file_path"],
        "sheet_name": _cache["sheet_name"],
        "columns": _cache["columns"],
        "key_columns": _cache["key_columns"],
        "row_count": _cache["row_count"],
        "col_count": _cache["col_count"],
        "loaded_at": _cache["loaded_at"],
    }


def get_columns() -> Dict[str, Any]:
    if not is_loaded():
        return {"error": "Main database not loaded", "columns": []}

    key_col_set = set(_cache["key_columns"])
    columns_info = []
    for idx, col_name in enumerate(_cache["columns"]):
        columns_info.append({
            "name": col_name,
            "index": idx,
            "is_key": col_name in key_col_set,
        })

    return {
        "columns": columns_info,
        "total_columns": len(columns_info),
        "key_column_count": len(_cache["key_columns"]),
    }


def get_data(
    offset: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    filters: Optional[Dict[str, str]] = None,
    sort_column: Optional[str] = None,
    sort_ascending: bool = True,
    key_columns_only: bool = False,
) -> Dict[str, Any]:
    if not is_loaded():
        return {"error": "Main database not loaded", "data": [], "total_rows": 0}

    col_mapping = _cache["col_mapping"]

    # Build column list
    if key_columns_only:
        display_cols = [c for c in _cache["key_columns"]]
    else:
        display_cols = list(_cache["columns"])

    select_cols = [f'"{col_mapping[c]}"' for c in display_cols]
    select_clause = ", ".join(select_cols)

    # Build WHERE clause
    where_parts = []
    params = []

    if search:
        search_lower = search.lower()
        search_conditions = []
        for kc in _cache["key_columns"]:
            search_conditions.append(f'LOWER("{col_mapping[kc]}") LIKE ?')
            params.append(f'%{search_lower}%')
        where_parts.append(f'({" OR ".join(search_conditions)})')

    if filters:
        for col_name, filter_value in filters.items():
            if col_name in col_mapping:
                where_parts.append(f'LOWER("{col_mapping[col_name]}") LIKE ?')
                params.append(f'%{filter_value.lower()}%')

    where_clause = f'WHERE {" AND ".join(where_parts)}' if where_parts else ''

    # Build ORDER BY
    order_clause = ''
    if sort_column is not None:
        if sort_column in col_mapping:
            order_col = col_mapping[sort_column]
        else:
            try:
                col_idx = int(sort_column)
                if 0 <= col_idx < len(display_cols):
                    order_col = col_mapping[display_cols[col_idx]]
                else:
                    order_col = None
            except (ValueError, TypeError):
                order_col = None

        if order_col:
            direction = 'ASC' if sort_ascending else 'DESC'
            order_clause = f'ORDER BY "{order_col}" {direction}'

    # Get total count with filters
    conn = _get_db_connection()
    try:
        count_sql = f'SELECT COUNT(*) FROM employees {where_clause}'
        total_filtered = conn.execute(count_sql, params).fetchone()[0]

        # Get data
        data_sql = f'SELECT {select_clause} FROM employees {where_clause} {order_clause} LIMIT ? OFFSET ?'
        data_params = params + [limit, offset]
        rows = conn.execute(data_sql, data_params).fetchall()

        # Convert to cell format
        data = []
        for row_idx, row in enumerate(rows):
            row_data = []
            display_row = offset + row_idx + 2
            for col_idx, col_name in enumerate(display_cols):
                value = row[col_idx]
                json_value = _convert_value_for_json(value) if value is not None else None
                # Try to detect number
                if json_value is not None and isinstance(json_value, str):
                    try:
                        if '.' in json_value:
                            json_value = float(json_value)
                        else:
                            json_value = int(json_value)
                    except (ValueError, TypeError):
                        pass
                cell_info = {
                    "row": display_row,
                    "col": col_idx + 1,
                    "value": json_value,
                    "type": _get_cell_type(json_value),
                    "column": col_name,
                }
                row_data.append(cell_info)
            data.append(row_data)

        has_more = (offset + limit) < total_filtered

        return {
            "data": data,
            "total_rows": total_filtered,
            "total_unfiltered_rows": _cache["row_count"],
            "offset": offset,
            "limit": limit,
            "returned_rows": len(data),
            "has_more": has_more,
            "columns": display_cols,
            "key_columns_only": key_columns_only,
        }
    finally:
        conn.close()


def get_stats() -> Dict[str, Any]:
    if not is_loaded():
        return {"error": "Main database not loaded"}

    conn = _get_db_connection()
    try:
        stats = {
            "total_rows": _cache["row_count"],
            "total_columns": _cache["col_count"],
            "key_column_count": len(_cache["key_columns"]),
            "file_path": _cache["file_path"],
            "sheet_name": _cache["sheet_name"],
            "loaded_at": _cache["loaded_at"],
        }

        col_mapping = _cache["col_mapping"]
        key_col_stats = {}

        for col_name in _cache["key_columns"]:
            if col_name in col_mapping:
                s_col = col_mapping[col_name]
                row_count = conn.execute(f'SELECT COUNT(*) FROM employees WHERE "{s_col}" IS NOT NULL').fetchone()[0]
                null_count = _cache["row_count"] - row_count
                unique_count = conn.execute(f'SELECT COUNT(DISTINCT "{s_col}") FROM employees').fetchone()[0]

                top_values = conn.execute(
                    f'SELECT "{s_col}", COUNT(*) as cnt FROM employees WHERE "{s_col}" IS NOT NULL GROUP BY "{s_col}" ORDER BY cnt DESC LIMIT 10'
                ).fetchall()

                key_col_stats[col_name] = {
                    "unique_count": unique_count,
                    "null_count": null_count,
                    "non_null_count": row_count,
                    "top_values": [{"value": r[0], "count": r[1]} for r in top_values],
                }

        stats["key_column_stats"] = key_col_stats

        # All columns overview
        all_col_stats = []
        for col_name in _cache["columns"]:
            if col_name in col_mapping:
                s_col = col_mapping[col_name]
                null_count = conn.execute(f'SELECT COUNT(*) FROM employees WHERE "{s_col}" IS NULL').fetchone()[0]
                unique_count = conn.execute(f'SELECT COUNT(DISTINCT "{s_col}") FROM employees').fetchone()[0]
                all_col_stats.append({
                    "name": col_name,
                    "dtype": "text",
                    "unique_count": unique_count,
                    "null_count": null_count,
                    "is_key": col_name in set(_cache["key_columns"]),
                })

        stats["all_columns"] = all_col_stats
        stats["memory_usage_mb"] = round(os.path.getsize(DB_PATH) / (1024 * 1024), 2)

        return stats
    finally:
        conn.close()


def search_advanced(
    query: Optional[str] = None,
    key_columns_only: bool = False,
    exact_match: bool = False,
    offset: int = 0,
    limit: int = 100,
) -> Dict[str, Any]:
    """Search using SQL LIKE on key columns."""
    if not is_loaded():
        return {"error": "Main database not loaded", "results": [], "total_rows": 0}

    if query is None:
        return {"error": "Query parameter is required", "results": [], "total_rows": 0}

    # Just use get_data with search - same implementation
    result = get_data(
        offset=offset,
        limit=limit,
        search=query,
        key_columns_only=key_columns_only,
    )

    # Rename 'data' to 'results' for compatibility
    result["results"] = result.pop("data", [])
    result["total_matched"] = result.get("total_rows", 0)
    result["query"] = query
    result["exact_match"] = exact_match

    return result


def clear_cache() -> Dict[str, Any]:
    global _cache
    file_path = _cache.get("file_path")

    # Delete SQLite database
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    if os.path.exists(META_PATH):
        os.remove(META_PATH)

    _cache = {
        "loaded": False,
        "file_path": None,
        "sheet_name": None,
        "columns": [],
        "key_columns": [],
        "col_mapping": {},
        "loaded_at": None,
        "row_count": 0,
        "col_count": 0,
    }
    return {"cleared": True, "previous_file": file_path}
