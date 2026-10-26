/**
 * Runs once when the server starts. A misconfigured portal stops here with every problem
 * listed, instead of starting and failing on each request. In Kubernetes that shows as a
 * pod that will not start, with the list in its logs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  // `next build` loads this file too; configuration is a runtime concern only.
  if (process.env.NEXT_PHASE === "phase-production-build") return

  const { configNotes, configProblems } = await import("./lib/config")
  const problems = configProblems()
  if (problems.length) {
    console.error(
      `[portal] cannot start: ${problems.length} configuration problem${problems.length > 1 ? "s" : ""}\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    )
    process.exit(1)
  }
  for (const note of configNotes()) console.info(`[portal] ${note}`)
}
