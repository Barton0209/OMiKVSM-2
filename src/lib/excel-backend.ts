/**
 * Helper constants and types for the Python Excel backend service.
 * The backend runs on port 3031 as a FastAPI service.
 */

export const EXCEL_BACKEND_URL = 'http://localhost:3031'

/** Fetch helper that calls the Python Excel backend. */
export async function backendFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${EXCEL_BACKEND_URL}${path}`
  const response = await fetch(url, options)

  if (!response.ok) {
    let errorMessage = response.statusText
    try {
      const body = await response.json()
      if (body.detail) {
        errorMessage = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
      }
    } catch {
      // ignore JSON parse error
    }
    throw new Error(`Backend error (${response.status}): ${errorMessage}`)
  }

  return response.json() as Promise<T>
}

/** Fetch helper that returns a raw Response (for streaming downloads). */
export async function backendRaw(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${EXCEL_BACKEND_URL}${path}`
  const response = await fetch(url, options)

  if (!response.ok) {
    let errorMessage = response.statusText
    try {
      const body = await response.json()
      if (body.detail) {
        errorMessage = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
      }
    } catch {
      // ignore JSON parse error
    }
    throw new Error(`Backend error (${response.status}): ${errorMessage}`)
  }

  return response
}
