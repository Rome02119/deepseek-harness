/** Types for Google NotebookLM integration via local nlm CLI. */

/** One NotebookLM notebook returned by the nlm CLI. */
export interface NlmNotebook {
  [key: string]: string | number
  readonly id: string
  readonly title: string
  readonly source_count: number
  readonly updated_at: string
}

/** One source document or note inside a notebook. */
export interface NlmSource {
  readonly id: string
  readonly title: string
  readonly type: string
  readonly url: string | null
}

/** One cited reference in a query answer. */
export interface NlmReference {
  [key: string]: string | number
  readonly source_id: string
  readonly citation_number: number
  readonly cited_text: string
}

/** Response from querying a notebook. */
export interface NlmQueryResponse {
  readonly answer: string
  readonly conversation_id: string
  readonly sources_used: readonly string[]
  readonly citations: Readonly<Record<string, string>>
  readonly references: readonly NlmReference[]
}

/** Response from creating a new notebook. */
export interface NlmCreateNotebookResponse {
  readonly notebook_id: string
  readonly title: string
  readonly url?: string | undefined
  readonly message?: string | undefined
}

/** Summary description for a notebook. */
export interface NlmNotebookDescription {
  readonly summary: readonly string[]
  readonly suggested_topics: readonly string[]
}

/** Doctor health diagnosis for nlm CLI. */
export interface NlmDoctorResult {
  readonly installed: boolean
  readonly version?: string | undefined
  readonly cliPath?: string | undefined
  readonly authenticated: boolean
  readonly profile?: string | undefined
  readonly rawOutput: string
  readonly error?: string | undefined
}

/** Snapshot of notebooks returned by the JSON endpoint. */
export interface NotebookListSnapshot {
  readonly checkedAt: string
  readonly notebooks: readonly NlmNotebook[]
  readonly cached: boolean
  readonly error?: string | undefined
  readonly cliPath?: string | undefined
}
