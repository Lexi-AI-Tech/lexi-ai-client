import React, {
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Content } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { invoke } from "@tauri-apps/api/core";
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
  blockType?: string;
  blockAttrs?: Record<string, any>;
  contextBefore?: string;
  contextAfter?: string;
}

const AskLexiHighlight = Extension.create({
  name: "askLexiHighlight",

  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>("askLexiHighlight");

    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(key);
            let decos = old.map(tr.mapping, tr.doc);
            if (meta && typeof meta === "object" && meta.from && meta.to) {
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.from, meta.to, {
                  class: "docs-ask-lexi-highlight",
                }),
              ]);
            }
            if (meta === "clear") {
              return DecorationSet.empty;
            }
            return decos;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});

export interface RichTextEditorRef {
  /** Insert structured TipTap JSON (full doc or content array) at current position or end */
  insertStructuredContent: (json: string) => void;
  /** Get current selection range and text, or null if empty */
  getSelection: () => DocSelection | null;
  /** Replace the given range with new text (split by double newlines into paragraphs). Only this section is changed. */
  replaceRange: (from: number, to: number, newText: string) => void;
}

export interface RichTextEditorProps {
  /** Initial content (TipTap JSON string or undefined for empty) */
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
    return JSON.parse(content) as Content;
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
  const [askLexiOpen, setAskLexiOpen] = useState(false);
  const [askLexiInstructions, setAskLexiInstructions] = useState("");
  const [askLexiSubmitting, setAskLexiSubmitting] = useState(false);
  const [askLexiSelection, setAskLexiSelection] = useState<DocSelection | null>(
    null,
  );
  /** Bump to force toolbar re-render so isActive() reflects current selection/marks. */
  const [, setToolbarVersion] = useState(0);

  const editor = useEditor({
    extensions: [
      AskLexiHighlight,
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
      handleKeyDown: (view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "k"
        ) {
          const state = view.state;
          const { from, to } = state.selection;
          const doc = state.doc;
          if (from === to) {
            return false;
          }
          const text = doc.textBetween(from, to, "\n");
          if (!text.trim()) {
            return false;
          }
          const $from = doc.resolve(from);
          const block = $from.parent;
          const blockType = block.type.name;
          const blockAttrs = block.attrs;
          const maxContext = 500;
          const docSize = doc.content.size;
          const contextBefore = doc.textBetween(
            Math.max(0, from - maxContext),
            from,
            "\n",
          );
          const contextAfter = doc.textBetween(
            to,
            Math.min(docSize, to + maxContext),
            "\n",
          );
          event.preventDefault();
          setAskLexiSelection({
            from,
            to,
            text,
            blockType,
            blockAttrs,
            contextBefore,
            contextAfter,
          });
          // Add inline highlight decoration while Ask Lexi is open
          view.dispatch(
            state.tr.setMeta(
              (AskLexiHighlight as any).storage?.pluginKey ||
                "askLexiHighlight",
              { from, to },
            ),
          );
          setAskLexiInstructions("");
          setAskLexiOpen(true);
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          // Allow default Enter behavior
        }
        return false;
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
      if (from === to) {
        cb(null);
        return;
      }
      const text = editor.state.doc.textBetween(from, to, "\n");
      if (!text.trim()) {
        cb(null);
        return;
      }
      cb({ from, to, text });
    },
  });

  const askLexiInputRef = useRef<HTMLInputElement | null>(null);
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

  // Sync content when it changes externally (e.g. opening another doc)
  useEffect(() => {
    if (!editor) return;
    const next = parseContent(content);
    const current = editor.getJSON();
    const currentStr = JSON.stringify(current);
    const nextStr = next
      ? JSON.stringify(next)
      : '{"type":"doc","content":[{"type":"paragraph"}]}';
    if (currentStr !== nextStr) {
      editor.commands.setContent(
        next ?? { type: "doc", content: [{ type: "paragraph" }] },
      );
    }
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
          const parsed = JSON.parse(json) as {
            type?: string;
            content?: Content[];
          };
          const nodes =
            parsed?.type === "doc" && Array.isArray(parsed.content)
              ? parsed.content
              : [parsed as Content];
          editor.chain().focus().insertContent(nodes).run();
          const newJson = JSON.stringify(editor.getJSON());
          onUpdateRef.current?.(newJson);
        } catch {
          try {
            editor
              .chain()
              .focus()
              .insertContent([
                { type: "paragraph", content: [{ type: "text", text: json }] },
              ])
              .run();
            const newJson = JSON.stringify(editor.getJSON());
            onUpdateRef.current?.(newJson);
          } catch (_) {}
        }
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
        const content: Content[] = blocks.map((block) => ({
          type: "paragraph",
          content: [{ type: "text", text: block }],
        })) as Content[];
        editor
          .chain()
          .focus()
          .deleteRange({ from, to })
          .insertContentAt(from, content)
          .run();
        const newJson = JSON.stringify(editor.getJSON());
        onUpdateRef.current?.(newJson);
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
        {editable && askLexiOpen && askLexiSelection && (
          <BubbleMenu
            editor={editor}
            shouldShow={({ editor }) =>
              askLexiOpen && !editor.state.selection.empty
            }
          >
            <div className="docs-ask-lexi-popover">
              <input
                ref={(el) => {
                  askLexiInputRef.current = el;
                  if (el) {
                    el.focus();
                    el.select();
                  }
                }}
                className="docs-ask-lexi-input"
                placeholder="Ask Lexi…"
                value={askLexiInstructions}
                onChange={(e) => setAskLexiInstructions(e.target.value)}
                disabled={askLexiSubmitting}
              />
              <button
                type="button"
                className="docs-ask-lexi-btn"
                disabled={askLexiSubmitting || !askLexiInstructions.trim()}
                onClick={async () => {
                  if (!askLexiSelection) return;
                  setAskLexiSubmitting(true);
                  try {
                    const content = await invoke<string>(
                      "rewrite_doc_section",
                      {
                        text: askLexiSelection.text,
                        instructions: askLexiInstructions.trim(),
                        contextBefore: askLexiSelection.contextBefore ?? "",
                        contextAfter: askLexiSelection.contextAfter ?? "",
                      },
                    );
                    const trimmed = content.trim();
                    if (trimmed) {
                      const blocks = trimmed.split(/\n\n+/).filter(Boolean);
                      const blockType =
                        askLexiSelection.blockType ?? "paragraph";
                      const attrs = askLexiSelection.blockAttrs ?? {};
                      const nodes = blocks.map((block) => ({
                        type: blockType,
                        ...(Object.keys(attrs).length ? { attrs } : {}),
                        content: [{ type: "text", text: block }],
                      })) as Content[];
                      editor
                        .chain()
                        .focus()
                        .deleteRange({
                          from: askLexiSelection.from,
                          to: askLexiSelection.to,
                        })
                        .insertContentAt(askLexiSelection.from, nodes)
                        .run();
                      onUpdateRef.current?.(JSON.stringify(editor.getJSON()));
                    }
                    // Clear inline highlight decoration
                    editor.view.dispatch(
                      editor.state.tr.setMeta("askLexiHighlight", "clear"),
                    );
                    setAskLexiOpen(false);
                    setAskLexiSelection(null);
                    setAskLexiInstructions("");
                  } catch {
                    // error handling is surfaced via the outer toast if desired
                  } finally {
                    setAskLexiSubmitting(false);
                  }
                }}
              >
                {askLexiSubmitting ? "…" : "Ask"}
              </button>
            </div>
          </BubbleMenu>
        )}
      </div>
    </div>
  );
});
