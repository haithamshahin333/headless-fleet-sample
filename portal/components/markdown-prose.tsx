import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Agent output is markdown — headings, bold, numbered lists, tables, fenced code.
 * Rendering it as plain text (which this portal did at first) turns a tidy answer into
 * a wall of asterisks, so it gets a real renderer.
 *
 * Styled by hand rather than with a typography plugin, so every colour comes from the
 * same tokens as the rest of the app and dark mode needs no special casing.
 */
export function MarkdownProse({ children }: { children: string }) {
  return (
    <div className="text-[13px] leading-relaxed [&>*+*]:mt-2.5 [&>:first-child]:mt-0">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h3 className="mt-3 text-[14px] font-semibold tracking-tight" {...p} />,
          h2: (p) => <h4 className="mt-3 text-[13.5px] font-semibold tracking-tight" {...p} />,
          h3: (p) => <h5 className="mt-3 text-[13px] font-semibold" {...p} />,
          p: (p) => <p className="whitespace-pre-wrap" {...p} />,
          ul: (p) => <ul className="ml-4 list-disc space-y-1" {...p} />,
          ol: (p) => <ol className="ml-4 list-decimal space-y-1" {...p} />,
          li: (p) => <li className="pl-0.5 [&>p]:inline" {...p} />,
          strong: (p) => <strong className="font-semibold" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          a: (p) => (
            <a
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
              target="_blank"
              rel="noreferrer noopener"
              {...p}
            />
          ),
          blockquote: (p) => (
            <blockquote className="border-l-2 border-brand-border pl-3 text-muted-foreground" {...p} />
          ),
          hr: () => <hr className="my-3" />,
          code: ({ className, children, ...rest }) => {
            const fenced = /language-/.test(className ?? "")
            if (!fenced) {
              return (
                <code
                  className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]"
                  {...rest}
                >
                  {children}
                </code>
              )
            }
            return (
              <code className="font-mono text-[11.5px]" {...rest}>
                {children}
              </code>
            )
          },
          // Wide content must scroll inside itself; the page must never scroll sideways.
          pre: (p) => (
            <pre
              className="overflow-x-auto rounded-lg bg-muted p-3 ring-1 ring-border/50 font-mono text-[11.5px]"
              {...p}
            />
          ),
          table: (p) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]" {...p} />
            </div>
          ),
          th: (p) => <th className="border px-2 py-1 text-left font-medium" {...p} />,
          td: (p) => <td className="border px-2 py-1 align-top" {...p} />,
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}
