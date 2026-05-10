import React, {
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Content } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Heading1,
  Heading2,
  Code,
  Minus,
} from "lucide-react";
import "./docs.css";

export interface DocSelection {
  from: number;
  to: number;
  text: string;
}

export interface RichTextEditorRef {
  /** Insert Markdown at current position or end */
  insertStructuredContent: (markdown: string) => void;
  /** Get current selection range and text, or null if empty */
  getSelection: () => DocSelection | null;
  /** Replace the given range with new text (split by double newlines into paragraphs). Only this section is changed. */
  replaceRange: (from: number, to: number, newText: string) => void;
}

export interface RichTextEditorProps {
  /** Initial content: Markdown string */
  content?: string;
  placeholder?: string;
  editable?: boolean;
  onUpdate?: (markdown: string) => void;
  onTitleChange?: (title: string) => void;
  /** Called when selection changes; null when selection is empty */
  onSelectionChange?: (selection: DocSelection | null) => void;
  /** If provided, show title input above editor */
  title?: string;
  /** When false, hide the title input (e.g. when title is shown in a parent toolbar). Default true */
  showTitle?: boolean;
  /** Optional class for the wrapper */
  className?: string;
}

export const RichTextEditor = forwardRef<
  RichTextEditorRef,
  RichTextEditorProps
>(function RichTextEditor(
  {
    content,
    placeholder = "Start writing…",
    editable = true,
    onUpdate,
    onTitleChange,
    onSelectionChange,
    title: initialTitle,
    showTitle = true,
    className = "",
  },
  ref,
) {
  const [title, setTitle] = React.useState(initialTitle ?? "");
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  /** Bump to force toolbar re-render so isActive() reflects current selection/marks. */
  const [, setToolbarVersion] = useState(0);
  const prevContentPropRef = useRef<string | undefined>(undefined);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
      Markdown,
    ],
    // Provide initial content as Markdown (parsed by @tiptap/markdown).
    content: content ?? "",
    // @tiptap/markdown augments EditorOptions with contentType at runtime,
    // but the @tiptap/react types in this repo don't pick it up reliably.
    ...( { contentType: "markdown" } as any ),
    editable,
    editorProps: {
      attributes: {
        class: "docs-editor-content",
      },
    },
    onUpdate: ({ editor }) => {
      const md = (editor as any).getMarkdown?.() ?? "";
      onUpdate?.(md);
      setToolbarVersion((v) => v + 1);
    },
    onSelectionUpdate: ({ editor }) => {
      setToolbarVersion((v) => v + 1);
      const cb = onSelectionChangeRef.current;
      if (!cb) return;
      const { from, to } = editor.state.selection;
      const doc = editor.state.doc;
      if (from === to) {
        cb(null);
        return;
      }
      const t = doc.textBetween(from, to, "\n");
      if (!t.trim()) cb(null);
      else cb({ from, to, text: t });
    },
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      el.classList.add("is-scrolling");
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        el.classList.remove("is-scrolling");
        scrollTimeoutRef.current = null;
      }, 800);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (prevContentPropRef.current === content) return;
    prevContentPropRef.current = content;
    // Ensure markdown is parsed correctly when switching docs.
    (editor.commands as any).setContent(content ?? "", {
      emitUpdate: false,
      contentType: "markdown",
    });
  }, [editor, content]);

  useEffect(() => {
    if (initialTitle !== undefined && title !== initialTitle) {
      setTitle(initialTitle);
    }
  }, [initialTitle]);

  const notifyTitle = useCallback(() => {
    const t = title.trim() || "Untitled";
    onTitleChange?.(t);
  }, [title, onTitleChange]);

  useImperativeHandle(
    ref,
    () => ({
      insertStructuredContent(markdown: string) {
        if (!editor) return;
        try {
          editor.chain().focus().run();
          // Use the command API so we can pass contentType reliably.
          (editor.commands as any).insertContent(markdown, {
            contentType: "markdown",
          });
          onUpdateRef.current?.(((editor as any).getMarkdown?.() as string) ?? "");
          return;
        } catch (_) {
          // fall through
        }
        try {
          editor
            .chain()
            .focus()
            .insertContent([
              { type: "paragraph", content: [{ type: "text", text: markdown }] },
            ])
            .run();
          onUpdateRef.current?.(((editor as any).getMarkdown?.() as string) ?? "");
        } catch (_) {}
      },
      getSelection(): DocSelection | null {
        if (!editor) return null;
        const { from, to } = editor.state.selection;
        if (from === to) return null;
        const text = editor.state.doc.textBetween(from, to, "\n");
        if (!text.trim()) return null;
        return { from, to, text };
      },
      replaceRange(from: number, to: number, newText: string) {
        if (!editor) return;
        const trimmed = newText.trim();
        if (!trimmed) return;
        const blocks = trimmed.split(/\n\n+/).filter(Boolean);
        const contentNodes: Content[] = blocks.map((block) => ({
          type: "paragraph",
          content: [{ type: "text", text: block }],
        })) as Content[];
        editor
          .chain()
          .focus()
          .deleteRange({ from, to })
          .insertContentAt(from, contentNodes)
          .run();
        onUpdateRef.current?.(((editor as any).getMarkdown?.() as string) ?? "");
      },
    }),
    [editor],
  );

  if (!editor) {
    return (
      <div className={`docs-editor-wrap ${className}`}>
        <div className="docs-editor-loading">Loading editor…</div>
      </div>
    );
  }

  return (
    <div className={`docs-editor-wrap ${className}`}>
      {onTitleChange && showTitle && (
        <input
          className="docs-editor-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={notifyTitle}
          placeholder="Untitled"
          disabled={!editable}
        />
      )}
      {editable && (
        <div className="docs-editor-toolbar">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive("bold") ? "is-active" : ""}
            title="Bold"
          >
            <Bold size={16} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive("italic") ? "is-active" : ""}
            title="Italic"
          >
            <Italic size={16} />
          </button>
          <button
            type="button"
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            className={
              editor.isActive("heading", { level: 1 }) ? "is-active" : ""
            }
            title="Heading 1"
          >
            <Heading1 size={16} />
          </button>
          <button
            type="button"
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            className={
              editor.isActive("heading", { level: 2 }) ? "is-active" : ""
            }
            title="Heading 2"
          >
            <Heading2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive("bulletList") ? "is-active" : ""}
            title="Bullet list"
          >
            <List size={16} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={editor.isActive("orderedList") ? "is-active" : ""}
            title="Numbered list"
          >
            <ListOrdered size={16} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={editor.isActive("blockquote") ? "is-active" : ""}
            title="Quote"
          >
            <Quote size={16} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={editor.isActive("codeBlock") ? "is-active" : ""}
            title="Code block"
          >
            <Code size={16} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Divider"
          >
            <Minus size={16} />
          </button>
        </div>
      )}
      <div className="docs-editor-scroll" ref={scrollRef}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});
