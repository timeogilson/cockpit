import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

/**
 * Rendered Markdown for assistant turns: GFM (tables, strikethrough, task lists)
 * + syntax-highlighted code (rehype-highlight → `.hljs` classes, themed in
 * styles.css). Links open in the OS browser via the main-process window-open
 * handler. Styling lives under `.md-body` in styles.css.
 */
export default function MarkdownView({ children }: { children: string }): JSX.Element {
  return (
    <div className="md-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ children: c, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {c}
            </a>
          )
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
