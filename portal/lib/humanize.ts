/**
 * Turn a deep-agent tool name into something a person wants to read.
 *
 * Borrowed from langchain-samples/liam-headless-fleet-demo, which had already learned
 * the lesson this portal had to learn the hard way: rendering tool *results* in the
 * transcript floods it with JSON blobs and base64 message ids. Tool activity belongs in
 * a compact, humanized step list; the result body belongs nowhere on screen.
 */
const LABELS: Record<string, string> = {
  read_file: "Reading",
  write_file: "Writing",
  edit_file: "Editing",
  ls: "Browsing files",
  list_files: "Browsing files",
  glob: "Searching files",
  grep: "Searching files",
  find_tools: "Finding tools",
  write_todos: "Planning",
  message_user: "Asking a question",
  task: "Delegating to a subagent",
  web_search: "Searching the web",
  tavily_web_search: "Searching the web",
  exa_web_search: "Searching the web",
  search_docs_by_lang_chain: "Searching the docs",
  query_docs_filesystem_docs_by_lang_chain: "Reading the docs",
  search_api: "Searching the API reference",
  get_symbol: "Reading the API reference",

  // Microsoft 365 — this workspace's agents lean on these heavily, and the raw names
  // ("outlook_calendar_list_events_for_date") make for a poor progress line.
  outlook_read_emails: "Reading email",
  outlook_search_emails: "Searching email",
  outlook_get_email: "Opening an email",
  outlook_send_email: "Sending an email",
  outlook_reply_to_email: "Replying to an email",
  outlook_create_draft: "Drafting an email",
  outlook_mark_as_read: "Marking email read",
  outlook_calendar_get_event: "Checking the calendar",
  outlook_calendar_list_events_for_date: "Checking the calendar",
  outlook_calendar_create_event: "Creating a calendar event",
  outlook_calendar_update_event: "Updating a calendar event",
  outlook_calendar_delete_event: "Deleting a calendar event",
  submit_purchase_order: "Submitting a purchase order",
  onedrive_download_file: "Downloading a file",
  onedrive_upload_file: "Uploading a file",
}

/** Tools whose argument is a path worth showing inline. */
const PATHY = new Set(["read_file", "write_file", "edit_file"])

export function humanizeTool(name: string, arg?: string | null): string {
  const base = LABELS[name] ?? name.replace(/_/g, " ")
  if (arg && PATHY.has(name)) return `${base} ${arg.replace(/^\//, "")}`
  if (arg && name.startsWith("outlook_")) return base
  return base
}
