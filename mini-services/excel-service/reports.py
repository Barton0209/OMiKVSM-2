"""
Reporting Engine - Generates various statistical reports from Main DB and Calendar DB.
"""

import os
import sqlite3
import json
from typing import Optional, Dict, Any, List
from datetime import datetime

import pandas as pd
import numpy as np

UPLOAD_DIR = "/home/z/my-project/upload/"
MAIN_DB_PATH = os.path.join(UPLOAD_DIR, "main_db.sqlite")
CALENDAR_DB_PATH = os.path.join(UPLOAD_DIR, "calendar_db.sqlite")
MAIN_META_PATH = os.path.join(UPLOAD_DIR, "main_db_meta.json")


def _safe_int(val, default=None):
    """Safely convert a value to int."""
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def _get_main_db_conn() -> Optional[sqlite3.Connection]:
    if not os.path.exists(MAIN_DB_PATH):
        return None
    conn = sqlite3.connect(MAIN_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.create_function("LOWER", 1, lambda x: x.lower() if x else None)
    return conn


def _get_calendar_db_conn() -> Optional[sqlite3.Connection]:
    if not os.path.exists(CALENDAR_DB_PATH):
        return None
    conn = sqlite3.connect(CALENDAR_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.create_function("LOWER", 1, lambda x: x.lower() if x else None)
    return conn


def _load_col_mapping() -> Dict[str, str]:
    """Load column mapping from metadata."""
    if os.path.exists(MAIN_META_PATH):
        with open(MAIN_META_PATH, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        return meta.get("col_mapping", {})
    return {}


# ==================== MAIN DB REPORTS ====================

def report_employment_by_period(
    year: Optional[int] = None,
    month: Optional[int] = None,
    citizenship: Optional[str] = None,
    territory: Optional[str] = None,
    organization: Optional[str] = None,
    status: Optional[str] = None,
) -> Dict[str, Any]:
    """Report on employees hired (Дата приема) by period with filters."""
    conn = _get_main_db_conn()
    if conn is None:
        return {"error": "Main database not loaded"}

    try:
        col_mapping = _load_col_mapping()
        date_col = col_mapping.get("Дата приема", "Дата_приема")
        dismissal_col = col_mapping.get("Дата увольнения", "Дата_увольнения")
        status_col = col_mapping.get("Состояние", "Состояние")
        citizenship_col = col_mapping.get("Страна гражданства", "Страна_гражданства")
        territory_col = col_mapping.get("Территория", "Территория")
        org_col = col_mapping.get("Организация", "Организация")

        # Build WHERE clause
        where_parts = [f'"{date_col}" IS NOT NULL AND "{date_col}" != ""']
        params = []

        if citizenship:
            where_parts.append(f'LOWER("{citizenship_col}") LIKE ?')
            params.append(f'%{citizenship.lower()}%')
        if territory:
            where_parts.append(f'LOWER("{territory_col}") LIKE ?')
            params.append(f'%{territory.lower()}%')
        if organization:
            where_parts.append(f'LOWER("{org_col}") LIKE ?')
            params.append(f'%{organization.lower()}%')
        if status:
            where_parts.append(f'LOWER("{status_col}") LIKE ?')
            params.append(f'%{status.lower()}%')

        where_clause = f'WHERE {" AND ".join(where_parts)}'

        # By year
        by_year = conn.execute(
            f'''
            SELECT SUBSTR("{date_col}", 1, 4) as yr, COUNT(*) as cnt
            FROM employees {where_clause}
            AND LENGTH(SUBSTR("{date_col}", 1, 4)) = 4
            AND SUBSTR("{date_col}", 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
            GROUP BY yr ORDER BY yr
            ''', params
        ).fetchall()

        # By year-month
        by_month = conn.execute(
            f'''
            SELECT SUBSTR("{date_col}", 1, 4) as yr,
                   SUBSTR("{date_col}", 4, 2) as mn,
                   SUBSTR("{date_col}", 1, 7) as period,
                   COUNT(*) as cnt
            FROM employees {where_clause}
            AND LENGTH(SUBSTR("{date_col}", 1, 4)) = 4
            AND SUBSTR("{date_col}", 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
            GROUP BY yr, mn ORDER BY yr, mn
            ''', params
        ).fetchall()

        # Also try with different date formats (DD.MM.YYYY)
        by_year_v2 = conn.execute(
            f'''
            SELECT SUBSTR("{date_col}", 7, 4) as yr, COUNT(*) as cnt
            FROM employees {where_clause}
            AND SUBSTR("{date_col}", 3, 1) = '.'
            AND LENGTH("{date_col}") >= 10
            AND SUBSTR("{date_col}", 7, 4) GLOB '[0-9][0-9][0-9][0-9]'
            GROUP BY yr ORDER BY yr
            ''', params
        ).fetchall()

        by_month_v2 = conn.execute(
            f'''
            SELECT SUBSTR("{date_col}", 7, 4) as yr,
                   SUBSTR("{date_col}", 4, 2) as mn,
                   SUBSTR("{date_col}", 7, 4) || '-' || SUBSTR("{date_col}", 4, 2) as period,
                   COUNT(*) as cnt
            FROM employees {where_clause}
            AND SUBSTR("{date_col}", 3, 1) = '.'
            AND LENGTH("{date_col}") >= 10
            AND SUBSTR("{date_col}", 7, 4) GLOB '[0-9][0-9][0-9][0-9]'
            GROUP BY yr, mn ORDER BY yr, mn
            ''', params
        ).fetchall()

        # Use whichever format gives better results
        if len(by_year_v2) > len(by_year):
            by_year_final = [{"year": _safe_int(r[0]), "count": r[1]} for r in by_year_v2 if r[0] and _safe_int(r[0])]
            by_month_final = [{"year": _safe_int(r[0]), "month": _safe_int(r[1]), "period": r[2], "count": r[3]} for r in by_month_v2 if r[0] and _safe_int(r[0])]
        else:
            by_year_final = [{"year": _safe_int(r[0]), "count": r[1]} for r in by_year if r[0] and _safe_int(r[0])]
            by_month_final = [{"year": _safe_int(r[0]), "month": _safe_int(r[1]), "period": r[2], "count": r[3]} for r in by_month if r[0] and _safe_int(r[0])]

        # Filter by requested year/month if specified
        filtered_by_month = by_month_final
        if year:
            filtered_by_month = [r for r in filtered_by_month if r.get("year") == year]
        if month:
            filtered_by_month = [r for r in filtered_by_month if r.get("month") == month]

        # By citizenship for the filtered data
        citizenship_filter = list(params)
        citizenship_where = f'WHERE {" AND ".join(where_parts)}'
        by_citizenship = conn.execute(
            f'''
            SELECT "{citizenship_col}", COUNT(*) as cnt
            FROM employees {citizenship_where}
            AND "{date_col}" IS NOT NULL AND "{date_col}" != ""
            GROUP BY "{citizenship_col}" ORDER BY cnt DESC LIMIT 20
            ''', citizenship_filter
        ).fetchall()

        # By territory
        by_territory = conn.execute(
            f'''
            SELECT "{territory_col}", COUNT(*) as cnt
            FROM employees {citizenship_where}
            AND "{date_col}" IS NOT NULL AND "{date_col}" != ""
            GROUP BY "{territory_col}" ORDER BY cnt DESC LIMIT 20
            ''', citizenship_filter
        ).fetchall()

        # Total count
        total = conn.execute(
            f'SELECT COUNT(*) FROM employees {where_clause}', params
        ).fetchone()[0]

        return {
            "report_type": "employment_by_period",
            "title": "Трудоустройство по периодам",
            "total": total,
            "by_year": by_year_final,
            "by_month": filtered_by_month if (year or month) else by_month_final,
            "by_citizenship": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_citizenship],
            "by_territory": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_territory],
            "filters_applied": {
                "year": year,
                "month": month,
                "citizenship": citizenship,
                "territory": territory,
                "organization": organization,
                "status": status,
            }
        }
    finally:
        conn.close()


def report_dismissal_by_period(
    year: Optional[int] = None,
    month: Optional[int] = None,
    citizenship: Optional[str] = None,
    territory: Optional[str] = None,
    organization: Optional[str] = None,
) -> Dict[str, Any]:
    """Report on employees dismissed (Дата увольнения) by period with filters."""
    conn = _get_main_db_conn()
    if conn is None:
        return {"error": "Main database not loaded"}

    try:
        col_mapping = _load_col_mapping()
        dismissal_col = col_mapping.get("Дата увольнения", "Дата_увольнения")
        citizenship_col = col_mapping.get("Страна гражданства", "Страна_гражданства")
        territory_col = col_mapping.get("Территория", "Территория")
        org_col = col_mapping.get("Организация", "Организация")
        status_col = col_mapping.get("Состояние", "Состояние")

        where_parts = [f'"{dismissal_col}" IS NOT NULL AND "{dismissal_col}" != ""']
        params = []

        if citizenship:
            where_parts.append(f'LOWER("{citizenship_col}") LIKE ?')
            params.append(f'%{citizenship.lower()}%')
        if territory:
            where_parts.append(f'LOWER("{territory_col}") LIKE ?')
            params.append(f'%{territory.lower()}%')
        if organization:
            where_parts.append(f'LOWER("{org_col}") LIKE ?')
            params.append(f'%{organization.lower()}%')

        where_clause = f'WHERE {" AND ".join(where_parts)}'

        # By year (DD.MM.YYYY format)
        by_year = conn.execute(
            f'''
            SELECT SUBSTR("{dismissal_col}", 7, 4) as yr, COUNT(*) as cnt
            FROM employees {where_clause}
            AND SUBSTR("{dismissal_col}", 3, 1) = '.'
            AND LENGTH("{dismissal_col}") >= 10
            AND SUBSTR("{dismissal_col}", 7, 4) GLOB '[0-9][0-9][0-9][0-9]'
            GROUP BY yr ORDER BY yr
            ''', params
        ).fetchall()

        # Try YYYY format
        by_year_v1 = conn.execute(
            f'''
            SELECT SUBSTR("{dismissal_col}", 1, 4) as yr, COUNT(*) as cnt
            FROM employees {where_clause}
            AND SUBSTR("{dismissal_col}", 5, 1) = '-'
            AND SUBSTR("{dismissal_col}", 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
            GROUP BY yr ORDER BY yr
            ''', params
        ).fetchall()

        if len(by_year_v1) > len(by_year):
            by_year = by_year_v1
            is_ddmm = False
        else:
            is_ddmm = True

        # By month
        if is_ddmm:
            by_month = conn.execute(
                f'''
                SELECT SUBSTR("{dismissal_col}", 7, 4) as yr,
                       SUBSTR("{dismissal_col}", 4, 2) as mn,
                       SUBSTR("{dismissal_col}", 7, 4) || '-' || SUBSTR("{dismissal_col}", 4, 2) as period,
                       COUNT(*) as cnt
                FROM employees {where_clause}
                AND SUBSTR("{dismissal_col}", 3, 1) = '.'
                AND LENGTH("{dismissal_col}") >= 10
                AND SUBSTR("{dismissal_col}", 7, 4) GLOB '[0-9][0-9][0-9][0-9]'
                GROUP BY yr, mn ORDER BY yr, mn
                ''', params
            ).fetchall()
        else:
            by_month = conn.execute(
                f'''
                SELECT SUBSTR("{dismissal_col}", 1, 4) as yr,
                       SUBSTR("{dismissal_col}", 6, 2) as mn,
                       SUBSTR("{dismissal_col}", 1, 7) as period,
                       COUNT(*) as cnt
                FROM employees {where_clause}
                AND SUBSTR("{dismissal_col}", 5, 1) = '-'
                AND SUBSTR("{dismissal_col}", 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
                GROUP BY yr, mn ORDER BY yr, mn
                ''', params
            ).fetchall()

        by_year_final = [{"year": _safe_int(r[0]), "count": r[1]} for r in by_year if r[0] and _safe_int(r[0])]
        by_month_final = [{"year": _safe_int(r[0]), "month": _safe_int(r[1]), "period": r[2], "count": r[3]} for r in by_month if r[0] and _safe_int(r[0])]

        filtered_by_month = by_month_final
        if year:
            filtered_by_month = [r for r in filtered_by_month if r.get("year") == year]
        if month:
            filtered_by_month = [r for r in filtered_by_month if r.get("month") == month]

        # By citizenship
        by_citizenship = conn.execute(
            f'''
            SELECT "{citizenship_col}", COUNT(*) as cnt
            FROM employees {where_clause}
            GROUP BY "{citizenship_col}" ORDER BY cnt DESC LIMIT 20
            ''', params
        ).fetchall()

        # By territory
        by_territory = conn.execute(
            f'''
            SELECT "{territory_col}", COUNT(*) as cnt
            FROM employees {where_clause}
            GROUP BY "{territory_col}" ORDER BY cnt DESC LIMIT 20
            ''', params
        ).fetchall()

        # By status
        by_status = conn.execute(
            f'''
            SELECT "{status_col}", COUNT(*) as cnt
            FROM employees {where_clause}
            GROUP BY "{status_col}" ORDER BY cnt DESC
            ''', params
        ).fetchall()

        total = conn.execute(
            f'SELECT COUNT(*) FROM employees {where_clause}', params
        ).fetchone()[0]

        return {
            "report_type": "dismissal_by_period",
            "title": "Увольнения по периодам",
            "total": total,
            "by_year": by_year_final,
            "by_month": filtered_by_month if (year or month) else by_month_final,
            "by_citizenship": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_citizenship],
            "by_territory": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_territory],
            "by_status": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_status],
            "filters_applied": {
                "year": year,
                "month": month,
                "citizenship": citizenship,
                "territory": territory,
                "organization": organization,
            }
        }
    finally:
        conn.close()


def report_current_composition(
    status: Optional[str] = None,
    citizenship: Optional[str] = None,
    territory: Optional[str] = None,
    organization: Optional[str] = None,
) -> Dict[str, Any]:
    """Report on current employee composition by status, citizenship, territory."""
    conn = _get_main_db_conn()
    if conn is None:
        return {"error": "Main database not loaded"}

    try:
        col_mapping = _load_col_mapping()
        status_col = col_mapping.get("Состояние", "Состояние")
        citizenship_col = col_mapping.get("Страна гражданства", "Страна_гражданства")
        territory_col = col_mapping.get("Территория", "Территория")
        org_col = col_mapping.get("Организация", "Организация")
        dept_col = col_mapping.get("Подразделение", "Подразделение")
        pos_col = col_mapping.get("Должность", "Должность")

        where_parts = []
        params = []

        if status:
            where_parts.append(f'LOWER("{status_col}") LIKE ?')
            params.append(f'%{status.lower()}%')
        if citizenship:
            where_parts.append(f'LOWER("{citizenship_col}") LIKE ?')
            params.append(f'%{citizenship.lower()}%')
        if territory:
            where_parts.append(f'LOWER("{territory_col}") LIKE ?')
            params.append(f'%{territory.lower()}%')
        if organization:
            where_parts.append(f'LOWER("{org_col}") LIKE ?')
            params.append(f'%{organization.lower()}%')

        where_clause = f'WHERE {" AND ".join(where_parts)}' if where_parts else ''

        # By status
        by_status = conn.execute(
            f'SELECT "{status_col}", COUNT(*) as cnt FROM employees {where_clause} GROUP BY "{status_col}" ORDER BY cnt DESC',
            params
        ).fetchall()

        # By citizenship
        by_citizenship = conn.execute(
            f'SELECT "{citizenship_col}", COUNT(*) as cnt FROM employees {where_clause} GROUP BY "{citizenship_col}" ORDER BY cnt DESC LIMIT 20',
            params
        ).fetchall()

        # By territory
        by_territory = conn.execute(
            f'SELECT "{territory_col}", COUNT(*) as cnt FROM employees {where_clause} GROUP BY "{territory_col}" ORDER BY cnt DESC LIMIT 20',
            params
        ).fetchall()

        # By organization
        by_organization = conn.execute(
            f'SELECT "{org_col}", COUNT(*) as cnt FROM employees {where_clause} GROUP BY "{org_col}" ORDER BY cnt DESC LIMIT 20',
            params
        ).fetchall()

        # By department (top 20)
        by_department = conn.execute(
            f'SELECT "{dept_col}", COUNT(*) as cnt FROM employees {where_clause} GROUP BY "{dept_col}" ORDER BY cnt DESC LIMIT 20',
            params
        ).fetchall()

        # By position (top 20)
        by_position = conn.execute(
            f'SELECT "{pos_col}", COUNT(*) as cnt FROM employees {where_clause} GROUP BY "{pos_col}" ORDER BY cnt DESC LIMIT 20',
            params
        ).fetchall()

        # Cross-tab: status x citizenship
        cross_status_citizenship = conn.execute(
            f'''
            SELECT "{status_col}", "{citizenship_col}", COUNT(*) as cnt
            FROM employees {where_clause}
            GROUP BY "{status_col}", "{citizenship_col}"
            ORDER BY cnt DESC LIMIT 50
            ''', params
        ).fetchall()

        total = conn.execute(f'SELECT COUNT(*) FROM employees {where_clause}', params).fetchone()[0]

        return {
            "report_type": "current_composition",
            "title": "Текущий состав сотрудников",
            "total": total,
            "by_status": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_status],
            "by_citizenship": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_citizenship],
            "by_territory": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_territory],
            "by_organization": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_organization],
            "by_department": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_department],
            "by_position": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_position],
            "cross_status_citizenship": [
                {"status": r[0] or "Не указано", "citizenship": r[1] or "Не указано", "count": r[2]}
                for r in cross_status_citizenship
            ],
            "filters_applied": {
                "status": status,
                "citizenship": citizenship,
                "territory": territory,
                "organization": organization,
            }
        }
    finally:
        conn.close()


def report_calendar_summary(
    direction: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    citizenship: Optional[str] = None,
    justification: Optional[str] = None,
    arrival_status: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate calendar report (Прилет/Вылет) with filters."""
    from calendar_db import get_calendar_stats, is_loaded as cal_loaded

    if not cal_loaded():
        return {"error": "Calendar database not loaded. Please load the calendar file first."}

    stats = get_calendar_stats(
        direction=direction,
        year=year,
        month=month,
    )

    # Add additional filtered queries
    conn = _get_calendar_db_conn()
    if conn is None:
        return stats

    try:
        where_parts = []
        params = []

        if direction:
            where_parts.append('direction = ?')
            params.append(direction)
        if year:
            where_parts.append('year = ?')
            params.append(year)
        if month:
            where_parts.append('month = ?')
            params.append(month)
        if citizenship:
            where_parts.append('LOWER(citizenship) LIKE ?')
            params.append(f'%{citizenship.lower()}%')
        if justification:
            where_parts.append('LOWER(justification) LIKE ?')
            params.append(f'%{justification.lower()}%')
        if arrival_status:
            where_parts.append('LOWER(arrival_status) LIKE ?')
            params.append(f'%{arrival_status.lower()}%')

        where_clause = f'WHERE {" AND ".join(where_parts)}' if where_parts else ''

        total = conn.execute(f'SELECT COUNT(*) FROM calendar_records {where_clause}', params).fetchone()[0]

        # By justification for filtered data
        by_justification = conn.execute(
            f'SELECT justification, COUNT(*) as cnt FROM calendar_records {where_clause} GROUP BY justification ORDER BY cnt DESC',
            params
        ).fetchall()

        # By citizenship for filtered data
        by_citizenship = conn.execute(
            f'SELECT citizenship, COUNT(*) as cnt FROM calendar_records {where_clause} GROUP BY citizenship ORDER BY cnt DESC',
            params
        ).fetchall()

        # By arrival status for filtered data
        by_arrival_status = conn.execute(
            f'SELECT arrival_status, COUNT(*) as cnt FROM calendar_records {where_clause} GROUP BY arrival_status ORDER BY cnt DESC',
            params
        ).fetchall()

        # Monthly breakdown
        by_month = conn.execute(
            f'SELECT year, month, direction, COUNT(*) as cnt FROM calendar_records {where_clause} GROUP BY year, month, direction ORDER BY year, month',
            params
        ).fetchall()

        return {
            "report_type": "calendar_summary",
            "title": f"Календарь {'Прилет' if direction == 'Прилет' else 'Вылет' if direction == 'Вылет' else 'Прилет/Вылет'}",
            "total": total,
            "by_justification": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_justification],
            "by_citizenship": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_citizenship],
            "by_arrival_status": [{"name": r[0] or "Не указано", "count": r[1]} for r in by_arrival_status],
            "by_month": [{"year": r[0], "month": r[1], "direction": r[2], "count": r[3]} for r in by_month],
            "filters_applied": {
                "direction": direction,
                "year": year,
                "month": month,
                "citizenship": citizenship,
                "justification": justification,
                "arrival_status": arrival_status,
            }
        }
    finally:
        conn.close()


def get_main_db_unique_values(column: str) -> List[str]:
    """Get unique values for a main DB column."""
    conn = _get_main_db_conn()
    if conn is None:
        return []

    try:
        col_mapping = _load_col_mapping()
        s_col = col_mapping.get(column)
        if not s_col:
            return []

        rows = conn.execute(
            f'SELECT DISTINCT "{s_col}" FROM employees WHERE "{s_col}" IS NOT NULL AND "{s_col}" != "" ORDER BY "{s_col}"'
        ).fetchall()
        return [r[0] for r in rows if r[0]]
    finally:
        conn.close()


def get_available_report_filters() -> Dict[str, Any]:
    """Get available filter options for all report types."""
    result = {
        "main_db": {},
        "calendar": {},
    }

    # Main DB filters
    conn = _get_main_db_conn()
    if conn:
        try:
            col_mapping = _load_col_mapping()
            for col_name, key in [
                ("Состояние", "statuses"),
                ("Страна гражданства", "citizenships"),
                ("Территория", "territories"),
                ("Организация", "organizations"),
            ]:
                s_col = col_mapping.get(col_name)
                if s_col:
                    rows = conn.execute(
                        f'SELECT DISTINCT "{s_col}" FROM employees WHERE "{s_col}" IS NOT NULL AND "{s_col}" != "" ORDER BY "{s_col}"'
                    ).fetchall()
                    result["main_db"][key] = [r[0] for r in rows if r[0]]

            # Available years from employment dates
            date_col = col_mapping.get("Дата приема", "Дата_приема")
            rows = conn.execute(
                f'SELECT DISTINCT SUBSTR("{date_col}", 7, 4) FROM employees '
                f'WHERE SUBSTR("{date_col}", 3, 1) = \'.\' '
                f'AND SUBSTR("{date_col}", 7, 4) GLOB \'[0-9][0-9][0-9][0-9]\' '
                f'ORDER BY SUBSTR("{date_col}", 7, 4)'
            ).fetchall()
            result["main_db"]["employment_years"] = [int(r[0]) for r in rows if r[0]]

            dismissal_col = col_mapping.get("Дата увольнения", "Дата_увольнения")
            rows = conn.execute(
                f'SELECT DISTINCT SUBSTR("{dismissal_col}", 7, 4) FROM employees '
                f'WHERE SUBSTR("{dismissal_col}", 3, 1) = \'.\' '
                f'AND SUBSTR("{dismissal_col}", 7, 4) GLOB \'[0-9][0-9][0-9][0-9]\' '
                f'ORDER BY SUBSTR("{dismissal_col}", 7, 4)'
            ).fetchall()
            result["main_db"]["dismissal_years"] = [int(r[0]) for r in rows if r[0]]

        finally:
            conn.close()

    # Calendar filters
    from calendar_db import is_loaded as cal_loaded, get_unique_values
    if cal_loaded():
        result["calendar"]["citizenships"] = get_unique_values("citizenship")
        result["calendar"]["justifications"] = get_unique_values("justification")
        result["calendar"]["arrival_statuses"] = get_unique_values("arrival_status")
        result["calendar"]["directions"] = ["Прилет", "Вылет"]
        result["calendar"]["worker_types"] = get_unique_values("worker_type")
        result["calendar"]["departments"] = get_unique_values("department")

        conn2 = _get_calendar_db_conn()
        if conn2:
            try:
                rows = conn2.execute('SELECT DISTINCT year FROM calendar_records WHERE year IS NOT NULL ORDER BY year').fetchall()
                result["calendar"]["years"] = [r[0] for r in rows]
                rows = conn2.execute('SELECT DISTINCT month FROM calendar_records WHERE month IS NOT NULL ORDER BY month').fetchall()
                result["calendar"]["months"] = [r[0] for r in rows]
            finally:
                conn2.close()

    return result
