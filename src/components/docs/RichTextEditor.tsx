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
  /** Insert structured TipTap JSON (full doc or content array) at current position or end */
  insertStructuredContent: (json: string) => void;
  /** Get current selection range and text, or null if empty */
  getSelection: () => DocSelection | null;
  /** Replace the given range with new text (split by double newlines into paragraphs). Only this section is changed. */
  replaceRange: (from: number, to: number, newText: string) => void;
}

export interface RichTextEditorProps {
  /** Initial content: TipTap/ProseMirror JSON document as string */
  content?: string;
  placeholder?: string;
  editable?: boolean;
  onUpdate?: (json: string) => void;
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

const parseContent = (content: string | undefined): Content | undefined => {
  if (!content || !content.trim()) return undefined;
  try {
    const parsed = JSON.parse(content) as { type?: string };
    if (!parsed || typeof parsed !== "object" || parsed.type !== "doc") {
      return undefined;
    }
    return parsed as Content;
  } catch {
    return undefined;
  }
};

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
    ],
    content: parseContent(content),
    editable,
    editorProps: {
      attributes: {
        class: "docs-editor-content",
      },
    },
    onUpdate: ({ editor }) => {
      const json = JSON.stringify(editor.getJSON());
      onUpdate?.(json);
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
    const next = parseContent(content);
    editor.commands.setContent(
      next ?? { type: "doc", content: [{ type: "paragraph" }] },
      { emitUpdate: false },
    );
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
      insertStructuredContent(json: string) {
        if (!editor) return;
        try {
          const parsed = JSON.parse(json) as { type?: string; content?: Content[] };
          const nodes =
            parsed?.type === "doc" && Array.isArray(parsed.content)
              ? parsed.content
              : [parsed as Content];
          editor.chain().focus().insertContent(nodes).run();
          onUpdateRef.current?.(JSON.stringify(editor.getJSON()));
          return;
        } catch {
          // fall through to plain text insert
        }
        try {
          editor
            .chain()
            .focus()
            .insertContent([
              { type: "paragraph", content: [{ type: "text", text: json }] },
            ])
            .run();
          onUpdateRef.current?.(JSON.stringify(editor.getJSON()));
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
        onUpdateRef.current?.(JSON.stringify(editor.getJSON()));
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
